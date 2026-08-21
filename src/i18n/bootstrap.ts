import type { PlatformServices } from "../platform/services";
import { initializeI18n } from ".";
import { selectUiLanguage, UI_LANGUAGE_KEY, type UiLanguage } from "./language";

export async function bootstrapUiLanguage(services: PlatformServices): Promise<UiLanguage> {
  const [savedResult, detectedResult] = await Promise.all([
    services.storage.get<UiLanguage>(UI_LANGUAGE_KEY).catch(() => undefined),
    services.locale.getSystemLanguage().catch(() => undefined),
  ]);
  const saved = savedResult?.ok ? savedResult.value : undefined;
  const detected = detectedResult?.ok ? detectedResult.value : undefined;
  const language = selectUiLanguage(saved, detected);
  await initializeI18n(language);
  return language;
}
