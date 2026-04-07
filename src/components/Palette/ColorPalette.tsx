import { useState, useMemo } from "react";
import { MARD_COLORS } from "../../data/mard221";
import { useEditorStore } from "../../store/editorStore";

export function ColorPalette() {
  const selectedColorIndex = useEditorStore((s) => s.selectedColorIndex);
  const setSelectedColor = useEditorStore((s) => s.setSelectedColor);
  const setTool = useEditorStore((s) => s.setTool);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return MARD_COLORS.map((c, i) => ({ color: c, index: i }));
    const q = search.toLowerCase();
    return MARD_COLORS
      .map((c, i) => ({ color: c, index: i }))
      .filter(
        ({ color: c }) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.hex.toLowerCase().includes(q)
      );
  }, [search]);

  return (
    <div className="flex flex-col h-full select-none">
      <div className="px-2 py-1.5 border-b bg-gray-50">
        <h3 className="text-xs font-semibold text-gray-600 mb-1">MARD 221 色板</h3>
        <input
          type="text"
          placeholder="搜索色号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        <div className="grid grid-cols-5 gap-0.5">
          {filtered.map(({ color, index }) => {
            const isSelected = selectedColorIndex === index;
            return (
              <button
                key={color.code}
                onClick={() => {
                  setSelectedColor(index);
                  setTool("pen");
                }}
                className={`relative group aspect-square rounded-sm border transition-all
                  ${isSelected ? "ring-2 ring-blue-500 ring-offset-1 z-10" : "border-gray-200 hover:border-gray-400"}`}
                style={{ backgroundColor: color.hex || "#FFF" }}
                title={`${color.code} ${color.name}\n${color.hex}`}
              >
                {/* Tooltip on hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-gray-800 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-20">
                  {color.code} {color.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected color info */}
      {selectedColorIndex !== null && (
        <div className="px-2 py-1.5 border-t bg-gray-50 flex items-center gap-2 text-xs">
          <div
            className="w-6 h-6 rounded border border-gray-300"
            style={{ backgroundColor: MARD_COLORS[selectedColorIndex]?.hex }}
          />
          <div>
            <div className="font-semibold">{MARD_COLORS[selectedColorIndex]?.code}</div>
            <div className="text-gray-500">{MARD_COLORS[selectedColorIndex]?.name}</div>
            <div className="text-gray-400">{MARD_COLORS[selectedColorIndex]?.hex}</div>
          </div>
        </div>
      )}
    </div>
  );
}
