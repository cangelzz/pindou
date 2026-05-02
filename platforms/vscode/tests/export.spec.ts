import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  stageReply,
  getWrites,
  callAction,
  clearMessages,
} from "./helpers";

async function openExportDialog(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "导出" })
    .filter({ hasNot: page.locator("[disabled]") })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "导出高分辨率图片" })
    .waitFor({ timeout: 5_000 });
}

function decodeBase64Header(b64: string): number[] {
  const bin = Buffer.from(b64, "base64");
  return [bin[0], bin[1], bin[2], bin[3]];
}

test.describe("Export", () => {
  test.afterAll(() => cleanupHarness());

  test("export blueprint PNG → writeFile called with PNG bytes", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    // The dialog needs a save path
    await stageReply(page, "showSaveDialog", "/out/test.png");

    await clearMessages(page);
    // Click the dialog's 导出 button (the only one inside the modal that's enabled)
    await page.getByRole("button", { name: /^导出$/ }).last().click();

    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile"),
      null,
      { timeout: 10_000 }
    );

    const writes = await getWrites(page);
    const fileWrite = writes.find((w: any) => w.kind === "writeFile" && w.path === "/out/test.png");
    expect(fileWrite).toBeTruthy();

    const header = decodeBase64Header(fileWrite.data);
    expect(header).toEqual([0x89, 0x50, 0x4e, 0x47]); // PNG signature
  });

  test("export with cancelled save dialog → no writeFile", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    await stageReply(page, "showSaveDialog", null);
    await clearMessages(page);
    await page.getByRole("button", { name: /^导出$/ }).last().click();
    await page.waitForTimeout(500);

    const writes = await getWrites(page);
    expect(writes.find((w: any) => w.kind === "writeFile")).toBeFalsy();
  });

  test("export with mirror also writes a mirrored file", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    // Enable mirror checkbox
    await page.getByLabel(/同时导出左右镜像/).check();
    await stageReply(page, "showSaveDialog", "/out/test.png");
    // Mirror file is written without a separate dialog (path derived from base)
    await clearMessages(page);

    await page.getByRole("button", { name: /^导出$/ }).last().click();
    await page.waitForFunction(
      () => (window as any)._writes.filter((w: any) => w.kind === "writeFile").length >= 2,
      null,
      { timeout: 15_000 }
    );

    const writes = await getWrites(page);
    const fileWrites = writes.filter((w: any) => w.kind === "writeFile");
    expect(fileWrites.length).toBeGreaterThanOrEqual(2);

    // Both should be PNG
    for (const w of fileWrites) {
      const header = decodeBase64Header(w.data);
      expect(header).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
    // Mirror filename should differ from the original
    const paths = fileWrites.map((w: any) => w.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("export preview JPG → writeFile called with JPEG bytes", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    // Switch off blueprint, on preview (preview-only path uses its own save dialog)
    await page.getByLabel(/图纸（带网格线/).uncheck();
    await page.getByLabel(/效果图（模拟/).check();

    await stageReply(page, "showSaveDialog", "/out/test_preview.jpg");

    await clearMessages(page);
    await page.getByRole("button", { name: /^导出$/ }).last().click();

    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile"),
      null,
      { timeout: 10_000 }
    );

    const writes = await getWrites(page);
    const previewWrite = writes.find(
      (w: any) => w.kind === "writeFile" && /\.jpe?g$/i.test(w.path)
    );
    expect(previewWrite).toBeTruthy();
    const header = decodeBase64Header(previewWrite.data);
    expect(header.slice(0, 3)).toEqual([0xff, 0xd8, 0xff]); // JPEG SOI
  });
});
