export interface BrowserTab {
  id?: number;
  windowId?: number;
}

export interface BrowserStorageArea {
  get(key?: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string | string[]): Promise<void>;
}

export type BrowserMessageListener = (
  message: unknown,
  sender: { id?: string; tab?: BrowserTab },
  sendResponse: (response: unknown) => void,
) => boolean | void;

export interface ImageTaskBrokerClient {
  request<T>(action: "list" | "claim" | "ack" | "renew" | "release" | "create" | "cleanup", payload?: unknown): Promise<T>;
  queueAck?(taskId: string, claimId: string): Promise<import("../../src/platform/result").PlatformResult<void>>;
}

export interface BrowserApi {
  runtime: {
    getURL(path: string): string;
    lastError?: unknown;
    onInstalled: { addListener(handler: () => void): void };
    sendMessage<T = unknown>(message: unknown): Promise<T>;
    onMessage: {
      addListener(handler: BrowserMessageListener): void;
      removeListener(handler: BrowserMessageListener): void;
    };
  };
  tabs: {
    get(tabId: number): Promise<BrowserTab>;
    update(tabId: number, updateProperties: { active: boolean }): Promise<unknown>;
    create(createProperties: { url: string }): Promise<BrowserTab>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    onRemoved: { addListener(handler: (tabId: number) => void): void };
  };
  windows: {
    update(windowId: number, updateInfo: { focused: boolean }): Promise<unknown>;
  };
  action: {
    onClicked: { addListener(handler: () => void): void };
  };
  contextMenus: {
    create(properties: { id: string; title: string; contexts: string[] }): void;
    remove(id: string): Promise<void>;
    onClicked: { addListener(handler: (info: { menuItemId: string; srcUrl?: string; pageUrl?: string }) => void): void };
  };
  storage: { local: BrowserStorageArea };
  i18n: { getUILanguage(): string; getMessage?(key: string): string };
}

export interface ChromeApiLike extends BrowserApi {}

export function createBrowserApi(chromeApi: ChromeApiLike): BrowserApi {
  return {
    runtime: {
      getURL: chromeApi.runtime.getURL.bind(chromeApi.runtime),
      get lastError() { return chromeApi.runtime.lastError; },
      sendMessage: chromeApi.runtime.sendMessage.bind(chromeApi.runtime),
      onInstalled: { addListener: chromeApi.runtime.onInstalled.addListener.bind(chromeApi.runtime.onInstalled) },
      onMessage: {
        addListener: chromeApi.runtime.onMessage.addListener.bind(chromeApi.runtime.onMessage),
        removeListener: chromeApi.runtime.onMessage.removeListener.bind(chromeApi.runtime.onMessage),
      },
    },
    tabs: {
      get: chromeApi.tabs.get.bind(chromeApi.tabs),
      update: chromeApi.tabs.update.bind(chromeApi.tabs),
      create: chromeApi.tabs.create.bind(chromeApi.tabs),
      sendMessage: chromeApi.tabs.sendMessage.bind(chromeApi.tabs),
      onRemoved: { addListener: chromeApi.tabs.onRemoved.addListener.bind(chromeApi.tabs.onRemoved) },
    },
    windows: {
      update: chromeApi.windows.update.bind(chromeApi.windows),
    },
    action: {
      onClicked: { addListener: chromeApi.action.onClicked.addListener.bind(chromeApi.action.onClicked) },
    },
    contextMenus: {
      create: chromeApi.contextMenus.create.bind(chromeApi.contextMenus),
      remove: chromeApi.contextMenus.remove.bind(chromeApi.contextMenus),
      onClicked: { addListener: chromeApi.contextMenus.onClicked.addListener.bind(chromeApi.contextMenus.onClicked) },
    },
    storage: { local: {
      get: chromeApi.storage.local.get.bind(chromeApi.storage.local),
      set: chromeApi.storage.local.set.bind(chromeApi.storage.local),
      remove: chromeApi.storage.local.remove.bind(chromeApi.storage.local),
    } },
    i18n: {
      getUILanguage: chromeApi.i18n.getUILanguage.bind(chromeApi.i18n),
      getMessage: chromeApi.i18n.getMessage?.bind(chromeApi.i18n),
    },
  };
}

export const PENDING_ACK_KEY_PREFIX = "pindou.pendingImageAck.";
export function createImageTaskBrokerClient(api: BrowserApi): ImageTaskBrokerClient {
  return {
    request: (action, payload) => api.runtime.sendMessage({ type: "pindou:image-task-broker", action, payload }),
    queueAck: async (taskId, claimId) => {
      try {
        await api.storage.local.set({ [`${PENDING_ACK_KEY_PREFIX}${taskId}`]: { taskId, claimId } });
        return { ok: true, value: undefined };
      } catch (cause) { return { ok: false, code: "unknown", cause }; }
    },
  };
}

export function getProductionBrowserApi(): BrowserApi | undefined {
  const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeApiLike }).chrome;
  return chromeApi ? createBrowserApi(chromeApi) : undefined;
}
