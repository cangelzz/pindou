import { describe, expect, it, vi } from "vitest";
import type { BrowserApi } from "../browserApi";
import { openOrFocusEditor, registerActionHandler, registerImageTaskHandlers } from "../background";

function createApi(options: {
  tabs?: Array<{ id?: number; windowId?: number; url?: string }>;
  createdTab?: { id?: number };
  identifyResponse?: unknown;
  identifyError?: Error;
} = {}) {
  let actionHandler: (() => void) | undefined;
  let installedHandler: (() => void) | undefined;
  const createdMenus: Array<{ id: string; title: string; contexts: string[] }> = [];
  const stored: Record<string, unknown> = {};
  const tabs = options.tabs ?? [];
  const api: BrowserApi = {
    runtime: {
      getURL: vi.fn(() => "chrome-extension://test/index.html"),
      onInstalled: { addListener: vi.fn((handler) => { installedHandler = handler; }) },
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      get: vi.fn(async (id) => {
        const tab = tabs.find((candidate) => candidate.id === id);
        if (!tab) throw new Error("No tab");
        return tab;
      }),
      update: vi.fn(async () => undefined),
      create: vi.fn(async () => options.createdTab ?? { id: 22 }),
      sendMessage: vi.fn(async () => {
        if (options.identifyError) throw options.identifyError;
        return options.identifyResponse ?? { ok: true, marker: "pindou-editor" };
      }),
      onRemoved: { addListener: vi.fn() },
    },
    windows: {
      update: vi.fn(async () => undefined),
    },
    action: {
      onClicked: {
        addListener: vi.fn((handler) => {
          actionHandler = handler;
        }),
      },
    },
    contextMenus: {
      create: vi.fn((properties) => { createdMenus.push(properties); }),
      remove: vi.fn(async () => undefined),
      onClicked: { addListener: vi.fn() },
    },
    storage: { local: {
      get: vi.fn(async (key?: string | null) => key == null ? { ...stored } : { [key]: stored[key] }),
      set: vi.fn(async (values) => { Object.assign(stored, values); }),
      remove: vi.fn(async (key) => { for (const item of Array.isArray(key) ? key : [key]) delete stored[item]; }),
    } },
    i18n: { getUILanguage: () => "en", getMessage: vi.fn((key: string) => key === "contextMenuConvertImage" ? "Convert with PindouVerse" : "") },
  };

  return { api, getActionHandler: () => actionHandler, runInstalled: () => installedHandler?.(), createdMenus };
}

describe("openOrFocusEditor", () => {
  it("focuses the persisted editor tab without querying browsing history", async () => {
    const { api } = createApi({ tabs: [{ id: 7, windowId: 3 }] });
    await api.storage.local.set({ "pindou.editorTabId": 7 });

    await expect(openOrFocusEditor(api)).resolves.toBe(7);

    expect(api.tabs.get).toHaveBeenCalledWith(7);
    expect(api.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(api.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it("replaces a persisted ordinary tab when editor handshake rejects", async () => {
    const { api } = createApi({ tabs: [{ id: 7, windowId: 3 }], createdTab: { id: 41 }, identifyError: new Error("Receiving end missing") });
    await api.storage.local.set({ "pindou.editorTabId": 7 });

    await expect(openOrFocusEditor(api)).resolves.toBe(41);

    expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, { type: "pindou:identify-editor" });
    expect(api.tabs.update).not.toHaveBeenCalledWith(7, expect.anything());
    await expect(api.storage.local.get("pindou.editorTabId")).resolves.toEqual({ "pindou.editorTabId": 41 });
  });

  it("replaces a persisted tab with the wrong handshake marker", async () => {
    const { api } = createApi({ tabs: [{ id: 7 }], createdTab: { id: 42 }, identifyResponse: { ok: true, marker: "other" } });
    await api.storage.local.set({ "pindou.editorTabId": 7 });

    await expect(openOrFocusEditor(api)).resolves.toBe(42);
    expect(api.tabs.update).not.toHaveBeenCalledWith(7, expect.anything());
  });

  it("persists a newly created editor tab id", async () => {
    const { api } = createApi({ createdTab: { id: 41 } });

    await expect(openOrFocusEditor(api)).resolves.toBe(41);

    expect(api.tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://test/index.html" });
    await expect(api.storage.local.get("pindou.editorTabId")).resolves.toEqual({ "pindou.editorTabId": 41 });
  });

  it("creates an editor tab when none exists", async () => {
    const { api } = createApi({ createdTab: { id: 41 } });

    await expect(openOrFocusEditor(api)).resolves.toBe(41);

    expect(api.tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://test/index.html" });
  });

  it("throws a clear error when the created tab has no id", async () => {
    const { api } = createApi({ createdTab: {} });

    await expect(openOrFocusEditor(api)).rejects.toThrow("Created editor tab has no id");
  });

  it("does not focus a window when the existing tab has no window id", async () => {
    const { api } = createApi({ tabs: [{ id: 7 }] });
    await api.storage.local.set({ "pindou.editorTabId": 7 });

    await expect(openOrFocusEditor(api)).resolves.toBe(7);

    expect(api.windows.update).not.toHaveBeenCalled();
  });
});

describe("registerImageTaskHandlers", () => {
  it("uses the localized browser message for the image context menu", async () => {
    const { api, runInstalled, createdMenus } = createApi();
    registerImageTaskHandlers(api);
    runInstalled();
    await vi.waitFor(() => expect(createdMenus).toHaveLength(1));
    expect(createdMenus[0].title).toBe("Convert with PindouVerse");
  });
});

describe("registerActionHandler", () => {
  it("catches and logs errors from the asynchronous action handler", async () => {
    const { api, getActionHandler } = createApi({ createdTab: {} });
    const logger = { error: vi.fn() };
    registerActionHandler(api, logger);

    getActionHandler()?.();
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to open or focus the extension editor",
        expect.any(Error),
      );
    });
  });
});
