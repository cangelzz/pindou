import { useState, useMemo } from "react";
import { MARD_COLORS, COLOR_GROUPS, getGroupIndices } from "../../data/mard221";
import { useEditorStore } from "../../store/editorStore";

/** Get series prefix from color code */
function getSeriesPrefix(code: string): string {
  const m = code.match(/^([A-Z]+)/);
  return m ? m[1] : "";
}

/** Compute contrasting text color for a given background */
function textColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 140 ? "#000000" : "#FFFFFF";
}

export function ColorPalette() {
  const selectedColorIndex = useEditorStore((s) => s.selectedColorIndex);
  const setSelectedColor = useEditorStore((s) => s.setSelectedColor);
  const setTool = useEditorStore((s) => s.setTool);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("mard221");

  // Group filtered items by series
  const grouped = useMemo(() => {
    const groupIndices = new Set(getGroupIndices(groupId));
    let items = MARD_COLORS
      .map((c, i) => ({ color: c, index: i }))
      .filter(({ index }) => groupIndices.has(index));

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        ({ color: c }) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.hex.toLowerCase().includes(q)
      );
    }

    // Group by series prefix
    const map = new Map<string, { color: typeof MARD_COLORS[0]; index: number }[]>();
    for (const item of items) {
      const prefix = getSeriesPrefix(item.color.code);
      if (!map.has(prefix)) map.set(prefix, []);
      map.get(prefix)!.push(item);
    }
    return map;
  }, [search, groupId]);

  const totalCount = useMemo(() => {
    let n = 0;
    grouped.forEach((v) => (n += v.length));
    return n;
  }, [grouped]);

  return (
    <div className="flex flex-col h-full select-none">
      <div className="px-2 py-1.5 border-b bg-gray-50">
        <div className="flex items-center gap-1 mb-1">
          <h3 className="text-xs font-semibold text-gray-600">色板</h3>
          <span className="text-[10px] text-gray-400">({totalCount})</span>
        </div>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="w-full px-1 py-0.5 text-xs border rounded mb-1"
        >
          {COLOR_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="搜索色号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {Array.from(grouped.entries()).map(([prefix, items], gi) => (
          <div key={prefix}>
            {gi > 0 && (
              <div className="flex items-center gap-1 my-1">
                <div className="flex-1 border-t border-gray-300" />
                <span className="text-[9px] text-gray-400 font-semibold">{prefix}</span>
                <div className="flex-1 border-t border-gray-300" />
              </div>
            )}
            {gi === 0 && (
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-[9px] text-gray-400 font-semibold">{prefix}</span>
                <div className="flex-1 border-t border-gray-300" />
              </div>
            )}
            <div className="flex flex-wrap gap-0.5">
              {items.map(({ color, index }) => {
                const isSelected = selectedColorIndex === index;
                return (
                  <button
                    key={color.code}
                    onClick={() => {
                      setSelectedColor(index);
                      setTool("pen");
                    }}
                    className={`flex items-center justify-center rounded-sm border transition-all
                      ${isSelected ? "ring-2 ring-blue-500 ring-offset-1 z-10" : "border-gray-200 hover:border-gray-400"}`}
                    style={{
                      backgroundColor: color.hex || "#FFF",
                      color: textColor(color.hex || "#FFF"),
                      width: 36,
                      height: 28,
                      fontSize: 8,
                      fontWeight: 600,
                      lineHeight: 1,
                    }}
                    title={`${color.code}\n${color.hex}\nRGB(${color.rgb?.join(", ")})`}
                  >
                    {color.code}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Selected color info */}
      {selectedColorIndex !== null && (
        <div className="px-2 py-1.5 border-t bg-gray-50 flex items-center gap-2 text-xs">
          <div
            className="w-6 h-6 rounded border border-gray-300 shrink-0"
            style={{ backgroundColor: MARD_COLORS[selectedColorIndex]?.hex }}
          />
          <div className="min-w-0">
            <div className="font-semibold">{MARD_COLORS[selectedColorIndex]?.code}</div>
            <div className="text-gray-400 truncate">{MARD_COLORS[selectedColorIndex]?.hex}</div>
          </div>
        </div>
      )}
    </div>
  );
}
