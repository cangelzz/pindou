import { useRef, useEffect, useState, useCallback } from "react";
import { useEditorStore } from "../../store/editorStore";
import { MARD_COLORS } from "../../data/mard221";

interface PreviewThumbnailProps {
  containerWidth: number;
  containerHeight: number;
}

export function PreviewThumbnail({ containerWidth, containerHeight }: PreviewThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasData = useEditorStore((s) => s.canvasData);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const layers = useEditorStore((s) => s.layers);
  const offsetX = useEditorStore((s) => s.offsetX);
  const offsetY = useEditorStore((s) => s.offsetY);
  const cellSize = useEditorStore((s) => s.cellSize);
  const blueprintMirror = useEditorStore((s) => s.blueprintMirror);
  const blueprintMode = useEditorStore((s) => s.blueprintMode);
  const setOffset = useEditorStore((s) => s.setOffset);

  const [pos, setPos] = useState({ x: 10, y: 10 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
  const [thumbSize, setThumbSize] = useState(200);
  const [showFull, setShowFull] = useState(true);

  const isMirror = blueprintMode && blueprintMirror;
  const cols = canvasSize.width;
  const rows = canvasSize.height;

  // Thumbnail pixel dimensions
  const aspect = cols / rows;
  const thumbW = aspect >= 1 ? thumbSize : Math.round(thumbSize * aspect);
  const thumbH = aspect >= 1 ? Math.round(thumbSize / aspect) : thumbSize;
  const sx = thumbW / cols;
  const sy = thumbH / rows;

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(0, 0, thumbW, thumbH);

    if (showFull) {
      for (const layer of layers) {
        if (!layer.visible) continue;
        ctx.globalAlpha = layer.opacity;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const sc = isMirror ? cols - 1 - c : c;
            const cell = layer.data[r]?.[sc];
            if (cell?.colorIndex != null) {
              const color = MARD_COLORS[cell.colorIndex];
              if (color) {
                ctx.fillStyle = color.hex;
                const px = Math.floor(c * sx);
                const py = Math.floor(r * sy);
                const pw = Math.ceil((c + 1) * sx) - px;
                const ph = Math.ceil((r + 1) * sy) - py;
                ctx.fillRect(px, py, pw, ph);
              }
            }
          }
        }
      }
      ctx.globalAlpha = 1;

      const vl = -offsetX / cellSize * sx;
      const vt = -offsetY / cellSize * sy;
      const vw = containerWidth / cellSize * sx;
      const vh = containerHeight / cellSize * sy;
      ctx.strokeStyle = "rgba(59,130,246,0.9)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vl, vt, vw, vh);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, thumbW, vt);
      ctx.fillRect(0, vt + vh, thumbW, thumbH - vt - vh);
      ctx.fillRect(0, vt, vl, vh);
      ctx.fillRect(vl + vw, vt, thumbW - vl - vw, vh);
    } else {
      const cc = Math.floor((-offsetX + containerWidth / 2) / cellSize);
      const cr = Math.floor((-offsetY + containerHeight / 2) / cellSize);
      const hw = Math.floor(thumbW / 2);
      const hh = Math.floor(thumbH / 2);
      for (let ty = 0; ty < thumbH; ty++) {
        for (let tx = 0; tx < thumbW; tx++) {
          const c = cc - hw + tx;
          const r = cr - hh + ty;
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
          const sc = isMirror ? cols - 1 - c : c;
          const cell = canvasData[r]?.[sc];
          if (cell?.colorIndex != null) {
            ctx.fillStyle = MARD_COLORS[cell.colorIndex]?.hex ?? "#000";
            ctx.fillRect(tx, ty, 1, 1);
          }
        }
      }
    }
  }, [layers, canvasData, cols, rows, offsetX, offsetY, cellSize, containerWidth, containerHeight, thumbW, thumbH, sx, sy, showFull, isMirror]);

  const handleThumbClick = useCallback(
    (e: React.MouseEvent) => {
      if (!showFull) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setOffset(-(x / sx * cellSize - containerWidth / 2), -(y / sy * cellSize - containerHeight / 2));
    },
    [showFull, sx, sy, cellSize, containerWidth, containerHeight, setOffset]
  );

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      setIsDragging(true);
      dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y };
    },
    [pos]
  );

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      setPos({
        x: dragRef.current.startPosX + e.clientX - dragRef.current.startX,
        y: dragRef.current.startPosY + e.clientY - dragRef.current.startY,
      });
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isDragging]);

  return (
    <div
      className="absolute z-40 bg-white border border-gray-300 rounded shadow-lg select-none"
      style={{ left: pos.x, top: pos.y, cursor: isDragging ? "grabbing" : "default" }}
    >
      <div
        className="flex items-center px-1.5 py-0.5 bg-gray-100 border-b text-[10px] text-gray-500 cursor-grab rounded-t"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-1">
          <button onClick={() => setThumbSize((s) => Math.max(80, s - 40))} className="px-1 hover:bg-gray-200 rounded" title="缩小">−</button>
          <button onClick={() => setThumbSize((s) => Math.min(600, s + 40))} className="px-1 hover:bg-gray-200 rounded" title="放大">+</button>
          <button onClick={() => setShowFull(!showFull)} className="px-1 hover:bg-gray-200 rounded" title={showFull ? "局部放大" : "全局缩略"}>
            {showFull ? "🔍" : "🗺️"}
          </button>
        </div>
        <span className="flex-1 text-center">预览</span>
      </div>
      <canvas
        ref={canvasRef}
        width={thumbW}
        height={thumbH}
        className="block"
        style={{ imageRendering: "pixelated", cursor: showFull ? "crosshair" : "default" }}
        onClick={handleThumbClick}
      />
    </div>
  );
}
