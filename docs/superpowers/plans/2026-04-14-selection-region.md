# Selection Region Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rectangle selection, magic wand selection, cell move, and clipboard (cut/copy/paste/delete) operations to the pixel art editor, operating on the active layer.

**Architecture:** New `"select"` and `"wand"` tools join the existing `EditorTool` type. Selection state (cell set + bounding box), clipboard, and floating selection are added to the Zustand store. A new `selectionRenderer.ts` handles marching ants and floating preview rendering. PixelCanvas gets a selection overlay canvas and new mouse/keyboard handlers. The toolbar gets two new tool buttons.

**Tech Stack:** React 19, Zustand 5, TypeScript, Tailwind CSS 4, Vitest, HTML5 Canvas

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types/index.ts` | Modify | Add `"select"` and `"wand"` to `EditorTool` |
| `src/store/editorStore.ts` | Modify | Add selection/clipboard/floating state + actions |
| `src/utils/selectionRenderer.ts` | Create | Marching ants, resize handles, floating cell rendering |
| `src/components/Canvas/PixelCanvas.tsx` | Modify | Selection overlay canvas, mouse handlers, keyboard shortcuts |
| `src/components/Canvas/CanvasToolbar.tsx` | Modify | Add select + wand tool buttons |
| `tests/core/selection.test.ts` | Create | Unit tests for selection logic (flood select, clipboard ops) |

---

### Task 1: Types + Store — Selection State and Actions

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/store/editorStore.ts`
- Create: `tests/core/selection.test.ts`

- [ ] **Step 1: Add `"select"` and `"wand"` to EditorTool type**

In `src/types/index.ts`, change:

```typescript
export type EditorTool = "pen" | "eraser" | "eyedropper" | "pan" | "fill" | "line" | "rect" | "circle";
```

to:

```typescript
export type EditorTool = "pen" | "eraser" | "eyedropper" | "pan" | "fill" | "line" | "rect" | "circle" | "select" | "wand";
```

- [ ] **Step 2: Add selection state fields to EditorState interface**

In `src/store/editorStore.ts`, add these fields after `customColorGroups` (around line 75):

```typescript
  // Selection
  selection: Set<string> | null; // "row,col" keys
  selectionBounds: { r1: number; c1: number; r2: number; c2: number } | null;
  clipboard: { cells: Map<string, CanvasCell>; width: number; height: number } | null;
  floatingSelection: { cells: Map<string, CanvasCell>; offsetRow: number; offsetCol: number } | null;
```

- [ ] **Step 3: Add selection action signatures to EditorState interface**

Add after `countLostPixels` signature (around line 110):

```typescript
  setSelection: (cells: Set<string>) => void;
  clearSelection: () => void;
  selectAll: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  pasteClipboard: () => void;
  deleteSelection: () => void;
  commitFloatingSelection: () => void;
  moveSelectionCells: (dRow: number, dCol: number) => void;
```

- [ ] **Step 4: Add initial state values**

In the `create<EditorState>((set, get) => ({` block, add after `customColorGroups` initial value:

```typescript
  selection: null,
  selectionBounds: null,
  clipboard: null,
  floatingSelection: null,
```

- [ ] **Step 5: Add helper function `computeBounds`**

Add before `makeGridConfig` function:

```typescript
/** Compute bounding box of a cell set */
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
```

- [ ] **Step 6: Add selection action implementations**

Add after `countLostPixels` implementation in the store:

