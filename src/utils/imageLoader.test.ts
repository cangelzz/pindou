import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLoadError, imageLoadErrorKey, loadImageData } from "./imageLoader";

describe("structured image loading errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps known codes and hides unknown diagnostics", () => {
    expect(imageLoadErrorKey(new ImageLoadError("decode-failed"))).toBe("import.image.errors.decode-failed");
    expect(imageLoadErrorKey(new Error("private path and diagnostic"))).toBe("import.image.errors.unknown");
  });

  it("converts unreadable base64 into an invalid-file code", async () => {
    vi.stubGlobal("atob", () => { throw new DOMException("bad", "InvalidCharacterError"); });
    await expect(loadImageData("bad.png", { readFileBase64: async () => "bad" })).rejects.toMatchObject({ code: "invalid-file" });
  });
});
