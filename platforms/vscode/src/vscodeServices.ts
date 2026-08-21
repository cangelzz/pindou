import type { LocaleService, StorageService } from "../../../src/platform/services";
import type { PlatformResult } from "../../../src/platform/result";

export type VSCodeRequest = (type: string, data?: Record<string, unknown>) => Promise<Record<string, unknown>>;

function failure(cause: unknown): PlatformResult<never> {
  return { ok: false, code: "unknown", cause };
}

export class VSCodeLocaleService implements LocaleService {
  constructor(private readonly request: VSCodeRequest) {}

  async getSystemLanguage(): Promise<PlatformResult<string>> {
    try {
      const result = await this.request("getUiEnvironment");
      return { ok: true, value: typeof result.language === "string" && result.language ? result.language : "en" };
    } catch (cause) {
      return failure(cause);
    }
  }
}

export class VSCodeStorageService implements StorageService {
  readonly availability = "available" as const;
  constructor(private readonly request: VSCodeRequest) {}

  async get<T>(key: string): Promise<PlatformResult<T | undefined>> {
    try {
      const result = await this.request("storageGet", { key });
      return { ok: true, value: result.value as T | undefined };
    } catch (cause) {
      return failure(cause);
    }
  }

  async set(key: string, value: unknown): Promise<PlatformResult<void>> {
    try {
      await this.request("storageSet", { key, value });
      return { ok: true, value: undefined };
    } catch (cause) {
      return failure(cause);
    }
  }

  async remove(key: string): Promise<PlatformResult<void>> {
    try {
      await this.request("storageRemove", { key });
      return { ok: true, value: undefined };
    } catch (cause) {
      return failure(cause);
    }
  }
}
