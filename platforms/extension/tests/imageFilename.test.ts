import { describe, expect, it } from "vitest";
import { safeFilename } from "../imageImportService";

describe("safeFilename", () => {
  it.each([
    ["https://x/cat.png?token=1#x", "image/png", "cat.png"],
    ["https://x/", "image/jpeg", "web-image.jpg"],
    ["https://x/a%3Ab%00c", "image/png", "a-b-c.png"],
    ["not a url", "image/webp", "web-image.webp"],
  ])("sanitizes %s", (url, mime, expected) => expect(safeFilename(url, mime)).toBe(expected));

  it("keeps extension while limiting a long filename", () => {
    const name = safeFilename(`https://x/${"a".repeat(300)}`, "image/png");
    expect(name.length).toBe(180);
    expect(name.endsWith(".png")).toBe(true);
  });
});
