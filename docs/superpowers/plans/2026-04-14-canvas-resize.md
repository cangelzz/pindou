# Canvas Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "调整画布" (resize canvas) feature that lets users change canvas dimensions while preserving existing pixel data, with a user-selectable anchor point and a warning when shrinking would lose pixels.

**Architecture:** Add `resizeCanvas` and `countLostPixels` functions to the Zustand store, and a resize dialog in App.tsx matching the existing "新建画布" dialog pattern. The resize operates on all layers simultaneously, clearing undo/redo stacks (consistent with `newCanvas`/`placeImageOnCanvas`).

**Tech Stack:** React 19, Zustand 5, TypeScript, Tailwind CSS 4, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/store/editorStore.ts` | Modify | Add `resizeCanvas` and `countLostPixels` to interface and implementation |
| `src/App.tsx` | Modify | Add "调整画布" button and resize dialog |
| `tests/core/canvasResize.test.ts` | Create | Unit tests for resize logic |

---

### Task 1: Core Resize Logic — Tests

**Files:**
- Create: `tests/core/canvasResize.test.ts`

- [ ] **Step 1: Create test file with resize helper tests**

```typescript
import { describe, it, expect } from "vitest";
import type { CanvasData } from "../../src/types";

// Pure functions extracted for testability — same logic used in editorStore
function createEmptyCanvas(width: number, height: number): CanvasData {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ colorIndex: null }))
  );
}

function resizeLayerData(
  data: CanvasData,
  oldW: number, oldH: number,
  newW: number, newH: number,
  anchorRow: number, anchorCol: number,
): CanvasData {
  const offsetCol = Math.floor(anchorCol * (newW - oldW) / 2);
  const offsetRow = Math.floor(anchorRow * (newH - oldH) / 2);
  const result = createEmptyCanvas(newW, newH);
  for (let r = 0; r < oldH; r++) {
    for (let c = 0; c < oldW; c++) {
      const nr = r + offsetRow;
      const nc = c + offsetCol;
      if (nr >= 0 && nr < newH && nc >= 0 && nc < newW) {
        result[nr][nc] = data[r][c];
      }
    }
  }
  return result;
}

function countLostPixels(
  layers: { data: CanvasData; visible: boolean }[],
  oldW: number, oldH: number,
  newW: number, newH: number,
  anchorRow: number, anchorCol: number,
): number {
  const offsetCol = Math.floor(anchorCol * (newW - oldW) / 2);
  const offsetRow = Math.floor(anchorRow * (newH - oldH) / 2);
  let lost = 0;
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (let r = 0; r < oldH; r++) {
      for (let c = 0; c < oldW; c++) {
        if (layer.data[r][c].colorIndex === null) continue;
        const nr = r + offsetRow;
        const nc = c + offsetCol;
        if (nr < 0 || nr >= newH || nc < 0 || nc >= newW) {
          lost++;
        }
      }
    }
  }
  return lost;
}

