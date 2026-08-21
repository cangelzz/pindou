import { getProductionBrowserApi, type BrowserApi } from "./browserApi";
import type { WebImageTask } from "../../src/platform/imageImportService";
import { WebImageTaskBroker } from "./imageTaskBroker";

declare const __PINDOU_EXTENSION_TEST__: boolean;

export const IMAGE_TASK_TTL_MS = 5 * 60 * 1000;
const MENU_ID = "convert-image";
const EDITOR_TAB_KEY = "pindou.editorTabId";

export interface ErrorLogger {
  error(message: string, error: unknown): void;
}

let editorLifecycleQueue: Promise<unknown> = Promise.resolve();
function serializeEditorLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const result = editorLifecycleQueue.then(operation, operation);
  editorLifecycleQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function openOrFocusEditor(api: BrowserApi): Promise<number> {
  return serializeEditorLifecycle(async () => {
    const stored = await api.storage.local.get(EDITOR_TAB_KEY);
    const knownId = stored[EDITOR_TAB_KEY];
    if (typeof knownId === "number") {
      let existingTab;
      try {
        existingTab = await api.tabs.get(knownId);
        const identity = await api.tabs.sendMessage(knownId, { type: "pindou:identify-editor" }) as { ok?: boolean; marker?: string } | undefined;
        if (identity?.ok !== true || identity.marker !== "pindou-editor") existingTab = undefined;
      } catch { existingTab = undefined; }
      if (!existingTab) await api.storage.local.remove(EDITOR_TAB_KEY);
      if (existingTab) {
        await api.tabs.update(knownId, { active: true });
        if (existingTab.windowId !== undefined) await api.windows.update(existingTab.windowId, { focused: true });
        return knownId;
      }
    }
    const createdTab = await api.tabs.create({ url: api.runtime.getURL("index.html") });
    if (createdTab.id === undefined) throw new Error("Created editor tab has no id");
    await api.storage.local.set({ [EDITOR_TAB_KEY]: createdTab.id });
    return createdTab.id;
  });
}

export async function createImageTaskFromContext(
  api: BrowserApi,
  broker: WebImageTaskBroker,
  info: { srcUrl: string; pageUrl?: string },
  deps: { now: () => number; randomUUID: () => string },
): Promise<WebImageTask> {
  const timestamp = deps.now();
  const task: WebImageTask = { id: deps.randomUUID(), imageUrl: info.srcUrl, pageUrl: info.pageUrl, createdAt: timestamp, expiresAt: timestamp + IMAGE_TASK_TTL_MS };
  const created = await broker.create(task);
  if (!created.ok) throw created.cause ?? new Error(created.message ?? created.code);
  const tabId = await openOrFocusEditor(api);
  try { await api.tabs.sendMessage(tabId, { type: "pindou:image-task", taskId: task.id, createdAt: task.createdAt }); }
  catch { /* editor may not be mounted; startup discovery keeps the task */ }
  return task;
}

export function registerImageTaskHandlers(
  api: BrowserApi,
  deps: { now?: () => number; randomUUID?: () => string; logger?: ErrorLogger } = {},
): void {
  const now = deps.now ?? Date.now;
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  const logger = deps.logger ?? console;
  const broker = new WebImageTaskBroker(api.storage.local, now);
  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const request = message as { type?: string; action?: string; payload?: { taskId?: string; claimId?: string; task?: WebImageTask } };
    if (request?.type !== "pindou:image-task-broker") return;
    const operation: Promise<unknown> = broker.drainPendingAcks().then<unknown>(() => request.action === "list" ? broker.list()
      : request.action === "claim" && request.payload?.taskId ? broker.claim(request.payload.taskId)
      : request.action === "ack" && request.payload?.taskId && request.payload?.claimId ? broker.ack(request.payload.taskId, request.payload.claimId)
      : request.action === "renew" && request.payload?.taskId && request.payload?.claimId ? broker.renew(request.payload.taskId, request.payload.claimId)
      : request.action === "release" && request.payload?.taskId && request.payload?.claimId ? broker.release(request.payload.taskId, request.payload.claimId)
      : request.action === "create" && request.payload?.task ? broker.create(request.payload.task)
      : request.action === "cleanup" ? broker.cleanup()
      : Promise.resolve({ ok: false as const, code: "invalid-data" as const, message: "Unknown broker request" }));
    void operation.then(sendResponse);
    return true;
  });
  api.runtime.onInstalled.addListener(() => {
    void api.contextMenus.remove(MENU_ID).catch(() => undefined).then(() => {
      api.contextMenus.create({
        id: MENU_ID,
        title: api.i18n?.getMessage?.("contextMenuConvertImage") || "Convert with PindouVerse",
        contexts: ["image"],
      });
    });
  });
  api.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
    void createImageTaskFromContext(api, broker, { srcUrl: info.srcUrl, pageUrl: info.pageUrl }, { now, randomUUID })
      .catch((error) => logger.error("Failed to create web image task", error));
  });
}

export function registerActionHandler(
  api: BrowserApi,
  logger: ErrorLogger = console,
): void {
  api.action.onClicked.addListener(() => {
    void openOrFocusEditor(api).catch((error: unknown) => {
      logger.error("Failed to open or focus the extension editor", error);
    });
  });
}

const productionApi = getProductionBrowserApi();
if (productionApi) {
  productionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if ((message as { type?: string })?.type !== "pindou:editor-ready" || sender.tab?.id === undefined) return;
    void serializeEditorLifecycle(() => productionApi.storage.local.set({ [EDITOR_TAB_KEY]: sender.tab!.id! }))
      .then(() => sendResponse({ ok: true }));
    return true;
  });
  productionApi.tabs.onRemoved.addListener((tabId) => {
    void serializeEditorLifecycle(async () => {
      const stored = await productionApi.storage.local.get(EDITOR_TAB_KEY);
      if (stored[EDITOR_TAB_KEY] === tabId) await productionApi.storage.local.remove(EDITOR_TAB_KEY);
    });
  });
  registerActionHandler(productionApi);
  registerImageTaskHandlers(productionApi);
  if (__PINDOU_EXTENSION_TEST__) {
    const testBroker = new WebImageTaskBroker(productionApi.storage.local, Date.now);
    productionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const request = message as { type?: string; action?: string; payload?: { srcUrl?: string; pageUrl?: string } };
      if (request.type !== "pindou:test") return;
      const operation = request.action === "open-editor"
        ? openOrFocusEditor(productionApi).then((tabId) => ({ ok: true, tabId }))
        : request.action === "image-context" && request.payload?.srcUrl
          ? createImageTaskFromContext(productionApi, testBroker, { srcUrl: request.payload.srcUrl, pageUrl: request.payload.pageUrl }, { now: Date.now, randomUUID: () => crypto.randomUUID() })
            .then(async (task) => {
              await productionApi.runtime.sendMessage({ type: "pindou:image-task", taskId: task.id, createdAt: task.createdAt });
              return { ok: true, task };
            })
          : Promise.resolve({ ok: false, message: "Unknown test action" });
      void operation.then(
        sendResponse,
        (error: unknown) => sendResponse({ ok: false, message: error instanceof Error ? error.message : String(error) }),
      );
      return true;
    });
  }
}
