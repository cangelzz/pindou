import { expect, test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { extensionDist, launchExtensionContext, withPersistentContext } from "./fixtures";

test("unpacked extension persists and restores GitHub session in chrome.storage.local", async () => {
  test.setTimeout(60_000);
  expect(fs.existsSync(path.join(extensionDist, "manifest.json"))).toBe(true);
  const builtScripts = fs.readdirSync(path.join(extensionDist, "assets")).filter((name) => name.endsWith(".js"));
  expect(builtScripts.some((name) => fs.readFileSync(path.join(extensionDist, "assets", name), "utf8").includes("Ov23libthPsNlBTIBZHs"))).toBe(true);
  await withPersistentContext(launchExtensionContext, async (context) => {
    await context.addInitScript(() => {
      let polls = 0;
      let gist: any = null;
      let gistFileName = "";
      let gistGets = 0;
      (globalThis as any).__gistRequests = [];
      const cloudProject = (color: number, title: string) => ({
        version: 3, canvasSize: { width: 2, height: 1 }, canvasData: [[color, null]],
        layers: [
          { id: "cloud-bottom", name: "Cloud Bottom", visible: true, opacity: 1, data: [[color, null]] },
          { id: "cloud-top", name: "Cloud Top", visible: true, opacity: 0.8, data: [[null, color + 1]] },
        ],
        gridConfig: { groupSize: 4, visible: false, lineColor: "#111111", lineWidth: 2, groupLineColor: "#222222", groupLineWidth: 3 },
        projectInfo: { title, author: "Cloud Author", sourceUrl: "https://cloud.test/source", notes: "downloaded" },
        createdAt: "2025-01-02T03:04:05.000Z", updatedAt: "2026-08-19T01:02:03.000Z",
      });
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "https://github.com/login/device/code") return new Response(JSON.stringify({ device_code: "device", user_code: "USER-CODE", verification_uri: "https://github.com/login/device", expires_in: 60, interval: 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url === "https://github.com/login/oauth/access_token") {
          polls += 1;
          return new Response(JSON.stringify(polls === 1 ? { error: "authorization_pending" } : { access_token: "persistent-token", token_type: "bearer", scope: "gist" }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url === "https://api.github.com/gists?per_page=100") return new Response(JSON.stringify(gist ? [gist] : []), { status: 200 });
        if (url === "https://api.github.com/gists" && init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          gistFileName = Object.keys(body.files)[0];
          const uploaded = JSON.parse(body.files[gistFileName].content);
          (globalThis as any).__gistRequests.push({ method: "POST", body, uploaded });
          gist = { id: "g1", updated_at: "2026-08-19T00:00:00Z", history: [{ version: "v2" }, { version: "v1" }], public: false, description: body.description, files: body.files };
          return new Response(JSON.stringify(gist), { status: 201 });
        }
        if (url === "https://api.github.com/gists/g1" && (!init?.method || init.method === "GET")) {
          gistGets += 1;
          if (gistGets === 1) return new Response(JSON.stringify(gist), { status: 200 });
          return new Response(JSON.stringify({ ...gist, files: { [gistFileName]: { content: JSON.stringify(cloudProject(31, "Cloud Download")) } } }), { status: 200 });
        }
        if (url === "https://api.github.com/gists/g1/v1") return new Response(JSON.stringify({ ...gist, history: [{ version: "v1" }], files: { [gistFileName]: { content: JSON.stringify(cloudProject(41, "History Restore")) } } }), { status: 200 });
        if (url === "https://api.github.com/gists/g1/commits?per_page=100") return new Response(JSON.stringify([{ version: "v1", committed_at: "2026-08-18T00:00:00Z" }]), { status: 200 });
        if (url === "https://api.github.com/gists/g1" && init?.method === "DELETE") { gist = null; return new Response(null, { status: 204 }); }
        return nativeFetch(input, init);
      };
    });
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    const menu = page.getByTestId("top-menu");
    const language = menu.locator('[data-menu-id="language"]');
    await expect(language).toHaveText("🌐 中文");
    await language.click();
    await expect(language).toHaveText("🌐 EN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    expect(await page.evaluate(async () => (await chrome.storage.local.get("pindou.uiLanguage"))["pindou.uiLanguage"])).toBe("zh-CN");
    expect(await page.evaluate(() => localStorage.getItem("pindou.uiLanguage"))).toBeNull();
    await page.reload();
    await expect(menu.locator('[data-menu-id="language"]')).toHaveText("🌐 EN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    expect(await page.evaluate(async () => (await chrome.storage.local.get("pindou.uiLanguage"))["pindou.uiLanguage"])).toBe("zh-CN");
    expect(await page.evaluate(() => localStorage.getItem("pindou.uiLanguage"))).toBeNull();
    await expect(menu.locator('[data-menu-id="login"]')).toBeEnabled();
    await menu.locator('[data-menu-id="login"]').click();
    await expect(page.getByText("USER-CODE")).toBeVisible();
    await expect(menu.locator('[data-menu-id="logged-in"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(async () => (await chrome.storage.local.get("github.accessToken"))["github.accessToken"])).toBe("persistent-token");
    expect(await page.evaluate(() => localStorage.getItem("github.accessToken"))).toBeNull();

    await page.evaluate(() => (globalThis as any).__pindouExtensionTest.callStore("setCell", [0, 0, 5]));
    await page.evaluate(() => (globalThis as any).__pindouExtensionTest.callStore("addLayer", ["Upload Top"]));
    await page.evaluate(() => (globalThis as any).__pindouExtensionTest.callStore("setCell", [0, 1, 8]));
    await page.evaluate(() => (globalThis as any).__pindouExtensionTest.callStore("setProjectInfo", [{ title: "Upload Full", author: "Uploader", sourceUrl: "https://upload.test", notes: "all fields" }]));
    await menu.locator('[data-menu-id="cloud"]').click();
    await expect(page.getByText("暂无云端项目")).toBeVisible();
    await page.getByRole("button", { name: "上传当前项目" }).evaluate((button: HTMLButtonElement) => button.click());
    await page.getByPlaceholder("项目名称").fill("Persistent");
    await page.getByRole("button", { name: "上传", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByText(/Persistent · 当前/)).toBeVisible({ timeout: 10_000 });
    const uploaded = await page.evaluate(() => (globalThis as any).__gistRequests[0].uploaded);
    expect(uploaded).toMatchObject({ version: 3, canvasSize: { width: 52, height: 52 }, projectInfo: { title: "Upload Full", author: "Uploader", sourceUrl: "https://upload.test", notes: "all fields" } });
    expect(uploaded.layers).toHaveLength(2);
    expect(uploaded.canvasData[0][0]).toBe(5);
    expect(uploaded.gridConfig).toBeTruthy();
    expect(uploaded.createdAt).toBeTruthy(); expect(uploaded.updatedAt).toBeTruthy();

    await page.getByRole("button", { name: "下载" }).evaluate((button: HTMLButtonElement) => button.click());
    await page.getByRole("button", { name: "确定" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(async () => (await page.evaluate(() => (globalThis as any).__pindouExtensionTest.getStore(["projectInfo"]))).projectInfo?.title).toBe("Cloud Download");
    let downloaded = await page.evaluate(() => (globalThis as any).__pindouExtensionTest.getStore(["canvasSize", "canvasData", "layers", "activeLayerId", "gridConfig", "projectInfo", "projectPath", "projectDocument", "isDirty", "baselineCanvasData", "undoStack", "redoStack", "cloudGistId", "cloudProjectName", "cloudUpdatedAt", "cloudVersion", "cloudSyncStatus", "cloudSyncedRevision"]));
    expect(downloaded.canvasSize).toEqual({ width: 2, height: 1 });
    expect(downloaded.canvasData.map((row: any[]) => row.map((cell) => cell.colorIndex))).toEqual([[31, 32]]);
    expect(downloaded.layers).toHaveLength(2);
    expect(downloaded.layers.map((layer: any) => ({ name: layer.name, visible: layer.visible, opacity: layer.opacity, data: layer.data.map((row: any[]) => row.map((cell) => cell.colorIndex)) }))).toEqual([
      { name: "Cloud Bottom", visible: true, opacity: 1, data: [[31, null]] },
      { name: "Cloud Top", visible: true, opacity: 0.8, data: [[null, 32]] },
    ]);
    expect(downloaded.gridConfig).toMatchObject({ groupSize: 4, visible: false, lineColor: "#111111", lineWidth: 2, groupLineColor: "#222222", groupLineWidth: 3 });
    expect(downloaded.projectInfo).toMatchObject({ title: "Cloud Download", author: "Cloud Author", sourceUrl: "https://cloud.test/source", notes: "downloaded" });
    expect(downloaded.activeLayerId).toBe(downloaded.layers[1].id);
    expect(downloaded.undoStack).toEqual([]); expect(downloaded.redoStack).toEqual([]);
    expect(downloaded).toMatchObject({ projectPath: null, projectDocument: null, isDirty: true, baselineCanvasData: null, cloudGistId: "g1", cloudProjectName: "Persistent", cloudUpdatedAt: "2026-08-19T00:00:00Z", cloudVersion: "v2", cloudSyncStatus: "synced" });
    expect(typeof downloaded.cloudSyncedRevision).toBe("number");

    await menu.locator('[data-menu-id="cloud"]').click();
    await page.getByRole("button", { name: "历史", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole("button", { name: "恢复" })).toBeVisible();
    await page.getByRole("button", { name: "恢复" }).evaluate((button: HTMLButtonElement) => button.click());
    await page.getByRole("button", { name: "确定" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(async () => (await page.evaluate(() => (globalThis as any).__pindouExtensionTest.getStore(["projectInfo"]))).projectInfo?.title).toBe("History Restore");
    downloaded = await page.evaluate(() => (globalThis as any).__pindouExtensionTest.getStore(["canvasSize", "canvasData", "layers", "gridConfig", "projectInfo", "cloudVersion", "cloudSyncStatus"]));
    expect(downloaded.canvasSize).toEqual({ width: 2, height: 1 });
    expect(downloaded.canvasData.map((row: any[]) => row.map((cell) => cell.colorIndex))).toEqual([[41, 42]]);
    expect(downloaded.layers.map((layer: any) => layer.name)).toEqual(["Cloud Bottom", "Cloud Top"]);
    expect(downloaded.gridConfig).toMatchObject({ groupSize: 4, visible: false });
    expect(downloaded.projectInfo).toMatchObject({ title: "History Restore", author: "Cloud Author", notes: "downloaded" });
    expect(downloaded).toMatchObject({ cloudVersion: "v1", cloudSyncStatus: "synced" });

    await menu.locator('[data-menu-id="cloud"]').click();
    await page.getByRole("button", { name: "删除" }).evaluate((button: HTMLButtonElement) => button.click());
    await page.getByRole("button", { name: "确定" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByText("暂无云端项目")).toBeVisible();
    await page.getByRole("button", { name: "关闭" }).evaluate((button: HTMLButtonElement) => button.click());

    await page.reload();
    await expect(menu.locator('[data-menu-id="logged-in"]')).toBeVisible();
    await menu.locator('[data-menu-id="logged-in"]').click();
    await expect(menu.locator('[data-menu-id="login"]')).toBeVisible();
    expect(await page.evaluate(async () => (await chrome.storage.local.get("github.accessToken"))["github.accessToken"])).toBeUndefined();
  });
});
