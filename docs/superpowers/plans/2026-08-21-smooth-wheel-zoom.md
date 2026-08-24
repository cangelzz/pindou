# Smooth Wheel Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为共享主编辑器增加实时、连续、以鼠标指针为中心的滚轮缩放，使标准滚轮一格约变化 10%，同时保持普通滚轮和 `Ctrl/Cmd + 滚轮`在 Desktop、浏览器扩展和 VS Code webview 中一致可用。

**Architecture:** 将 wheel 输入归一化、指数倍率、边界限制和指针锚定封装到无 DOM/store 依赖的纯函数 `wheelZoom.ts`，先通过 Vitest 锁定数学行为。Editor store 改为保存浮点 `cellSize`，`PixelCanvas`只负责从 DOM 采集事件数据、调用纯函数并更新视图状态；VS Code Playwright 再验证真实 wheel 事件、默认行为阻止和画布范围隔离。

**Tech Stack:** React 19、TypeScript、Zustand 5、HTML Canvas、Vitest 4、Playwright 1.59/1.62、Vite 6

---

## 文件结构

- Create: `src/components/Canvas/wheelZoom.ts`
  - 只负责 wheel delta 归一化、指数缩放和指针锚定计算。
  - 不读取 DOM、不读取 Zustand，不产生副作用。
- Create: `src/components/Canvas/wheelZoom.test.ts`
  - 覆盖方向、10% 灵敏度、触控板细粒度、`deltaMode`、异常输入、单事件限制、边界和锚点。
- Create: `src/store/editorStore.zoom.test.ts`
  - 覆盖 store 的浮点 `cellSize`、上下限、无效输入、`fitToWindow`一致性和 dirty 状态。
- Modify: `src/store/editorStore.ts:700-715`
  - 移除 `cellSize`整数取整，并拒绝非有限 zoom。
- Modify: `src/components/Canvas/PixelCanvas.tsx:42-55,810-833,1533-1560`
  - 订阅 `setZoom`，新增局部 `onWheel`处理器并应用纯函数结果。
- Create: `platforms/vscode/tests/canvas-zoom.spec.ts`
  - 在真实共享 webview bundle 中验证 wheel DOM wiring、实时连续变化、锚点、边界、dirty 和画布外隔离。
- Modify only if regression fails: `src/utils/canvasRenderer.ts:77-87,211-263`
  - 浮点格距本身应被现有 renderer 接受；不要预先改动。只有既有 renderer 测试或新增的实际断言暴露错误时才进行最小修复并补测试。

## 固定数学参数

实现中使用以下单一来源常量，避免测试与产品代码各自猜测：

```ts
export const BASE_CELL_SIZE = 16;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 40;
export const WHEEL_LINE_HEIGHT = 40;
export const MAX_WHEEL_DELTA_PX = 240;
export const WHEEL_SENSITIVITY = Math.log(1.1) / 100;
```

含义：归一化后的 `-100px` 输入恰好放大约 `1.1×`，`+100px` 输入缩小约 `÷1.1`；单事件最多按 `240px`计算，避免异常输入跳变。

---

### Task 1: 以 TDD 实现纯滚轮缩放数学

**Files:**
- Create: `src/components/Canvas/wheelZoom.test.ts`
- Create: `src/components/Canvas/wheelZoom.ts`

- [ ] **Step 1: 创建失败测试，锁定方向、速度和细粒度行为**

创建 `src/components/Canvas/wheelZoom.test.ts`：

