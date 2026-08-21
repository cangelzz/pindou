import { test, expect, type Page } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  clearMessages,
  getMessages,
  getStoreState,
  setStoreState,
  stageReply,
  callAction,
} from "./helpers";

async function clickNew(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^新建$/ }).first().click();
}

async function dirtyLoadedProject(page: Page): Promise<void> {
  await loadProject(page, { virtualPath: "/original/project.pindou" });
  await callAction(page, "setCell", [0, 0, 0]);
  await setStoreState(page, {
    cloudGistId: "gist-original",
    cloudUpdatedAt: "2026-08-18T10:00:00Z",
    cloudProjectName: "云端项目",
    saveStatus: { kind: "saved", at: "10:00:00" },
  });
}

async function stateSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const s = (window as any).__pindouStore.getState();
    return {
      canvasSize: s.canvasSize,
      canvasData: s.canvasData,
      layers: s.layers,
      gridConfig: s.gridConfig,
      projectInfo: s.projectInfo,
      projectPath: s.projectPath,
      projectDocument: s.projectDocument,
      projectGeneration: s.projectGeneration,
      cloudGistId: s.cloudGistId,
      cloudUpdatedAt: s.cloudUpdatedAt,
      cloudProjectName: s.cloudProjectName,
      baselineCanvasData: s.baselineCanvasData,
      saveStatus: s.saveStatus,
      isDirty: s.isDirty,
    };
  });
}

