import { beforeAll, beforeEach, describe, expect, it } from "vitest";

let storeModule: typeof import("./editorStore");
const memory = new Map<string, string>();

beforeAll(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
  storeModule = await import("./editorStore");
});

beforeEach(() => {
  storeModule.useEditorStore.setState({
    canvasSize: { width: 52, height: 52 },
    zoom: 1,
    cellSize: 16,
    offsetX: 0,
    offsetY: 0,
    isDirty: false,
  });
});

describe("editor view zoom precision", () => {
  it("preserves a finite fractional zoom without dirtying the project", () => {
    storeModule.useEditorStore.getState().setZoom(1.03125);

    const state = storeModule.useEditorStore.getState();
    expect(state.zoom).toBe(1.03125);
    expect(state.cellSize).toBe(16.5);
    expect(state.isDirty).toBe(false);
  });

  it("clamps zoom to the supported range", () => {
    storeModule.useEditorStore.getState().setZoom(100);
    expect(storeModule.useEditorStore.getState()).toMatchObject({ zoom: 40, cellSize: 640 });

    storeModule.useEditorStore.getState().setZoom(0.1);
    expect(storeModule.useEditorStore.getState()).toMatchObject({ zoom: 0.5, cellSize: 8 });
  });

  it.each([
    ["NaN", Number.NaN],
    ["positive Infinity", Number.POSITIVE_INFINITY],
    ["negative Infinity", Number.NEGATIVE_INFINITY],
  ])("ignores %s instead of contaminating the view state", (_name, invalidZoom) => {
    storeModule.useEditorStore.getState().setZoom(1.25);
    const before = storeModule.useEditorStore.getState();

    storeModule.useEditorStore.getState().setZoom(invalidZoom);

    const after = storeModule.useEditorStore.getState();
    expect(after.zoom).toBe(before.zoom);
    expect(after.cellSize).toBe(before.cellSize);
    expect(after.isDirty).toBe(before.isDirty);
  });

  it("updates a complete viewport atomically with one consistent notification", () => {
    const notifications: { zoom: number; cellSize: number; offsetX: number; offsetY: number }[] = [];
    const unsubscribe = storeModule.useEditorStore.subscribe((state) => {
      notifications.push({
        zoom: state.zoom,
        cellSize: state.cellSize,
        offsetX: state.offsetX,
        offsetY: state.offsetY,
      });
    });

    storeModule.useEditorStore.getState().setViewport(2, 10, 20);
    unsubscribe();

    expect(notifications).toEqual([
      { zoom: 2, cellSize: 32, offsetX: 10, offsetY: 20 },
    ]);
  });

  it("clamps viewport zoom and rejects any non-finite viewport value", () => {
    storeModule.useEditorStore.getState().setViewport(100, 10, 20);
    expect(storeModule.useEditorStore.getState()).toMatchObject({
      zoom: 40,
      cellSize: 640,
      offsetX: 10,
      offsetY: 20,
    });

    const before = storeModule.useEditorStore.getState();
    for (const values of [
      [Number.NaN, 1, 2],
      [1, Number.POSITIVE_INFINITY, 2],
      [1, 2, Number.NEGATIVE_INFINITY],
    ] satisfies [number, number, number][]) {
      storeModule.useEditorStore.getState().setViewport(...values);
      expect(storeModule.useEditorStore.getState()).toBe(before);
    }
  });

  it("does not clear an existing dirty state when setting zoom", () => {
    storeModule.useEditorStore.setState({ isDirty: true });

    storeModule.useEditorStore.getState().setZoom(1.5);

    expect(storeModule.useEditorStore.getState().isDirty).toBe(true);
  });

  it("fits and centers the canvas using floating-point cell geometry without dirtying the project", () => {
    storeModule.useEditorStore.setState({ canvasSize: { width: 10, height: 8 } });

    storeModule.useEditorStore.getState().fitToWindow(213, 187);

    const state = storeModule.useEditorStore.getState();
    expect(state.cellSize).toBe(16 * state.zoom);
    expect(state.offsetX).toBe((213 - 10 * state.cellSize) / 2);
    expect(state.offsetY).toBe((187 - 8 * state.cellSize) / 2);
    expect(state.cellSize).not.toBe(Math.round(state.cellSize));
    expect(state.isDirty).toBe(false);
  });

  it("does not clear an existing dirty state when fitting to the window", () => {
    storeModule.useEditorStore.setState({
      canvasSize: { width: 10, height: 8 },
      isDirty: true,
    });

    storeModule.useEditorStore.getState().fitToWindow(213, 187);

    expect(storeModule.useEditorStore.getState().isDirty).toBe(true);
  });

  it.each([
    ["NaN width", Number.NaN, 187],
    ["positive Infinity width", Number.POSITIVE_INFINITY, 187],
    ["negative Infinity width", Number.NEGATIVE_INFINITY, 187],
    ["zero width", 0, 187],
    ["negative width", -1, 187],
    ["NaN height", 213, Number.NaN],
    ["positive Infinity height", 213, Number.POSITIVE_INFINITY],
    ["negative Infinity height", 213, Number.NEGATIVE_INFINITY],
    ["zero height", 213, 0],
    ["negative height", 213, -1],
  ])("ignores invalid container %s", (_name, containerW, containerH) => {
    storeModule.useEditorStore.setState({
      zoom: 1.25,
      cellSize: 20,
      offsetX: 3.5,
      offsetY: -4.25,
      isDirty: true,
    });

    storeModule.useEditorStore.getState().fitToWindow(containerW, containerH);

    expect(storeModule.useEditorStore.getState()).toMatchObject({
      zoom: 1.25,
      cellSize: 20,
      offsetX: 3.5,
      offsetY: -4.25,
      isDirty: true,
    });
  });

  it.each([
    ["NaN width", Number.NaN, 8],
    ["positive Infinity width", Number.POSITIVE_INFINITY, 8],
    ["negative Infinity width", Number.NEGATIVE_INFINITY, 8],
    ["zero width", 0, 8],
    ["negative width", -1, 8],
    ["NaN height", 10, Number.NaN],
    ["positive Infinity height", 10, Number.POSITIVE_INFINITY],
    ["negative Infinity height", 10, Number.NEGATIVE_INFINITY],
    ["zero height", 10, 0],
    ["negative height", 10, -1],
  ])("ignores invalid canvas %s", (_name, width, height) => {
    storeModule.useEditorStore.setState({
      canvasSize: { width, height },
      zoom: 1.25,
      cellSize: 20,
      offsetX: 3.5,
      offsetY: -4.25,
      isDirty: true,
    });

    storeModule.useEditorStore.getState().fitToWindow(213, 187);

    expect(storeModule.useEditorStore.getState()).toMatchObject({
      zoom: 1.25,
      cellSize: 20,
      offsetX: 3.5,
      offsetY: -4.25,
      isDirty: true,
    });
  });
});
