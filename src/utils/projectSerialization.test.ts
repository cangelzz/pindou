import { describe, it, expect } from "vitest";
import {
  normalizeProjectFromDisk,
  serializeProjectToV3,
} from "./projectSerialization";

describe("normalizeProjectFromDisk", () => {
  it("loads a v3 flat-cell project as in-memory {colorIndex} cells", () => {
    const raw = JSON.stringify({
      version: 3,
      canvasSize: { width: 2, height: 2 },
      canvasData: [[null, 5], [3, null]],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.version).toBe(3);
    expect(p.canvasData).toEqual([
      [{ colorIndex: null }, { colorIndex: 5 }],
      [{ colorIndex: 3 }, { colorIndex: null }],
    ]);
  });

  it("loads a v2 verbose-cell project unchanged", () => {
    const raw = JSON.stringify({
      version: 2,
      canvasSize: { width: 2, height: 1 },
      canvasData: [[{ colorIndex: null }, { colorIndex: 7 }]],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.canvasData).toEqual([[{ colorIndex: null }, { colorIndex: 7 }]]);
  });

  it("treats missing version as legacy verbose", () => {
    const raw = JSON.stringify({
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: 4 }]],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.canvasData).toEqual([[{ colorIndex: 4 }]]);
  });

  it("fills missing legacy timestamps with one stable ISO normalization time", () => {
    const p = normalizeProjectFromDisk(JSON.stringify({
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: 4 }]],
    }));
    expect(p.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(p.updatedAt).toBe(p.createdAt);
  });

  it("treats unknown future version (>=4) as v3", () => {
    const raw = JSON.stringify({
      version: 99,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[2]],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.canvasData).toEqual([[{ colorIndex: 2 }]]);
  });

  it("normalises layers' data on v3", () => {
    const raw = JSON.stringify({
      version: 3,
      canvasSize: { width: 2, height: 1 },
      canvasData: [[null, 5]],
      layers: [{
        id: "l1", name: "底", visible: true, opacity: 1,
        data: [[null, 5]],
      }],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.layers?.[0].data).toEqual([
      [{ colorIndex: null }, { colorIndex: 5 }],
    ]);
  });

  it("accepts missing or null layers for legacy single-layer projects", () => {
    const base = { canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: 1 }]] };
    expect(normalizeProjectFromDisk(JSON.stringify(base)).layers).toBeUndefined();
    expect(normalizeProjectFromDisk(JSON.stringify({ ...base, layers: null })).layers).toBeUndefined();
  });

  it("rejects a present non-array layers value", () => {
    const raw = JSON.stringify({ canvasSize: { width: 1, height: 1 }, canvasData: [[null]], layers: {} });
    expect(() => normalizeProjectFromDisk(raw)).toThrow(/layers/i);
  });

  it("normalises layers' data on v2 (verbose)", () => {
    const raw = JSON.stringify({
      version: 2,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: null }]],
      layers: [{
        id: "l1", name: "底", visible: true, opacity: 1,
        data: [[{ colorIndex: 9 }]],
      }],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.layers?.[0].data).toEqual([[{ colorIndex: 9 }]]);
  });

  it("throws on malformed JSON", () => {
    expect(() => normalizeProjectFromDisk("{ not json")).toThrow();
  });

  it("throws when a cell is neither null/number nor {colorIndex}", () => {
    const raw = JSON.stringify({
      version: 3,
      canvasSize: { width: 1, height: 1 },
      canvasData: [["banana"]],
      createdAt: "t1",
      updatedAt: "t1",
    });
    expect(() => normalizeProjectFromDisk(raw)).toThrow(/cell/i);
  });

  it("normalises the version field to 3 regardless of source", () => {
    const v1 = JSON.stringify({
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: 4 }]],
      createdAt: "t1", updatedAt: "t1",
    });
    const v2 = JSON.stringify({
      version: 2,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: 4 }]],
      createdAt: "t1", updatedAt: "t1",
    });
    expect(normalizeProjectFromDisk(v1).version).toBe(3);
    expect(normalizeProjectFromDisk(v2).version).toBe(3);
  });

  it("throws for structurally invalid projects", () => {
    const invalid = [
      null,
      [],
      { canvasData: [[null]] },
      { canvasSize: { width: 0, height: 1 }, canvasData: [[]] },
      { canvasSize: { width: 1.5, height: 1 }, canvasData: [[null]] },
      { canvasSize: { width: 2, height: 1 }, canvasData: [[null]] },
      { canvasSize: { width: 1, height: 2 }, canvasData: [[null]] },
      { canvasSize: { width: 1, height: 1 }, canvasData: [[null]], layers: [{ id: "x", data: [[]] }] },
    ];
    for (const value of invalid) {
      expect(() => normalizeProjectFromDisk(JSON.stringify(value))).toThrow();
    }
  });

  it("throws when a verbose cell carries a non-number/non-null colorIndex", () => {
    const raw = JSON.stringify({
      version: 2,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: "banana" }]],
      createdAt: "t1", updatedAt: "t1",
    });
    expect(() => normalizeProjectFromDisk(raw)).toThrow(/cell/i);
  });
});

describe("serializeProjectToV3", () => {
  it("produces compact JSON (no whitespace/newlines)", () => {
    const out = serializeProjectToV3({
      version: 2,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: null }]],
      createdAt: "t",
      updatedAt: "t",
    } as any);
    expect(out).not.toMatch(/\n/);
    expect(out).not.toMatch(/  /);
  });

  it("collapses cells to flat null|number and stamps version: 3", () => {
    const out = serializeProjectToV3({
      version: 2,
      canvasSize: { width: 2, height: 1 },
      canvasData: [[{ colorIndex: null }, { colorIndex: 5 }]],
      createdAt: "t",
      updatedAt: "t",
    } as any);
    const back = JSON.parse(out);
    expect(back.version).toBe(3);
    expect(back.canvasData).toEqual([[null, 5]]);
  });

  it("preserves optional projectId in compact v3 serialization and normalization", () => {
    const serialized = serializeProjectToV3({
      version: 3,
      projectId: "project-stable",
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: 2 }]],
      createdAt: "t",
      updatedAt: "t",
    });
    expect(JSON.parse(serialized).projectId).toBe("project-stable");
    expect(normalizeProjectFromDisk(serialized).projectId).toBe("project-stable");
  });

  it("collapses layers' data too", () => {
    const out = serializeProjectToV3({
      version: 2,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: 3 }]],
      layers: [{
        id: "l1", name: "底", visible: true, opacity: 1,
        data: [[{ colorIndex: 3 }]],
      }],
      createdAt: "t",
      updatedAt: "t",
    } as any);
    const back = JSON.parse(out);
    expect(back.layers[0].data).toEqual([[3]]);
  });

  it("round-trip is logically idempotent for a v3 in-memory object", () => {
    const original = {
      version: 2,
      canvasSize: { width: 3, height: 2 },
      canvasData: [
        [{ colorIndex: null }, { colorIndex: 1 }, { colorIndex: null }],
        [{ colorIndex: 2 }, { colorIndex: null }, { colorIndex: 7 }],
      ],
      createdAt: "t", updatedAt: "t",
    } as any;
    const s = serializeProjectToV3(original);
    const back = normalizeProjectFromDisk(s);
    expect(back.canvasData).toEqual(original.canvasData);
    expect(back.version).toBe(3);
  });
});
