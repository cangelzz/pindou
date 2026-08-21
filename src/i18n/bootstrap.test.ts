import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformServices } from "../platform/services";
import { i18n } from ".";
import { bootstrapUiLanguage } from "./bootstrap";

function services(storageResult: unknown, localeResult: unknown): PlatformServices {
  return {
    storage: { availability: "available", get: vi.fn(async () => storageResult), set: vi.fn(), remove: vi.fn() },
    locale: { getSystemLanguage: vi.fn(async () => localeResult) },
  } as unknown as PlatformServices;
}

describe("bootstrapUiLanguage", () => {
  beforeEach(async () => { if (i18n.isInitialized) await i18n.changeLanguage("en"); });

  it("prefers a saved supported language over detection", async () => {
    const selected = await bootstrapUiLanguage(services(
      { ok: true, value: "en" },
      { ok: true, value: "zh-CN" },
    ));
    expect(selected).toBe("en");
    expect(i18n.language).toBe("en");
  });

  it("uses detected language when no preference exists", async () => {
    const selected = await bootstrapUiLanguage(services(
      { ok: true, value: undefined },
      { ok: true, value: "zh-CN" },
    ));
    expect(selected).toBe("zh-CN");
    expect(i18n.language).toBe("zh-CN");
  });

  it("falls back to English when service results fail", async () => {
    await expect(bootstrapUiLanguage(services(
      { ok: false, code: "unknown" },
      { ok: false, code: "unknown" },
    ))).resolves.toBe("en");
  });

  it("catches rejected service calls independently", async () => {
    const platform = services({ ok: true, value: undefined }, { ok: true, value: "zh-CN" });
    vi.mocked(platform.storage.get).mockRejectedValue(new Error("storage denied"));
    await expect(bootstrapUiLanguage(platform)).resolves.toBe("zh-CN");

    vi.mocked(platform.locale.getSystemLanguage).mockRejectedValue(new Error("locale denied"));
    await expect(bootstrapUiLanguage(platform)).resolves.toBe("en");
  });
});
