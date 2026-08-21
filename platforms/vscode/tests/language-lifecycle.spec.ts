import { test, expect } from "@playwright/test";
import { getMessages, setupPage } from "./helpers";

test("saved English overrides detected Simplified Chinese", async ({ page }) => {
  await setupPage(page, { savedLanguage: "en", systemLanguage: "zh-CN" });
  await expect.poll(() => page.locator("html").getAttribute("lang")).toBe("en");
  const types = (await getMessages(page)).map((message) => message.type);
  expect(types.indexOf("storageGet")).toBeLessThan(types.indexOf("ready"));
  expect(types.indexOf("getUiEnvironment")).toBeLessThan(types.indexOf("ready"));
});

test("detects Simplified Chinese when no preference is saved", async ({ page }) => {
  await setupPage(page, { systemLanguage: "zh-CN" });
  await expect.poll(() => page.locator("html").getAttribute("lang")).toBe("zh-CN");
});

test("normalizes Traditional Chinese to English", async ({ page }) => {
  await setupPage(page, { systemLanguage: "zh-TW" });
  await expect.poll(() => page.locator("html").getAttribute("lang")).toBe("en");
});

test("mounts in English when host storage fails", async ({ page }) => {
  await setupPage(page, { systemLanguage: "en", storageError: true });
  await expect(page.locator("#root > *")).toBeVisible();
  await expect.poll(() => page.locator("html").getAttribute("lang")).toBe("en");
});

test("times out missing startup RPC replies and still mounts in English", async ({ page }) => {
  test.setTimeout(15_000);
  await setupPage(page, { ignoreUiRpc: true });
  await expect(page.locator("#root > *")).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => page.locator("html").getAttribute("lang")).toBe("en");
});
