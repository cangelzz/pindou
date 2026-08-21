import { describe, expect, it, vi } from "vitest";
import { VSCodeLocaleService, VSCodeStorageService } from "../../platforms/vscode/src/vscodeServices";

describe("VS Code platform services", () => {
  it("gets host UI language", async () => {
    const request = vi.fn(async () => ({ language: "zh-CN" }));
    await expect(new VSCodeLocaleService(request).getSystemLanguage()).resolves.toEqual({ ok: true, value: "zh-CN" });
    expect(request).toHaveBeenCalledWith("getUiEnvironment");
  });

  it("uses host global state for storage operations", async () => {
    const request = vi.fn(async (type: string) => type === "storageGet" ? { value: "en" } : {});
    const storage = new VSCodeStorageService(request);
    expect(storage.availability).toBe("available");
    await expect(storage.get("pindou.uiLanguage")).resolves.toEqual({ ok: true, value: "en" });
    await expect(storage.set("pindou.uiLanguage", "zh-CN")).resolves.toEqual({ ok: true, value: undefined });
    await expect(storage.remove("pindou.uiLanguage")).resolves.toEqual({ ok: true, value: undefined });
    expect(request.mock.calls).toEqual([
      ["storageGet", { key: "pindou.uiLanguage" }],
      ["storageSet", { key: "pindou.uiLanguage", value: "zh-CN" }],
      ["storageRemove", { key: "pindou.uiLanguage" }],
    ]);
  });

  it("maps rejected RPCs to unknown", async () => {
    const request = vi.fn(async () => { throw new Error("host failed"); });
    await expect(new VSCodeLocaleService(request).getSystemLanguage()).resolves.toMatchObject({ ok: false, code: "unknown" });
    await expect(new VSCodeStorageService(request).get("x")).resolves.toMatchObject({ ok: false, code: "unknown" });
  });
});
