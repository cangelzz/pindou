import { chromium, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extensionDist, withPersistentContext } from "./fixtures";
import { assertEnglishFunctionalUi, captureCompositionGeometry, ephemeralRenderRoot, installDeterminism, loadSample, outputDir, settle, STORE_SCENARIOS, type StoreLocale, writeScreenshotMetadata } from "./storeScreenshotHelpers";

test.afterAll(() => { if (ephemeralRenderRoot) fs.rmSync(ephemeralRenderRoot, { recursive: true, force: true }); });

test("English audit rejects Chinese UI that resembles a color suffix", async ({ page }) => {
  await page.setContent('<button>设置颜色</button>');
  await expect(assertEnglishFunctionalUi(page)).rejects.toThrow();
});

test("English audit permits only exact brand, color, and user nodes", async ({ page }) => {
  await page.setContent(`
    <span data-testid="brand">拼豆</span>
    <button data-color-index="0">红色</button>
    <span data-user-content>用户图层</span>
  `);
  await expect(assertEnglishFunctionalUi(page)).resolves.toBeUndefined();
});

async function prepareScenario(page: import("@playwright/test").Page, locale: StoreLocale, scenario: (typeof STORE_SCENARIOS)[number]) {
  await loadSample(page, scenario.sample);
  if (scenario.id === "editor") await expect(page.getByText(locale === "en" ? "Palette" : "色板", { exact: true }).first()).toBeVisible();
  if (scenario.id === "layers") { await page.getByRole("button", { name: locale === "en" ? "Layers" : "图层" }).click(); await expect(page.getByText(locale === "en" ? "Bead Layers" : "拼豆图层")).toBeVisible(); }
  if (scenario.id === "export") { await page.locator('[data-menu-id="export"]').click(); await expect(page.getByRole("heading", { name: locale === "en" ? "Export High-Resolution Image" : "导出高分辨率图片" })).toBeVisible(); }
  if (scenario.id === "cloud") { await expect(page.locator('[data-menu-id="cloud"]')).toBeVisible(); await page.locator('[data-menu-id="cloud"]').click(); for (const name of ["T. Rex Expedition", "Pterosaur Skies", "Ankylosaurus Trail"]) await expect(page.getByText(name)).toBeVisible(); }
  if (scenario.id === "image-conversion") {
    const png = await page.locator("canvas").nth(1).screenshot({ animations: "disabled" });
    expect(png.length).toBeGreaterThan(10_000);
    await page.locator('[data-menu-id="import-image"]').click();
    const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: locale === "en" ? "Choose File" : "选择文件" }).click(); const fc = await chooser;
    await fc.setFiles({ name: "triceratops-source.png", mimeType: "image/png", buffer: png });
    await expect(page.getByRole("button", { name: locale === "en" ? "Preview" : "预览", exact: true })).toBeVisible();
    await expect.poll(() => page.getByTestId("crop-canvas").evaluate((canvas: HTMLCanvasElement) => { if (!canvas.width || !canvas.height) return false; const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] && (pixels[i - 3] || pixels[i - 2] || pixels[i - 1])) return true; return false; })).toBe(true);
  }
}

for (const locale of ["en", "zh-CN"] as const) {
  test.describe(locale, () => {
    for (const scenario of STORE_SCENARIOS) test(`${scenario.file} ${scenario.id}`, async () => {
      await withPersistentContext(
        (profile) => chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, locale: locale === "en" ? "en-US" : "zh-CN", timezoneId: "UTC", colorScheme: "light", reducedMotion: "reduce", deviceScaleFactor: 1, viewport: { width: 1280, height: 800 }, args: [`--disable-extensions-except=${extensionDist}`, `--load-extension=${extensionDist}`] }),
        async (context) => {
        await installDeterminism(context, locale);
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
        for (const page of context.pages()) await page.close();
        const page = await context.newPage();
        await page.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
        await page.evaluate(async (language) => chrome.storage.local.set({ "pindou.uiLanguage": language, "github.accessToken": "screenshot-token" }), locale);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await prepareScenario(page, locale, scenario);
        if (locale === "en") await assertEnglishFunctionalUi(page);
        await expect(page.getByText(/loading|加载|error|错误/i)).toHaveCount(0);
        await settle(page);
        fs.mkdirSync(outputDir(locale), { recursive: true });
        const screenshotPath = path.join(outputDir(locale), scenario.file);
        const geometry = await captureCompositionGeometry(page);
        await page.screenshot({ path: screenshotPath, animations: "disabled" });
        writeScreenshotMetadata(screenshotPath, locale, scenario, geometry);
        },
        { makeProfile: () => fs.mkdtempSync(path.join(os.tmpdir(), `pindou-store-${locale}-`)) },
      );
    });
  });
}

for (const scenario of STORE_SCENARIOS) test(`${scenario.id} composition geometry is locale independent`, async () => {
  const geometry = [];
  for (const locale of ["en", "zh-CN"] as const) {
    await withPersistentContext(
      (profile) => chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, locale: locale === "en" ? "en-US" : "zh-CN", timezoneId: "UTC", colorScheme: "light", reducedMotion: "reduce", deviceScaleFactor: 1, viewport: { width: 1280, height: 800 }, args: [`--disable-extensions-except=${extensionDist}`, `--load-extension=${extensionDist}`] }),
      async (context) => {
        await installDeterminism(context, locale);
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
        for (const existing of context.pages()) await existing.close();
        const page = await context.newPage();
        await page.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
        await page.evaluate(async (language) => chrome.storage.local.set({ "pindou.uiLanguage": language, "github.accessToken": "screenshot-token" }), locale);
        await page.reload();
        await prepareScenario(page, locale, scenario);
        await settle(page);
        geometry.push(await captureCompositionGeometry(page));
      },
      { makeProfile: () => fs.mkdtempSync(path.join(os.tmpdir(), `pindou-geometry-${locale}-`)) },
    );
  }
  expect(geometry[1]).toEqual(geometry[0]);
});

test("scenario descriptors are locale independent", () => { const descriptor = (locale: StoreLocale) => STORE_SCENARIOS.map(({ id, file, sample }) => ({ id, file, sample })); expect(descriptor("en")).toEqual(descriptor("zh-CN")); });
