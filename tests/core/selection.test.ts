import { describe, it, expect } from "vitest";
import type { CanvasData } from "../../src/types";

function computeBounds(cells: Set<string>): { r1: number; c1: number; r2: number; c2: number } {
  let r1 = Infinity, c1 = Infinity, r2 = -Infinity, c2 = -Infinity;
  for (const key of cells) {
    const [r, c] = key.split(",").map(Number);
    if (r < r1) r1 = r;
    if (c < c1) c1 = c;
    if (r > r2) r2 = r;
    if (c > c2) c2 = c;
  }
  return { r1, c1, r2, c2 };
}

function floodSelect(
  layerData: CanvasData,
  startRow: number, startCol: number,
  width: number, height: number,
): Set<string> {
  const targetColor = layerData[startRow]?.[startCol]?.colorIndex ?? null;
  const visited = new Set<string>();
  const queue: [number, number][] = [[startRow, startCol]];
  while (queue.length > 0) {
    const [r, c] = queue.pop()!;
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    if (r < 0 || r >= height || c < 0 || c >= width) continue;
    const cellColor = layerData[r]?.[c]?.colorIndex ?? null;
    if (cellColor !== targetColor) continue;
    visited.add(key);
    queue.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return visited;
}

describe("computeBounds", () => {
  it("computes bounding box of cell set", () => {
    const cells = new Set(["1,2", "3,4", "0,1"]);
    const bounds = computeBounds(cells);
    expect(bounds).toEqual({ r1: 0, c1: 1, r2: 3, c2: 4 });
  });

  it("handles single cell", () => {
    const cells = new Set(["5,3"]);
    expect(computeBounds(cells)).toEqual({ r1: 5, c1: 3, r2: 5, c2: 3 });
  });
});

describe("floodSelect", () => {
  it("selects contiguous cells of same color", () => {
    const data: CanvasData = [
      [{ colorIndex: 1 }, { colorIndex: 1 }, { colorIndex: 2 }],
      [{ colorIndex: 1 }, { colorIndex: 2 }, { colorIndex: 2 }],
      [{ colorIndex: 3 }, { colorIndex: 3 }, { colorIndex: 2 }],
    ];
    const result = floodSelect(data, 0, 0, 3, 3);
    expect(result.size).toBe(3);
    expect(result.has("0,0")).toBe(true);
    expect(result.has("0,1")).toBe(true);
    expect(result.has("1,0")).toBe(true);
    expect(result.has("1,1")).toBe(false);
  });

  it("selects null (empty) cells", () => {
    const data: CanvasData = [
      [{ colorIndex: null }, { colorIndex: null }, { colorIndex: 1 }],
      [{ colorIndex: null }, { colorIndex: 1 }, { colorIndex: 1 }],
    ];
    const result = floodSelect(data, 0, 0, 3, 2);
    expect(result.size).toBe(3);
    expect(result.has("0,0")).toBe(true);
    expect(result.has("0,1")).toBe(true);
    expect(result.has("1,0")).toBe(true);
  });

  it("handles single isolated cell", () => {
    const data: CanvasData = [
      [{ colorIndex: 1 }, { colorIndex: 2 }],
      [{ colorIndex: 2 }, { colorIndex: 2 }],
    ];
    const result = floodSelect(data, 0, 0, 2, 2);
    expect(result.size).toBe(1);
    expect(result.has("0,0")).toBe(true);
  });
});
