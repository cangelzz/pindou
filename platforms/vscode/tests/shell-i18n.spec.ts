import { test, expect } from "@playwright/test";
import { setupPage, setStoreState } from "./helpers";

test("common dialog defaults follow the active language", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en" });
  await page.evaluate(() => { void (window as any).__pindouDialogs.confirm("Continue?"); });
  await expect(page.getByText("Confirm", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "OK" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.locator('[data-menu-id="language"]').click();
  await page.evaluate(() => { void (window as any).__pindouDialogs.confirm("继续吗？"); });
  await expect(page.getByText("确认", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
  await expect(page.getByRole("button", { name: "确定" })).toBeVisible();
});

test("canvas toolbar titles follow the active language", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en" });
  await expect(page.getByTitle("Pen (P)")).toBeVisible();
  await expect(page.getByTitle("Undo (Ctrl+Z)")).toBeVisible();
  await expect(page.getByTitle("Fit to Window")).toBeVisible();
  await page.locator('[data-menu-id="language"]').click();
  await expect(page.getByTitle("画笔 (P)")).toBeVisible();
  await expect(page.getByTitle("撤销 (Ctrl+Z)")).toBeVisible();
  await expect(page.getByTitle("适应窗口")).toBeVisible();
});

test("structured save status translates without mutating editor state", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en" });
  const revision = await page.evaluate(() => (window as any).__pindouStore.getState().contentRevision);
  const saveStatus = { kind: "autosaved", at: "2026-08-20T10:11:12.000Z", revision };
  await setStoreState(page, { saveStatus });
  await expect(page.getByTestId("save-status")).toContainText("Autosaved");
  await page.locator('[data-menu-id="language"]').click();
  await expect(page.getByTestId("save-status")).toContainText("自动备份");
  expect(await page.evaluate(() => (window as any).__pindouStore.getState().saveStatus)).toEqual(saveStatus);
});

test("English shell has no hardcoded Chinese and preserves user names", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en" });
  await setStoreState(page, {
    projectInfo: { title: "用户项目" },
    layers: [{ id: "user-layer", name: "用户图层", visible: true, opacity: 1, data: [[{ colorIndex: null }]] }],
    activeLayerId: "user-layer",
  });
  await page.getByRole("button", { name: "Layers" }).click();
  await expect(page.getByText("用户项目")).toHaveCount(0);
  await expect(page.getByText("用户图层", { exact: true })).toBeVisible();
  const text = await page.locator("body").innerText();
  const chinese = [...text.matchAll(/[㐀-鿿]/g)].map(([character]) => character);
  expect(chinese.every((character) => "中文用户图层".includes(character))).toBe(true);
});
