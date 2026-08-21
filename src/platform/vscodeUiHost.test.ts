import { describe, expect, it, vi } from "vitest";
import { handleUiPlatformMessage } from "../../platforms/vscode/src/uiPlatformHost";
import { UI_LANGUAGE_KEY } from "../i18n/language";

function harness(language = "zh-CN") {
  const values = new Map<string, unknown>();
  const postMessage = vi.fn(async (_message: Record<string, unknown>) => true);
  const globalState = {
    get: vi.fn((key: string) => values.get(key)),
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    }),
  };
  return { values, postMessage, globalState, dependencies: { language, globalState, postMessage } };
}

describe("handleUiPlatformMessage", () => {
  it("returns vscode UI language with the original requestId before ready", async () => {
    const host = harness();
    await expect(handleUiPlatformMessage({ type: "getUiEnvironment", requestId: 7 }, host.dependencies)).resolves.toBe(true);
    expect(host.postMessage).toHaveBeenCalledWith({ type: "uiEnvironment", requestId: 7, language: "zh-CN", revision: 0 });
  });

  it("gets, sets, and removes the UI preference through globalState", async () => {
    const host = harness();
    host.values.set(UI_LANGUAGE_KEY, "en");

    await handleUiPlatformMessage({ type: "storageGet", requestId: 1, key: UI_LANGUAGE_KEY }, host.dependencies);
    await handleUiPlatformMessage({ type: "storageSet", requestId: 2, key: UI_LANGUAGE_KEY, value: "zh-CN" }, host.dependencies);
    await handleUiPlatformMessage({ type: "storageRemove", requestId: 3, key: UI_LANGUAGE_KEY }, host.dependencies);

    expect(host.globalState.get).toHaveBeenCalledWith(UI_LANGUAGE_KEY);
    expect(host.globalState.update.mock.calls).toEqual([[UI_LANGUAGE_KEY, "zh-CN"], [UI_LANGUAGE_KEY, undefined]]);
    expect(host.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: "storageResult", requestId: 1, value: "en", revision: 0 },
      { type: "storageResult", requestId: 2, revision: 1 },
      { type: "storageResult", requestId: 3 },
    ]);
  });

  it("rejects non-UI globalState keys and preserves requestId", async () => {
    const host = harness();
    await expect(handleUiPlatformMessage({ type: "storageGet", requestId: 9, key: "github.accessToken" }, host.dependencies)).resolves.toBe(true);
    expect(host.globalState.get).not.toHaveBeenCalled();
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "storageResult",
      requestId: 9,
      error: expect.stringContaining("Unsupported storage key"),
    }));
  });

  it("rejects invalid saved languages without updating globalState", async () => {
    for (const value of ["zh-TW", {}, undefined]) {
      const host = harness();
      await expect(handleUiPlatformMessage({ type: "storageSet", requestId: 4, key: UI_LANGUAGE_KEY, value }, host.dependencies)).resolves.toBe(true);
      expect(host.globalState.update).not.toHaveBeenCalled();
      expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: 4, error: expect.stringContaining("Invalid UI language") }));
    }
  });

  it("ignores UI RPC messages without a numeric requestId", async () => {
    const host = harness();
    await expect(handleUiPlatformMessage({ type: "storageGet", key: UI_LANGUAGE_KEY }, host.dependencies)).resolves.toBe(false);
    expect(host.globalState.get).not.toHaveBeenCalled();
    expect(host.postMessage).not.toHaveBeenCalled();
  });

  it("returns false for messages outside the UI platform RPC contract", async () => {
    const host = harness();
    await expect(handleUiPlatformMessage({ type: "ready" }, host.dependencies)).resolves.toBe(false);
    expect(host.postMessage).not.toHaveBeenCalled();
  });
});
