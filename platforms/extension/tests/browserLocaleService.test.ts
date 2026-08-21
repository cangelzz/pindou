import { describe, expect, it } from "vitest";
import { BrowserLocaleService } from "../browserLocaleService";

describe("BrowserLocaleService", () => {
  it("returns the browser UI language", async () => {
    const service = new BrowserLocaleService({ getUILanguage: () => "zh-CN" }, { language: "en-US" });
    await expect(service.getSystemLanguage()).resolves.toEqual({ ok: true, value: "zh-CN" });
  });

  it("falls back to navigator.language when browser language is empty or throws", async () => {
    await expect(new BrowserLocaleService({ getUILanguage: () => "" }, { language: "zh-CN" }).getSystemLanguage())
      .resolves.toEqual({ ok: true, value: "zh-CN" });
    await expect(new BrowserLocaleService({ getUILanguage: () => { throw new Error("denied"); } }, { language: "zh-CN" }).getSystemLanguage())
      .resolves.toEqual({ ok: true, value: "zh-CN" });
  });

  it("uses English when both browser and navigator languages are missing", async () => {
    await expect(new BrowserLocaleService({ getUILanguage: () => "" }, {}).getSystemLanguage())
      .resolves.toEqual({ ok: true, value: "en" });
  });
});
