import { describe, expect, it } from "vitest";
import {
  BASE_CELL_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  computeWheelZoom,
  normalizeWheelDelta,
} from "./wheelZoom";

const baseInput = {
  zoom: 1,
  cellSize: BASE_CELL_SIZE,
  offsetX: 100,
  offsetY: 80,
  pointerX: 300,
  pointerY: 240,
  deltaMode: 0,
  pageHeight: 600,
};

describe("normalizeWheelDelta", () => {
  it("normalizes pixel, line, and page deltas", () => {
    expect(normalizeWheelDelta(25, 0, 600)).toBe(25);
    expect(normalizeWheelDelta(2, 1, 600)).toBe(80);
    expect(normalizeWheelDelta(0.25, 2, 600)).toBe(150);
  });

  it("caps a single event and rejects invalid values", () => {
    expect(normalizeWheelDelta(10_000, 0, 600)).toBe(240);
    expect(normalizeWheelDelta(-10_000, 0, 600)).toBe(-240);
    expect(normalizeWheelDelta(Number.NaN, 0, 600)).toBe(0);
    expect(normalizeWheelDelta(Number.POSITIVE_INFINITY, 1, 600)).toBe(0);
    expect(normalizeWheelDelta(1, 2, Number.NaN)).toBe(0);
    expect(normalizeWheelDelta(1, 2, 0)).toBe(0);
    expect(normalizeWheelDelta(1, 2, -600)).toBe(0);
  });
});

describe("computeWheelZoom", () => {
  it("zooms by about ten percent for a 100-pixel delta", () => {
    expect(computeWheelZoom({ ...baseInput, deltaY: -100 }).zoom).toBeCloseTo(1.1, 10);
    expect(computeWheelZoom({ ...baseInput, deltaY: 100 }).zoom).toBeCloseTo(1 / 1.1, 10);
  });

  it("uses fine-grained floating-point changes for small deltas", () => {
    const next = computeWheelZoom({ ...baseInput, deltaY: -5 });

    expect(next.zoom).toBeGreaterThan(1);
    expect(next.zoom).toBeLessThan(1.01);
    expect(next.cellSize).toBeCloseTo(BASE_CELL_SIZE * next.zoom, 10);
    expect(Number.isInteger(next.cellSize)).toBe(false);
  });

  it("keeps the logical canvas point under the pointer fixed", () => {
    const next = computeWheelZoom({ ...baseInput, deltaY: -100 });
    const beforeX = (baseInput.pointerX - baseInput.offsetX) / baseInput.cellSize;
    const beforeY = (baseInput.pointerY - baseInput.offsetY) / baseInput.cellSize;
    const afterX = (baseInput.pointerX - next.offsetX) / next.cellSize;
    const afterY = (baseInput.pointerY - next.offsetY) / next.cellSize;

    expect(afterX).toBeCloseTo(beforeX, 10);
    expect(afterY).toBeCloseTo(beforeY, 10);
  });

  it("clamps a near-boundary zoom while keeping the pointer anchored", () => {
    const input = {
      ...baseInput,
      zoom: 39.9,
      cellSize: BASE_CELL_SIZE * 39.9,
      deltaY: -100,
    };
    const next = computeWheelZoom(input);
    const beforeX = (input.pointerX - input.offsetX) / input.cellSize;
    const beforeY = (input.pointerY - input.offsetY) / input.cellSize;
    const afterX = (input.pointerX - next.offsetX) / next.cellSize;
    const afterY = (input.pointerY - next.offsetY) / next.cellSize;

    expect(next.zoom).toBe(MAX_ZOOM);
    expect(afterX).toBeCloseTo(beforeX, 10);
    expect(afterY).toBeCloseTo(beforeY, 10);
  });

  it("clamps zoom without moving offsets once already at a boundary", () => {
    expect(computeWheelZoom({
      ...baseInput,
      zoom: MAX_ZOOM,
      cellSize: BASE_CELL_SIZE * MAX_ZOOM,
      deltaY: -100,
    })).toEqual({
      zoom: MAX_ZOOM,
      cellSize: BASE_CELL_SIZE * MAX_ZOOM,
      offsetX: baseInput.offsetX,
      offsetY: baseInput.offsetY,
    });
    expect(computeWheelZoom({
      ...baseInput,
      zoom: MIN_ZOOM,
      cellSize: BASE_CELL_SIZE * MIN_ZOOM,
      deltaY: 100,
    })).toEqual({
      zoom: MIN_ZOOM,
      cellSize: BASE_CELL_SIZE * MIN_ZOOM,
      offsetX: baseInput.offsetX,
      offsetY: baseInput.offsetY,
    });
  });

  it("returns the current view for zero or invalid input", () => {
    const current = {
      zoom: baseInput.zoom,
      cellSize: baseInput.cellSize,
      offsetX: baseInput.offsetX,
      offsetY: baseInput.offsetY,
    };

    expect(computeWheelZoom({ ...baseInput, deltaY: 0 })).toEqual(current);
    expect(computeWheelZoom({ ...baseInput, deltaY: Number.NaN })).toEqual(current);

    for (const invalid of [
      { zoom: Number.NaN },
      { cellSize: 0 },
      { cellSize: Number.POSITIVE_INFINITY },
      { offsetX: Number.NaN },
      { offsetY: Number.NEGATIVE_INFINITY },
      { pointerX: Number.NaN },
      { pointerY: Number.POSITIVE_INFINITY },
    ]) {
      const input = { ...baseInput, ...invalid, deltaY: -100 };
      expect(computeWheelZoom(input)).toEqual({
        zoom: input.zoom,
        cellSize: input.cellSize,
        offsetX: input.offsetX,
        offsetY: input.offsetY,
      });
    }
  });
});
