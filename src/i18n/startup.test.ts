import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n, initializeI18n } from ".";
import { renderStartupFailure } from "./startup";

describe("renderStartupFailure", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["en", "PindouVerse failed to start."],
    ["zh-CN", "PindouVerse 启动失败。"],
  ] as const)("renders the localized startup error after %s initialization", async (language, expected) => {
    await initializeI18n(language);
    const root = { textContent: "" } as HTMLElement;
    const error = new Error("bootstrap failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    renderStartupFailure(root, error);

    expect(root.textContent).toBe(expected);
    expect(consoleError).toHaveBeenCalledWith("PindouVerse failed to start", error);
  });

  it("uses the browser language synchronously when initialization failed", () => {
    vi.spyOn(i18n, "isInitialized", "get").mockReturnValue(false);
    vi.stubGlobal("document", { documentElement: { lang: "zh-CN" } });
    vi.stubGlobal("navigator", { language: "en-US" });
    const root = { textContent: "" } as HTMLElement;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    renderStartupFailure(root, new Error("i18n failed"));

    expect(root.textContent).toBe("PindouVerse failed to start.");
    vi.unstubAllGlobals();
  });
});
