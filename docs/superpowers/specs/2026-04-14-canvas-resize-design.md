# Canvas Resize Feature

**Date:** 2026-04-14
**Status:** Approved

## Context

Currently the only way to change canvas size is to create a new canvas (destructive — all content lost). Users need to expand or shrink an existing canvas while preserving their work.

## Design

### UI — "调整画布" dialog

**Access:** New "调整画布" button in the top menu bar, between "新建" and "打开".

**Dialog contents:**
- Width / Height number inputs (min 4, max 256, pre-filled with current size)
- 3×3 anchor grid — user clicks one of 9 dots to set where existing content stays:
  - Top-left (default), top-center, top-right
  - Center-left, center, center-right
  - Bottom-left, bottom-center, bottom-right
- Preview text: `52×52 → 60×80 (+8 宽, +28 高)`
- Warning (orange) if shrinking would lose non-empty pixels: `⚠ 将裁剪 N 个非空像素`
- "应用" and "取消" buttons

### Store — `resizeCanvas(newWidth, newHeight, anchorRow, anchorCol)`

**Parameters:**
- `newWidth`, `newHeight`: target dimensions
- `anchorRow`: 0 = top, 1 = center, 2 = bottom
- `anchorCol`: 0 = left, 1 = center, 2 = right

**Behavior:**
1. Calculate pixel offset based on anchor:
   - `offsetCol = anchorCol * (newWidth - oldWidth) / 2` (floored)
   - `offsetRow = anchorRow * (newHeight - oldHeight) / 2` (floored)
2. For each layer: create new empty `CanvasData[newHeight][newWidth]`, copy existing cells at calculated offset, clipping anything outside bounds
3. Merge layers into new `canvasData`
4. Update `canvasSize`, `gridConfig` (via `makeGridConfig`)
5. Push current state to undo stack (resize is undoable)
6. Set `isDirty = true`

**Helper — `countLostPixels(newWidth, newHeight, anchorRow, anchorCol)`:**
Returns the number of non-null cells across all visible layers that would fall outside the new bounds. Used by the dialog to show the warning.

### Edge cases

- Expanding: new space filled with `{ colorIndex: null }`
- Shrinking: pixels outside new bounds are clipped (after user sees warning)
- Same size: button disabled / no-op
- Reference image: not affected (independent dimensions)
- Undo: restores previous size and all layer data

## Files to modify

- `src/store/editorStore.ts` — add `resizeCanvas` and `countLostPixels`
- `src/App.tsx` — add "调整画布" button and resize dialog
- `src/types/index.ts` — no changes needed (existing types sufficient)

## Verification

- Expand canvas → existing pixels stay at selected anchor position, new space is empty
- Shrink canvas → warning shows correct count, pixels outside bounds are removed
- Undo after resize → canvas returns to previous size with all content
- All layers resized correctly (not just active layer)
- Grid config updates to match new size
