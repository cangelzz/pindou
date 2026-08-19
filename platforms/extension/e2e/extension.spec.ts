import { expect } from "@playwright/test";
import { callStore, getStore, test } from "./fixtures";

const v3Project = {
  version: 3,
  canvasSize: { width: 1, height: 1 },
  canvasData: [[4]],
  layers: [{ id: "layer", name: "Main", visible: true, opacity: 1, data: [[4]] }],
  gridConfig: { groupSize: 5, visible: true },
  projectInfo: { title: "Roundtrip", author: "E2E", sourceUrl: "https://source.test", notes: "full fields" },
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};

test("test build exposes real store actions without shipping the seam", async ({ editor }) => {
  await callStore(editor, "setCell", [0, 0, 7]);
  const state = await getStore<{ isDirty: boolean; canvasData: Array<Array<{ colorIndex: number | null }>> }>(editor, ["isDirty", "canvasData"]);
  expect(state.isDirty).toBe(true);
  expect(state.canvasData[0][0].colorIndex).toBe(7);
});

test("dirty New cancellation preserves content and confirmation clears identity", async ({ editor }) => {
  await callStore(editor, "setCell", [0, 0, 9]);
  await editor.getByTestId("top-menu").locator('[data-menu-id="new"]').click();
  await expect(editor.getByRole("heading", { name: "未保存的修改" })).toBeVisible();
  await editor.getByRole("button", { name: "取消" }).evaluate((button: HTMLButtonElement) => button.click());
  let state = await getStore<any>(editor, ["isDirty", "canvasData", "projectGeneration"]);
  expect(state.isDirty).toBe(true);
  expect(state.canvasData[0][0].colorIndex).toBe(9);
  const generation = state.projectGeneration;

  await editor.getByTestId("top-menu").locator('[data-menu-id="new"]').click();
  await editor.getByRole("button", { name: "继续" }).evaluate((button: HTMLButtonElement) => button.click());
  await editor.getByRole("button", { name: "创建" }).evaluate((button: HTMLButtonElement) => button.click());
  state = await getStore<any>(editor, ["isDirty", "canvasData", "projectGeneration", "projectDocument", "cloudGistId"]);
  expect(state.isDirty).toBe(false);
  expect(state.canvasData[0][0].colorIndex).toBeNull();
  expect(state.projectGeneration).toBe(generation + 1);
  expect(state.projectDocument).toBeNull();
  expect(state.cloudGistId).toBeNull();
});

test("dirty Open cancellation never launches the picker and preserves content", async ({ editor }) => {
  await callStore(editor, "setCell", [0, 0, 10]);
  await editor.evaluate(() => {
    (globalThis as any).__openPickerCalls = 0;
    (globalThis as any).showOpenFilePicker = async () => { (globalThis as any).__openPickerCalls += 1; return []; };
  });
  await editor.getByTestId("top-menu").locator('[data-menu-id="open"]').click();
  await expect(editor.getByRole("heading", { name: "未保存的修改" })).toBeVisible();
  await editor.getByRole("button", { name: "取消" }).evaluate((button: HTMLButtonElement) => button.click());
  expect(await editor.evaluate(() => (globalThis as any).__openPickerCalls)).toBe(0);
  const state = await getStore<any>(editor, ["canvasData", "isDirty"]);
  expect(state.canvasData[0][0].colorIndex).toBe(10);
  expect(state.isDirty).toBe(true);
});

test("clean New opens directly and resets the canvas", async ({ editor }) => {
  await editor.getByTestId("top-menu").locator('[data-menu-id="new"]').click();
  await expect(editor.getByText("新建画布")).toBeVisible();
  await expect(editor.getByRole("heading", { name: "未保存的修改" })).toHaveCount(0);
  await editor.getByRole("button", { name: "创建" }).evaluate((button: HTMLButtonElement) => button.click());
  expect((await getStore<any>(editor, ["isDirty"])).isDirty).toBe(false);
});

