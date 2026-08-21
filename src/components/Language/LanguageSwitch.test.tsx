import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import { LanguageSwitch, changeUiLanguage, createLanguageSwitchHandler } from "./LanguageSwitch";
import { UI_LANGUAGE_KEY, type UiLanguage } from "../../i18n/language";
import type { PlatformResult } from "../../platform/result";

function dependencies(language: UiLanguage, storageResult: PlatformResult<void> = { ok: true, value: undefined }) {
  let current = language;
  const documentElement = { lang: language };
  const changeLanguage = vi.fn(async (next: UiLanguage) => { current = next; });
  const set = vi.fn(async () => storageResult);
  return {
    deps: { i18n: { changeLanguage }, documentElement, storage: { set } },
    changeLanguage,
    set,
    documentElement,
    current: () => current,
  };
}

describe("changeUiLanguage", () => {
  it.each([["en", "zh-CN"], ["zh-CN", "en"]] as const)("switches %s to %s and persists it", async (from, next) => {
    const test = dependencies(from);
    const result = await changeUiLanguage(next, test.deps);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(test.current()).toBe(next);
    expect(test.documentElement.lang).toBe(next);
    expect(test.set).toHaveBeenCalledWith(UI_LANGUAGE_KEY, next);
  });

  it("keeps the changed language when persistence fails", async () => {
    const failure = { ok: false as const, code: "unknown" as const, message: "disk full" };
    const test = dependencies("en", failure);
    expect(await changeUiLanguage("zh-CN", test.deps)).toBe(failure);
    expect(test.current()).toBe("zh-CN");
    expect(test.documentElement.lang).toBe("zh-CN");
  });

  it("does not mutate lang or persist when i18n rejects the change", async () => {
    const test = dependencies("en");
    test.changeLanguage.mockRejectedValueOnce(new Error("i18n failed"));
    const result = await changeUiLanguage("zh-CN", test.deps);
    expect(result).toMatchObject({ ok: false, code: "unknown", message: "language-change-failed" });
    expect(test.documentElement.lang).toBe("en");
    expect(test.set).not.toHaveBeenCalled();
  });

  it("never invokes an editor-store mutation while switching language", async () => {
    const test = dependencies("en");
    const mutateStore = vi.fn();
    await changeUiLanguage("zh-CN", { ...test.deps, localizeDefaultLayerNames: mutateStore });
    expect(mutateStore).not.toHaveBeenCalled();
  });
});

describe("createLanguageSwitchHandler", () => {
  it("coalesces concurrent clicks into one language change and one persistence", async () => {
    let resolveChange!: () => void;
    const change = vi.fn(() => new Promise<PlatformResult<void>>((resolve) => {
      resolveChange = () => resolve({ ok: true, value: undefined });
    }));
    const alert = vi.fn(async () => {});
    const handler = createLanguageSwitchHandler({
      getNextLanguage: () => "zh-CN",
      change,
      alert,
      translate: (key) => key,
      setSwitching: vi.fn(),
    });

    const first = handler();
    const second = handler();
    expect(change).toHaveBeenCalledTimes(1);
    resolveChange();
    await Promise.all([first, second]);
    expect(change).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it.each([
    ["en", "Could not switch the interface language"],
    ["zh-CN", "无法切换界面语言"],
  ] as const)("alerts in the unchanged %s language when changeLanguage fails", async (language, message) => {
    const translations = language === "en"
      ? { "language.switchError": "Could not switch the interface language" }
      : { "language.switchError": "无法切换界面语言" };
    const alert = vi.fn(async () => {});
    const handler = createLanguageSwitchHandler({
      getNextLanguage: () => language === "en" ? "zh-CN" : "en",
      change: vi.fn(async () => ({ ok: false as const, code: "unknown" as const, message: "language-change-failed" })),
      alert,
      translate: (key) => translations[key as keyof typeof translations] ?? key,
      setSwitching: vi.fn(),
    });

    await handler();
    expect(alert).toHaveBeenCalledWith(message);
  });
});

describe("LanguageSwitch SSR", () => {
  it.each([
    ["en", "🌐 中文", "Switch to Chinese"],
    ["zh-CN", "🌐 EN", "切换到英文"],
  ] as const)("renders the target language for %s", async (language, label, title) => {
    const instance = createInstance();
    await instance.init({
      lng: language,
      resources: {
        en: { translation: { language: { switchToChinese: "Switch to Chinese", switchToEnglish: "Switch to English", title: "Language", saveError: "Could not save language preference" } } },
        "zh-CN": { translation: { language: { switchToChinese: "切换到中文", switchToEnglish: "切换到英文", title: "语言", saveError: "无法保存语言偏好" } } },
      },
    });
    const html = renderToString(createElement(I18nextProvider, { i18n: instance }, createElement(LanguageSwitch, {
      services: { storage: dependencies(language).deps.storage } as never,
      documentElement: { lang: language },
    })));
    expect(html).toContain(label);
    expect(html).toContain(`title="${title}"`);
    expect(html).toContain(`aria-label="${title}"`);
    expect(html).toContain('data-menu-id="language"');
  });
});
