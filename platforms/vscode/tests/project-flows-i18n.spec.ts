import { test, expect, type Page } from "@playwright/test";
import { setupPage, loadProject, callAction, stageReply } from "./helpers";

const cases = [
  { language: "en", projectInfo: "Project Info", resize: "Resize Canvas", width: "Width", height: "Height", cancel: "Cancel", save: "Save", dirty: "Unsaved Changes", newText: /Creating a new project will discard/, openText: /Opening another project will discard/ },
  { language: "zh-CN", projectInfo: "项目信息", resize: "调整画布", width: "宽", height: "高", cancel: "取消", save: "保存", dirty: "未保存的修改", newText: /继续新建会丢失/, openText: /继续打开会丢失/ },
] as const;

for (const locale of cases) {
  test(`project info and resize are fully translated (${locale.language})`, async ({ page }) => {
    await setupPage(page, { savedLanguage: locale.language });
    await page.locator('[data-menu-id="project-info"]').click();
    const info = page.getByRole("heading", { name: locale.projectInfo }).locator("../../..");
    await expect(info.getByRole("button", { name: locale.cancel })).toBeVisible();
    await expect(info.getByRole("button", { name: locale.save })).toBeVisible();
    await info.getByRole("button", { name: locale.cancel }).click();

    await page.locator('[data-menu-id="resize"]').click();
    const resize = page.getByRole("heading", { name: locale.resize }).locator("..");
    await expect(resize.getByText(locale.width, { exact: true })).toBeVisible();
    await expect(resize.getByText(locale.height, { exact: true })).toBeVisible();
    await expect(resize.getByRole("button", { name: locale.cancel })).toBeVisible();
  });

  test(`new and open dirty guards are translated (${locale.language})`, async ({ page }) => {
    await setupPage(page, { savedLanguage: locale.language });
    await loadProject(page);
    await callAction(page, "setCell", [0, 0, 0]);
    await page.locator('[data-menu-id="new"]').click();
    await expect(page.getByRole("heading", { name: locale.dirty })).toBeVisible();
    await expect(page.getByText(locale.newText)).toBeVisible();
    await page.getByRole("button", { name: locale.cancel }).click();
    await page.locator('[data-menu-id="open"]').click();
    await expect(page.getByText(locale.openText)).toBeVisible();
  });
}

test("stale open is translated in English while a real cancellation stays silent", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en" });
  await stageReply(page, "showOpenDialog", { defer: true, path: "/picked.pindou" });
  const project = { version: 2, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: null }]], createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" };
  await stageReply(page, "readFile", { data: Buffer.from(JSON.stringify(project)).toString("base64") });
  await page.locator('[data-menu-id="open"]').click();
  await page.waitForFunction(() => typeof (window as any)._resolveDeferredOpen === "function");
  await callAction(page, "setCell", [0, 0, 1]);
  await page.evaluate(() => (window as any)._resolveDeferredOpen());
  await expect(page.getByText("The project changed while the file picker was open. Please try again.")).toBeVisible();
  await page.getByRole("button", { name: "OK" }).click();
  await page.evaluate(() => (window as any).__pindouStore.setState({ isDirty: false }));

  await page.locator('[data-menu-id="open"]').click();
  await page.waitForTimeout(50);
  await expect(page.locator("div.fixed.inset-0")).toHaveCount(0);
});
