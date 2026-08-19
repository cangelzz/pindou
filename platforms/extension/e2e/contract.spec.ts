import { expect, test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { fileURLToPath } from "url";

const extensionDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist-test");
let harnessPath = "";
let server: http.Server;
let origin = "";

test.beforeAll(() => {
  if (!fs.existsSync(path.join(extensionDist, "index.html"))) {
    throw new Error("Build the browser extension first with: npm run ext:build");
  }
  const html = fs.readFileSync(path.join(extensionDist, "index.html"), "utf8");
  const entry = html.match(/src="([^"]+\.js)"/)?.[1];
  const css = html.match(/href="([^"]+\.css)"/)?.[1];
  if (!entry || !css) throw new Error("Extension build output is missing entry assets");
  const noopEvent = `{ addListener() {}, removeListener() {} }`;
  const chromeMock = `<script>
    const event = ${noopEvent};
    const stored = {};
    globalThis.__extensionStored = stored;
    globalThis.__openedUrls = [];
    globalThis.chrome = {
      runtime: { getURL: p => p, sendMessage: async () => [], onInstalled: event, onMessage: event },
      tabs: { get: async () => { throw new Error('missing'); }, update: async () => {}, create: async value => { __openedUrls.push(value.url); return {}; }, sendMessage: async () => {}, onRemoved: event },
      windows: { update: async () => {} }, action: { onClicked: event },
      contextMenus: { create() {}, remove: async () => {}, onClicked: event },
      storage: { local: { get: async key => ({ [key]: stored[key] }), set: async values => Object.assign(stored, values), remove: async key => { if (globalThis.__failStorageRemove) throw new Error('remove denied'); delete stored[key]; } } },
    };
    globalThis.fetch = async url => {
      if (url.endsWith('/device/code')) return new Response(JSON.stringify({ device_code: 'device', user_code: 'USER-CODE', verification_uri: 'https://github.com/login/device', expires_in: 60, interval: 1 }), { status: 200 });
      return new Response(JSON.stringify({ access_token: 'browser-token', token_type: 'bearer', scope: 'gist' }), { status: 200 });
    };
  </script>`;
  harnessPath = path.join(extensionDist, "browser-contract-harness.html");
  fs.writeFileSync(harnessPath, `<!doctype html><html><head>${chromeMock}<link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`);
  server = http.createServer((request, response) => {
    const relative = request.url === "/" ? "browser-contract-harness.html" : decodeURIComponent(request.url!.slice(1));
    const file = path.join(extensionDist, relative);
    response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    response.end(fs.readFileSync(file));
  });
  return new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => {
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    resolve();
  }));
});

test.afterAll(() => { server?.close(); if (harnessPath && fs.existsSync(harnessPath)) fs.unlinkSync(harnessPath); });

test("HTTP bundle harness authenticates, stores locally, logs out, and has no AI UI", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  const menu = page.getByTestId("top-menu");
  await expect(menu).toBeVisible();
  const localStorageWrites: string[] = [];
  await page.evaluate(() => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key, value) => { (globalThis as any).__localStorageWrites = ((globalThis as any).__localStorageWrites ?? []).concat(key); original(key, value); };
  });
  await expect(menu.locator('[data-menu-id="login"]')).toBeEnabled();
  await menu.locator('[data-menu-id="login"]').click();
  await expect(page.getByText("USER-CODE")).toBeVisible();
  await expect(menu.locator('[data-menu-id="logged-in"]')).toBeVisible({ timeout: 5000 });
  expect(await page.evaluate(() => (globalThis as any).__extensionStored["github.accessToken"])).toBe("browser-token");
  localStorageWrites.push(...await page.evaluate(() => (globalThis as any).__localStorageWrites ?? []));
  expect(localStorageWrites).not.toContain("github.accessToken");
  await page.evaluate(() => { (globalThis as any).__failStorageRemove = true; });
  await menu.locator('[data-menu-id="logged-in"]').click();
  await expect(page.getByText("登出失败，未能删除本地 GitHub 凭据，请重试")).toBeVisible();
  await expect(menu.locator('[data-menu-id="logged-in"]')).toBeVisible();
  expect(await page.evaluate(() => (globalThis as any).__extensionStored["github.accessToken"])).toBe("browser-token");
  await page.getByRole("button", { name: "确定" }).evaluate((button: HTMLButtonElement) => button.click());
  await page.evaluate(() => { (globalThis as any).__failStorageRemove = false; });
  await menu.locator('[data-menu-id="logged-in"]').click();
  await expect(menu.locator('[data-menu-id="login"]')).toBeVisible();
  expect(await page.evaluate(() => (globalThis as any).__extensionStored["github.accessToken"])).toBeUndefined();
  await expect(menu.locator('[data-menu-id="import-blueprint"]')).toBeEnabled();
  await expect(menu.locator('[data-menu-id="feedback"]')).toHaveAttribute("data-feedback-environment", "Browser Extension (Chrome)");
  await expect(page.getByText(/AI语音|AI 语音增强/)).toHaveCount(0);
  await page.getByTitle("图纸模式").click();
  await page.getByTitle(/网格聚焦/).click();
  const microphone = page.getByTitle(/语音控制/);
  await expect(microphone).toBeVisible();
  await microphone.click();
  await expect(page.getByText("🎤 正在监听...")).toBeVisible();
  await page.getByTestId("beta-settings").evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByText("图纸导入（从导出的图纸还原画布）")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
