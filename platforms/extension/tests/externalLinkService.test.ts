import { describe, expect, it, vi } from "vitest";
import { BrowserExternalLinkService } from "../externalLinkService";

describe("BrowserExternalLinkService", () => {
  it("opens an https URL through the extension tabs API", async () => {
    const tabs = { marker: "tabs", create: vi.fn(function (this: { marker: string }, value: { url: string }) { expect(this.marker).toBe("tabs"); return Promise.resolve(value); }) };
    const service = new BrowserExternalLinkService(tabs);
    expect(await service.open("https://github.com/login/device")).toEqual({ ok: true, value: undefined });
    expect(tabs.create).toHaveBeenCalledWith({ url: "https://github.com/login/device" });
  });

  it("rejects unsafe protocols and structures tab failures", async () => {
    const service = new BrowserExternalLinkService({ create: vi.fn().mockRejectedValue(new Error("blocked")) });
    expect(await service.open("javascript:alert(1)")).toMatchObject({ ok: false, code: "invalid-data" });
    expect(await service.open("https://github.com")).toMatchObject({ ok: false, code: "unknown", message: "blocked" });
  });
});
