import { describe, expect, it } from "vitest";
import { beginVoiceLifecycle, parseVoiceCommand, resolveEnhancedVoiceCommand, voiceUnknownFeedback } from "./useVoiceControl";

describe("voice mounted lifecycle", () => {
  it("reactivates after StrictMode cleanup and second setup", () => {
    const mounted = { current: false };
    let cleanups = 0;
    const firstCleanup = beginVoiceLifecycle(mounted, () => { cleanups++; });
    expect(mounted.current).toBe(true);
    firstCleanup();
    expect(mounted.current).toBe(false);
    const secondCleanup = beginVoiceLifecycle(mounted, () => { cleanups++; });
    expect(mounted.current).toBe(true);
    secondCleanup();
    expect(mounted.current).toBe(false);
    expect(cleanups).toBe(2);
  });
});

describe("bilingual voice command parser", () => {
  it.each([
    ["up", "up"], ["向上", "up"], ["summary", "summary"], ["统计", "summary"],
    ["still here", "still_here"], ["我还在", "still_here"],
  ] as const)("parses %s as %s regardless of UI language", (phrase, command) => {
    expect(parseVoiceCommand(phrase).command).toBe(command);
  });

  it.each([
    ["go to 3 5", 3, 5], ["column 3 row 5", 3, 5], ["第3列第5行", 3, 5],
  ] as const)("parses goto phrase %s", (phrase, col, row) => {
    expect(parseVoiceCommand(phrase)).toMatchObject({ command: "goto", gotoCol: col, gotoRow: row });
  });

  it("echoes only the original transcript for an unknown enhanced command", () => {
    const result = resolveEnhancedVoiceCommand(
      { command: "unknown", raw: "paint a dragon", confidence: 0.4 },
      { command: "unknown", enhanced: true, ...({ debug: '{"model":"raw response","path":"C:/secret"}' } as object) },
    );
    expect(result).toEqual({ command: "unknown", raw: "paint a dragon", confidence: 0.4 });
    expect(voiceUnknownFeedback(result.raw)).toBe("paint a dragon");
  });
});
