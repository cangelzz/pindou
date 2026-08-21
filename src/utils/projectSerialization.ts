import type { ProjectFile, CanvasCell, BeadLayer } from "../types";
import { canonicalizeDefaultLayer } from "../store/defaultLayerNames";

/** A cell as it appears on disk: either the verbose v2 form `{colorIndex}` or
 *  the flat v3 form (`null | number`). */
type DiskCell = number | null | { colorIndex: number | null };

function expandCell(cell: DiskCell, ctx: string): CanvasCell {
  if (cell === null) return { colorIndex: null };
  if (typeof cell === "number") return { colorIndex: cell };
  if (typeof cell === "object" && "colorIndex" in cell) {
    const ci = (cell as any).colorIndex;
    if (ci === null || typeof ci === "number") return { colorIndex: ci };
    throw new Error(`Invalid cell at ${ctx}: ${JSON.stringify(cell)}`);
  }
  throw new Error(`Invalid cell at ${ctx}: ${JSON.stringify(cell)}`);
}

function expandRow(row: unknown, ctx: string): CanvasCell[] {
  if (!Array.isArray(row)) throw new Error(`Expected array at ${ctx}`);
  return row.map((c, i) => expandCell(c as DiskCell, `${ctx}[${i}]`));
}

function expandGrid(grid: unknown, ctx: string): CanvasCell[][] {
  if (!Array.isArray(grid)) throw new Error(`Expected 2D array at ${ctx}`);
  return grid.map((row, i) => expandRow(row, `${ctx}[${i}]`));
}

function collapseCell(cell: CanvasCell): number | null {
  return cell.colorIndex;
}

function collapseGrid(grid: CanvasCell[][]): (number | null)[][] {
  return grid.map((row) => row.map(collapseCell));
}

/**
 * Parse raw JSON text from disk and produce a fully-normalised in-memory
 * ProjectFile. The disk format is auto-detected from the `version` field:
 *   - version >= 3 : cells are flat (`null | number`).
 *   - version < 3 or missing : cells are verbose (`{colorIndex}`).
 *   - unknown future version : treated as v3.
 *
 * After this call, every cell in `canvasData` and every layer's `data` is
 * a `CanvasCell = { colorIndex: number | null }` regardless of source.
 * The in-memory `version` is always 3 after normalisation, regardless of source.
 */
export function normalizeProjectFromDisk(rawJson: string): ProjectFile {
  const raw = JSON.parse(rawJson) as any;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Expected project object");
  const width = raw.canvasSize?.width;
  const height = raw.canvasSize?.height;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Invalid canvasSize");
  }
  const canvasData = expandGrid(raw.canvasData, "canvasData");
  const validateDimensions = (grid: CanvasCell[][], ctx: string) => {
    if (grid.length !== height || grid.some((row) => row.length !== width)) {
      throw new Error(`${ctx} dimensions do not match canvasSize`);
    }
  };
  validateDimensions(canvasData, "canvasData");
  if (raw.layers !== undefined && raw.layers !== null && !Array.isArray(raw.layers)) {
    throw new Error("Expected layers array");
  }
  const layers: BeadLayer[] | undefined = Array.isArray(raw.layers)
    ? raw.layers.map((l: any, i: number): BeadLayer => {
        const data = expandGrid(l.data, `layers[${i}].data`);
        validateDimensions(data, `layers[${i}].data`);
        return canonicalizeDefaultLayer({
          id: String(l.id),
          name: String(l.name ?? "Layer"),
          visible: l.visible !== false,
          opacity: typeof l.opacity === "number" ? l.opacity : 1,
          defaultNameIndex: l.defaultNameIndex,
          isDefaultName: l.isDefaultName,
          data,
        }, i + 1);
      })
    : undefined;

  const normalizedAt = new Date().toISOString();
  const createdAt = typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : normalizedAt;
  const updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : createdAt;
  return {
    version: 3,
    projectId: typeof raw.projectId === "string" && raw.projectId ? raw.projectId : undefined,
    canvasSize: raw.canvasSize,
    canvasData,
    layers,
    gridConfig: raw.gridConfig,
    projectInfo: raw.projectInfo,
    createdAt,
    updatedAt,
  };
}

/**
 * Serialise an in-memory ProjectFile as compact v3 JSON. Always stamps
 * `version: 3`, collapses every cell to `null | number`, and uses
 * `JSON.stringify` with no indent.
 */
export function serializeProjectToV3(project: ProjectFile): string {
  const out: any = {
    version: 3,
    ...(project.projectId ? { projectId: project.projectId } : {}),
    canvasSize: project.canvasSize,
    canvasData: collapseGrid(project.canvasData),
    gridConfig: project.gridConfig,
    projectInfo: project.projectInfo,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  if (project.layers) {
    out.layers = project.layers.map((layer, index) => {
      const { isDefaultName: _legacyMarker, ...l } = canonicalizeDefaultLayer(
        layer as BeadLayer & { isDefaultName?: boolean },
        index + 1,
      );
      return { ...l, data: collapseGrid(l.data) };
    });
  }
  return JSON.stringify(out);
}