```typescript
  setSelection: (cells) => {
    if (cells.size === 0) {
      set({ selection: null, selectionBounds: null });
      return;
    }
    set({ selection: cells, selectionBounds: computeBounds(cells) });
  },

  clearSelection: () => {
    const state = get();
    // Commit floating selection first if present
    if (state.floatingSelection) {
      get().commitFloatingSelection();
    }
    set({ selection: null, selectionBounds: null });
  },

  selectAll: () => {
    const state = get();
    const { width, height } = state.canvasSize;
    const cells = new Set<string>();
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        cells.add(`${r},${c}`);
      }
    }
    set({ selection: cells, selectionBounds: { r1: 0, c1: 0, r2: height - 1, c2: width - 1 } });
  },

  copySelection: () => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const { r1, c1, r2, c2 } = state.selectionBounds;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const cells = new Map<string, CanvasCell>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const cell = layerData[r]?.[c];
      if (cell && cell.colorIndex !== null) {
        cells.set(`${r - r1},${c - c1}`, { ...cell });
      }
    }
    set({ clipboard: { cells, width: c2 - c1 + 1, height: r2 - r1 + 1 } });
  },

  cutSelection: () => {
    const state = get();
    if (!state.selection) return;
    // Copy first
    get().copySelection();
    // Then clear selected cells
    get().deleteSelection();
  },

  pasteClipboard: () => {
    const state = get();
    if (!state.clipboard) return;
    // Commit any existing floating selection
    if (state.floatingSelection) {
      get().commitFloatingSelection();
    }
    // Place at top-left or center
    const { width: cw, height: ch } = state.canvasSize;
    const { width: pw, height: ph } = state.clipboard;
    const offsetRow = Math.floor((ch - ph) / 2);
    const offsetCol = Math.floor((cw - pw) / 2);
    set({
      floatingSelection: {
        cells: new Map(state.clipboard.cells),
        offsetRow,
        offsetCol,
      },
    });
  },

  deleteSelection: () => {
    const state = get();
    if (!state.selection) return;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      entries.push({ row: r, col: c, colorIndex: null });
    }
    if (entries.length > 0) {
      get().batchSetCells(entries);
    }
  },

  commitFloatingSelection: () => {
    const state = get();
    if (!state.floatingSelection) return;
    const { cells, offsetRow, offsetCol } = state.floatingSelection;
    const { width, height } = state.canvasSize;
    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const [key, cell] of cells) {
      const [lr, lc] = key.split(",").map(Number);
      const r = lr + offsetRow;
      const c = lc + offsetCol;
      if (r >= 0 && r < height && c >= 0 && c < width && cell.colorIndex !== null) {
        entries.push({ row: r, col: c, colorIndex: cell.colorIndex });
      }
    }
    if (entries.length > 0) {
      get().batchSetCells(entries);
    }
    set({ floatingSelection: null, selection: null, selectionBounds: null });
  },

  moveSelectionCells: (dRow, dCol) => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const { r1, c1 } = state.selectionBounds;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;

    // Collect cells for floating selection
    const floatingCells = new Map<string, CanvasCell>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const cell = layerData[r]?.[c];
      if (cell && cell.colorIndex !== null) {
        floatingCells.set(`${r - r1},${c - c1}`, { ...cell });
      }
    }

    // Clear originals
    const clearEntries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      clearEntries.push({ row: r, col: c, colorIndex: null });
    }
    if (clearEntries.length > 0) {
      get().batchSetCells(clearEntries);
    }

    set({
      floatingSelection: {
        cells: floatingCells,
        offsetRow: r1 + dRow,
        offsetCol: c1 + dCol,
      },
      selection: null,
      selectionBounds: null,
    });
  },
```

- [ ] **Step 7: Create unit tests**

Create `tests/core/selection.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { CanvasCell, CanvasData } from "../../src/types";

/** Compute bounding box of a cell set — same as store helper */
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

/** BFS flood select — same algorithm as store/PixelCanvas */
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
    expect(result.size).toBe(3); // (0,0), (0,1), (1,0)
    expect(result.has("0,0")).toBe(true);
    expect(result.has("0,1")).toBe(true);
    expect(result.has("1,0")).toBe(true);
    expect(result.has("1,1")).toBe(false); // different color
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
```

- [ ] **Step 8: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All tests pass (33 existing + 5 new = 38)

- [ ] **Step 9: Commit**

```bash
git add src/types/index.ts src/store/editorStore.ts tests/core/selection.test.ts
git commit -m "feat: add selection state, clipboard, and selection actions to store"
```

---

### Task 2: Selection Renderer

**Files:**
- Create: `src/utils/selectionRenderer.ts`

- [ ] **Step 1: Create selection renderer**

Create `src/utils/selectionRenderer.ts`:

