/**
 * Load a blueprint image: bytes via adapter, decoded RGBA via the browser's
 * native image decoder. Used by the TS blueprint importer (VS Code webview +
 * browser); Tauri path doesn't need this (Rust does its own decoding).
 */

export type ImageLoadErrorCode = "invalid-file" | "read-failed" | "decode-failed" | "canvas-unavailable";

export class ImageLoadError extends Error {
  readonly cause?: unknown;
  constructor(readonly code: ImageLoadErrorCode, cause?: unknown) { super(code); this.name = "ImageLoadError"; this.cause = cause; }
}

export function imageLoadErrorKey(error: unknown): `import.image.errors.${ImageLoadErrorCode | "unknown"}` {
  return `import.image.errors.${error instanceof ImageLoadError ? error.code : "unknown"}`;
}

export interface LoadedImage {
  /** RGBA, length = width * height * 4 */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Raw file bytes — passed to pngMetadata.readBlueprintMetadata for PNG. */
  rawBytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg" | "image/bmp" | "application/octet-stream";
}

interface ReadFileAdapter {
  readFileBase64(path: string): Promise<string>;
}

export async function loadImageData(
  path: string,
  adapter: ReadFileAdapter,
): Promise<LoadedImage> {
  let base64: string;
  try { base64 = await adapter.readFileBase64(path); }
  catch (cause) { throw new ImageLoadError("read-failed", cause); }
  let rawBytes: Uint8Array;
  try { rawBytes = base64ToUint8Array(base64); }
  catch (cause) { throw new ImageLoadError("invalid-file", cause); }
  const mediaType = detectMediaType(path);

  const dataUrl = `data:${mediaType};base64,${base64}`;
  const img = await loadImage(dataUrl);
  const { width, height } = img;
  if (width === 0 || height === 0) {
    throw new ImageLoadError("decode-failed");
  }

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageLoadError("canvas-unavailable");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);

  return {
    data: imageData.data,
    width,
    height,
    rawBytes,
    mediaType,
  };
}

function detectMediaType(path: string): LoadedImage["mediaType"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "application/octet-stream";
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageLoadError("decode-failed"));
    img.src = src;
  });
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement;
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
