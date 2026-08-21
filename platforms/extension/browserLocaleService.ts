import type { LocaleService } from "../../src/platform/services";

type BrowserI18nLike = { getUILanguage(): string };
type NavigatorLike = { readonly language?: string };

export class BrowserLocaleService implements LocaleService {
  constructor(
    private readonly browserI18n: BrowserI18nLike,
    private readonly navigatorLike: NavigatorLike = navigator,
  ) {}

  async getSystemLanguage() {
    try {
      const language = this.browserI18n.getUILanguage();
      if (language) return { ok: true as const, value: language };
    } catch {
      // Fall through to navigator: browser APIs can be unavailable in test/fallback contexts.
    }

    try {
      return { ok: true as const, value: this.navigatorLike.language || "en" };
    } catch (cause) {
      return { ok: false as const, code: "unknown" as const, cause };
    }
  }
}
