import { test, expect } from "@playwright/test";
import { setupPage, setStoreState, stageReply } from "./helpers";

for (const locale of [
  { language: "en", error: "Could not save the project. Please try again." },
  { language: "zh-CN", error: "保存项目失败，请重试" },
] as const) {
  test(`save failure is translated and preserves dirty state (${locale.language})`, async ({ page }) => {
    await setupPage(page, { savedLanguage: locale.language });
    await setStoreState(page, { isDirty: true, saveStatus: null });
    await stageReply(page, "showSaveDialog", "/denied.pindou");
    await stageReply(page, "saveAs", { success: false, error: "denied" });
    await page.locator('[data-menu-id="save"]').click();
    await expect(page.getByText(locale.error)).toBeVisible();
    expect(await page.evaluate(() => {
      const s = (window as any).__pindouStore.getState();
      return { isDirty: s.isDirty, saveStatus: s.saveStatus };
    })).toEqual({ isDirty: true, saveStatus: null });
  });
}

test("cancelled save is silent", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en" });
  await setStoreState(page, { isDirty: true, saveStatus: null });
  await page.locator('[data-menu-id="save"]').click();
  await page.waitForTimeout(100);
  await expect(page.locator("div.fixed.inset-0")).toHaveCount(0);
});
