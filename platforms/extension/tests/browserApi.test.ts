import { describe, expect, it, vi } from "vitest";
import { createBrowserApi, type ChromeApiLike } from "../browserApi";

describe("createBrowserApi", () => {
  it("binds Chrome methods to their owners and forwards arguments", async () => {
    let registeredHandler: (() => void) | undefined;
    const runtimeEvents = {
      marker: "runtime-event",
      addListener: vi.fn(function (this: { marker: string }) { expect(this.marker).toBe("runtime-event"); }),
      removeListener: vi.fn(function (this: { marker: string }) { expect(this.marker).toBe("runtime-event"); }),
    };
    const runtime = {
      prefix: "chrome-extension://bound/",
      getURL(this: { prefix: string }, path: string) {
        return `${this.prefix}${path}`;
      },
      sendMessage: vi.fn(function (this: { prefix: string }, message: unknown) { expect(this.prefix).toContain("bound"); return Promise.resolve(message); }),
      onInstalled: runtimeEvents,
      onMessage: runtimeEvents,
    };
    const tabs = {
      marker: "tabs",
      get: vi.fn(function (this: { marker: string }, tabId: number) {
        expect(this.marker).toBe("tabs");
        return Promise.resolve({ id: tabId, windowId: 2 });
      }),
      update: vi.fn(function (
        this: { marker: string },
        tabId: number,
        updateProperties: { active: boolean },
      ) {
        expect(this.marker).toBe("tabs");
        return Promise.resolve({ tabId, updateProperties });
      }),
      create: vi.fn(function (this: { marker: string }, createProperties: { url: string }) {
        expect(this.marker).toBe("tabs");
        return Promise.resolve({ id: 3, url: createProperties.url });
      }),
      sendMessage: vi.fn(function (this: { marker: string }) { expect(this.marker).toBe("tabs"); return Promise.resolve(); }),
      onRemoved: { marker: "tabs-removed", addListener: vi.fn(function(this: { marker: string }) { expect(this.marker).toBe("tabs-removed"); }) },
    };
    const windows = {
      marker: "windows",
      update: vi.fn(function (
        this: { marker: string },
        windowId: number,
        updateInfo: { focused: boolean },
      ) {
        expect(this.marker).toBe("windows");
        return Promise.resolve({ windowId, updateInfo });
      }),
    };
    const onClicked = {
      marker: "onClicked",
      addListener: vi.fn(function (this: { marker: string }, handler: () => void) {
        expect(this.marker).toBe("onClicked");
        registeredHandler = handler;
      }),
    };
    const contextMenus = { marker: "menus", create: vi.fn(function(this: { marker: string }) { expect(this.marker).toBe("menus"); }), remove: vi.fn(function(this: { marker: string }) { expect(this.marker).toBe("menus"); return Promise.resolve(); }), onClicked };
    const local = { marker: "storage", get: vi.fn(function(this: { marker: string }) { expect(this.marker).toBe("storage"); return Promise.resolve({}); }), set: vi.fn(function(this: { marker: string }) { expect(this.marker).toBe("storage"); return Promise.resolve(); }), remove: vi.fn(function(this: { marker: string }) { expect(this.marker).toBe("storage"); return Promise.resolve(); }) };
    const api = createBrowserApi({
      runtime,
      tabs,
      windows,
      action: { onClicked },
      contextMenus,
      storage: { local },
    } as ChromeApiLike);
    const handler = vi.fn();

    expect(api.runtime.getURL("index.html")).toBe("chrome-extension://bound/index.html");
    await api.runtime.sendMessage({ ping: true });
    await api.tabs.get(1);
    await api.tabs.update(4, { active: true });
    await api.tabs.create({ url: "editor" });
    await api.tabs.sendMessage(3, { ok: true });
    await api.windows.update(5, { focused: true });
    api.runtime.onInstalled.addListener(handler);
    api.runtime.onMessage.addListener(handler);
    api.runtime.onMessage.removeListener(handler);
    api.contextMenus.create({ id: "x", title: "x", contexts: ["image"] });
    await api.contextMenus.remove("x");
    await api.storage.local.get("x");
    await api.storage.local.set({ x: 1 });
    await api.storage.local.remove("x");
    api.action.onClicked.addListener(handler);

    expect(tabs.get).toHaveBeenCalledWith(1);
    expect(tabs.update).toHaveBeenCalledWith(4, { active: true });
    expect(tabs.create).toHaveBeenCalledWith({ url: "editor" });
    expect(windows.update).toHaveBeenCalledWith(5, { focused: true });
    expect(onClicked.addListener).toHaveBeenCalledWith(handler);
    registeredHandler?.();
    expect(handler).toHaveBeenCalledOnce();
  });
});
