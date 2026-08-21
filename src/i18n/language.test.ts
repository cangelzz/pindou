import { describe, expect, it } from "vitest";
import {
  UI_LANGUAGE_KEY,
  isUiLanguage,
  normalizeUiLanguage,
  selectUiLanguage,
} from "./language";

describe("UI_LANGUAGE_KEY", () => {
  it("uses the stable local storage key", () => {
    expect(UI_LANGUAGE_KEY).toBe("pindou.uiLanguage");
  });
});

describe("isUiLanguage", () => {
  it.each(["en", "zh-CN"])("accepts the exact supported value %j", (value) => {
    expect(isUiLanguage(value)).toBe(true);
  });

  it.each([
    " en",
    "en ",
    "EN",
    "zh-cn",
    " zh-CN ",
    "zh_CN",
    "",
    "fr",
    null,
    undefined,
    42,
    {},
  ])("rejects non-exact or non-string value %j", (value) => {
    expect(isUiLanguage(value)).toBe(false);
  });
});

describe("normalizeUiLanguage", () => {
  it.each([
    "zh-CN",
    "zh_CN",
    "zh-cn",
    "zh-SG",
    "zh_SG",
    "zh-Hans",
    "zh-Hans-CN",
    "zh-Hans-SG",
    "zh-Hans-TW",
    "zh-Hans-HK",
    "zh-CN-x-private",
    "zh-SG-x-private",
    " ZH_hAnS_cn ",
  ])("normalizes Simplified Chinese locale %j to zh-CN", (value) => {
    expect(normalizeUiLanguage(value)).toBe("zh-CN");
  });

  it.each([
    "zh-TW",
    "zh-HK",
    "zh-Hant",
    "zh-Hant-TW",
    "zh-Hant-CN",
    "zh-Hant-SG",
    "zh-Latn-CN",
    "zh",
    "zh-Hansx",
    "zh-Hans-",
    "zh-CN---",
    "zh-CN-💩",
    "zh-CN-u",
    "zh__CN",
    "-zh-CN",
    "zh CN",
    "en",
    "en-US",
    "fr",
    "ja",
    "",
    "   ",
    null,
    undefined,
    42,
  ])("normalizes unsupported locale %j to en", (value) => {
    expect(normalizeUiLanguage(value)).toBe("en");
  });
});

describe("normalizeUiLanguage without Intl.Locale", () => {
  it.each([
    ["zh-Hans", "zh-CN"], ["zh-CN", "zh-CN"], ["zh-SG-u-ca-chinese", "zh-CN"],
    ["zh-Hant-CN", "en"], ["zh-Latn-CN", "en"], ["zh-Hans-", "en"],
    ["zh-CN-1901", "zh-CN"], ["zh-CN-u", "en"], ["zh__CN", "en"], ["zh-CN-💩", "en"],
    ["zh-CN-u-ca-chinese-u-nu-latn", "en"], ["zh-CN-x-private", "zh-CN"],
  ] as const)("strictly parses %j as %j", (value, expected) => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "Locale");
    Object.defineProperty(Intl, "Locale", { configurable: true, value: undefined });
    try { expect(normalizeUiLanguage(value)).toBe(expected); }
    finally { if (descriptor) Object.defineProperty(Intl, "Locale", descriptor); }
  });
});

describe("selectUiLanguage", () => {
  it.each([
    ["en", "zh-Hans", "en"],
    ["zh-CN", "en-US", "zh-CN"],
  ] as const)(
    "prefers valid saved language %j over detected language %j",
    (saved, detected, expected) => {
      expect(selectUiLanguage(saved, detected)).toBe(expected);
    },
  );

  it.each([
    [" en", "zh-Hans", "zh-CN"],
    ["zh-cn", "en-US", "en"],
    [" zh-CN ", "fr", "en"],
    [null, "zh_CN", "zh-CN"],
    [undefined, "zh-Hant", "en"],
    [42, "zh-CN-x-private", "zh-CN"],
  ])(
    "falls back from invalid saved value %j to detected value %j",
    (saved, detected, expected) => {
      expect(selectUiLanguage(saved, detected)).toBe(expected);
    },
  );
});
