import { test, expect } from "@playwright/test";
import { setupPage } from "./helpers";

test.describe("toolbar flyout dismissal", () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test("eraser flyout closes when another tool is clicked", async ({ page }) => {
    // Open the eraser flyout
    await page.getByTitle("橡皮擦 (E)").click();
    // The sub-options are now visible
    await expect(page.getByText("区域擦除")).toBeVisible();

    // Click a different tool (pen)
    await page.getByTitle("画笔 (P)").click();

    // The flyout must disappear
    await expect(page.getByText("区域擦除")).toHaveCount(0);
  });

  test("shape flyout closes when another tool is clicked", async ({ page }) => {
    await page.getByTitle("形状工具").click();
    await expect(page.getByText("矩形")).toBeVisible();

    await page.getByTitle("画笔 (P)").click();

    await expect(page.getByText("矩形")).toHaveCount(0);
  });

  test("opening the eraser flyout closes the shape flyout", async ({ page }) => {
    await page.getByTitle("形状工具").click();
    await expect(page.getByText("矩形")).toBeVisible();

    // Opening the eraser flyout should dismiss the shape flyout
    await page.getByTitle("橡皮擦 (E)").click();

    await expect(page.getByText("矩形")).toHaveCount(0);
    await expect(page.getByText("区域擦除")).toBeVisible();
  });
});
