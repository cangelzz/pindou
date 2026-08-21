import { i18n } from ".";
import { normalizeUiLanguage } from "./language";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export function renderStartupFailure(root: HTMLElement, error: unknown): void {
  console.error("PindouVerse failed to start", error);
  const detectedLanguage = typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : typeof document !== "undefined" ? document.documentElement.lang : "en";
  const language = normalizeUiLanguage(detectedLanguage);
  root.textContent = i18n.isInitialized
    ? i18n.t("errors.startup")
    : language === "zh-CN" ? zhCN.errors.startup : en.errors.startup;
}
