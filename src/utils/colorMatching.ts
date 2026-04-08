import { MARD_COLORS, getGroupIndices } from "../data/mard221";
import type { ColorMatchAlgorithm } from "../types";
import { rgbToLab, deltaE76, euclideanRGB, type Lab } from "./colorConversion";

/** Pre-computed Lab values for all MARD colors */
let labCache: Lab[] | null = null;

function getLabCache(): Lab[] {
  if (!labCache) {
    labCache = MARD_COLORS.map((c) => {
      if (!c.rgb) return [0, 0, 0] as Lab;
      return rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]);
    });
  }
  return labCache;
}

/**
 * Find the closest MARD color index for a given RGB value.
 * Returns the index into MARD_COLORS array.
 * If allowedIndices is provided, only search within those indices.
 */
export function findClosestColor(
  r: number,
  g: number,
  b: number,
  algorithm: ColorMatchAlgorithm = "ciede2000",
  allowedIndices?: number[]
): number {
  let minDist = Infinity;
  let minIndex = 0;

  const indices = allowedIndices ?? MARD_COLORS.map((_, i) => i);

  if (algorithm === "euclidean") {
    for (const i of indices) {
      const c = MARD_COLORS[i];
      if (!c.rgb) continue;
      const d = euclideanRGB([r, g, b], c.rgb);
      if (d < minDist) {
        minDist = d;
        minIndex = i;
      }
    }
  } else {
    const inputLab = rgbToLab(r, g, b);
    const cache = getLabCache();
    for (const i of indices) {
      if (!MARD_COLORS[i].rgb) continue;
      const d = deltaE76(inputLab, cache[i]);
      if (d < minDist) {
        minDist = d;
        minIndex = i;
      }
    }
  }

  return minIndex;
}

/**
 * Convert an entire image (flat pixel array) to MARD color indices.
 * pixels: flat [r,g,b, r,g,b, ...] array
 * groupId: color group to restrict matching (default: "mard221")
 * Returns: flat array of MARD color indices, one per pixel
 */
export function matchImageToMard(
  pixels: Uint8Array | number[],
  algorithm: ColorMatchAlgorithm,
  groupId: string = "mard221"
): number[] {
  const result: number[] = [];
  const cache = new Map<string, number>();
  const allowedIndices = getGroupIndices(groupId);

  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const key = `${r},${g},${b}`;

    let idx = cache.get(key);
    if (idx === undefined) {
      idx = findClosestColor(r, g, b, algorithm, allowedIndices);
      cache.set(key, idx);
    }
    result.push(idx);
  }

  return result;
}