```ts
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

  it("caps a single event and rejects non-finite values", () => {
    expect(normalizeWheelDelta(10_000, 0, 600)).toBe(240);
    expect(normalizeWheelDelta(-10_000, 0, 600)).toBe(-240);
    expect(normalizeWheelDelta(Number.NaN, 0, 600)).toBe(0);
    expect(normalizeWheelDelta(1, 2, Number.NaN)).toBe(0);
  });
});

describe("computeWheelZoom", () => {
  it("zooms in for negative delta and out for positive delta", () => {
    expect(computeWheelZoom({ ...baseInput, deltaY: -100 }).zoom).toBeCloseTo(1.1, 10);
    expect(computeWheelZoom({ ...baseInput, deltaY: 100 }).zoom).toBeCloseTo(1 / 1.1, 10);
  });

  it("uses fine-grained exponential changes for trackpads", () => {
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
    expect(computeWheelZoom({ ...baseInput, cellSize: 0, deltaY: -100 })).toEqual({
      ...current,
      cellSize: 0,
    });
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run:

```bash
npm test -- src/components/Canvas/wheelZoom.test.ts
```

Expected: FAIL，错误包含 `Failed to resolve import "./wheelZoom"` 或模块不存在。

- [ ] **Step 3: 创建最小纯函数实现**

创建 `src/components/Canvas/wheelZoom.ts`：

```ts
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

