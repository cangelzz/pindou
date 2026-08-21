import { describe, expect, it, vi } from "vitest";
import { handleUiPlatformMessage } from "../../platforms/vscode/src/uiPlatformHost";

const message = { type: "storageSet", requestId: 1, key: "pindou.uiLanguage", value: "zh-CN" };

describe("VS Code UI language propagation", () => {
  it("notifies peers only after persistence succeeds", async () => {
    const order: string[] = [];
    const onLanguageChanged = vi.fn(async () => { order.push("broadcast"); });
    await handleUiPlatformMessage(message, {
      language: "en",
      globalState: { get: vi.fn(), update: vi.fn(async () => { order.push("stored"); }) },
      postMessage: vi.fn(async () => { order.push("replied"); return true; }),
      onLanguageChanged,
    });
    expect(order).toEqual(["stored", "broadcast", "replied"]);
    expect(onLanguageChanged).toHaveBeenCalledWith("zh-CN", 1);
  });

  it("rejects invalid language without persisting or broadcasting", async () => {
    const update = vi.fn(async () => {}), onLanguageChanged = vi.fn();
    await handleUiPlatformMessage({ ...message, value: "fr" }, {
      language: "en", globalState: { get: vi.fn(), update }, postMessage: vi.fn(async () => true), onLanguageChanged,
    });
    expect(update).not.toHaveBeenCalled();
    expect(onLanguageChanged).not.toHaveBeenCalled();
  });
});