```typescript
import type { CanvasCell } from "../types";
import { MARD_COLORS } from "../data/mard221";

/**
 * Render marching ants border around selected cells.
 * Draws dashed lines on edges between selected and non-selected cells.
 */
export function renderMarchingAnts(
  ctx: CanvasRenderingContext2D,
  selection: Set<string>,
  cellSize: number,
  offsetX: number,
  offsetY: number,
  dashOffset: number,
): void {
  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = dashOffset;

  for (const key of selection) {
    const [r, c] = key.split(",").map(Number);
    const x = c * cellSize + offsetX;
    const y = r * cellSize + offsetY;

    // Draw edge if neighbor is NOT in selection
    // Top
    if (!selection.has(`${r - 1},${c}`)) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + cellSize, y); ctx.stroke();
    }
    // Bottom
    if (!selection.has(`${r + 1},${c}`)) {
      ctx.beginPath(); ctx.moveTo(x, y + cellSize); ctx.lineTo(x + cellSize, y + cellSize); ctx.stroke();
    }
    // Left
    if (!selection.has(`${r},${c - 1}`)) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + cellSize); ctx.stroke();
    }
    // Right
    if (!selection.has(`${r},${c + 1}`)) {
      ctx.beginPath(); ctx.moveTo(x + cellSize, y); ctx.lineTo(x + cellSize, y + cellSize); ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Render resize handles at corners and edge midpoints of bounding box.
 */
export function renderResizeHandles(
  ctx: CanvasRenderingContext2D,
  bounds: { r1: number; c1: number; r2: number; c2: number },
  cellSize: number,
  offsetX: number,
  offsetY: number,
): void {
  const x1 = bounds.c1 * cellSize + offsetX;
  const y1 = bounds.r1 * cellSize + offsetY;
  const x2 = (bounds.c2 + 1) * cellSize + offsetX;
  const y2 = (bounds.r2 + 1) * cellSize + offsetY;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const s = 5; // handle half-size

  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;

  const handles = [
    [x1, y1], [mx, y1], [x2, y1],
    [x1, my],           [x2, my],
    [x1, y2], [mx, y2], [x2, y2],
  ];
  for (const [hx, hy] of handles) {
    ctx.fillRect(hx - s, hy - s, s * 2, s * 2);
    ctx.strokeRect(hx - s, hy - s, s * 2, s * 2);
  }
}

/**
 * Render floating selection cells as semi-transparent overlay.
 */
export function renderFloatingSelection(
  ctx: CanvasRenderingContext2D,
  cells: Map<string, CanvasCell>,
  offsetRow: number,
  offsetCol: number,
  cellSize: number,
  canvasOffsetX: number,
  canvasOffsetY: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.7;
  for (const [key, cell] of cells) {
    if (cell.colorIndex === null) continue;
    const [lr, lc] = key.split(",").map(Number);
    const r = lr + offsetRow;
    const c = lc + offsetCol;
    const x = c * cellSize + canvasOffsetX;
    const y = r * cellSize + canvasOffsetY;
    const color = MARD_COLORS[cell.colorIndex];
    ctx.fillStyle = color?.hex || "#FF00FF";
    ctx.fillRect(x, y, cellSize, cellSize);
  }
  ctx.restore();
}
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 38 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/utils/selectionRenderer.ts
git commit -m "feat: add selection renderer — marching ants, handles, floating preview"
```

---

### Task 3: Toolbar — Add Select + Wand Buttons

**Files:**
- Modify: `src/components/Canvas/CanvasToolbar.tsx`

- [ ] **Step 1: Add select and wand tools to the toolbar**

In `CanvasToolbar.tsx`, find the `tools` array and add these two entries at the beginning (before pen):

```typescript
  { id: "select" as EditorTool, label: "选区", icon: "⬚", shortcut: "S" },
  { id: "wand" as EditorTool, label: "魔棒", icon: "✦", shortcut: "W" },
```

