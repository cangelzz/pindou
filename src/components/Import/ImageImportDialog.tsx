import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import { matchImageToMard } from "../../utils/colorMatching";
import { MARD_COLORS } from "../../data/mard221";
import type { ColorMatchAlgorithm, CanvasCell } from "../../types";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface PixelData {
  width: number;
  height: number;
  pixels: number[];
}

export function ImageImportDialog({ onClose }: { onClose: () => void }) {
  const loadCanvasData = useEditorStore((s) => s.loadCanvasData);

  const [filePath, setFilePath] = useState<string | null>(null);
  const [targetWidth, setTargetWidth] = useState(52);
  const [targetHeight, setTargetHeight] = useState(52);
  const [algorithm, setAlgorithm] = useState<ColorMatchAlgorithm>("ciede2000");
  const [isProcessing, setIsProcessing] = useState(false);
  const [preview, setPreview] = useState<number[] | null>(null);

  const handleSelectFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Image",
          extensions: ["png", "jpg", "jpeg", "bmp", "gif", "webp"],
        },
      ],
    });
    if (selected) {
      setFilePath(selected as string);
      setPreview(null);
    }
  };

  const handlePreview = async () => {
    if (!filePath) return;
    setIsProcessing(true);
    try {
      const data = await invoke<PixelData>("import_image", {
        path: filePath,
        targetWidth,
        targetHeight,
      });
      const matched = matchImageToMard(data.pixels, algorithm);
      setPreview(matched);
    } catch (e) {
      alert(`导入失败: ${e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirm = () => {
    if (!preview) return;

    const canvasData: CanvasCell[][] = [];
    for (let row = 0; row < targetHeight; row++) {
      const rowData: CanvasCell[] = [];
      for (let col = 0; col < targetWidth; col++) {
        const idx = row * targetWidth + col;
        rowData.push({ colorIndex: preview[idx] });
      }
      canvasData.push(rowData);
    }

    loadCanvasData(canvasData, { width: targetWidth, height: targetHeight });
    onClose();
  };

  const sizePresets = [
    { label: "52×52 (中号板)", w: 52, h: 52 },
    { label: "104×104 (大号板)", w: 104, h: 104 },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-sm">导入图片</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          {/* File selection */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">图片文件</label>
            <div className="flex gap-2">
              <button
                onClick={handleSelectFile}
                className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
              >
                选择文件
              </button>
              <span className="text-xs text-gray-500 self-center truncate flex-1">
                {filePath || "未选择"}
              </span>
            </div>
          </div>

          {/* Target size */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">目标尺寸</label>
            <div className="flex gap-2 mb-1">
              {sizePresets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setTargetWidth(p.w); setTargetHeight(p.h); }}
                  className={`px-2 py-1 text-xs rounded border ${
                    targetWidth === p.w && targetHeight === p.h
                      ? "bg-blue-100 border-blue-400"
                      : "hover:bg-gray-100"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                min={4}
                max={256}
                value={targetWidth}
                onChange={(e) => setTargetWidth(Number(e.target.value))}
                className="w-16 px-2 py-1 text-xs border rounded"
              />
              <span className="text-gray-400">×</span>
              <input
                type="number"
                min={4}
                max={256}
                value={targetHeight}
                onChange={(e) => setTargetHeight(Number(e.target.value))}
                className="w-16 px-2 py-1 text-xs border rounded"
              />
            </div>
          </div>

          {/* Algorithm */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">颜色匹配算法</label>
            <div className="flex gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="algo"
                  checked={algorithm === "ciede2000"}
                  onChange={() => setAlgorithm("ciede2000")}
                />
                CIELAB ΔE (推荐)
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="algo"
                  checked={algorithm === "euclidean"}
                  onChange={() => setAlgorithm("euclidean")}
                />
                Euclidean (RGB)
              </label>
            </div>
          </div>

          {/* Preview / Confirm */}
          <div className="flex gap-2">
            <button
              onClick={handlePreview}
              disabled={!filePath || isProcessing}
              className="px-3 py-1.5 bg-gray-600 text-white text-xs rounded hover:bg-gray-700 disabled:opacity-40"
            >
              {isProcessing ? "处理中..." : "预览匹配结果"}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!preview}
              className="px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-40"
            >
              确认导入
            </button>
          </div>

          {/* Preview grid */}
          {preview && (
            <div className="border rounded p-2 bg-gray-50">
              <p className="text-[10px] text-gray-500 mb-1">
                预览 ({targetWidth}×{targetHeight}):
              </p>
              <canvas
                ref={(canvas) => {
                  if (!canvas || !preview) return;
                  canvas.width = targetWidth;
                  canvas.height = targetHeight;
                  const ctx = canvas.getContext("2d");
                  if (!ctx) return;

                  for (let row = 0; row < targetHeight; row++) {
                    for (let col = 0; col < targetWidth; col++) {
                      const idx = preview[row * targetWidth + col];
                      const color = MARD_COLORS[idx];
                      ctx.fillStyle = color?.hex || "#FFF";
                      ctx.fillRect(col, row, 1, 1);
                    }
                  }
                }}
                style={{
                  width: Math.min(400, targetWidth * 4),
                  height: Math.min(400, targetHeight * 4),
                  imageRendering: "pixelated",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