export function normalizeWheelDelta(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (!Number.isFinite(deltaY)) return 0;

  let pixels = deltaY;
  if (deltaMode === 1) pixels *= WHEEL_LINE_HEIGHT;
  else if (deltaMode === 2) {
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
```

- [ ] **Step 4: 运行纯函数测试并确认通过**

Run:

```bash
npm test -- src/components/Canvas/wheelZoom.test.ts
```

Expected: PASS，`7 tests passed`。

- [ ] **Step 5: 提交纯函数及测试**

```bash
git add src/components/Canvas/wheelZoom.ts src/components/Canvas/wheelZoom.test.ts
git commit -m "feat: add smooth wheel zoom math" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 让 editor store 保留浮点视图精度

**Files:**
- Create: `src/store/editorStore.zoom.test.ts`
- Modify: `src/store/editorStore.ts:700-715`
- Verify: `src/store/projectIntegrity.test.ts:140-145`

- [ ] **Step 1: 添加 store 失败测试**

创建 `src/store/editorStore.zoom.test.ts`：

```ts
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

let useEditorStore: typeof import("./editorStore").useEditorStore;
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
  ({ useEditorStore } = await import("./editorStore"));
});

beforeEach(() => {
  memory.clear();
  useEditorStore.getState().newCanvas(10, 8);
  useEditorStore.setState({ isDirty: false });
});

describe("editor zoom precision", () => {
  it("keeps a floating-point cell size in setZoom", () => {
    useEditorStore.getState().setZoom(1.03125);
    expect(useEditorStore.getState()).toMatchObject({
      zoom: 1.03125,
      cellSize: 16.5,
      isDirty: false,
    });
  });

  it("clamps zoom and ignores non-finite values", () => {
    useEditorStore.getState().setZoom(100);
    expect(useEditorStore.getState()).toMatchObject({ zoom: 40, cellSize: 640 });
    useEditorStore.getState().setZoom(0.01);
    expect(useEditorStore.getState()).toMatchObject({ zoom: 0.5, cellSize: 8 });
    const before = useEditorStore.getState();
    useEditorStore.getState().setZoom(Number.NaN);
    expect(useEditorStore.getState()).toMatchObject({
      zoom: before.zoom,
      cellSize: before.cellSize,
    });
  });

  it("uses the same floating-point size when fitting to the window", () => {
    useEditorStore.getState().fitToWindow(203, 163);
    const state = useEditorStore.getState();
    expect(state.cellSize).toBeCloseTo(16 * state.zoom, 10);
    expect(state.offsetX).toBeCloseTo((203 - 10 * state.cellSize) / 2, 10);
    expect(state.offsetY).toBeCloseTo((163 - 8 * state.cellSize) / 2, 10);
    expect(state.isDirty).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试，确认整数取整断言失败**

Run:

```bash
npm test -- src/store/editorStore.zoom.test.ts
```

Expected: FAIL；首个测试应显示当前 `cellSize`为 `17`而不是 `16.5`，无效 zoom 测试也会暴露 `NaN`污染状态。

- [ ] **Step 3: 最小修改 store 的缩放动作**

在 `src/store/editorStore.ts:700-715` 将实现改为：

```ts
  setZoom: (zoom) => {
    if (!Number.isFinite(zoom)) return;
    const clamped = Math.max(0.5, Math.min(40, zoom));
    set({ zoom: clamped, cellSize: 16 * clamped });
  },

  fitToWindow: (containerW, containerH) => {
    const state = get();
    const { width, height } = state.canvasSize;
    const padding = 20; // px margin
    const zoomX = (containerW - padding * 2) / (width * 16);
    const zoomY = (containerH - padding * 2) / (height * 16);
    const zoom = Math.max(0.5, Math.min(40, Math.min(zoomX, zoomY)));
    const cellSize = 16 * zoom;
    const offsetX = (containerW - width * cellSize) / 2;
    const offsetY = (containerH - height * cellSize) / 2;
    set({ zoom, cellSize, offsetX, offsetY });
  },
```

不要改变 `CanvasToolbar.tsx:214-249`，工具栏继续使用 `1.25×`、`÷1.25`、1:1 和适应窗口。

- [ ] **Step 4: 运行聚焦测试和既有 dirty 回归测试**

Run:

```bash
npm test -- src/store/editorStore.zoom.test.ts src/store/projectIntegrity.test.ts
```

Expected: PASS；新增 3 个测试及 `projectIntegrity.test.ts`全部通过。

- [ ] **Step 5: 运行 renderer 与选择几何单测，确认浮点尺寸没有破坏共享计算**

Run:

```bash
npm test -- src/utils/canvasRenderer.test.ts src/utils/selectionResize.test.ts src/utils/blueprintDecorations.test.ts src/utils/blueprintLegend.test.ts
```

Expected: PASS。若失败，只修复与浮点 `cellSize`直接相关的断言或计算；不得将 `cellSize`重新取整。任何修复都必须先增加能复现问题的测试。

- [ ] **Step 6: 提交 store 精度修改**

```bash
git add src/store/editorStore.ts src/store/editorStore.zoom.test.ts
git commit -m "fix: preserve continuous canvas zoom precision" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 在共享 PixelCanvas 接入局部 wheel 事件

**Files:**
- Modify: `src/components/Canvas/PixelCanvas.tsx:1-55,810-833,1533-1560`
- Test: `src/components/Canvas/wheelZoom.test.ts`

- [ ] **Step 1: 先扩展纯函数测试，锁定边界附近的部分缩放仍保持锚点**

在 `src/components/Canvas/wheelZoom.test.ts` 的 `computeWheelZoom` describe 内添加：

```ts
  it("anchors the pointer using the clamped zoom near a boundary", () => {
    const input = {
      ...baseInput,
      zoom: 39.9,
      cellSize: BASE_CELL_SIZE * 39.9,
      deltaY: -100,
    };
    const next = computeWheelZoom(input);
    expect(next.zoom).toBe(MAX_ZOOM);
    expect((input.pointerX - next.offsetX) / next.cellSize).toBeCloseTo(
      (input.pointerX - input.offsetX) / input.cellSize,
      10,
    );
  });
```

- [ ] **Step 2: 运行测试确认当前纯函数已满足该接入前置条件**

Run:

```bash
npm test -- src/components/Canvas/wheelZoom.test.ts
```

Expected: PASS。该测试是接入前的契约保护，不需要为制造红灯而破坏已有正确实现。

- [ ] **Step 3: 导入纯函数并订阅 `setZoom`**

在 `src/components/Canvas/PixelCanvas.tsx` import 区加入：

```ts
import { computeWheelZoom } from "./wheelZoom";
```

在现有 selector 区，紧邻 `setOffset`加入：

```ts
  const setZoom = useEditorStore((s) => s.setZoom);
```

- [ ] **Step 4: 在坐标换算附近添加 wheel handler**

在 `screenToCell`之前添加：

```ts
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (event.deltaY === 0 || !Number.isFinite(event.deltaY)) return;

      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const next = computeWheelZoom({
        zoom,
        cellSize,
        offsetX,
        offsetY,
        pointerX: event.clientX - rect.left,
        pointerY: event.clientY - rect.top,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        pageHeight: rect.height,
      });

      if (next.zoom === zoom) return;
      setZoom(next.zoom);
      setOffset(next.offsetX, next.offsetY);
    },
    [zoom, cellSize, offsetX, offsetY, setZoom, setOffset],
  );
```

说明：`React.WheelEvent`可通过已启用的 React JSX 类型命名空间使用，不必把默认 React 对象引入运行时代码。若 TypeScript 配置不暴露 `React`命名空间，则将第 1 行改为：

```ts
import { useRef, useEffect, useCallback, useState, useMemo, type WheelEvent } from "react";
```

并把参数类型改为：

```ts
(event: WheelEvent<HTMLDivElement>) => {
```

只采用其中一种写法，不同时保留两种。

- [ ] **Step 5: 仅在画布容器绑定 handler**

在 `data-canvas-container`元素现有事件属性中加入：

```tsx
        onWheel={handleWheel}
```

放在 `onMouseLeave`和 `onDoubleClick`之间即可。不要监听 `window`、`document`或外层 App。

- [ ] **Step 6: 运行类型检查、构建和根单测**

Run:

```bash
npm run build
npm test -- src/components/Canvas/wheelZoom.test.ts src/store/editorStore.zoom.test.ts src/utils/canvasRenderer.test.ts src/utils/selectionResize.test.ts
```

Expected: `tsc && vite build`成功，全部指定测试 PASS。

- [ ] **Step 7: 提交共享画布接入**

```bash
git add src/components/Canvas/PixelCanvas.tsx src/components/Canvas/wheelZoom.test.ts
git commit -m "feat: add pointer-anchored wheel zoom" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 用 VS Code Playwright 验证真实 wheel 行为

**Files:**
- Create: `platforms/vscode/tests/canvas-zoom.spec.ts`
- Verify: `platforms/vscode/tests/selection-actions.spec.ts:633-667`
- Verify: `platforms/vscode/tests/selection-resize.spec.ts`

- [ ] **Step 1: 创建端到端 wheel 行为测试**

创建 `platforms/vscode/tests/canvas-zoom.spec.ts`：

```ts
import { test, expect, type Page } from "@playwright/test";
import {
  callAction,
  cleanupHarness,
  getStoreState,
  loadProject,
  setStoreState,
  setupPage,
} from "./helpers";

async function dispatchWheel(
  page: Page,
  options: { deltaY: number; ctrlKey?: boolean; xRatio?: number; yRatio?: number },
) {
  return page.evaluate(({ deltaY, ctrlKey, xRatio, yRatio }) => {
    const element = document.querySelector<HTMLElement>("[data-canvas-container]");
    if (!element) throw new Error("canvas container not found");
    const rect = element.getBoundingClientRect();
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width * xRatio,
      clientY: rect.top + rect.height * yRatio,
      deltaY,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      ctrlKey,
    });
    const accepted = element.dispatchEvent(event);
    return {
      accepted,
      defaultPrevented: event.defaultPrevented,
      localX: rect.width * xRatio,
      localY: rect.height * yRatio,
    };
  }, {
    deltaY: options.deltaY,
    ctrlKey: options.ctrlKey ?? false,
    xRatio: options.xRatio ?? 0.5,
    yRatio: options.yRatio ?? 0.5,
  });
}

