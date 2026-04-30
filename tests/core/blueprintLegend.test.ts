import { describe, it, expect } from "vitest";
import { buildLegendItems, computeLegendLayout, type LegendCell } from "../../src/utils/blueprintLegend";

const mk = (code: string, r: number, g: number, b: number): LegendCell => ({ color_code: code, r, g, b });

describe("buildLegendItems", () => {
  it("counts cells and returns both sort orders", () => {
    const cells: (LegendCell | null)[][] = [
      [mk("A", 1, 1, 1), mk("A", 1, 1, 1), mk("B", 2, 2, 2)],
      [mk("C", 3, 3, 3), null, mk("A", 1, 1, 1)],
    ];
    const { byCount, byAlpha } = buildLegendItems(cells);

    expect(byCount.map((x) => `${x.code}:${x.count}`)).toEqual(["A:3", "B:1", "C:1"]);
    expect(byAlpha.map((x) => x.code)).toEqual(["A", "B", "C"]);
  });

  it("descending count ties broken by ascending code", () => {
    const cells: (LegendCell | null)[][] = [
      [mk("Z", 0, 0, 0), mk("A", 0, 0, 0)],
    ];
    const { byCount } = buildLegendItems(cells);
    expect(byCount.map((x) => x.code)).toEqual(["A", "Z"]);
  });

  it("returns empty arrays for an empty grid", () => {
    const { byCount, byAlpha } = buildLegendItems([[null, null]]);
    expect(byCount).toEqual([]);
    expect(byAlpha).toEqual([]);
  });
});

describe("computeLegendLayout", () => {
  it("computes positive total height for grids with content", () => {
    const cells: (LegendCell | null)[][] = [[mk("A", 1, 1, 1), mk("B", 2, 2, 2)]];
    const layout = computeLegendLayout(cells, 2, 30);
    expect(layout.totalHeight).toBeGreaterThan(0);
    expect(layout.byCount.length).toBe(2);
    expect(layout.byAlpha.length).toBe(2);
    expect(layout.cols).toBeGreaterThanOrEqual(1);
  });

  it("scales legend columns based on width and cell size", () => {
    const cells: (LegendCell | null)[][] = [[mk("A", 1, 1, 1)]];
    // width 100 cells × cellSize 30 = 3000px, swatchW = 60 → cols = 50
    expect(computeLegendLayout(cells, 100, 30).cols).toBe(50);
    // width 4 cells × cellSize 30 = 120px, swatchW = 60 → cols = 2
    expect(computeLegendLayout(cells, 4, 30).cols).toBe(2);
  });

  it("at least 1 column even for very narrow grids", () => {
    const cells: (LegendCell | null)[][] = [[mk("A", 1, 1, 1)]];
    expect(computeLegendLayout(cells, 1, 30).cols).toBe(1);
  });
});