test("File System Access opens v3, saves through retained handle, and keeps dirty on write failure", async ({ context, extensionId }) => {
  let failWrite = false;
  await context.addInitScript(({ project }) => {
    const writes: string[] = [];
    (globalThis as any).__fileWrites = writes;
    (globalThis as any).__setWriteFailure = (value: boolean) => { (globalThis as any).__writeFailure = value; };
    const handle = {
      name: "roundtrip.pindou",
      kind: "file",
      getFile: async () => new File([JSON.stringify(project)], "roundtrip.pindou", { type: "application/json" }),
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      createWritable: async () => ({
        write: async (value: string) => { if ((globalThis as any).__writeFailure) throw new Error("disk full"); writes.push(value); },
        close: async () => {}, abort: async () => {},
      }),
    };
    (globalThis as any).showOpenFilePicker = async () => [handle];
    (globalThis as any).showSaveFilePicker = async () => handle;
  }, { project: v3Project });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  const menu = page.getByTestId("top-menu");
  await menu.locator('[data-menu-id="open"]').click();
  await expect.poll(async () => (await getStore<any>(page, ["canvasData"])).canvasData[0][0].colorIndex).toBe(4);
  await callStore(page, "setCell", [0, 0, 6]);
  await menu.locator('[data-menu-id="save"]').click();
  await expect.poll(() => page.evaluate(() => (globalThis as any).__fileWrites.length)).toBe(1);
  expect(JSON.parse(await page.evaluate(() => (globalThis as any).__fileWrites[0]))).toMatchObject({ version: 3, canvasData: [[6]], projectInfo: v3Project.projectInfo });
  expect((await getStore<any>(page, ["isDirty"])).isDirty).toBe(false);

  await callStore(page, "setCell", [0, 0, 7]);
  failWrite = true;
  await page.evaluate((value) => (globalThis as any).__setWriteFailure(value), failWrite);
  await menu.locator('[data-menu-id="save"]').click();
  await expect.poll(async () => (await getStore<any>(page, ["isDirty"])).isDirty).toBe(true);
});

test("download fallback emits v3 on every save", async ({ context, extensionId }) => {
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, "showOpenFilePicker", { configurable: true, value: undefined });
    Object.defineProperty(globalThis, "showSaveFilePicker", { configurable: true, value: undefined });
  });
  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/index.html`);
  await callStore(editor, "setCell", [0, 0, 8]);
  const menu = editor.getByTestId("top-menu");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const downloadPromise = editor.waitForEvent("download");
    await menu.locator(attempt === 0 ? '[data-menu-id="save-as"]' : '[data-menu-id="save"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pindou$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const project = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(project.version).toBe(3);
    expect(project.canvasData[0][0]).toBe(8);
  }
});

test("autosave and snapshots survive closing and reopening the editor page", async ({ context, editor, extensionId }) => {
  await callStore(editor, "setCell", [0, 0, 12]);
  expect(await callStore<any>(editor, "autoSave")).toMatchObject({ ok: true });
  expect(await callStore<any>(editor, "createSnapshot", ["Restart snapshot"])).toMatchObject({ ok: true });
  await editor.close();

  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/index.html`);
  await reopened.getByTestId("top-menu").waitFor();
  await expect(reopened.getByTestId("autosave-recovery-dialog")).toBeVisible();
  await reopened.getByRole("button", { name: "恢复" }).evaluate((button: HTMLButtonElement) => button.click());
  const restored = await getStore<any>(reopened, ["canvasData", "isDirty", "projectDocument", "projectPath", "cloudGistId"]);
  expect(restored.canvasData[0][0].colorIndex).toBe(12);
  expect(restored.isDirty).toBe(true);
  expect(restored.projectDocument).toBeNull();
  expect(restored.projectPath).toBeNull();
  expect(restored.cloudGistId).toBeNull();
  expect(await callStore<any>(reopened, "loadSnapshots")).toMatchObject({ ok: true });
  const state = await getStore<any>(reopened, ["snapshots"]);
  expect(state.snapshots.find((item: { name: string }) => item.name === "Restart snapshot")).toBeTruthy();
  const records = await reopened.evaluate(async () => {
    const request = indexedDB.open("pindouverse", 2);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const get = (store: string, key: string) => new Promise<unknown>((resolve, reject) => { const req = db.transaction(store).objectStore(store).get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const count = (store: string) => new Promise<number>((resolve, reject) => { const req = db.transaction(store).objectStore(store).count(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    return { autosave: await get("autosave", "current"), snapshotCount: await count("snapshots") };
  });
  expect(records.snapshotCount).toBe(1);
  expect(records.autosave).toBeUndefined();
});

test("web image context task opens the real wizard and acknowledges storage", async ({ editor }) => {
  await editor.addInitScript(() => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://images.test/pixel.png") {
        const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130]);
        return new Response(bytes, { status: 200, headers: { "Content-Type": "image/png", "Content-Length": String(bytes.length) } });
      }
      return original(input, init);
    };
  });
  await editor.reload();
  expect(await editor.evaluate(() => chrome.runtime.sendMessage({ type: "pindou:test", action: "image-context", payload: { srcUrl: "https://images.test/pixel.png", pageUrl: "https://page.test" } }))).toMatchObject({ ok: true });
  await expect(editor.getByRole("button", { name: "确认导入" })).toBeVisible();
  await editor.getByRole("button", { name: "预览", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(editor.getByRole("button", { name: "确认导入" })).toBeEnabled();
  await editor.getByRole("button", { name: "确认导入" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => editor.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((key) => key.startsWith("pindou.webImageTask.")).length)).toBe(0);
});