async function view(page: Page) {
  return page.evaluate(() => {
    const state = (window as any).__pindouStore.getState();
    return {
      zoom: state.zoom as number,
      cellSize: state.cellSize as number,
      offsetX: state.offsetX as number,
      offsetY: state.offsetY as number,
      isDirty: state.isDirty as boolean,
    };
  });
}

test.describe("Canvas smooth wheel zoom", () => {
  test.afterAll(() => cleanupHarness());

  test.beforeEach(async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "setZoom", [1]);
    await setStoreState(page, { offsetX: 100, offsetY: 80, isDirty: false });
  });

  test("ordinary wheel zooms smoothly and prevents the default action", async ({ page }) => {
    const event = await dispatchWheel(page, { deltaY: -100 });
    const after = await view(page);
    expect(event).toMatchObject({ accepted: false, defaultPrevented: true });
    expect(after.zoom).toBeCloseTo(1.1, 5);
    expect(after.zoom).toBeLessThan(1.25);
    expect(after.cellSize).toBeCloseTo(16 * after.zoom, 8);
    expect(after.isDirty).toBe(false);
  });

  test("small trackpad-like deltas update immediately without integer quantization", async ({ page }) => {
    await dispatchWheel(page, { deltaY: -5 });
    const first = await view(page);
    await dispatchWheel(page, { deltaY: -5 });
    const second = await view(page);
    expect(first.zoom).toBeGreaterThan(1);
    expect(first.zoom).toBeLessThan(1.01);
    expect(second.zoom).toBeGreaterThan(first.zoom);
    expect(Number.isInteger(first.cellSize)).toBe(false);
  });

  test("Ctrl+wheel follows the same path and keeps the pointer anchored", async ({ page }) => {
    const before = await view(page);
    const event = await dispatchWheel(page, {
      deltaY: -100,
      ctrlKey: true,
      xRatio: 0.75,
      yRatio: 0.3,
    });
    const after = await view(page);
    const beforeCanvasX = (event.localX - before.offsetX) / before.cellSize;
    const beforeCanvasY = (event.localY - before.offsetY) / before.cellSize;
    const afterCanvasX = (event.localX - after.offsetX) / after.cellSize;
    const afterCanvasY = (event.localY - after.offsetY) / after.cellSize;
    expect(event.defaultPrevented).toBe(true);
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(afterCanvasX).toBeCloseTo(beforeCanvasX, 7);
    expect(afterCanvasY).toBeCloseTo(beforeCanvasY, 7);
  });

  test("wheel outside the canvas does not change editor zoom", async ({ page }) => {
    const before = await getStoreState<number>(page, "zoom");
    await page.evaluate(() => {
      document.body.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
      }));
    });
    expect(await getStoreState<number>(page, "zoom")).toBe(before);
  });

  test("zoom boundaries do not drift the canvas offset", async ({ page }) => {
    await callAction(page, "setZoom", [40]);
    await setStoreState(page, { offsetX: 12.5, offsetY: 34.5 });
    await dispatchWheel(page, { deltaY: -100 });
    expect(await view(page)).toMatchObject({
      zoom: 40,
      offsetX: 12.5,
      offsetY: 34.5,
    });

    await callAction(page, "setZoom", [0.5]);
    await setStoreState(page, { offsetX: 22.5, offsetY: 44.5 });
    await dispatchWheel(page, { deltaY: 100 });
    expect(await view(page)).toMatchObject({
      zoom: 0.5,
      offsetX: 22.5,
      offsetY: 44.5,
    });
  });
});
```

- [ ] **Step 2: 在未重新构建 webview 前确认新测试失败或未发现新行为**

从 `platforms/vscode/`运行：

```bash
npx playwright test canvas-zoom.spec.ts
```

Expected: 如果 `dist/webview`仍是旧 bundle，则 FAIL，表现为 wheel 后 zoom 仍为 1 或 `defaultPrevented`为 false。若此前构建已更新 bundle，允许直接 PASS；DOM wiring 已由测试本身验证。

- [ ] **Step 3: 构建 VS Code webview 并运行聚焦 Playwright 测试**

从 `platforms/vscode/`运行：

```bash
npm run check:types
npm run build
npx playwright test canvas-zoom.spec.ts selection-actions.spec.ts selection-resize.spec.ts
```

Expected:

- host 与 webview TypeScript 检查通过；
- extension/webview 构建成功；
- `canvas-zoom.spec.ts`全部 PASS；
- 既有选择清除和 resize tests 全部 PASS，证明浮点 `cellSize`下命中与几何仍一致。

- [ ] **Step 4: 运行完整 VS Code webview 套件**

从 `platforms/vscode/`运行：

```bash
npm run test:webview
```

Expected: build 成功，Playwright webview suite 全部 PASS。若数量与 `CLAUDE.md`中的历史数字不同，以命令当次输出为准，不修改无关测试来追求旧数量。

- [ ] **Step 5: 提交 Playwright 覆盖**

```bash
git add platforms/vscode/tests/canvas-zoom.spec.ts
git commit -m "test: cover smooth canvas wheel zoom" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 全量验证与变更审查

