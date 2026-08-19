import { describe, expect, it } from "vitest";
import { DEFAULT_GITHUB_CLIENT_ID, getGitHubClientId } from "../config";

describe("extension GitHub configuration", () => {
  it("uses the existing public OAuth App client id in production", () => {
    expect(DEFAULT_GITHUB_CLIENT_ID).toBe("Ov23libthPsNlBTIBZHs");
    expect(getGitHubClientId(undefined)).toBe(DEFAULT_GITHUB_CLIENT_ID);
  });

  it("allows an explicit build-time override", () => {
    expect(getGitHubClientId(" override ")).toBe("override");
  });
});
