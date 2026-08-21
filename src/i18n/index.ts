import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import type { UiLanguage } from "./language";
import { setDefaultLayerNameProvider } from "../store/defaultLayerNames";

export type SupportedLanguage = UiLanguage;

export const i18n = createInstance().use(initReactI18next);

export async function initializeI18n(language: SupportedLanguage) {
  if (i18n.isInitialized) {
    await i18n.changeLanguage(language);
  } else {
    await i18n.init({
      resources: {
        en: { translation: en },
        "zh-CN": { translation: zhCN },
      },
      lng: language,
      fallbackLng: "en",
      supportedLngs: ["en", "zh-CN"],
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  }

  setDefaultLayerNameProvider((number) => i18n.t("layers.defaultName", { number }));

  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }

  return i18n;
}
