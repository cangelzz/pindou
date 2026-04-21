import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { useEditorStore } from "../../store/editorStore";
import { getEffectiveHex } from "../../utils/colorHelper";
import type { CanvasData } from "../../types";
import type { ColorOverrideMap } from "../../utils/colorHelper";

const MIN_CANVAS = 200;
const MAX_CANVAS = 600;

function renderView(
  canvas: HTMLCanvasElement,
  data: CanvasData,
  gridW: number,
  gridH: number,
  zoom: number,
  panX: number,
  panY: number,
  colorOverrides: ColorOverrideMap,
  viewSize: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = viewSize;
  canvas.height = viewSize;

  ctx.fillStyle = "#e5e5e5";
  ctx.fillRect(0, 0, viewSize, viewSize);

  const cellSize = zoom;
  const startCol = Math.max(0, Math.floor(-panX / cellSize));
  const startRow = Math.max(0, Math.floor(-panY / cellSize));
  const endCol = Math.min(gridW, Math.ceil((viewSize - panX) / cellSize));
  const endRow = Math.min(gridH, Math.ceil((viewSize - panY) / cellSize));

  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      const cell = data[r]?.[c];
      if (cell?.colorIndex != null) {
        ctx.fillStyle = getEffectiveHex(cell.colorIndex, colorOverrides);
        ctx.fillRect(c * cellSize + panX, r * cellSize + panY, cellSize, cellSize);
      }
    }
  }

  // Grid lines when zoomed in enough
  if (cellSize >= 8) {
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 0.5;
    for (let c = startCol; c <= endCol; c++) {
      const x = c * cellSize + panX;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, viewSize); ctx.stroke();
    }
    for (let r = startRow; r <= endRow; r++) {
      const y = r * cellSize + panY;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(viewSize, y); ctx.stroke();
    }
  }
}

export function ChangesCompareDialog({ onClose }: { onClose: () => void }) {
  const canvasData = useEditorStore((s) => s.canvasData);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const baselineCanvasData = useEditorStore((s) => s.baselineCanvasData);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);

  const baselineRef = useRef<HTMLCanvasElement>(null);
  const currentRef = useRef<HTMLCanvasElement>(null);

  const [viewSize, setViewSize] = useState(320);

  // Shared zoom & pan
  const fitZoom = Math.min(viewSize / canvasSize.width, viewSize / canvasSize.height);
  const [zoom, setZoom] = useState(fitZoom);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  // Center on mount
  useEffect(() => {
    const z = Math.min(viewSize / canvasSize.width, viewSize / canvasSize.height);
    setZoom(z);
    setPanX((viewSize - canvasSize.width * z) / 2);
    setPanY((viewSize - canvasSize.height * z) / 2);
  }, [canvasSize, viewSize]);

  const stats = useMemo(() => {
    if (!baselineCanvasData) return { added: 0, removed: 0, modified: 0 };
    let added = 0, removed = 0, modified = 0;
    for (let r = 0; r < canvasSize.height; r++) {
      for (let c = 0; c < canvasSize.width; c++) {
        const base = baselineCanvasData[r]?.[c]?.colorIndex ?? null;
        const curr = canvasData[r]?.[c]?.colorIndex ?? null;
        if (base === curr) continue;
        if (base === null) added++;
        else if (curr === null) removed++;
        else modified++;
      }
    }
    return { added, removed, modified };
  }, [canvasData, baselineCanvasData, canvasSize]);

  // Render both canvases
  useEffect(() => {
    if (baselineRef.current && baselineCanvasData) {
      renderView(baselineRef.current, baselineCanvasData, canvasSize.width, canvasSize.height, zoom, panX, panY, colorOverrides, viewSize);
    }
    if (currentRef.current) {
      renderView(currentRef.current, canvasData, canvasSize.width, canvasSize.height, zoom, panX, panY, colorOverrides, viewSize);
    }
  }, [canvasData, baselineCanvasData, canvasSize, colorOverrides, zoom, panX, panY, viewSize]);

  // Mouse drag (synced on both canvases)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
  }, [panX, panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setPanX(dragStart.current.px + (e.clientX - dragStart.current.x));
    setPanY(dragStart.current.py + (e.clientY - dragStart.current.y));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Scroll to zoom (synced)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.5, Math.min(50, zoom * factor));
    setPanX(mx - (mx - panX) * (newZoom / zoom));
    setPanY(my - (my - panY) * (newZoom / zoom));
    setZoom(newZoom);
  }, [zoom, panX, panY]);

  const total = stats.added + stats.removed + stats.modified;
  const zoomPct = Math.round((zoom / fitZoom) * 100);

  const canvasProps = {
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseUp,
    onWheel: handleWheel,
    style: { width: viewSize, height: viewSize, cursor: isDragging.current ? "grabbing" : "grab" } as React.CSSProperties,
    className: "border rounded",
  };

  // Dialog resize handle
  const isResizing = useRef(false);
  const resizeStart = useRef({ x: 0, size: 0 });
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStart.current = { x: e.clientX, size: viewSize };
    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = ev.clientX - resizeStart.current.x;
      setViewSize(Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, resizeStart.current.size + delta / 2)));
    };
    const onUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [viewSize]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl relative" style={{ width: viewSize * 2 + 80 }}>
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-sm">变更对比</h2>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{zoomPct}%</span>
            <button
              onClick={() => {
                const z = fitZoom;
                setZoom(z);
                setPanX((viewSize - canvasSize.width * z) / 2);
                setPanY((viewSize - canvasSize.height * z) / 2);
              }}
              className="px-1.5 py-0.5 rounded border hover:bg-gray-100 text-[10px]"
            >
              适应
            </button>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="flex gap-4 p-4 justify-center">
          <div className="text-center">
            <div className="text-[10px] text-gray-500 mb-1">基准版本</div>
            <canvas ref={baselineRef} {...canvasProps} />
          </div>
          <div className="text-center">
            <div className="text-[10px] text-gray-500 mb-1">当前版本</div>
            <canvas ref={currentRef} {...canvasProps} />
          </div>
        </div>
        <div className="px-4 pb-3 flex items-center justify-between">
          <div className="flex gap-3 text-xs">
            {total === 0 ? (
              <span className="text-gray-400">无变更</span>
            ) : (
              <>
                {stats.added > 0 && <span className="text-green-600">+{stats.added} 新增</span>}
                {stats.removed > 0 && <span className="text-red-500">-{stats.removed} 删除</span>}
                {stats.modified > 0 && <span className="text-orange-500">~{stats.modified} 修改</span>}
                <span className="text-gray-400">共 {total} 处变更</span>
              </>
            )}
          </div>
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100">关闭</button>
        </div>
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{ background: "linear-gradient(135deg, transparent 50%, #ccc 50%)" }}
        />
      </div>
    </div>
  );
}
