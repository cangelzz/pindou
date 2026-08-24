export const BASE_CELL_SIZE = 16;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 40;
export const WHEEL_LINE_HEIGHT = 40;
export const MAX_WHEEL_DELTA_PX = 240;
export const WHEEL_SENSITIVITY = Math.log(1.1) / 100;

export interface WheelZoomInput {
  zoom: number;
  cellSize: number;
  offsetX: number;
  offsetY: number;
  pointerX: number;
  pointerY: number;
  deltaY: number;
  deltaMode: number;
  pageHeight: number;
}

export interface WheelZoomView {
  zoom: number;
  cellSize: number;
  offsetX: number;
  offsetY: number;
}

function currentView(input: WheelZoomInput): WheelZoomView {
  return {
    zoom: input.zoom,
    cellSize: input.cellSize,
    offsetX: input.offsetX,
    offsetY: input.offsetY,
  };
}

export function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  pageHeight: number,
): number {
  if (!Number.isFinite(deltaY)) return 0;

  let pixels = deltaY;
  if (deltaMode === 1) {
    pixels *= WHEEL_LINE_HEIGHT;
  } else if (deltaMode === 2) {
    if (!Number.isFinite(pageHeight) || pageHeight <= 0) return 0;
    pixels *= pageHeight;
  }

  return Math.max(-MAX_WHEEL_DELTA_PX, Math.min(MAX_WHEEL_DELTA_PX, pixels));
}

export function computeWheelZoom(input: WheelZoomInput): WheelZoomView {
  const current = currentView(input);
  if (
    !Number.isFinite(input.zoom) ||
    !Number.isFinite(input.cellSize) ||
    input.cellSize <= 0 ||
    !Number.isFinite(input.offsetX) ||
    !Number.isFinite(input.offsetY) ||
    !Number.isFinite(input.pointerX) ||
    !Number.isFinite(input.pointerY)
  ) {
    return current;
  }

  const delta = normalizeWheelDelta(input.deltaY, input.deltaMode, input.pageHeight);
  if (delta === 0) return current;

  const requestedZoom = input.zoom * Math.exp(-delta * WHEEL_SENSITIVITY);
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, requestedZoom));
  if (nextZoom === input.zoom) return current;

  const nextCellSize = BASE_CELL_SIZE * nextZoom;
  const canvasX = (input.pointerX - input.offsetX) / input.cellSize;
  const canvasY = (input.pointerY - input.offsetY) / input.cellSize;

  return {
    zoom: nextZoom,
    cellSize: nextCellSize,
    offsetX: input.pointerX - canvasX * nextCellSize,
    offsetY: input.pointerY - canvasY * nextCellSize,
  };
}