**Files:**
- Verify: `src/components/Canvas/wheelZoom.ts`
- Verify: `src/components/Canvas/PixelCanvas.tsx`
- Verify: `src/store/editorStore.ts`
- Verify: `src/components/Canvas/wheelZoom.test.ts`
- Verify: `src/store/editorStore.zoom.test.ts`
- Verify: `platforms/vscode/tests/canvas-zoom.spec.ts`

- [ ] **Step 1: 运行根项目全量单测**

从仓库根目录运行：

```bash
npm test
```

Expected: Vitest 全部 PASS，无未处理 rejection 或 worker error。

- [ ] **Step 2: 运行根项目生产构建**

```bash
npm run build
```

Expected: TypeScript 和 Vite build 成功，无类型错误。

- [ ] **Step 3: 运行浏览器扩展共享 bundle 构建和验证**

```bash
npm run ext:build:chrome
npm run ext:build:edge
npm run ext:validate
```

Expected: Chrome/Edge bundle 均成功生成，manifest 和扩展 TypeScript 验证通过。此步骤证明共享 `PixelCanvas`修改可被两个扩展入口编译。

- [ ] **Step 4: 检查 diff 范围与格式**

```bash
git diff --check main...HEAD
git status --short
git diff --stat main...HEAD
```

Expected:

