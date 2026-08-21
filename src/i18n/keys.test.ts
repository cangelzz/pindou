import defaultI18n from "i18next";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useTranslation } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import { i18n, initializeI18n } from "./index";

const requiredDomains = [
  "brand",
  "menu",
  "tools",
  "canvas",
  "palette",
  "preview",
  "layers",
  "project",
  "recovery",
  "stats",
  "import",
  "export",
  "history",
  "snapshots",
  "cloud",
  "compare",
  "github",
  "selection",
  "feedback",
  "voice",
  "window",
  "dialogs",
  "status",
  "errors",
  "beta",
  "language",
] as const;

function flatten(value: unknown, path = ""): Map<string, string> {
  if (typeof value === "string") {
    expect(value.trim(), `${path} must be a non-empty string`).not.toBe("");
    return new Map([[path, value]]);
  }

  expect(value, `${path || "root"} must be an object`).not.toBeNull();
  expect(Array.isArray(value), `${path || "root"} must not be an array`).toBe(false);
  expect(typeof value, `${path || "root"} must be an object`).toBe("object");

  const entries = Object.entries(value as Record<string, unknown>);
  expect(entries.length, `${path || "root"} must not be empty`).toBeGreaterThan(0);

  return new Map(
    entries.flatMap(([key, child]) =>
      [...flatten(child, path ? `${path}.${key}` : key).entries()],
    ),
  );
}

describe("translation resources", () => {
  it("has exactly the required top-level domains", () => {
    expect(Object.keys(en).sort()).toEqual([...requiredDomains].sort());
    expect(Object.keys(zhCN).sort()).toEqual([...requiredDomains].sort());
  });

  it("has identical flattened keys and non-empty string leaves", () => {
    const enLeaves = flatten(en);
    const zhLeaves = flatten(zhCN);

    expect([...enLeaves.keys()].sort()).toEqual([...zhLeaves.keys()].sort());
  });

  it("keeps English translations free of Chinese characters", () => {
    for (const [key, value] of flatten(en)) {
      expect(value, key).not.toMatch(/\p{Script=Han}/u);
    }
  });

  it.each([
    "palette.groups.mard221", "palette.search", "palette.replace.confirm",
    "selection.menu.mirror", "selection.replace.title", "selection.adjust.title",
    "history.current", "history.pixelChanges", "snapshots.manageTitle",
    "compare.title", "cloud.projectsTitle", "github.loginTitle",
    "beta.description", "feedback.description", "voice.listening",
    "window.closeConfirm",
  ])("includes advanced workflow key %s in both languages", (key) => {
    expect(flatten(en).has(key)).toBe(true);
    expect(flatten(zhCN).has(key)).toBe(true);
  });
});

describe("initializeI18n", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses an isolated instance with the required configuration", async () => {
    await initializeI18n("en");

    expect(i18n).not.toBe(defaultI18n);
    expect(i18n.options.fallbackLng).toEqual(["en"]);
    expect(i18n.options.supportedLngs).toEqual(["en", "zh-CN", "cimode"]);
    expect(i18n.options.interpolation?.escapeValue).toBe(false);
    expect(i18n.options.returnNull).toBe(false);
    expect(i18n.getResource("en", "translation", "language.name")).toBe("English");
    expect(i18n.getResource("zh-CN", "translation", "language.name")).toBe("简体中文");
  });

  it("connects React useTranslation to the shared instance", async () => {
    function LanguageName() {
      const { t } = useTranslation();
      return createElement("span", null, t("language.name"));
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await initializeI18n("en");
    expect(renderToString(createElement(LanguageName))).toContain("English");

    await initializeI18n("zh-CN");
    expect(renderToString(createElement(LanguageName))).toContain("简体中文");
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
    await initializeI18n("en");
  });

  it("initializes English and switches to Simplified Chinese", async () => {
    await initializeI18n("en");
    expect(i18n.language).toBe("en");
    expect(i18n.t("language.name")).toBe("English");

    await initializeI18n("zh-CN");
    expect(i18n.language).toBe("zh-CN");
    expect(i18n.t("language.name")).toBe("简体中文");
  });

  it("falls back to English when the active language lacks a key", async () => {
    await initializeI18n("zh-CN");
    i18n.addResource("en", "translation", "status.fallbackForTest", "English fallback");

    expect(i18n.t("status.fallbackForTest")).toBe("English fallback");
  });

  it("sets the document language when a document exists", async () => {
    const documentElement = { lang: "" };
    vi.stubGlobal("document", { documentElement });

    await initializeI18n("zh-CN");

    expect(documentElement.lang).toBe("zh-CN");
  });

  it("is safe when document is unavailable", async () => {
    vi.stubGlobal("document", undefined);

    await expect(initializeI18n("en")).resolves.toBe(i18n);
  });

  it("returns the key when every language lacks a translation", async () => {
    await initializeI18n("en");
    expect(i18n.t("errors.missingForTest")).toBe("errors.missingForTest");
  });
});
