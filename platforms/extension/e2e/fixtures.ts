import { test as base, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

export const extensionDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist-test");

export async function removeProfile(profile: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { fs.rmSync(profile, { recursive: true, force: true }); return; }
    catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

export async function launchExtensionContext(profile: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionDist}`, `--load-extension=${extensionDist}`],
  });
}

export async function withPersistentContext<T>(
  launch: (profile: string) => Promise<BrowserContext>,
  run: (context: BrowserContext, profile: string) => Promise<T>,
  deps: { makeProfile?: () => string; remove?: (profile: string) => Promise<void> } = {},
): Promise<T> {
  const profile = deps.makeProfile?.() ?? fs.mkdtempSync(path.join(os.tmpdir(), "pindou-extension-e2e-"));
  let context: BrowserContext | undefined;
  try {
    context = await launch(profile);
    return await run(context, profile);
  } finally {
    await context?.close();
    await (deps.remove ?? removeProfile)(profile);
  }
}

export type ExtensionFixture = {
  context: BrowserContext;
  extensionId: string;
  editor: Page;
  worker: Worker;
};

export const test = base.extend<ExtensionFixture>({
  context: async ({}, use) => {
    await withPersistentContext(launchExtensionContext, async (context) => use(context));
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await use(worker);
  },
  extensionId: async ({ worker }, use) => { await use(new URL(worker.url()).host); },
  editor: async ({ context, extensionId }, use) => {
    for (const existing of context.pages()) await existing.close();
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.getByTestId("top-menu").waitFor();
    await use(page);
  },
});

export async function callStore<T>(page: Page, action: string, args: unknown[] = []): Promise<T> {
  return page.evaluate(async ({ action, args }) => {
    const api = (globalThis as any).__pindouExtensionTest;
    if (!api) throw new Error("Extension test API unavailable");
    return api.callStore(action, args);
  }, { action, args });
}

export async function getStore<T>(page: Page, keys: string[]): Promise<T> {
  return page.evaluate((keys) => (globalThis as any).__pindouExtensionTest.getStore(keys), keys);
}

export async function setUiLanguage(page: Page, language: "en" | "zh-CN"): Promise<void> {
  await page.evaluate(async (value) => chrome.storage.local.set({ "pindou.uiLanguage": value }), language);
  await page.reload();
  await page.getByTestId("top-menu").waitFor();
  await page.locator("html").waitFor();
}
