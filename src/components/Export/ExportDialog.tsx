import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import { MARD_COLORS } from "../../data/mard221";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const canvasData = useEditorStore((s) => s.canvasData);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const importedFileName = useEditorStore((s) => s.importedFileName);

  const [cellSize, setCellSize] = useState(40);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [isExporting, setIsExporting] = useState(false);

  const outputWidth = canvasSize.width * cellSize;
  const outputHeight = canvasSize.height * cellSize;

  const defaultExportName = importedFileName
    ? `${importedFileName}_pindou_export.${format}`
    : `pindou_export.${format}`;

  const handleExport = async () => {
    const outputPath = await save({
      filters: [
        format === "png"
          ? { name: "PNG Image", extensions: ["png"] }
          : { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
      ],
      defaultPath: defaultExportName,
    });

    if (!outputPath) return;

    setIsExporting(true);
    try {
      const cells = canvasData.map((row) =>
        row.map((cell) => {
          if (cell.colorIndex === null) return null;
          const c = MARD_COLORS[cell.colorIndex];
          return c
            ? { color_code: c.code, r: c.rgb![0], g: c.rgb![1], b: c.rgb![2] }
            : null;
        })
      );

      await invoke("export_image", {
        request: {
          width: canvasSize.width,
          height: canvasSize.height,
          cell_size: cellSize,
          cells,
          output_path: outputPath,
          format,
        },
      });

      alert(`导出成功: ${outputPath}`);
      onClose();
    } catch (e) {
      alert(`导出失败: ${e}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[380px]">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-sm">导出高分辨率图片</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {/* Cell size */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">每像素大小 (px)</label>
            <input
              type="number"
              min={10}
              max={100}
              value={cellSize}
              onChange={(e) => setCellSize(Number(e.target.value))}
              className="w-20 px-2 py-1 text-xs border rounded"
            />
            <p className="text-[10px] text-gray-400 mt-0.5">
              输出尺寸: {outputWidth}×{outputHeight} px
            </p>
          </div>

          {/* Format */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">格式</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="format"
                  checked={format === "png"}
                  onChange={() => setFormat("png")}
                />
                PNG
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="format"
                  checked={format === "jpeg"}
                  onChange={() => setFormat("jpeg")}
                />
                JPEG
              </label>
            </div>
          </div>

          <p className="text-[10px] text-gray-500">
            每个格子将标注 MARD 色号，方便对照购买拼豆。
          </p>

          <button
            onClick={handleExport}
            disabled={isExporting}
            className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-40"
          >
            {isExporting ? "导出中..." : "导出"}
          </button>
        </div>
      </div>
    </div>
  );
}
