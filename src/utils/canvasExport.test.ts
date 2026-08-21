import { describe, expect, it, vi } from "vitest";
import {
  renderBlueprintBlob,
  renderPreviewBlob,
  type CanvasExportDependencies,
} from "./canvasExport";

function harness(blob: Blob | null = new Blob(["encoded"], { type: "image/png" })) {
  const calls: Array<[string, ...unknown[]]> = [];
  const ctx = new Proxy({
    canvas: undefined,
    measureText: (text: string) => ({ width: text.length * 6 }),
  } as unknown as CanvasRenderingContext2D, {
    get(target, prop) {
      if (prop in target) return (target as any)[prop];
      if (typeof prop === "string" && /^(fillRect|strokeRect|fillText|beginPath|moveTo|lineTo|stroke|save|restore|translate|drawImage|roundRect|clip)$/.test(prop)) {
        return (...args: unknown[]) => calls.push([prop, ...args]);
      }
      return (target as any)[prop];
    },
    set(target, prop, value) {
      (target as any)[prop] = value;
      calls.push([`set:${String(prop)}`, value]);
      return true;
    },
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((callback: BlobCallback, mime: string, quality?: number) => {
      calls.push(["encode", mime, quality]);
      callback(blob);
    }),
  } as unknown as HTMLCanvasElement;
  (ctx as any).canvas = canvas;
  const dependencies: CanvasExportDependencies = { createCanvas: () => canvas };
  return { canvas, ctx, calls, dependencies };
}

const request = {
  width: 2,
  height: 1,
  cell_size: 20,
  cells: [[
    { color_code: "A1", r: 255, g: 255, b: 255 },
    { color_code: "H1", r: 0, g: 0, b: 0 },
  ]],
  format: "png" as const,
  start_x: 3,
  start_y: 9,
  edge_padding: 0,
  labels: {
    legendByCount: "By count ({{colors}} colors, {{beads}} beads)",
    legendByCode: "By code ({{colors}} colors)",
  },
};

describe("renderBlueprintBlob", () => {
  it("reserves one cell axis margin on all four sides and draws both axis pairs", async () => {
    const h = harness();
    await renderBlueprintBlob(request, undefined, h.dependencies);

    expect(h.canvas.width).toBe(80);
    expect(h.canvas.height).toBeGreaterThanOrEqual(60);
    const labels = h.calls.filter(([name]) => name === "fillText").map(([, text]) => text);
    expect(labels.filter((text) => text === "3")).toHaveLength(2);
    expect(labels.filter((text) => text === "9")).toHaveLength(2);
  });

  it("encodes the requested MIME and quality and rejects a null Blob", async () => {
    const jpeg = harness(new Blob(["jpeg"], { type: "image/jpeg" }));
    await renderBlueprintBlob({ ...request, format: "jpeg" }, undefined, jpeg.dependencies);
    expect(jpeg.calls).toContainEqual(["encode", "image/jpeg", 0.95]);

    const failed = harness(null);
    await expect(renderBlueprintBlob(request, undefined, failed.dependencies)).rejects.toThrow("encode");
    const wrongMime = harness(new Blob(["wrong"], { type: "image/png" }));
    await expect(renderBlueprintBlob({ ...request, format: "jpeg" }, undefined, wrongMime.dependencies)).rejects.toThrow("instead");
  });

  it("draws transparent beads without solid-filling them", async () => {
    const h = harness();
    await renderBlueprintBlob(request, undefined, h.dependencies);
    const fills = h.calls.filter(([name]) => name === "fillRect");
    expect(fills.some(([, x, y, w]) => x === 20 && y === 0 && w === 20)).toBe(false);
    expect(h.calls.filter(([name]) => name === "lineTo").length).toBeGreaterThan(0);
  });

  it("renders labels captured in the request instead of current language state", async () => {
    const h = harness();
    const captured = {
      legendByCount: "By count ({{colors}} colors, {{beads}} beads)",
      legendByCode: "By code ({{colors}} colors)",
    };
    const queued = { ...request, labels: { ...captured } };
    captured.legendByCount = "按数量（{{colors}} 种颜色，{{beads}} 颗）";
    await renderBlueprintBlob(queued, undefined, h.dependencies);
    const labels = h.calls.filter(([name]) => name === "fillText").map(([, text]) => text);
    expect(labels).toContain("By count (2 colors, 2 beads)");
    expect(labels.some((text) => String(text).includes("按数量"))).toBe(false);
  });

  it("computes legend wrapping using the full grid width between margins", async () => {
    const h = harness();
    const cells = [["A", "B", "C", "D"].map((color_code) => ({ color_code, r: 1, g: 2, b: 3 }))];
    await renderBlueprintBlob({ ...request, width: 7, cells }, undefined, h.dependencies);
    // Four mock legend items fit into the 140px grid in two rows.
    // The old pre-margin width calculation treated only 100px as available and used four rows.
    expect(h.canvas.height).toBeLessThan(300);
  });

  it("rejects invalid or excessively large canvas dimensions", async () => {
    const h = harness();
    await expect(renderBlueprintBlob({ ...request, width: 0 }, undefined, h.dependencies)).rejects.toThrow("dimensions");
    await expect(renderBlueprintBlob({ ...request, width: 100_000 }, undefined, h.dependencies)).rejects.toThrow("large");
  });
});

describe("renderPreviewBlob", () => {
  it("uses deterministic smoothing/font settings and JPEG encoding", async () => {
    const h = harness(new Blob(["jpeg"], { type: "image/jpeg" }));
    await renderPreviewBlob({
      width: 2,
      height: 1,
      pixel_size: 10,
      cells: request.cells,
    }, undefined, h.dependencies);

    expect(h.canvas.width).toBe(20);
    expect(h.calls).toContainEqual(["set:imageSmoothingEnabled", false]);
    expect(h.calls).toContainEqual(["encode", "image/jpeg", 0.92]);
  });
});
