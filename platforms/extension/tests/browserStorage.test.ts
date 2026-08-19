import { describe, expect, it, vi } from "vitest";
import { BrowserStorage, GITHUB_ACCESS_TOKEN_KEY } from "../browserStorage";

function callbackChrome() {
  const values: Record<string, unknown> = {};
  const runtime: { lastError?: { message: string } } = {};
  const local = {
    marker: "local",
    get(this: { marker: string }, key: string, callback: (items: Record<string, unknown>) => void) {
      expect(this.marker).toBe("local"); callback({ [key]: values[key] });
    },
    set(this: { marker: string }, items: Record<string, unknown>, callback: () => void) {
      expect(this.marker).toBe("local"); Object.assign(values, items); callback();
    },
    remove(this: { marker: string }, key: string, callback: () => void) {
      expect(this.marker).toBe("local"); delete values[key]; callback();
    },
  };
  return { values, runtime, local };
}

describe("BrowserStorage", () => {
  it("uses only chrome.storage.local with callback APIs and preserves this", async () => {
    const chrome = callbackChrome();
    const localStorageGet = vi.fn();
    const localStorageSet = vi.fn();
    vi.stubGlobal("localStorage", { getItem: localStorageGet, setItem: localStorageSet });
    const storage = new BrowserStorage(chrome.local, chrome.runtime);

    expect(await storage.set(GITHUB_ACCESS_TOKEN_KEY, "token")).toEqual({ ok: true, value: undefined });
    expect(await storage.get(GITHUB_ACCESS_TOKEN_KEY)).toEqual({ ok: true, value: "token" });
    expect(await storage.remove(GITHUB_ACCESS_TOKEN_KEY)).toEqual({ ok: true, value: undefined });
    expect(localStorageGet).not.toHaveBeenCalled();
    expect(localStorageSet).not.toHaveBeenCalled();
  });

  it("supports promise APIs", async () => {
    const values: Record<string, unknown> = {};
    const local = {
      async get(key: string) { return { [key]: values[key] }; },
      async set(items: Record<string, unknown>) { Object.assign(values, items); },
      async remove(key: string) { delete values[key]; },
    };
    const storage = new BrowserStorage(local, {});
    await storage.set("x", 3);
    expect(await storage.get<number>("x")).toEqual({ ok: true, value: 3 });
  });

  it("turns chrome.runtime.lastError into a structured failure", async () => {
    const chrome = callbackChrome();
    chrome.local.get = function (_key: string, callback: (items: Record<string, unknown>) => void) {
      chrome.runtime.lastError = { message: "storage denied" }; callback({}); delete chrome.runtime.lastError;
    } as typeof chrome.local.get;
    const storage = new BrowserStorage(chrome.local, chrome.runtime);
    expect(await storage.get("x")).toMatchObject({ ok: false, code: "unknown", message: "storage denied" });
  });
});