- [ ] **Step 2: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 38 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/components/Canvas/CanvasToolbar.tsx
git commit -m "feat: add select and wand tool buttons to toolbar"
```

---

### Task 4: PixelCanvas — Selection Overlay Canvas + Marching Ants Rendering

**Files:**
- Modify: `src/components/Canvas/PixelCanvas.tsx`

- [ ] **Step 1: Add imports and refs**

Add to the imports at the top:

```typescript
import { renderMarchingAnts, renderResizeHandles, renderFloatingSelection } from "../../utils/selectionRenderer";
```

Add after `const shapeCanvasRef` ref:

```typescript
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);
```

Add store bindings after existing ones:

```typescript
  const selection = useEditorStore((s) => s.selection);
  const selectionBounds = useEditorStore((s) => s.selectionBounds);
  const floatingSelectionState = useEditorStore((s) => s.floatingSelection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const commitFloatingSelection = useEditorStore((s) => s.commitFloatingSelection);
  const moveSelectionCells = useEditorStore((s) => s.moveSelectionCells);
```

- [ ] **Step 2: Add selection canvas to resize function**

In the `resize` callback, add `selectionCanvasRef.current` to the canvases list. Find:

```typescript
    const ac = axisCanvasRef.current;
    if (!container || !pc || !rc || !gc || !ac) return;
```

Change to:

```typescript
    const ac = axisCanvasRef.current;
    const sc = selectionCanvasRef.current;
    if (!container || !pc || !rc || !gc || !ac || !sc) return;
```

And in the for loop `for (const c of [pc, rc, gc, ac])`, change to:

```typescript
    for (const c of [pc, rc, gc, ac, sc]) {
```

- [ ] **Step 3: Add marching ants rendering useEffect**

Add after the grid rendering useEffect:

```typescript
  // Render selection overlay (marching ants + handles + floating)
  const [antOffset, setAntOffset] = useState(0);
  useEffect(() => {
    if (!selection && !floatingSelectionState) return;
    let animId: number;
    const animate = () => {
      setAntOffset((prev) => (prev + 0.5) % 16);
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [selection, floatingSelectionState]);

  useEffect(() => {
    const ctx = selectionCanvasRef.current?.getContext("2d");
    if (!ctx || !containerRef.current) return;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (floatingSelectionState) {
      renderFloatingSelection(
        ctx,
        floatingSelectionState.cells,
        floatingSelectionState.offsetRow,
        floatingSelectionState.offsetCol,
        cellSize, offsetX, offsetY,
      );
    }

    if (selection && selection.size > 0) {
      renderMarchingAnts(ctx, selection, cellSize, offsetX, offsetY, antOffset);
      if (selectionBounds) {
        renderResizeHandles(ctx, selectionBounds, cellSize, offsetX, offsetY);
      }
    }
  }, [selection, selectionBounds, floatingSelectionState, cellSize, offsetX, offsetY, antOffset, resizeCount]);
```

- [ ] **Step 4: Add selection canvas element to JSX**

Add after `<canvas ref={shapeCanvasRef} .../>`:

```tsx
        <canvas ref={selectionCanvasRef} className="absolute inset-0 pointer-events-none" />
```

- [ ] **Step 5: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 38 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/Canvas/PixelCanvas.tsx
git commit -m "feat: add selection overlay canvas with marching ants rendering"
```

---

### Task 5: PixelCanvas — Selection Mouse Handlers

**Files:**
- Modify: `src/components/Canvas/PixelCanvas.tsx`

- [ ] **Step 1: Add selection-related refs**

Add after `isPanning` ref:

```typescript
  // Selection tool state
  const selectionStart = useRef<{ row: number; col: number } | null>(null);
  const isDraggingSelection = useRef(false);
  const selectionDragStart = useRef<{ row: number; col: number; mouseX: number; mouseY: number } | null>(null);
```

- [ ] **Step 2: Add `screenToCell` helper if not existing**

Check if there's already a screen-to-cell conversion function. If not, add:

```typescript
  const screenToCell = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const col = Math.floor((x - offsetX) / cellSize);
    const row = Math.floor((y - offsetY) / cellSize);
    return { row, col };
  }, [offsetX, offsetY, cellSize]);
```

- [ ] **Step 3: Update `handleMouseDown` for select/wand tools**

In `handleMouseDown`, add a new case before the shape tools check. Find the section where left-button + normal tool starts `isDragging.current = true` and `applyTool`. Add before it:

```typescript
      // Selection tool: start rectangle drag
      if (currentTool === "select") {
        const cell = screenToCell(e.clientX, e.clientY);
        if (!cell) return;
        const { row, col } = cell;

        // Check if clicking inside existing selection → start cell drag
        if (selection && selection.has(`${row},${col}`)) {
          isDraggingSelection.current = true;
          selectionDragStart.current = { row, col, mouseX: e.clientX, mouseY: e.clientY };
          return;
        }

        // Commit floating selection if present
        if (floatingSelectionState) {
          commitFloatingSelection();
        }

        // Start new selection rectangle
        selectionStart.current = { row, col };
        setSelection(new Set([`${row},${col}`]));
        return;
      }

      // Magic wand tool: flood select on click
      if (currentTool === "wand") {
        const cell = screenToCell(e.clientX, e.clientY);
        if (!cell) return;
        const { row, col } = cell;
        const state = useEditorStore.getState();
        const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
        if (layerIdx === -1) return;
        const layerData = state.layers[layerIdx].data;
        const { width, height } = state.canvasSize;
        const targetColor = layerData[row]?.[col]?.colorIndex ?? null;
        const visited = new Set<string>();
        const queue: [number, number][] = [[row, col]];
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
        // Shift+click adds to selection
        if (e.shiftKey && selection) {
          const merged = new Set(selection);
          for (const k of visited) merged.add(k);
          setSelection(merged);
        } else {
          setSelection(visited);
        }
        return;
      }
```

- [ ] **Step 4: Update `handleMouseMove` for select tool rectangle drag**

Add a section for selection rectangle dragging. After the panning section:

```typescript
      // Selection rectangle drag
      if (currentTool === "select" && selectionStart.current && !isDraggingSelection.current) {
        const cell = screenToCell(e.clientX, e.clientY);
        if (!cell) return;
        const sr = selectionStart.current.row;
        const sc = selectionStart.current.col;
        const er = cell.row;
        const ec = cell.col;
        const r1 = Math.min(sr, er);
        const c1 = Math.min(sc, ec);
        const r2 = Math.max(sr, er);
        const c2 = Math.max(sc, ec);
        const cells = new Set<string>();
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) {
            cells.add(`${r},${c}`);
          }
        }
        setSelection(cells);
        return;
      }

      // Moving selected cells
      if (isDraggingSelection.current && selectionDragStart.current) {
        // Will be committed on mouseUp
        return;
      }
```

- [ ] **Step 5: Update `handleMouseUp` for selection**

Add before the shape tool commit section:

```typescript
      // Finish selection rectangle
      if (currentTool === "select" && selectionStart.current) {
        selectionStart.current = null;
      }

      // Finish moving selection cells
      if (isDraggingSelection.current && selectionDragStart.current) {
        const cell = screenToCell(e.clientX, e.clientY);
        if (cell) {
          const dRow = cell.row - selectionDragStart.current.row;
          const dCol = cell.col - selectionDragStart.current.col;
          if (dRow !== 0 || dCol !== 0) {
            moveSelectionCells(dRow, dCol);
          }
        }
        isDraggingSelection.current = false;
        selectionDragStart.current = null;
      }
```

- [ ] **Step 6: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 38 tests pass

- [ ] **Step 7: Commit**

```bash
git add src/components/Canvas/PixelCanvas.tsx
git commit -m "feat: add selection mouse handlers — rect drag, magic wand, cell move"
```

---

### Task 6: PixelCanvas — Keyboard Shortcuts

**Files:**
- Modify: `src/components/Canvas/PixelCanvas.tsx`

- [ ] **Step 1: Add selection keyboard shortcuts**

In the `onKey` handler, add these cases. Find the `else if (!e.ctrlKey && !e.metaKey)` block for tool shortcuts. Add `s: "select", w: "wand"` to the `toolMap`:

```typescript
        const toolMap: Record<string, import("../../types").EditorTool> = {
          p: "pen", l: "line", r: "rect", c: "circle",
          f: "fill", e: "eraser", i: "eyedropper",
          s: "select", w: "wand",
        };
```

Add these cases BEFORE the existing `else if (!e.ctrlKey && !e.metaKey)` block (so Ctrl shortcuts are checked first):

```typescript
      } else if (e.ctrlKey && e.key === "c") {
        e.preventDefault();
        useEditorStore.getState().copySelection();
      } else if (e.ctrlKey && e.key === "x") {
        e.preventDefault();
        useEditorStore.getState().cutSelection();
      } else if (e.ctrlKey && e.key === "v") {
        e.preventDefault();
        useEditorStore.getState().pasteClipboard();
      } else if (e.ctrlKey && e.key === "a") {
        e.preventDefault();
        useEditorStore.getState().selectAll();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (useEditorStore.getState().selection) {
          e.preventDefault();
          useEditorStore.getState().deleteSelection();
        }
```

Also update the Escape handler to clear selection:

```typescript
      } else if (e.key === "Escape") {
        // Cancel shape in progress
        if (shapeStart.current) {
          shapeStart.current = null;
          setShapePreview(null);
        }
        // Clear selection
        const state = useEditorStore.getState();
        if (state.floatingSelection) {
          state.commitFloatingSelection();
        } else if (state.selection) {
          state.clearSelection();
        }
        setFocusGroup(null);
```

- [ ] **Step 2: Update cursor for selection tool**

In the cursor computation, add select/wand:

```typescript
  const cursor =
    currentTool === "pan"
      ? "grab"
      : currentTool === "eyedropper" || currentTool === "fill"
        ? "crosshair"
        : currentTool === "select" || currentTool === "wand"
          ? "crosshair"
          : "default";
```

- [ ] **Step 3: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 38 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/components/Canvas/PixelCanvas.tsx
git commit -m "feat: add selection keyboard shortcuts — Ctrl+C/X/V/A, Delete, Escape"
```

---

### Task 7: Rebuild VS Code Extension + Final Test

**Files:**
- No source changes

- [ ] **Step 1: Run all unit tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 38 tests pass

- [ ] **Step 2: Rebuild VS Code extension**

```bash
cd c:\Repo\pindou\platforms\vscode && npm run build
```

- [ ] **Step 3: Run Playwright test**

```bash
cd c:\Repo\pindou\platforms\vscode && npx playwright test
```

Expected: PASS