- `git diff --check`无输出；
- 只包含计划内源码、测试和设计/计划文档；
- 用户原有的 `.claude/skills/pindou-poster/scripts/make_poster.py`修改、`.claude/worktrees/`及 `scripts/__pycache__/`不被暂存或提交。

- [ ] **Step 5: 对照验收标准做最终人工检查**

启动项目时使用项目既有运行流程，不新增临时文件到仓库根目录。逐项确认：

```text
[ ] 普通滚轮向上/向下实时平滑缩放
[ ] 标准一格约 10%，明显小于工具栏 25%
[ ] Ctrl/Cmd + 滚轮不触发页面级缩放
[ ] 指针下的珠子保持原位
[ ] 触控板小幅输入每次都有连续变化
[ ] 0.5 和 40 边界无偏移漂移
[ ] 工具栏、平移、绘制、选择仍正常
[ ] 比较窗口和图纸导入窗口的独立 wheel 行为不受影响
```

- [ ] **Step 6: 如人工检查没有产生额外修改，则不创建空提交；如产生了必要修复，重新运行相关测试后提交**

修复提交格式：

```bash
git add <仅列出本次必要修复文件>
git commit -m "fix: stabilize smooth wheel zoom interactions" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

修复后必须重新运行 Task 5 Step 1～3，不得仅凭人工观察宣布完成。

---

## 实施注意事项

- 严禁把 wheel listener 提升到 `window`/`document`；只绑定 `[data-canvas-container]`。
- 不为 wheel 复用工具栏 `1.25×`档位。
- 不增加缓动、`requestAnimationFrame`、debounce、throttle 或 delta 累积器。
- 不把浮点 `cellSize`重新 `Math.round()`；工具栏百分比显示仍可取整。
- 不修改独立 H5 `BeadCanvas`或移动端触摸交互。
- 不在本功能中重构大型 `PixelCanvas`；仅抽离新的纯数学单元。
- 不触碰用户已有未提交文件或生成目录。
