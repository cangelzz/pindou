import { describe, expect, it } from "vitest";
import { createNavigatorLocaleService, WebStorageService } from "./webRuntimeServices";

describe("createNavigatorLocaleService", () => {
  it("returns navigator.language", async () => {
    const service = createNavigatorLocaleService({ language: "zh-CN" });
    await expect(service.getSystemLanguage()).resolves.toEqual({ ok: true, value: "zh-CN" });
  });

  it("uses English when navigator.language is missing or empty", async () => {
    await expect(createNavigatorLocaleService({ language: "" }).getSystemLanguage()).resolves.toEqual({ ok: true, value: "en" });
    await expect(createNavigatorLocaleService({}).getSystemLanguage()).resolves.toEqual({ ok: true, value: "en" });
  });

  it("maps a throwing language getter to unknown", async () => {
    const navigatorLike = Object.defineProperty({}, "language", { get() { throw new DOMException("denied", "SecurityError"); } });
    const result = await createNavigatorLocaleService(navigatorLike).getSystemLanguage();
    expect(result).toMatchObject({ ok: false, code: "unknown" });
  });
});

describe("WebStorageService", () => {
  it("round-trips JSON values through localStorage", async () => {
    const values = new Map<string, string>();
    const storage = new WebStorageService({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    });

    expect(storage.availability).toBe("available");
    await expect(storage.set("ui", { language: "zh-CN" })).resolves.toEqual({ ok: true, value: undefined });
    await expect(storage.get("ui")).resolves.toEqual({ ok: true, value: { language: "zh-CN" } });
    await expect(storage.remove("ui")).resolves.toEqual({ ok: true, value: undefined });
    await expect(storage.get("ui")).resolves.toEqual({ ok: true, value: undefined });
  });

  it("maps SecurityError from every operation to unknown without throwing", async () => {
    const denied = () => { throw new DOMException("denied", "SecurityError"); };
    const storage = new WebStorageService({ getItem: denied, setItem: denied, removeItem: denied });

    await expect(storage.get("ui")).resolves.toMatchObject({ ok: false, code: "unknown" });
    await expect(storage.set("ui", "en")).resolves.toMatchObject({ ok: false, code: "unknown" });
    await expect(storage.remove("ui")).resolves.toMatchObject({ ok: false, code: "unknown" });
  });

  it("does not access storage during construction and maps a throwing provider", async () => {
    const denied = () => { throw new DOMException("denied", "SecurityError"); };
    expect(() => new WebStorageService(denied)).not.toThrow();
    const storage = new WebStorageService(denied);
    await expect(storage.get("ui")).resolves.toMatchObject({ ok: false, code: "unknown" });
  });
});
