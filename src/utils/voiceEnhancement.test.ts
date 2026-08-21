import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { tauriVoiceEnhancementService } from "./voiceEnhancement";
import { clearGitHubToken, setGitHubToken } from "./githubToken";

describe("Tauri AI voice service", () => {
  beforeEach(() => { clearGitHubToken(); invoke.mockReset(); });

  it("calls the desktop AI command through its platform-only implementation", async () => {
    setGitHubToken("desktop-token");
    invoke.mockResolvedValue('{"command":"right","repeat":2}');

    await expect(tauriVoiceEnhancementService.interpret("向右两次")).resolves.toMatchObject({
      command: "right",
      repeat: 2,
      enhanced: true,
    });
    expect(invoke).toHaveBeenCalledWith("github_models_chat", expect.objectContaining({
      token: "desktop-token",
      transcript: "向右两次",
      systemPrompt: expect.stringMatching(/repeat.*中文数字.*JSON/s),
    }));
  });

  it("documents and parses one-based goto row and column fields", async () => {
    setGitHubToken("desktop-token");
    invoke.mockResolvedValue('{"command":"goto","col":3,"row":5}');

    await expect(tauriVoiceEnhancementService.interpret("第3列第5行")).resolves.toMatchObject({
      command: "goto",
      gotoCol: 3,
      gotoRow: 5,
    });
    expect(invoke).toHaveBeenCalledWith("github_models_chat", expect.objectContaining({
      systemPrompt: expect.stringMatching(/col.*row.*第3列第5行/s),
    }));
  });

  it("accepts integer goto coordinates outside a canvas for consumer-side validation", async () => {
    setGitHubToken("desktop-token");
    invoke.mockResolvedValue('{"command":"goto","col":0,"row":-2}');
    await expect(tauriVoiceEnhancementService.interpret("零列负二行")).resolves.toMatchObject({
      command: "goto", gotoCol: 0, gotoRow: -2,
    });
  });

  it.each([
    ['{"command":"right","repeat":2.5}'],
    ['{"command":"goto","col":3}'],
    ['{"command":"goto","col":"3","row":5}'],
    ['[]'],
  ])("rejects invalid model command contracts: %s", async (response) => {
    setGitHubToken("desktop-token");
    invoke.mockResolvedValue(response);
    await expect(tauriVoiceEnhancementService.interpret("invalid")).resolves.toMatchObject({ command: "unknown", enhanced: true });
  });

  it("does not return raw model responses in diagnostics", async () => {
    setGitHubToken("desktop-token");
    invoke.mockResolvedValue('{"command":"unknown","private":"raw model response"}');
    const result = await tauriVoiceEnhancementService.interpret("paint a dragon");
    expect(result).not.toHaveProperty("debug");
    expect(JSON.stringify(result)).not.toContain("raw model response");
  });

  it("does not return exception details in diagnostics", async () => {
    setGitHubToken("desktop-token");
    invoke.mockRejectedValue(new Error("C:/private/model.json"));
    const result = await tauriVoiceEnhancementService.interpret("paint a dragon");
    expect(result).toEqual({ command: "unknown", enhanced: true });
  });
});