test.describe("New project dirty-state contract", () => {
  test.afterAll(() => cleanupHarness());

  test("dirty project cancellation preserves the complete project state", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await dirtyLoadedProject(page);
    const before = await stateSnapshot(page);

    await clickNew(page);
    await expect(page.getByText(/未保存.*丢失/)).toBeVisible();
    await page.getByRole("button", { name: /^取消$/ }).click();

    await expect(page.getByText(/未保存.*丢失/)).toBeHidden();
    expect(await stateSnapshot(page)).toEqual(before);
  });

  test("dirty confirmation followed by size-dialog cancellation preserves state", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await dirtyLoadedProject(page);
    const before = await stateSnapshot(page);

    await clickNew(page);
    await page.getByRole("button", { name: /^继续$/ }).click();
    await expect(page.getByRole("heading", { name: "新建画布" })).toBeVisible();
    await page.getByRole("button", { name: /^取消$/ }).click();

    expect(await stateSnapshot(page)).toEqual(before);
  });

  test("clean project opens the size dialog without an extra warning", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await loadProject(page);
    expect(await getStoreState(page, "isDirty")).toBe(false);

    await clickNew(page);

    await expect(page.getByRole("heading", { name: "新建画布" })).toBeVisible();
    await expect(page.getByText(/未保存.*丢失/)).toHaveCount(0);
  });

  test("VS Code host request receives dimensions and leaves current document untouched", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await dirtyLoadedProject(page);
    const before = await stateSnapshot(page);
    await clearMessages(page);

    await clickNew(page);
    await page.getByRole("button", { name: /^继续$/ }).click();
    const dialog = page.getByRole("heading", { name: "新建画布" }).locator("..");
    await dialog.locator('input[type="number"]').nth(0).fill("31");
    await dialog.locator('input[type="number"]').nth(1).fill("47");
    await dialog.getByRole("button", { name: /^创建$/ }).click();

    await page.waitForFunction(() => (window as any)._messages.some((m: any) => m.type === "newProject"));
    const request = (await getMessages(page)).find((m: any) => m.type === "newProject");
    expect(request).toMatchObject({ width: 31, height: 47 });
    expect(await stateSnapshot(page)).toEqual(before);
  });

  test("a clean request that becomes dirty must warn before creation", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await loadProject(page);
    await page.evaluate(() => { delete (window as any).__pindouRequestNewProject; });

    await clickNew(page);
    await expect(page.getByRole("heading", { name: "新建画布" })).toBeVisible();
    await callAction(page, "setCell", [0, 0, 0]);
    await page.getByRole("button", { name: /^创建$/ }).click();

    await expect(page.getByText(/未保存.*丢失/)).toBeVisible();
    expect(await getStoreState(page, "isDirty")).toBe(true);
    expect(await getStoreState(page, "projectPath")).not.toBeNull();
  });

  test("non-host creation after dirty confirmation replaces the project and clears identity", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await dirtyLoadedProject(page);
    await page.evaluate(() => { delete (window as any).__pindouRequestNewProject; });

    await clickNew(page);
    await page.getByRole("button", { name: /^继续$/ }).click();
    const dialog = page.getByRole("heading", { name: "新建画布" }).locator("..");
    await dialog.locator('input[type="number"]').nth(0).fill("19");
    await dialog.locator('input[type="number"]').nth(1).fill("23");
    await dialog.getByRole("button", { name: /^创建$/ }).click();

    expect(await getStoreState(page, "canvasSize")).toEqual({ width: 19, height: 23 });
    expect(await getStoreState(page, "projectPath")).toBeNull();
    expect(await getStoreState(page, "projectDocument")).toBeNull();
    expect(await getStoreState(page, "cloudGistId")).toBeNull();
    expect(await getStoreState(page, "baselineCanvasData")).toBeNull();
    expect(await getStoreState(page, "saveStatus")).toBeNull();
    expect(await getStoreState(page, "isDirty")).toBe(false);
  });

  test("stale dirty confirmation cannot act after another document is opened", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await dirtyLoadedProject(page);
    await clickNew(page);
    await expect(page.getByText(/未保存.*丢失/)).toBeVisible();

    await loadProject(page, { virtualPath: "/original/project.pindou" });
    const replacement = await stateSnapshot(page);
    await clearMessages(page);
    await page.getByRole("button", { name: /^继续$/ }).click();

    await expect(page.getByRole("heading", { name: "新建画布" })).toHaveCount(0);
    expect((await getMessages(page)).some((m: any) => m.type === "newProject")).toBe(false);
    expect(await stateSnapshot(page)).toEqual(replacement);
  });

  test("restoreSnapshot makes an open size dialog stale", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await loadProject(page);
    await clickNew(page);
    await expect(page.getByRole("heading", { name: "新建画布" })).toBeVisible();
    const snapshot = {
      version: 2,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: 5 }]],
      createdAt: "before",
      updatedAt: "before",
    };
    await stageReply(page, "readFile", { data: Buffer.from(JSON.stringify(snapshot)).toString("base64") });
    expect(await callAction(page, "restoreSnapshot", ["/snapshot.pindou"])).toMatchObject({ ok: true });
    await clearMessages(page);

    await page.getByRole("button", { name: /^创建$/ }).click();

    await expect(page.getByRole("heading", { name: "新建画布" })).toHaveCount(0);
    expect((await getMessages(page)).some((m: any) => m.type === "newProject")).toBe(false);
  });

  test("host requestNewProject message uses the same dirty guard", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await dirtyLoadedProject(page);

    await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "requestNewProject" } })));

    await expect(page.getByText(/未保存.*丢失/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "新建画布" })).toHaveCount(0);
  });

  test("host requestNewProject message opens dimensions directly when clean", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await loadProject(page);

    await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "requestNewProject" } })));

    await expect(page.getByRole("heading", { name: "新建画布" })).toBeVisible();
    await expect(page.getByText(/未保存.*丢失/)).toHaveCount(0);
  });

  test("newCanvas resets content, identity, cloud, save and transient state", async ({ page }) => {
    await setupPage(page, { savedLanguage: "zh-CN" });
    await dirtyLoadedProject(page);
    await setStoreState(page, {
      importedFileName: "old.png",
      lastAutosaveErrorCode: "permission-denied",
      selection: new Set(["0,0"]),
      clipboard: { cells: new Map([["0,0", { colorIndex: 0 }]]), width: 1, height: 1 },
      previewOverlay: new Map([["0,0", 1]]),
      adjustSession: { layerId: "old", cells: new Map(), srcIndices: [], used: [] },
    });

    await callAction(page, "newCanvas", [13, 17]);
    const state = await page.evaluate(() => {
      const s = (window as any).__pindouStore.getState();
      return {
        canvasSize: s.canvasSize,
        canvasData: s.canvasData,
        gridConfig: s.gridConfig,
        layers: s.layers,
        activeLayerId: s.activeLayerId,
        projectPath: s.projectPath,
        projectDocument: s.projectDocument,
        projectInfo: s.projectInfo,
        importedFileName: s.importedFileName,
        cloudGistId: s.cloudGistId,
        cloudUpdatedAt: s.cloudUpdatedAt,
        cloudProjectName: s.cloudProjectName,
        baselineCanvasData: s.baselineCanvasData,
        saveStatus: s.saveStatus,
        lastAutosaveErrorCode: s.lastAutosaveErrorCode,
        selection: s.selection,
        clipboard: s.clipboard,
        previewOverlay: s.previewOverlay,
        adjustSession: s.adjustSession,
        undoStack: s.undoStack,
        redoStack: s.redoStack,
        isDirty: s.isDirty,
      };
    });

    expect(state.canvasSize).toEqual({ width: 13, height: 17 });
    expect(state.canvasData).toHaveLength(17);
    expect(state.canvasData[0]).toHaveLength(13);
    expect(state.layers).toHaveLength(1);
    expect(state.layers[0].id).toBe(state.activeLayerId);
    expect(state.layers[0].data).toEqual(state.canvasData);
    expect(state.gridConfig.groupSize).toBeGreaterThan(0);
    expect(state).toMatchObject({
      projectPath: null,
      projectDocument: null,
      importedFileName: null,
      cloudGistId: null,
      cloudUpdatedAt: null,
      cloudProjectName: null,
      baselineCanvasData: null,
      saveStatus: null,
      lastAutosaveErrorCode: null,
      selection: null,
      clipboard: null,
      previewOverlay: null,
      adjustSession: null,
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
    expect(state.projectInfo).toBeUndefined();

    await callAction(page, "setCell", [0, 0, 0]);
    expect(await getStoreState(page, "isDirty")).toBe(true);
  });
});
