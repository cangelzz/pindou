import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { appAlert } from "../Dialog/AppDialog";
import { UI_LANGUAGE_KEY, type UiLanguage } from "../../i18n/language";
import type { PlatformResult } from "../../platform/result";
import type { PlatformServices, StorageService } from "../../platform/services";

export interface ChangeUiLanguageDependencies {
  i18n: { changeLanguage(language: UiLanguage): Promise<unknown> };
  documentElement: Pick<HTMLElement, "lang">;
  storage: Pick<StorageService, "set">;
  localizeDefaultLayerNames?(): void | Promise<void>;
}

export async function changeUiLanguage(
  next: UiLanguage,
  dependencies: ChangeUiLanguageDependencies,
): Promise<PlatformResult<void>> {
  try {
    await dependencies.i18n.changeLanguage(next);
  } catch (cause) {
    return { ok: false, code: "unknown", message: "language-change-failed", cause };
  }

  try {
    dependencies.documentElement.lang = next;
    return await dependencies.storage.set(UI_LANGUAGE_KEY, next);
  } catch (cause) {
    return { ok: false, code: "unknown", message: "language-save-failed", cause };
  }
}

interface LanguageSwitchHandlerDependencies {
  getNextLanguage(): UiLanguage;
  change(next: UiLanguage): Promise<PlatformResult<void>>;
  alert(message: string): Promise<unknown>;
  translate(key: string): string;
  setSwitching(switching: boolean): void;
}

export function createLanguageSwitchHandler(dependencies: LanguageSwitchHandlerDependencies) {
  let switching = false;
  return async () => {
    if (switching) return;
    switching = true;
    dependencies.setSwitching(true);
    try {
      const result = await dependencies.change(dependencies.getNextLanguage());
      if (!result.ok) {
        const key = result.message === "language-change-failed" ? "language.switchError" : "language.saveError";
        await dependencies.alert(dependencies.translate(key));
      }
    } finally {
      switching = false;
      dependencies.setSwitching(false);
    }
  };
}

interface LanguageSwitchProps {
  services: Pick<PlatformServices, "storage">;
  documentElement?: Pick<HTMLElement, "lang">;
}

export function LanguageSwitch({ services, documentElement }: LanguageSwitchProps) {
  const { i18n, t } = useTranslation();
  const [switching, setSwitching] = useState(false);
  const current: UiLanguage = i18n.resolvedLanguage === "zh-CN" || i18n.language === "zh-CN" ? "zh-CN" : "en";
  const next: UiLanguage = current === "en" ? "zh-CN" : "en";
  const nextRef = useRef(next);
  nextRef.current = next;
  const handlerRef = useRef<() => Promise<void>>(undefined);
  if (!handlerRef.current) {
    handlerRef.current = createLanguageSwitchHandler({
      getNextLanguage: () => nextRef.current,
      change: (language) => changeUiLanguage(language, {
        i18n,
        documentElement: documentElement ?? document.documentElement,
        storage: services.storage,
        localizeDefaultLayerNames: () => import("../../store/editorStore").then(({ useEditorStore }) => useEditorStore.getState().localizeDefaultLayerNames()),
      }),
      alert: appAlert,
      translate: (key) => i18n.t(key),
      setSwitching,
    });
  }
  const title = current === "en" ? t("language.switchToChinese") : t("language.switchToEnglish");
  const switchLanguage = handlerRef.current;

  return (
    <button
      data-menu-id="language"
      data-testid="brand"
      disabled={switching}
      onClick={switchLanguage}
      className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50 text-xs"
      title={title}
      aria-label={title}
    >
      {current === "en" ? "🌐 中文" : "🌐 EN"}
    </button>
  );
}
