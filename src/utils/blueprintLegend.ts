/**
 * Bead-count legend rendering for blueprint exports.
 * Mirrors the Tauri Rust implementation in src-tauri/src/commands/image_export.rs
 * so browser and VS Code exports look the same as the desktop app.
 */

export interface LegendCell {
  color_code: string;
  r: number;
  g: number;
  b: number;
}

export interface LegendItem {
  code: string;
  r: number;
  g: number;
  b: number;
  count: number;
}

export interface LegendLayout {
  swatchW: number;
  swatchH: number;
  cols: number;
  gap: number;
  sectionTitleH: number;
  totalHeight: number;
  byCount: LegendItem[];
  byAlpha: LegendItem[];
}

/** Count distinct colors and return both sort orders. */
export function buildLegendItems(cells: (LegendCell | null)[][]): { byCount: LegendItem[]; byAlpha: LegendItem[] } {
  const map = new Map<string, LegendItem>();
  for (const row of cells) {
    for (const cell of row) {
      if (!cell) continue;
      const ex = map.get(cell.color_code);
      if (ex) {
        ex.count += 1;
      } else {
        map.set(cell.color_code, { code: cell.color_code, r: cell.r, g: cell.g, b: cell.b, count: 1 });
      }
    }
  }
  const byCount = Array.from(map.values()).sort((a, b) =>
    b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
  const byAlpha = [...byCount].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { byCount, byAlpha };
}

/** Compute layout dimensions to extend the export canvas height. */
export function computeLegendLayout(
  cells: (LegendCell | null)[][],
  width: number,
  cellSize: number,
): LegendLayout {
  const { byCount, byAlpha } = buildLegendItems(cells);
  const swatchW = cellSize * 2;
  const swatchH = cellSize;
  const cols = Math.max(1, Math.floor((width * cellSize) / swatchW));
  const gap = Math.floor(cellSize / 2);
  const sectionTitleH = cellSize;

  const sectionH = (items: LegendItem[]) => {
    if (items.length === 0) return sectionTitleH;
    const rows = Math.floor((items.length - 1) / cols) + 1;
    return sectionTitleH + rows * (swatchH + 2);
  };

  const totalHeight = gap + sectionH(byCount) + gap + sectionH(byAlpha) + gap;
  return { swatchW, swatchH, cols, gap, sectionTitleH, totalHeight, byCount, byAlpha };
}

/** Draw the bead-count legend into a canvas. Call after the grid is drawn. */
export function drawLegend(
  ctx: CanvasRenderingContext2D,
  layout: LegendLayout,
  cellSize: number,
  margin: number,
  gridAreaH: number,
): void {
  const { swatchW, swatchH, cols, gap, sectionTitleH, byCount, byAlpha } = layout;
  const titleFontPx = Math.max(8, cellSize * 0.5);
  const codeFontPx = Math.max(7, cellSize * 0.35);

  const totalBeads = byCount.reduce((s, x) => s + x.count, 0);
  const sections: Array<{ title: string; items: LegendItem[] }> = [
    { title: `By Count (${byCount.length} colors, ${totalBeads} beads)`, items: byCount },
    { title: `By Code (${byAlpha.length} colors)`, items: byAlpha },
  ];

  let y = gridAreaH + gap;
  for (const { title, items } of sections) {
    // Section title
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.font = `${titleFontPx}px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(title, margin, y + 2);

    const rowStartY = y + sectionTitleH;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const sx = margin + col * swatchW;
      const sy = rowStartY + row * (swatchH + 2);
      const sw = swatchW - 2;

      // Swatch fill
      ctx.fillStyle = `rgb(${it.r},${it.g},${it.b})`;
      ctx.fillRect(sx, sy, sw, swatchH);

      // Border
      ctx.strokeStyle = "rgb(160,160,160)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, swatchH - 1);

      // Label "CODE xN" with adaptive contrast
      const lum = 0.299 * it.r + 0.587 * it.g + 0.114 * it.b;
      ctx.fillStyle = lum > 128 ? "rgba(0,0,0,0.95)" : "rgba(255,255,255,0.95)";
      ctx.font = `${codeFontPx}px monospace`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${it.code} x${it.count}`, sx + 3, sy + swatchH / 2);
    }

    const rowsCount = items.length === 0 ? 0 : Math.floor((items.length - 1) / cols) + 1;
    y += sectionTitleH + rowsCount * (swatchH + 2) + gap;
  }
}
