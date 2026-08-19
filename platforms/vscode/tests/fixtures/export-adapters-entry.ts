import { BrowserAdapter } from "../../../../src/adapters/browser";
import { VScodeAdapter } from "../../src/vscodeAdapter";
import type { ExportImageRequest, ExportPreviewRequest } from "../../../../src/adapters";

interface CapturedDownload {
  blob: Blob;
  filename: string;
}

declare global {
  interface Window {
    __adapterDownloads: CapturedDownload[];
    __runBlueprintAdapterContract(request: ExportImageRequest): Promise<void>;
    __runPreviewAdapterContract(request: ExportPreviewRequest): Promise<void>;
  }
}

window.__adapterDownloads = [];

async function runBoth(
  method: "exportImage" | "exportPreview",
  request: ExportImageRequest | ExportPreviewRequest,
): Promise<void> {
  window.__adapterDownloads.length = 0;
  const browser = new BrowserAdapter((blob, filename) => {
    window.__adapterDownloads.push({ blob, filename });
  });
  const vscode = new VScodeAdapter();
  await (browser[method] as (value: any) => Promise<void>)(request);
  await (vscode[method] as (value: any) => Promise<void>)(request);
}

window.__runBlueprintAdapterContract = (request) => runBoth("exportImage", request);
window.__runPreviewAdapterContract = (request) => runBoth("exportPreview", request);
