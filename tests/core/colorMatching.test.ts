import { describe, it, expect } from "vitest";
import { findClosestColor, matchImageToMard, invalidateLabCache } from "../../src/utils/colorMatching";
import { MARD_COLORS } from "../../src/data/mard221";
import type { ColorOverrideMap } from "../../src/utils/colorHelper";

describe("findClosestColor", () => {
  it("returns an exact match for a known MARD color", () => {
    // Find a color with known RGB
    const idx = MARD_COLORS.findIndex((c) => c.rgb && c.hex === "#FFFFFF");
    if (idx >= 0) {
      const result = findClosestColor(255, 255, 255, "euclidean");
      expect(MARD_COLORS[result].rgb).toBeTruthy();
      // Should be very close to white
      const rgb = MARD_COLORS[result].rgb!;
      const dist = Math.sqrt((rgb[0] - 255) ** 2 + (rgb[1] - 255) ** 2 + (rgb[2] - 255) ** 2);
      expect(dist).toBeLessThan(30);
    }
  });

  it("returns a valid index for any input", () => {
    const idx = findClosestColor(123, 45, 67, "euclidean");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(MARD_COLORS.length);
  });

  it("euclidean and ciede2000 both return valid indices", () => {
    const e = findClosestColor(200, 50, 50, "euclidean");
    const c = findClosestColor(200, 50, 50, "ciede2000");
    expect(e).toBeGreaterThanOrEqual(0);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(MARD_COLORS[e].rgb).toBeTruthy();
    expect(MARD_COLORS[c].rgb).toBeTruthy();
  });

  it("respects allowedIndices filter", () => {
    const allowed = [0, 1, 2, 3, 4];
    const idx = findClosestColor(128, 128, 128, "euclidean", allowed);
    expect(allowed).toContain(idx);
  });

  it("black matches a dark color", () => {
    const idx = findClosestColor(0, 0, 0, "euclidean");
    const rgb = MARD_COLORS[idx].rgb!;
    // Should match something dark (luminance < 50)
    const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    expect(lum).toBeLessThan(80);
  });
});

describe("color overrides in matching", () => {
  // Pick two distinct colors to swap via override
  const idxA = MARD_COLORS.findIndex((c) => c.rgb && c.hex === "#FFFFFF");
  const idxB = MARD_COLORS.findIndex((c) => c.rgb && c.hex === "#000000");

  it("findClosestColor: override changes which palette index wins", () => {
    if (idxA < 0 || idxB < 0) return;
    invalidateLabCache();
    // Without overrides: pure white (255,255,255) maps to idxA (white)
    const baseline = findClosestColor(255, 255, 255, "euclidean");
    expect(baseline).toBe(idxA);

    // Override idxB ("black") to be pure white. Now (255,255,255) input
    // should match idxB (which is now visually white) at zero distance,
    // beating idxA which may not be exactly (255,255,255).
    const overrides: ColorOverrideMap = new Map([
      [idxB, { hex: "#FFFFFF", rgb: [255, 255, 255] as [number, number, number] }],
    ]);
    const overridden = findClosestColor(255, 255, 255, "euclidean", undefined, overrides);
    // It should pick something at distance 0 — either idxA (if it was already exact) or idxB
    const rgb = MARD_COLORS[overridden].rgb!;
    const ovEntry = overrides.get(overridden);
    const effRgb = ovEntry ? ovEntry.rgb : rgb;
    const dist = Math.hypot(effRgb[0] - 255, effRgb[1] - 255, effRgb[2] - 255);
    expect(dist).toBe(0);
  });

  it("findClosestColor: ciede2000 also honors overrides", () => {
    if (idxB < 0) return;
    invalidateLabCache();
    const overrides: ColorOverrideMap = new Map([
      [idxB, { hex: "#FF00FF", rgb: [255, 0, 255] as [number, number, number] }],
    ]);
    // Magenta input: with override, idxB becomes a perfect magenta and should win
    const idx = findClosestColor(255, 0, 255, "ciede2000", undefined, overrides);
    expect(idx).toBe(idxB);
  });

  it("matchImageToMard forwards overrides", () => {
    if (idxB < 0) return;
    invalidateLabCache();
    const overrides: ColorOverrideMap = new Map([
      [idxB, { hex: "#FF00FF", rgb: [255, 0, 255] as [number, number, number] }],
    ]);
    // Three magenta pixels
    const pixels = new Uint8Array([255, 0, 255, 255, 0, 255, 255, 0, 255]);
    const withoutOv = matchImageToMard(pixels, "euclidean", "mard221");
    const withOv = matchImageToMard(pixels, "euclidean", "mard221", overrides);
    // With override, every pixel should map to idxB
    expect(withOv.every((i) => i === idxB)).toBe(true);
    // Without override, idxB (originally black) should NOT be the chosen match
    expect(withoutOv.some((i) => i !== idxB)).toBe(true);
  });

  it("lab cache refreshes when overrides change", () => {
    if (idxB < 0) return;
    invalidateLabCache();
    // First call with no overrides primes the cache
    findClosestColor(128, 128, 128, "ciede2000");
    // Now call with overrides — should rebuild cache and reflect new colors
    const overrides: ColorOverrideMap = new Map([
      [idxB, { hex: "#808080", rgb: [128, 128, 128] as [number, number, number] }],
    ]);
    const idx = findClosestColor(128, 128, 128, "ciede2000", undefined, overrides);
    // Override makes idxB a perfect (128,128,128) match — must win
    expect(idx).toBe(idxB);
  });
});
