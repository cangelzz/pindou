# Selection Region Feature

**Date:** 2026-04-14
**Status:** Approved

## Context

The pixel art editor currently has no way to select, move, copy, or rearrange existing pixel regions. Users must redraw if they want to reposition content. This feature adds rectangle selection, magic wand selection, and clipboard operations.

## Tools

Two new tools added to `EditorTool` type:

- **`"select"`** — Rectangle drag selection. Shortcut: **S**. Click+drag to create a rectangular selection.
- **`"wand"`** — Magic wand flood selection. Shortcut: **W**. Click a cell to flood-select all contiguous cells with the same colorIndex (same BFS as the existing fill tool, but collects cells instead of coloring). Shift+click adds to existing selection; click without Shift replaces selection.

## Selection Model

Selection is stored as a **set of cell coordinates**, supporting both rectangular and non-rectangular (magic wand) shapes.

### Store state

```typescript
// Selection state
selection: Set<string> | null              // "row,col" keys
selectionBounds: { r1: number, c1: number, r2: number, c2: number } | null  // cached bounding box

// Clipboard
clipboard: { cells: Map<string, CanvasCell>, width: number, height: number } | null

// Floating selection (during move/paste, before commit)
floatingSelection: { cells: Map<string, CanvasCell>, offsetRow: number, offsetCol: number } | null
```

### Store actions

```typescript
setSelection(cells: Set<string>): void
clearSelection(): void
copySelection(): void           // copy active layer cells within selection to clipboard
cutSelection(): void            // copy + clear originals
pasteClipboard(): void          // create floating selection from clipboard at center
deleteSelection(): void         // clear selected cells (set to null)
commitFloatingSelection(): void // write floating cells to active layer, clear floating
selectAll(): void               // select entire canvas
```

## Behaviors

### 1. Create selection (rectangle tool)

Click+drag draws a rectangle. On mouseUp, all cells within the rectangle are added to `selection`. Marching ants rendered around boundary.

### 2. Create selection (magic wand tool)

Click a cell → BFS flood-fill from that cell collecting all contiguous cells with the same `colorIndex`. Result stored in `selection`. Shift+click adds to existing selection instead of replacing.

### 3. Resize selection

Drag any of the 4 edges or 4 corners of the bounding box to adjust the selection rectangle. For rectangular selections, this adds/removes cells. For magic wand selections, resize operates on the bounding box and clips to existing cells.

### 4. Move selection box only

Drag the selection border/handles to reposition the selection rectangle without moving cell content. The selection set is recalculated for the new bounding box position.

### 5. Move cells

Drag inside the selection to move the selected cells. Creates a floating selection:
- Original positions are cleared (cut + place)
- Floating cells render as a semi-transparent overlay during drag
- On release (or click outside), floating selection commits to the active layer at the new position

### 6. Cut / Copy / Paste / Delete

Operates on the **active layer only**.

| Shortcut | Action |
|----------|--------|
| **Ctrl+C** | Copy selected cells to internal clipboard |
| **Ctrl+X** | Cut (copy + clear originals) |
| **Ctrl+V** | Paste clipboard as floating selection at canvas center |
| **Delete** | Clear selected cells (set colorIndex to null) |
| **Ctrl+A** | Select all cells |
| **Escape** | Deselect / cancel floating selection |

### 7. Deselect

Escape key, click outside selection, or switch to another tool.

### 8. Constrained drawing (Phase 2 — not in initial implementation)

When a selection exists, pen/eraser/fill tools only affect cells inside the selection (acts as a mask). This is a future enhancement.

## Visual rendering

- **Marching ants** — Animated dashed border around selection boundary edges, rendered on a dedicated overlay canvas. Animation via `requestAnimationFrame` with dash offset cycling.
- **Resize handles** — Small squares at corners and edge midpoints of the bounding box.
- **Floating cells** — During move/paste, cells render as a semi-transparent overlay at the drag position.
- **Cursor changes** — Move cursor inside selection, resize arrows on edges/corners.

## Scope and phasing

**Phase 1 (this spec):**
- Select tool (rectangle drag)
- Magic wand tool (flood select)
- Move selection box
- Move cells (cut+place)
- Cut/Copy/Paste/Delete
- Select All, Deselect
- Marching ants, resize handles, floating preview

**Phase 2 (future):**
- Selection as drawing mask (constrain pen/eraser/fill to selection)
- Flip/rotate selection

## Files to modify

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types/index.ts` | Modify | Add `"select"` and `"wand"` to `EditorTool` |
| `src/store/editorStore.ts` | Modify | Add selection state, clipboard state, floating selection state, and all selection actions |
| `src/components/Canvas/PixelCanvas.tsx` | Modify | Add selection mouse handling, rendering (marching ants, handles, floating preview), keyboard shortcuts (Ctrl+C/X/V/A, Delete, Escape) |
| `src/utils/selectionRenderer.ts` | Create | Marching ants rendering, resize handle rendering, floating selection rendering |
| `src/components/Canvas/CanvasToolbar.tsx` | Modify | Add select and wand tool buttons |

## Verification

- Rectangle select: drag creates selection, marching ants visible
- Magic wand: click selects contiguous same-color cells
- Shift+click magic wand: adds to selection
- Resize handles: drag edge/corner changes selection size
- Move cells: drag inside selection moves cells, originals become empty
- Ctrl+C then Ctrl+V: copies and pastes cells at new position
- Ctrl+X: cuts cells (originals cleared)
- Delete: clears selected cells
- Ctrl+A: selects all
- Escape: deselects
- Undo after move/cut/delete restores previous state
