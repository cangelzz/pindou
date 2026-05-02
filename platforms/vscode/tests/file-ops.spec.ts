import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  getMessages,
  getWrites,
  clearMessages,
  stageReply,
  getStoreState,
  callAction,
  clickButton,
} from "./helpers";

test.describe("File operations", () => {
  test.afterAll(() => cleanupHarness());

  test("Save (existing file): posts 'save' message, no dialog", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await clearMessages(page);

    await callAction(page, "saveProject");
    await page.waitForTimeout(200);

    const types = (await getMessages(page)).map((m: any) => m.type);
    expect(types).toContain("save");
    expect(types).not.toContain("showSaveDialog");
    expect(types).not.toContain("saveAs");
  });

  test("Save As: posts 'saveAs' with the new path (regression for 0.8.5)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await clearMessages(page);

    const newPath = "/picked/somewhere-else.pindou";
    await stageReply(page, "showSaveDialog", newPath);

    await callAction(page, "saveProjectAs");
    // saveAs is async — wait for the writeback round-trip
    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "saveAs"),
      null,
      { timeout: 5_000 }
    );

    const writes = await getWrites(page);
    const saveAs = writes.find((w: any) => w.kind === "saveAs");
    expect(saveAs).toBeTruthy();
    expect(saveAs.path).toBe(newPath);
    // Content should be valid JSON with canvasSize/canvasData
    const parsed = JSON.parse(saveAs.content);
    expect(parsed.canvasSize).toBeTruthy();
    expect(parsed.canvasData).toBeTruthy();
  });

  test("Save As: cancel dialog → no save fires", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await clearMessages(page);

    await stageReply(page, "showSaveDialog", null); // user cancels

    await callAction(page, "saveProjectAs");
    await page.waitForTimeout(300);

    const writes = await getWrites(page);
    expect(writes.find((w: any) => w.kind === "saveAs")).toBeFalsy();
    expect(writes.find((w: any) => w.kind === "save")).toBeFalsy();
  });

  test("New Project (untitled): Save shows dialog (regression for 0.8.6)", async ({ page }) => {
    await setupPage(page);
    // Simulate `pindouverse.newProject` opening an untitled temp file
    await loadProject(page, {
      isUntitled: true,
      virtualPath: "C:/users/foo/AppData/.../untitled_1234.pindou",
    });
    // The webview should NOT carry the temp path into projectPath
    expect(await getStoreState(page, "projectPath")).toBeNull();

    await clearMessages(page);
    await stageReply(page, "showSaveDialog", "/somewhere/real.pindou");

    await callAction(page, "saveProject");
    await page.waitForFunction(
      () => (window as any)._messages.some((m: any) => m.type === "showSaveDialog"),
      null,
      { timeout: 5_000 }
    );

    const types = (await getMessages(page)).map((m: any) => m.type);
    expect(types).toContain("showSaveDialog");
    // And the actual write should target the picked path (saveAs branch since
    // path != currentDocPath)
    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "saveAs"),
      null,
      { timeout: 5_000 }
    );
    const writes = await getWrites(page);
    const w = writes.find((x: any) => x.kind === "saveAs");
    expect(w?.path).toBe("/somewhere/real.pindou");
  });

  test("In-app newCanvas clears projectPath", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    expect(await getStoreState(page, "projectPath")).toBeTruthy();

    await callAction(page, "newCanvas", [20, 20]);

    expect(await getStoreState(page, "projectPath")).toBeNull();
    const size = await getStoreState<{ width: number; height: number }>(page, "canvasSize");
    expect(size.width).toBe(20);
    expect(size.height).toBe(20);
  });

  test("After newCanvas, Save prompts for destination", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [16, 16]);
    await clearMessages(page);

    await stageReply(page, "showSaveDialog", "/new-thing.pindou");
    await callAction(page, "saveProject");
    await page.waitForFunction(
      () => (window as any)._messages.some((m: any) => m.type === "showSaveDialog"),
      null,
      { timeout: 5_000 }
    );

    const types = (await getMessages(page)).map((m: any) => m.type);
    expect(types).toContain("showSaveDialog");
  });

  test("Open: posts showOpenDialog and loads result", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await clearMessages(page);

    // Stage the file picker reply, then the readFile reply with a tiny project
    const tinyProject = {
      version: 1,
      canvasSize: { width: 8, height: 8 },
      canvasData: Array.from({ length: 8 }, () =>
        Array.from({ length: 8 }, (_, c) => ({ colorIndex: c % 2 === 0 ? 0 : null }))
      ),
    };
    const base64 = Buffer.from(JSON.stringify(tinyProject)).toString("base64");

    await stageReply(page, "showOpenDialog", "/picked.pindou");
    await stageReply(page, "readFile", { data: base64 });

    await callAction(page, "openProject");
    await page.waitForFunction(
      () => {
        const s = (window as any).__pindouStore.getState();
        return s.canvasSize.width === 8;
      },
      null,
      { timeout: 5_000 }
    );

    expect(await getStoreState(page, "projectPath")).toBe("/picked.pindou");
  });

  test("Edit dirties; save clears dirty", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    expect(await getStoreState(page, "isDirty")).toBe(false);

    // Make any change via store action
    await callAction(page, "setCell", [0, 0, 0]);
    expect(await getStoreState(page, "isDirty")).toBe(true);

    await callAction(page, "saveProject");
    await page.waitForFunction(
      () => (window as any).__pindouStore.getState().isDirty === false,
      null,
      { timeout: 5_000 }
    );
    expect(await getStoreState(page, "isDirty")).toBe(false);
  });
});
