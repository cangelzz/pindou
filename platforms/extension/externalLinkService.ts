import type { ExternalLinkService } from "../../src/platform/services";

export class BrowserExternalLinkService implements ExternalLinkService {
  readonly availability = "available" as const;
  constructor(private readonly tabs: { create(createProperties: { url: string }): Promise<unknown> }) {}
  async open(url: string) {
    let parsed: URL;
    try { parsed = new URL(url); }
    catch (cause) { return { ok: false as const, code: "invalid-data" as const, message: "Invalid external URL", cause }; }
    if (parsed.protocol !== "https:") return { ok: false as const, code: "invalid-data" as const, message: "Only HTTPS external URLs are allowed" };
    try { await this.tabs.create({ url: parsed.href }); return { ok: true as const, value: undefined }; }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { ok: false as const, code: "unknown" as const, message, cause };
    }
  }
}
