import type { ImageImportAsset, ImageImportService, WebImageTask } from "../../src/platform/imageImportService";
import type { PlatformResult } from "../../src/platform/result";
import type { ImageTaskBrokerClient } from "./browserApi";
import type { BrowserFileApi } from "./projectFileService";
import type { ClaimedWebImageTask } from "./imageTaskBroker";

export const MAX_WEB_IMAGE_BYTES = 25 * 1024 * 1024;

export async function readResponseBlobWithLimit(
  response: Response,
  maxBytes: number,
  mime: string,
  renew?: () => Promise<PlatformResult<void>>,
): Promise<PlatformResult<Blob>> {
  if (!response.body) {
    try {
      const blob = await response.blob();
      return blob.size > maxBytes
        ? { ok: false, code: "invalid-data", message: "Image is too large" }
        : { ok: true, value: blob };
    } catch (cause) { return { ok: false, code: "network", cause }; }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (renew) {
        const renewed = await renew();
        if (!renewed.ok) { await reader.cancel(); return { ok: false, code: "network", message: "Image task lease renewal failed", cause: renewed.cause }; }
      }
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, code: "invalid-data", message: "Image is too large" };
      }
      chunks.push(new Uint8Array(value));
    }
    return { ok: true, value: new Blob(chunks, { type: mime }) };
  } catch (cause) {
    return { ok: false, code: "network", cause };
  }
}

const ACCEPT_IMAGES = ".png,.jpg,.jpeg,.bmp,.gif,.webp,image/*";
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/bmp": "bmp", "image/svg+xml": "svg",
};

export class ExtensionImageImportService implements ImageImportService {
  private readonly assets = new Map<string, ImageImportAsset>();
  private readonly claims = new Map<string, string>();

  constructor(
    private readonly broker: ImageTaskBrokerClient,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly fileApi?: BrowserFileApi,
    private readonly randomUUID: () => string = () => crypto.randomUUID(),
  ) {}

  async chooseLocalImage(): Promise<PlatformResult<ImageImportAsset>> {
    if (!this.fileApi) return { ok: false, code: "unsupported" };
    try {
      const file = await this.fileApi.pickFile(ACCEPT_IMAGES);
      if (!file) return { ok: false, code: "cancelled" };
      const asset = { id: this.randomUUID(), file, displayName: file.name, source: "local" as const };
      this.assets.set(asset.id, asset);
      return { ok: true, value: asset };
    } catch (cause) { return { ok: false, code: "unknown", cause }; }
  }

  getAsset(id: string) { return this.assets.get(id); }
  consumeAsset(id: string) { this.assets.delete(id); }
  async acknowledgeTask(id: string): Promise<PlatformResult<void>> {
    const claimId = this.claims.get(id);
    if (!claimId) return { ok: false, code: "cancelled" };
    const result = await this.retryFinish(id, "ack");
    if (result.ok || result.code === "cancelled") return result;
    if (!this.broker.queueAck) return result;
    const queued = await this.broker.queueAck(id, claimId);
    if (queued.ok) this.claims.delete(id);
    return queued;
  }
  async releaseTask(id: string): Promise<PlatformResult<void>> { return this.retryFinish(id, "release"); }
  async renewTask(id: string): Promise<PlatformResult<void>> { return this.finishClaim(id, "renew", false); }

  listPendingTasks(): Promise<PlatformResult<WebImageTask[]>> {
    return this.broker.request("list");
  }

  async fetchWebImage(taskId: string): Promise<PlatformResult<ImageImportAsset>> {
    try {
      const claimed = await this.broker.request<PlatformResult<ClaimedWebImageTask>>("claim", { taskId });
      if (!claimed.ok) return claimed;
      const { task, claimId } = claimed.value;
      this.claims.set(taskId, claimId);
      let response: Response;
      try {
        response = await this.fetcher(task.imageUrl, { credentials: "omit", referrerPolicy: "no-referrer" });
      } catch (cause) { return { ok: false, code: "network", cause }; }
      if (!response.ok) return { ok: false, code: "network", message: `HTTP ${response.status}` };
      const mime = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
      if (!mime.startsWith("image/")) return { ok: false, code: "unsupported", message: "Response is not an image" };
      const declaredLength = Number(response.headers.get("Content-Length") ?? 0);
      if (declaredLength > MAX_WEB_IMAGE_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, code: "invalid-data", message: "Image is too large" };
      }
      const renewed = await this.renewTask(taskId);
      if (!renewed.ok) { await response.body?.cancel().catch(() => undefined); return { ok: false, code: "network", message: "Image task lease renewal failed", cause: renewed.cause }; }
      const blobResult = await readResponseBlobWithLimit(response, MAX_WEB_IMAGE_BYTES, mime, () => this.renewTask(taskId));
      if (!blobResult.ok) return blobResult;
      const blob = blobResult.value;
      if (blob.size === 0) return { ok: false, code: "invalid-data", message: "Image is empty" };
      const name = safeFilename(task.imageUrl, mime);
      const file = new File([blob], name, { type: mime });
      const asset = { id: task.id, file, displayName: name, source: "web-context-menu" as const, sourcePageUrl: task.pageUrl };
      this.assets.set(asset.id, asset);
      return { ok: true, value: asset };
    } catch (cause) { return { ok: false, code: "unknown", cause }; }
  }

  private async retryFinish(id: string, action: "ack" | "release"): Promise<PlatformResult<void>> {
    let result: PlatformResult<void> = { ok: false, code: "unknown" };
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await this.finishClaim(id, action, false);
      if (result.ok || result.code === "cancelled") { this.claims.delete(id); return result; }
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 10));
    }
    return result;
  }

  private async finishClaim(id: string, action: "ack" | "renew" | "release", clear = action !== "renew"): Promise<PlatformResult<void>> {
    const claimId = this.claims.get(id);
    if (!claimId) return { ok: false, code: "cancelled" };
    try {
      const result = await this.broker.request<PlatformResult<void>>(action, { taskId: id, claimId });
      if (clear && (result.ok || result.code === "cancelled")) this.claims.delete(id);
      return result;
    } catch (cause) { return { ok: false, code: "unknown", cause }; }
  }
}

export function safeFilename(rawUrl: string, mime: string): string {
  let basename = "web-image";
  try { basename = decodeURIComponent(new URL(rawUrl).pathname.split("/").pop() || basename); } catch { /* fallback */ }
  basename = basename.replace(/[\\/:*?"<>|]/g, "-").replace(/[\x00-\x1f]/g, "-").trim() || "web-image";
  if (!/\.[a-z0-9]{2,5}$/i.test(basename)) basename += `.${MIME_EXTENSIONS[mime] ?? "img"}`;
  const extension = basename.match(/(\.[a-z0-9]{2,5})$/i)?.[1] ?? "";
  return basename.length <= 180 ? basename : `${basename.slice(0, 180 - extension.length)}${extension}`;
}
