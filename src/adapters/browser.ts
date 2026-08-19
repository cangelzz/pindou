import type {
  PlatformAdapter,
  FileFilter,
  ImagePreview,
  PixelData,
  CropRect,
  ExportImageRequest,
  ExportPreviewRequest,
  SnapshotInfo,
  PaletteColor,
  BlueprintImportResult,
  ImportMode,
} from "./index";
import type { ProjectFile } from "../types";
import { renderBlueprintBlob, renderPreviewBlob } from "../utils/canvasExport";
import { importBlueprintTS, detectBlueprintDimsTS } from "../utils/blueprintImportTS";
import appIconUrl from "../../src-tauri/icons/64x64.png";

let _cachedIcon: HTMLImageElement | null = null;
let _iconPromise: Promise<HTMLImageElement | null> | null = null;

function loadAppIcon(): Promise<HTMLImageElement | null> {
  if (_cachedIcon) return Promise.resolve(_cachedIcon);
  if (_iconPromise) return _iconPromise;
  _iconPromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      _cachedIcon = img;
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = appIconUrl;
  });
  return _iconPromise;
}

const DB_NAME = "pindouverse";
const DB_VERSION = 2;
const STORE_PROJECTS = "projects";
const STORE_AUTOSAVE = "autosave";
const STORE_SNAPSHOTS = "snapshots";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS);
      }
      if (!db.objectStoreNames.contains(STORE_AUTOSAVE)) {
        db.createObjectStore(STORE_AUTOSAVE);
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbPut(store: string, key: string, value: unknown): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function idbAllKeys(store: string): Promise<string[]> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).getAllKeys();
        req.onsuccess = () => resolve(req.result as string[]);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbDelete(store: string, key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

/** Load an image from a File into an HTMLImageElement */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

/** Extract RGB pixels from image, optionally cropped and resized */
function extractPixels(
  img: HTMLImageElement,
  maxDim: number,
  crop: CropRect | null,
  sharp: boolean
): PixelData {
  const sx = crop ? crop.x : 0;
  const sy = crop ? crop.y : 0;
  const sw = crop ? crop.width : img.naturalWidth;
  const sh = crop ? crop.height : img.naturalHeight;

  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d")!;
  if (sharp) {
    ctx.imageSmoothingEnabled = false;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

  const imageData = ctx.getImageData(0, 0, dw, dh);
  const pixels: number[] = [];
  for (let i = 0; i < imageData.data.length; i += 4) {
    pixels.push(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
  }
  return { width: dw, height: dh, pixels };
}

/** Trigger a file download in the browser */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Pick a file via <input type="file"> */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Convert FileFilter[] to accept string */
function filtersToAccept(filters: FileFilter[]): string {
  return filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
}

// ─── Browser / Extension adapter ─────────────────────────────────

export type BrowserDownloadSink = (blob: Blob, filename: string) => void | Promise<void>;

export class BrowserAdapter implements PlatformAdapter {
  constructor(private readonly saveBlob: BrowserDownloadSink = downloadBlob) {}

  /** File picked by open dialog, stored for later use by previewImage/importImage */
  private _pendingFile: File | null = null;
  private _pendingImageEl: HTMLImageElement | null = null;

  setImageImportFile(file: File): void {
    this._pendingFile = file;
    this._pendingImageEl = null;
  }

  async showSaveDialog(_filters: FileFilter[], defaultPath?: string): Promise<string | null> {
    // In browser we don't pick a path; return the suggested filename
    const name = defaultPath?.split(/[/\\]/).pop() ?? "download";
    return name;
  }

  async showOpenDialog(filters: FileFilter[]): Promise<string | null> {
    const accept = filtersToAccept(filters);
    const file = await pickFile(accept);
    if (!file) return null;
    this._pendingFile = file;
    this._pendingImageEl = null;
    return file.name;
  }

  // ─── Legacy project migration / autosave ───

  async saveProject(path: string, project: ProjectFile): Promise<void> {
    // Formal browser saves are handled by BrowserProjectFileService. Keep the
    // pre-existing IndexedDB path only for the current autosave implementation.
    if (!path.includes("__autosave__")) {
      throw new Error("Browser projects must be saved through ProjectFileService");
    }
    await idbPut(STORE_PROJECTS, path, project);
  }

  async writeProjectFile(_path: string, _project: ProjectFile): Promise<void> {
    throw new Error("Browser projects must be saved through ProjectFileService");
  }

  async loadProject(path: string): Promise<ProjectFile> {
    // Read-only compatibility entry for projects created by older releases.
    const project = await idbGet<ProjectFile>(STORE_PROJECTS, path);
    if (!project) throw new Error(`Project not found: ${path}`);
    return project;
  }

  async getAutosaveDir(): Promise<string> {
    return "__autosave__";
  }

  // ─── Snapshots (IndexedDB) ───

  async saveSnapshot(project: ProjectFile, label: string, sourceProjectId?: string): Promise<void> {
    if (sourceProjectId && !project.projectId) project = { ...project, projectId: sourceProjectId };
    const key = `snapshot_${Date.now()}_${label}`;
    await idbPut(STORE_SNAPSHOTS, key, { project, label, timestamp: new Date().toISOString() });
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const keys = await idbAllKeys(STORE_SNAPSHOTS);
    const results: SnapshotInfo[] = [];
    for (const key of keys) {
      const data = await idbGet<{ label: string; timestamp: string }>(STORE_SNAPSHOTS, key);
      if (data) {
        results.push({ path: key, name: data.label, modified: data.timestamp });
      }
    }
    results.sort((a, b) => b.modified.localeCompare(a.modified));
    return results;
  }

  async loadSnapshot(path: string): Promise<ProjectFile> {
    const data = await idbGet<{ project: ProjectFile }>(STORE_SNAPSHOTS, path);
    if (!data) throw new Error(`Snapshot not found: ${path}`);
    return data.project;
  }

  async deleteSnapshot(path: string): Promise<void> {
    await idbDelete(STORE_SNAPSHOTS, path);
  }

  // ─── Image import (Canvas API) ───

  async previewImage(_path: string): Promise<ImagePreview> {
    if (!this._pendingFile) throw new Error("No file selected");
    const img = await loadImageFromFile(this._pendingFile);
    this._pendingImageEl = img;

    const maxPreview = 400;
    const scale = Math.min(1, maxPreview / Math.max(img.naturalWidth, img.naturalHeight));
    const pw = Math.round(img.naturalWidth * scale);
    const ph = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, pw, ph);
    const imageData = ctx.getImageData(0, 0, pw, ph);
    const pixels: number[] = [];
    for (let i = 0; i < imageData.data.length; i += 4) {
      pixels.push(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
    }

    return {
      original_width: img.naturalWidth,
      original_height: img.naturalHeight,
      preview_width: pw,
      preview_height: ph,
      pixels,
    };
  }

  async importImage(
    _path: string,
    maxDimension: number,
    crop: CropRect | null,
    sharp: boolean
  ): Promise<PixelData> {
    if (!this._pendingImageEl && this._pendingFile) {
      this._pendingImageEl = await loadImageFromFile(this._pendingFile);
    }
    if (!this._pendingImageEl) throw new Error("No image loaded");
    return extractPixels(this._pendingImageEl, maxDimension, crop, sharp);
  }

  // ─── Image export (Canvas API + download) ───

  async exportImage(request: ExportImageRequest): Promise<void> {
    const { output_path, ...renderRequest } = request;
    const icon = await loadAppIcon();
    const blob = await renderBlueprintBlob(renderRequest, { appIcon: icon });
    const ext = request.format === "jpeg" ? "jpg" : "png";
    const filename = output_path.split(/[/\\]/).pop() || `export.${ext}`;
    await this.saveBlob(blob, filename);
  }

  async exportPreview(request: ExportPreviewRequest): Promise<void> {
    const { output_path, ...renderRequest } = request;
    const icon = await loadAppIcon();
    const blob = await renderPreviewBlob(renderRequest, { appIcon: icon });
    const filename = output_path.split(/[/\\]/).pop() || "preview.jpg";
    await this.saveBlob(blob, filename);
  }

  async importBlueprint(
    path: string,
    palette: PaletteColor[],
    gridWidth?: number,
    gridHeight?: number,
    mode?: ImportMode,
    bbox?: { left: number; top: number; right: number; bottom: number },
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<BlueprintImportResult> {
    return await importBlueprintTS(
      { path, palette, gridWidth, gridHeight, bbox, mode },
      this,
      opts,
    );
  }

  async detectBlueprintDims(
    path: string,
    bbox?: { left: number; top: number; right: number; bottom: number },
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<{ width: number; height: number; cellSize: number; bbox: { left: number; top: number; right: number; bottom: number }; hasMetadata: boolean }> {
    return await detectBlueprintDimsTS(path, this, bbox, opts);
  }

  async readFileBase64(path: string): Promise<string> {
    if (path.startsWith("data:")) {
      const comma = path.indexOf(",");
      if (comma < 0) throw new Error("Invalid data URL");
      return path.slice(comma + 1);
    }
    throw new Error("readFileBase64 in browser only supports data: URLs (full file access via picker not implemented yet)");
  }
}