test("web image fetch failure offers local fallback", async ({ editor }) => {
  await editor.addInitScript(() => {
    globalThis.fetch = async () => new Response("no", { status: 503 });
  });
  await editor.reload();
  expect(await editor.evaluate(() => chrome.runtime.sendMessage({ type: "pindou:test", action: "image-context", payload: { srcUrl: "https://images.test/fail.png" } }))).toMatchObject({ ok: true });
  await expect(editor.getByRole("heading", { name: "无法读取网页图片" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "选择本地图片" })).toBeVisible();
});

test("persisted ordinary tab id is rejected by the editor identity handshake", async ({ context, editor, extensionId }) => {
  const ordinary = await context.newPage();
  await ordinary.goto("data:text/html,ordinary");
  const ordinaryId = await editor.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true });
    return tab.id;
  });
  expect(typeof ordinaryId).toBe("number");
  await editor.evaluate(async (tabId) => chrome.storage.local.set({ "pindou.editorTabId": tabId }), ordinaryId);
  const trigger = editor.evaluate(() => chrome.runtime.sendMessage({ type: "pindou:test", action: "open-editor" }));
  await editor.close();
  await trigger.catch(() => undefined);
  await expect.poll(() => context.pages().filter((page) => page.url().startsWith(`chrome-extension://${extensionId}/index.html`)).length).toBe(1);
  const replacement = context.pages().find((page) => page.url().startsWith(`chrome-extension://${extensionId}/index.html`))!;
  expect(await replacement.evaluate(async () => (await chrome.storage.local.get("pindou.editorTabId"))["pindou.editorTabId"])).not.toBe(ordinaryId);
  expect(ordinary.url()).toBe("data:text/html,ordinary");
});

test("background open command keeps one editor tab and focuses it", async ({ context, editor, extensionId }) => {
  await editor.evaluate(() => Promise.all([
    chrome.runtime.sendMessage({ type: "pindou:test", action: "open-editor" }),
    chrome.runtime.sendMessage({ type: "pindou:test", action: "open-editor" }),
    chrome.runtime.sendMessage({ type: "pindou:test", action: "open-editor" }),
  ]));
  await expect.poll(() => context.pages().filter((page) => page.url().startsWith(`chrome-extension://${extensionId}/index.html`)).length).toBe(1);
  const matchingPages = context.pages().filter((page) => page.url().startsWith(`chrome-extension://${extensionId}/index.html`));
  expect(matchingPages).toHaveLength(1);
  expect(await matchingPages[0].evaluate(() => document.visibilityState)).toBe("visible");
});