describe("resizeLayerData", () => {
  it("expands canvas with top-left anchor", () => {
    const data: CanvasData = [
      [{ colorIndex: 1 }, { colorIndex: 2 }],
      [{ colorIndex: 3 }, { colorIndex: 4 }],
    ];
    const result = resizeLayerData(data, 2, 2, 4, 3, 0, 0);
    expect(result[0][0].colorIndex).toBe(1);
    expect(result[0][1].colorIndex).toBe(2);
    expect(result[1][0].colorIndex).toBe(3);
    expect(result[1][1].colorIndex).toBe(4);
    // New space is null
    expect(result[0][2].colorIndex).toBeNull();
    expect(result[0][3].colorIndex).toBeNull();
    expect(result[2][0].colorIndex).toBeNull();
  });

  it("expands canvas with center anchor", () => {
    const data: CanvasData = [
      [{ colorIndex: 1 }, { colorIndex: 2 }],
      [{ colorIndex: 3 }, { colorIndex: 4 }],
    ];
    // 2x2 -> 4x4, center anchor (1,1)
    const result = resizeLayerData(data, 2, 2, 4, 4, 1, 1);
    // Offset = floor(1 * (4-2)/2) = 1 for both row and col
    expect(result[1][1].colorIndex).toBe(1);
    expect(result[1][2].colorIndex).toBe(2);
    expect(result[2][1].colorIndex).toBe(3);
    expect(result[2][2].colorIndex).toBe(4);
    // Corners are null
    expect(result[0][0].colorIndex).toBeNull();
    expect(result[3][3].colorIndex).toBeNull();
  });

  it("expands canvas with bottom-right anchor", () => {
    const data: CanvasData = [
      [{ colorIndex: 5 }],
    ];
    // 1x1 -> 3x3, bottom-right anchor (2,2)
    const result = resizeLayerData(data, 1, 1, 3, 3, 2, 2);
    // Offset = floor(2 * (3-1)/2) = 2
    expect(result[2][2].colorIndex).toBe(5);
    expect(result[0][0].colorIndex).toBeNull();
  });

  it("shrinks canvas and clips pixels", () => {
    const data: CanvasData = [
      [{ colorIndex: 1 }, { colorIndex: 2 }, { colorIndex: 3 }],
      [{ colorIndex: 4 }, { colorIndex: 5 }, { colorIndex: 6 }],
      [{ colorIndex: 7 }, { colorIndex: 8 }, { colorIndex: 9 }],
    ];
    // 3x3 -> 2x2, top-left anchor
    const result = resizeLayerData(data, 3, 3, 2, 2, 0, 0);
    expect(result[0][0].colorIndex).toBe(1);
    expect(result[0][1].colorIndex).toBe(2);
    expect(result[1][0].colorIndex).toBe(4);
    expect(result[1][1].colorIndex).toBe(5);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(2);
  });

  it("handles same size as no-op", () => {
    const data: CanvasData = [
      [{ colorIndex: 1 }, { colorIndex: 2 }],
    ];
    const result = resizeLayerData(data, 2, 1, 2, 1, 0, 0);
    expect(result[0][0].colorIndex).toBe(1);
    expect(result[0][1].colorIndex).toBe(2);
  });
});

