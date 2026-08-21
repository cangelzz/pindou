import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { getMessages, loadProject, setupPage, stageReply, FIXTURES_DIR } from "./helpers";

const languageButton = (page: import("@playwright/test").Page) => page.locator('[data-menu-id="language"]');

test("English UI switches to Chinese and persists across reload", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en", systemLanguage: "en" });
  await expect(languageButton(page)).toHaveText("🌐 中文");
  await expect(languageButton(page)).toHaveAttribute("title", "Switch to Chinese");
  await languageButton(page).click();
  await expect(languageButton(page)).toHaveText("🌐 EN");
  await expect(languageButton(page)).toHaveAttribute("title", "切换到英文");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect((await getMessages(page)).some((message) => message.type === "storageSet" && message.key === "pindou.uiLanguage" && message.value === "zh-CN")).toBe(true);

  await page.reload();
  await page.waitForFunction(() => (window as any)._webviewReady === true);
  await expect(languageButton(page)).toHaveText("🌐 EN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("Chinese initial UI offers English", async ({ page }) => {
  await setupPage(page, { savedLanguage: "zh-CN", systemLanguage: "en" });
  await expect(languageButton(page)).toHaveText("🌐 EN");
  await expect(languageButton(page)).toHaveAttribute("aria-label", "切换到英文");
});

test("language switching preserves editor state", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en" });
  await loadProject(page);
  const before = await page.evaluate(() => ((state: any) => ({
    canvasData: state.canvasData,
    canvasSize: state.canvasSize,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    currentTool: state.currentTool,
    selectedColor: state.selectedColor,
    zoom: state.zoom,
    panOffset: state.panOffset,
    previewData: state.previewData,
    referenceImage: state.referenceImage,
    gridConfig: state.gridConfig,
    projectInfo: state.projectInfo,
    isDirty: state.isDirty,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    selection: state.selection ? [...state.selection] : null,
    selectionBounds: state.selectionBounds,
    cloudGistId: state.cloudGistId,
    cloudSyncStatus: state.cloudSyncStatus,
    projectId: state.projectId,
    projectPath: state.projectPath,
    projectDocument: state.projectDocument,
    saveStatus: state.saveStatus,
    autoSaveEnabled: state.autoSaveEnabled,
    lastAutosaveErrorCode: state.lastAutosaveErrorCode,
    snapshots: state.snapshots,
  }))((window as any).__pindouStore.getState()));
  await languageButton(page).click();
  const after = await page.evaluate(() => ((state: any) => ({
    canvasData: state.canvasData,
    canvasSize: state.canvasSize,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    currentTool: state.currentTool,
    selectedColor: state.selectedColor,
    zoom: state.zoom,
    panOffset: state.panOffset,
    previewData: state.previewData,
    referenceImage: state.referenceImage,
    gridConfig: state.gridConfig,
    projectInfo: state.projectInfo,
    isDirty: state.isDirty,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    selection: state.selection ? [...state.selection] : null,
    selectionBounds: state.selectionBounds,
    cloudGistId: state.cloudGistId,
    cloudSyncStatus: state.cloudSyncStatus,
    projectId: state.projectId,
    projectPath: state.projectPath,
    projectDocument: state.projectDocument,
    saveStatus: state.saveStatus,
    autoSaveEnabled: state.autoSaveEnabled,
    lastAutosaveErrorCode: state.lastAutosaveErrorCode,
    snapshots: state.snapshots,
  }))((window as any).__pindouStore.getState()));
  expect(after).toEqual(before);
});

test("image wizard language switch preserves file, preview, crop and settings", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en" });
  await page.locator('[data-menu-id="import-image"]').click();
  await stageReply(page, "showOpenDialog", "/fixture.png");
  await stageReply(page, "readFile", { data: fs.readFileSync(path.join(FIXTURES_DIR, "sample-32x32.png")).toString("base64") });
  await page.getByRole("button", { name: "Choose File" }).click();
  await expect(page.getByText(/Original:\s*32×32/)).toBeVisible();

  await page.getByLabel("Maximum side (keep aspect ratio)").count().catch(() => 0);
  const numberInputs = page.getByRole("spinbutton");
  await numberInputs.first().fill("26");
  await page.getByLabel("Euclidean (RGB)").check();
  await page.getByLabel("Sharp edges (recommended for line art)").check();
  const cropCanvas = page.getByTestId("crop-canvas");
  const box = await cropCanvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 4, box!.y + 4);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.up();
  const cropBefore = await page.getByText(/Selection:/).innerText();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText(/Image size:/)).toBeVisible();
  const before = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll("h2")].find((node) => node.textContent === "Import Image")?.closest(".fixed");
    return {
      dialog: !!dialog,
      canvasCount: dialog?.querySelectorAll("canvas").length,
      values: [...(dialog?.querySelectorAll("input, select") ?? [])].map((node: any) => ({ type: node.type, value: node.value, checked: node.checked })),
      file: dialog?.textContent?.includes("/fixture.png"),
    };
  });

  await languageButton(page).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("heading", { name: "导入图片" })).toBeVisible();
  const after = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll("h2")].find((node) => node.textContent === "导入图片")?.closest(".fixed");
    return {
      dialog: !!dialog,
      canvasCount: dialog?.querySelectorAll("canvas").length,
      values: [...(dialog?.querySelectorAll("input, select") ?? [])].map((node: any) => ({ type: node.type, value: node.value, checked: node.checked })),
      file: dialog?.textContent?.includes("/fixture.png"),
    };
  });
  expect(after).toEqual(before);
  const cropDims = cropBefore.match(/\d+×\d+/)?.[0];
  expect(cropDims).toBeTruthy();
  await expect(page.getByText(new RegExp(`选区：\\s*${cropDims}`))).toBeVisible();
  await expect(page.getByText(/图片尺寸：/)).toBeVisible();
});

test("persistence failure keeps Chinese UI and shows translated alert", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en", storageError: true });
  await languageButton(page).click();
  await expect(languageButton(page)).toHaveText("🌐 EN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByText("无法保存语言偏好")).toBeVisible();
});
