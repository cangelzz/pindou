import { useState } from "react";
import { PixelCanvas } from "./components/Canvas/PixelCanvas";
import { CanvasToolbar } from "./components/Canvas/CanvasToolbar";
import { ColorPalette } from "./components/Palette/ColorPalette";
import { BeadCounter } from "./components/Stats/BeadCounter";
import { ImageImportDialog } from "./components/Import/ImageImportDialog";
import { ExportDialog } from "./components/Export/ExportDialog";
import { useEditorStore } from "./store/editorStore";

function App() {
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showNewCanvas, setShowNewCanvas] = useState(false);
  const [rightTab, setRightTab] = useState<"palette" | "stats">("palette");

  const newCanvas = useEditorStore((s) => s.newCanvas);
  const isDirty = useEditorStore((s) => s.isDirty);

  const [newW, setNewW] = useState(52);
  const [newH, setNewH] = useState(52);

  return (
    <div className="flex flex-col h-screen bg-white text-gray-800">
      {/* Top menu bar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 border-b text-xs select-none">
        <span className="font-bold text-sm mr-2">🎨 拼豆编辑器</span>
        <button
          onClick={() => setShowNewCanvas(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          新建
        </button>
        <button
          onClick={() => setShowImport(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          导入图片
        </button>
        <button
          onClick={() => setShowExport(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          导出
        </button>
        {isDirty && <span className="text-orange-500 ml-2">● 未保存</span>}
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left toolbar */}
        <CanvasToolbar />

        {/* Center canvas */}
        <PixelCanvas />

        {/* Right panel */}
        <div className="flex flex-col w-56 border-l bg-white min-h-0">
          {/* Tabs */}
          <div className="flex border-b text-xs">
            <button
              onClick={() => setRightTab("palette")}
              className={`flex-1 py-1.5 ${
                rightTab === "palette"
                  ? "border-b-2 border-blue-500 text-blue-600 font-semibold"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              色板
            </button>
            <button
              onClick={() => setRightTab("stats")}
              className={`flex-1 py-1.5 ${
                rightTab === "stats"
                  ? "border-b-2 border-blue-500 text-blue-600 font-semibold"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              统计
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === "palette" ? <ColorPalette /> : <BeadCounter />}
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {showImport && <ImageImportDialog onClose={() => setShowImport(false)} />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}

      {/* New Canvas Dialog */}
      {showNewCanvas && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[320px] p-4">
            <h2 className="font-semibold text-sm mb-3">新建画布</h2>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                {[
                  { l: "52×52", w: 52, h: 52 },
                  { l: "104×104", w: 104, h: 104 },
                ].map((p) => (
                  <button
                    key={p.l}
                    onClick={() => { setNewW(p.w); setNewH(p.h); }}
                    className={`px-2 py-1 text-xs rounded border ${
                      newW === p.w && newH === p.h
                        ? "bg-blue-100 border-blue-400"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    {p.l}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center text-xs">
                <span>宽</span>
                <input
                  type="number"
                  min={4}
                  max={256}
                  value={newW}
                  onChange={(e) => setNewW(Number(e.target.value))}
                  className="w-16 px-2 py-1 border rounded"
                />
                <span>高</span>
                <input
                  type="number"
                  min={4}
                  max={256}
                  value={newH}
                  onChange={(e) => setNewH(Number(e.target.value))}
                  className="w-16 px-2 py-1 border rounded"
                />
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => {
                    newCanvas(newW, newH);
                    setShowNewCanvas(false);
                  }}
                  className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                >
                  创建
                </button>
                <button
                  onClick={() => setShowNewCanvas(false)}
                  className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