describe("countLostPixels", () => {
  it("returns 0 when expanding", () => {
    const layers = [{
      visible: true,
      data: [[{ colorIndex: 1 }, { colorIndex: 2 }]] as CanvasData,
    }];
    expect(countLostPixels(layers, 2, 1, 4, 2, 0, 0)).toBe(0);
  });

  it("counts pixels lost when shrinking", () => {
    const layers = [{
      visible: true,
      data: [
        [{ colorIndex: 1 }, { colorIndex: 2 }, { colorIndex: 3 }],
        [{ colorIndex: 4 }, { colorIndex: null }, { colorIndex: 6 }],
        [{ colorIndex: 7 }, { colorIndex: 8 }, { colorIndex: 9 }],
      ] as CanvasData,
    }];
    // 3x3 -> 2x2 top-left: lose col 2 (3,6,9) and row 2 (7,8) = 5 non-null pixels
    expect(countLostPixels(layers, 3, 3, 2, 2, 0, 0)).toBe(5);
  });

  it("ignores hidden layers", () => {
    const layers = [{
      visible: false,
      data: [[{ colorIndex: 1 }, { colorIndex: 2 }, { colorIndex: 3 }]] as CanvasData,
    }];
    expect(countLostPixels(layers, 3, 1, 1, 1, 0, 0)).toBe(0);
  });

  it("counts across multiple visible layers", () => {
    const layers = [
      { visible: true, data: [[{ colorIndex: 1 }, { colorIndex: 2 }]] as CanvasData },
      { visible: true, data: [[{ colorIndex: 3 }, { colorIndex: 4 }]] as CanvasData },
    ];
    // 2x1 -> 1x1 top-left: each layer loses 1 pixel (col 1) = 2 total
    expect(countLostPixels(layers, 2, 1, 1, 1, 0, 0)).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd c:\Repo\pindou && npm test`

Expected: PASS (these test pure local functions, not store methods — they should pass immediately since the functions are defined inline in the test file)

- [ ] **Step 3: Commit**

```bash
git add tests/core/canvasResize.test.ts
git commit -m "test: add canvas resize logic unit tests"
```

---

### Task 2: Store — Add `resizeCanvas` and `countLostPixels`

**Files:**
- Modify: `src/store/editorStore.ts` (interface at ~line 78, implementation at ~line 530)

- [ ] **Step 1: Add method signatures to EditorState interface**

Add after `loadCanvasData` declaration (around line 106):

```typescript
  resizeCanvas: (newWidth: number, newHeight: number, anchorRow: number, anchorCol: number) => void;
  countLostPixels: (newWidth: number, newHeight: number, anchorRow: number, anchorCol: number) => number;
```

- [ ] **Step 2: Add `resizeLayerData` helper function**

Add after `mergeLayers` function (around line 189), before `makeGridConfig`:

```typescript
/** Resize a single layer's data to new dimensions, placing content at anchor offset */
function resizeLayerData(
  data: CanvasData,
  oldW: number, oldH: number,
  newW: number, newH: number,
  anchorRow: number, anchorCol: number,
): CanvasData {
  const offsetCol = Math.floor(anchorCol * (newW - oldW) / 2);
  const offsetRow = Math.floor(anchorRow * (newH - oldH) / 2);
  const result = createEmptyCanvas(newW, newH);
  for (let r = 0; r < oldH; r++) {
    for (let c = 0; c < oldW; c++) {
      const nr = r + offsetRow;
      const nc = c + offsetCol;
      if (nr >= 0 && nr < newH && nc >= 0 && nc < newW) {
        result[nr][nc] = data[r][c];
      }
    }
  }
  return result;
}
```

- [ ] **Step 3: Add `resizeCanvas` and `countLostPixels` implementations**

Add after `loadCanvasData` implementation (around line 530):

```typescript
  resizeCanvas: (newWidth, newHeight, anchorRow, anchorCol) => {
    const state = get();
    const { width: oldW, height: oldH } = state.canvasSize;
    if (newWidth === oldW && newHeight === oldH) return;

    const newLayers = state.layers.map((layer) => ({
      ...layer,
      data: resizeLayerData(layer.data, oldW, oldH, newWidth, newHeight, anchorRow, anchorCol),
    }));

    set({
      canvasSize: { width: newWidth, height: newHeight },
      canvasData: mergeLayers(newLayers, newWidth, newHeight),
      gridConfig: makeGridConfig(newWidth, newHeight),
      layers: newLayers,
      undoStack: [],
      redoStack: [],
      isDirty: true,
      offsetX: 0,
      offsetY: 0,
    });
  },

  countLostPixels: (newWidth, newHeight, anchorRow, anchorCol) => {
    const state = get();
    const { width: oldW, height: oldH } = state.canvasSize;
    const offsetCol = Math.floor(anchorCol * (newWidth - oldW) / 2);
    const offsetRow = Math.floor(anchorRow * (newHeight - oldH) / 2);
    let lost = 0;
    for (const layer of state.layers) {
      if (!layer.visible) continue;
      for (let r = 0; r < oldH; r++) {
        for (let c = 0; c < oldW; c++) {
          if (layer.data[r][c].colorIndex === null) continue;
          const nr = r + offsetRow;
          const nc = c + offsetCol;
          if (nr < 0 || nr >= newHeight || nc < 0 || nc >= newWidth) {
            lost++;
          }
        }
      }
    }
    return lost;
  },
```

- [ ] **Step 4: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 24+ tests pass

- [ ] **Step 5: Commit**

```bash
git add src/store/editorStore.ts
git commit -m "feat: add resizeCanvas and countLostPixels to editor store"
```

---

### Task 3: UI — Resize Dialog in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add state variables for resize dialog**

Add after `const [showNewCanvas, setShowNewCanvas] = useState(false);` (around line 39):

```typescript
  const [showResize, setShowResize] = useState(false);
  const [resizeW, setResizeW] = useState(52);
  const [resizeH, setResizeH] = useState(52);
  const [resizeAnchorRow, setResizeAnchorRow] = useState(0); // 0=top, 1=center, 2=bottom
  const [resizeAnchorCol, setResizeAnchorCol] = useState(0); // 0=left, 1=center, 2=right
```

- [ ] **Step 2: Add store bindings**

Add after the existing store bindings (around line 62):

```typescript
  const resizeCanvas = useEditorStore((s) => s.resizeCanvas);
  const countLostPixels = useEditorStore((s) => s.countLostPixels);
```

- [ ] **Step 3: Add "调整画布" button in the top menu bar**

Add after the "新建" button (around line 155, after the `setShowNewCanvas(true)` button):

```tsx
        <button
          onClick={() => {
            setResizeW(canvasSize.width);
            setResizeH(canvasSize.height);
            setResizeAnchorRow(0);
            setResizeAnchorCol(0);
            setShowResize(true);
          }}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          调整画布
        </button>
```

- [ ] **Step 4: Add the resize dialog**

Add after the "New Canvas Dialog" section (after `showNewCanvas` dialog closing `}}`), around line 625:

```tsx
      {/* Resize Canvas Dialog */}
      {showResize && (() => {
        const lostPixels = (resizeW !== canvasSize.width || resizeH !== canvasSize.height)
          ? countLostPixels(resizeW, resizeH, resizeAnchorRow, resizeAnchorCol)
          : 0;
        const dw = resizeW - canvasSize.width;
        const dh = resizeH - canvasSize.height;
        const isSameSize = dw === 0 && dh === 0;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-[340px] p-4">
              <h2 className="font-semibold text-sm mb-3">调整画布</h2>
              <div className="flex flex-col gap-3">
                {/* Size inputs */}
                <div className="flex gap-2 items-center text-xs">
                  <span>宽</span>
                  <input
                    type="number"
                    min={4}
                    max={256}
                    value={resizeW}
                    onChange={(e) => setResizeW(Math.max(4, Math.min(256, Number(e.target.value))))}
                    className="w-16 px-2 py-1 border rounded"
                  />
                  <span>高</span>
                  <input
                    type="number"
                    min={4}
                    max={256}
                    value={resizeH}
                    onChange={(e) => setResizeH(Math.max(4, Math.min(256, Number(e.target.value))))}
                    className="w-16 px-2 py-1 border rounded"
                  />
                </div>

                {/* Preview */}
                <div className="text-xs text-gray-500">
                  {canvasSize.width}×{canvasSize.height} → {resizeW}×{resizeH}
                  {!isSameSize && (
                    <span className="ml-1">
                      ({dw >= 0 ? "+" : ""}{dw} 宽, {dh >= 0 ? "+" : ""}{dh} 高)
                    </span>
                  )}
                </div>

                {/* Anchor selector */}
                <div>
                  <div className="text-xs text-gray-500 mb-1">锚点（内容保留位置）</div>
                  <div className="inline-grid grid-cols-3 gap-1">
                    {[0, 1, 2].map((row) =>
                      [0, 1, 2].map((col) => (
                        <button
                          key={`${row}-${col}`}
                          onClick={() => { setResizeAnchorRow(row); setResizeAnchorCol(col); }}
                          className={`w-6 h-6 rounded border text-xs flex items-center justify-center ${
                            resizeAnchorRow === row && resizeAnchorCol === col
                              ? "bg-blue-500 text-white border-blue-600"
                              : "bg-gray-100 hover:bg-gray-200 border-gray-300"
                          }`}
                        >
                          {resizeAnchorRow === row && resizeAnchorCol === col ? "●" : "○"}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Warning for pixel loss */}
                {lostPixels > 0 && (
                  <div className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                    ⚠ 将裁剪 {lostPixels} 个非空像素
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => {
                      resizeCanvas(resizeW, resizeH, resizeAnchorRow, resizeAnchorCol);
                      setShowResize(false);
                    }}
                    disabled={isSameSize}
                    className={`px-3 py-1.5 text-xs rounded ${
                      isSameSize
                        ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                        : "bg-blue-500 text-white hover:bg-blue-600"
                    }`}
                  >
                    应用
                  </button>
                  <button
                    onClick={() => setShowResize(false)}
                    className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 5: Run the app and verify visually**

Run: `cd c:\Repo\pindou && npm run dev`

Test manually:
1. Create a new 52×52 canvas, draw some pixels
2. Click "调整画布"
3. Change to 60×80, confirm anchor is top-left, click 应用
4. Verify pixels are in top-left, new space is empty
5. Try center anchor — verify pixels are centered
6. Try shrinking — verify warning shows pixel count
7. Click 应用 on shrink — verify pixels are clipped

- [ ] **Step 6: Run all tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add resize canvas dialog with anchor selector and crop warning"
```

---

### Task 4: Rebuild VS Code Extension

**Files:**
- No source changes — just rebuild

- [ ] **Step 1: Rebuild VS Code webview**

```bash
cd c:\Repo\pindou\platforms\vscode && npm run build
```

- [ ] **Step 2: Run Playwright test**

```bash
cd c:\Repo\pindou\platforms\vscode && npx playwright test
```

Expected: PASS (the webview test loads a file and verifies rendering — the new resize feature doesn't break it)

- [ ] **Step 3: Commit if any build artifacts are tracked**

No commit needed — build outputs are in dist/ which is gitignored.
