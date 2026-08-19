import { describe, expect, it } from "vitest";
import manifest from "../manifest.base.json";

describe("extension manifest permissions", () => {
  it("uses local storage and only fixed GitHub OAuth and API hosts", () => {
    expect(manifest.permissions).toEqual(["storage", "contextMenus"]);
    expect(manifest.host_permissions).toEqual(["https://github.com/login/*", "https://api.github.com/*", "https://gist.githubusercontent.com/*"]);
    expect(manifest.host_permissions).not.toContain("<all_urls>");
    expect(manifest).not.toHaveProperty("content_scripts");
  });
});
