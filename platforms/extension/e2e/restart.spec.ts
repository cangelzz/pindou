import { expect, test, type BrowserContext } from "@playwright/test";
import { callStore, getStore, launchExtensionContext, withPersistentContext } from "./fixtures";

async function extensionId(context: BrowserContext): Promise<string> {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  return new URL(worker.url()).host;
}

test("browser restart preserves token, settings, autosave record and restores snapshot", async () => {
  test.setTimeout(90_000);
  await withPersistentContext(launchExtensionContext, async (firstContext, profile) => {
    let context: BrowserContext | undefined = firstContext;
    try {
    const firstId = await extensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${firstId}/index.html`);
    await page.getByTestId("top-menu").waitFor();
    await page.evaluate(async () => {
      chrome.storage.local.set({ "github.accessToken": "restart-token" });
      localStorage.setItem("pindouverse.exportWatermark", JSON.stringify({ showHeader: false }));
    });
    await callStore(page, "setCell", [0, 0, 23]);
    expect(await callStore(page, "autoSave")).toMatchObject({ ok: true });
    expect(await callStore(page, "createSnapshot", ["Across browser restart"])).toMatchObject({ ok: true });
    await page.evaluate(async () => {
      const request = indexedDB.open("pindouverse", 2);
      const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction(["autosave", "snapshots"], "readonly"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
    });
    await context.close(); context = undefined;

    context = await launchExtensionContext(profile);
    const secondId = await extensionId(context);
    expect(secondId).toBe(firstId);
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${secondId}/index.html`);
    await reopened.getByTestId("top-menu").waitFor();
    expect(await reopened.evaluate(async () => (await chrome.storage.local.get("github.accessToken"))["github.accessToken"])).toBe("restart-token");
    expect(await reopened.evaluate(() => JSON.parse(localStorage.getItem("pindouverse.exportWatermark") || "null"))).toEqual({ showHeader: false });
    const autosave = await reopened.evaluate(async () => {
      const request = indexedDB.open("pindouverse", 2);
      const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const value = await new Promise<unknown>((resolve, reject) => { const get = db.transaction("autosave").objectStore("autosave").get("current"); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
      db.close(); return JSON.parse(value as string);
    });
    expect(autosave.version).toBe(3);
    expect(autosave.canvasData[0][0]).toBe(23);
    expect(await callStore(reopened, "loadSnapshots")).toMatchObject({ ok: true });
    const snapshots = (await getStore<any>(reopened, ["snapshots"])).snapshots;
    const snapshot = snapshots.find((item: { name: string }) => item.name === "Across browser restart");
    expect(snapshot).toBeTruthy();
    expect(await callStore(reopened, "restoreSnapshot", [snapshot.path])).toMatchObject({ ok: true });
    expect((await getStore<any>(reopened, ["canvasData"])).canvasData[0][0].colorIndex).toBe(23);
    } finally {
      if (context && context !== firstContext) await context.close();
    }
  });
});
