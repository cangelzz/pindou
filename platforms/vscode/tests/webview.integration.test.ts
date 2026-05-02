import { test, expect } from "@playwright/test";
import * as fs from "fs";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  getMessages,
  countRenderedPixels,
  TEST_DATA,
  DIST_DIR,
} from "./helpers";
import * as path from "path";

test.describe("VS Code webview critical paths", () => {
  test.beforeAll(() => {
    const indexJs = path.join(DIST_DIR, "assets/index.js");
    if (!fs.existsSync(indexJs)) {
      throw new Error(
        `Built webview not found at ${indexJs}. Run 'npm run build:webview' first.`
      );
    }
  });

  test.afterAll(() => {
    cleanupHarness();
  });

  test("loads .pindou file and renders pixels", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const pixels = await countRenderedPixels(page);
    expect(pixels).toBeGreaterThan(100);
  });

  test("file path appears in status bar after loading", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const inDom = await page.evaluate(() => {
      const text = document.body.textContent || "";
      return text.includes("asuka71x100.pindou");
    });
    expect(inDom).toBe(true);
  });

  test("Ctrl+S on existing file posts 'save' (not 'showSaveDialog')", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
      )
    );
    await page.waitForTimeout(300);

    const types = (await getMessages(page)).map((m: any) => m.type);
    expect(types).toContain("save");
    expect(types).not.toContain("showSaveDialog");
  });

  test("canvas survives a save echo (not cleared)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const before = await countRenderedPixels(page);
    expect(before).toBeGreaterThan(100);

    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
      )
    );
    await page.waitForTimeout(800);

    const after = await countRenderedPixels(page);
    expect(after).toBeGreaterThanOrEqual(before * 0.8);
  });

  test("projectInfo title is reflected in document.title", async ({ page }) => {
    await setupPage(page);

    const projectData = JSON.parse(fs.readFileSync(TEST_DATA, "utf-8"));
    projectData.projectInfo = { title: "Test Title", author: "Test Author" };
    const tempFile = path.join(DIST_DIR, "test-with-info.pindou");
    fs.writeFileSync(tempFile, JSON.stringify(projectData));

    try {
      await loadProject(page, { samplePath: tempFile, virtualPath: "/test/with-info.pindou" });
      const title = await page.title();
      expect(title).toContain("Test Title");
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  });
});
