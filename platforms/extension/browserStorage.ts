import type { StorageService } from "../../src/platform/services";
import type { PlatformResult } from "../../src/platform/result";

export const GITHUB_ACCESS_TOKEN_KEY = "github.accessToken";
export const GITHUB_REVOKED_SESSION_KEY = "github.sessionRevoked";

type RuntimeLike = { lastError?: unknown };
type StorageAreaLike = {
  get(key: string, callback?: (items: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void;
  set(items: Record<string, unknown>, callback?: () => void): Promise<void> | void;
  remove(key: string, callback?: () => void): Promise<void> | void;
};

function errorMessage(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : error == null ? undefined : String(error);
}

export class BrowserStorage implements StorageService {
  readonly availability = "available" as const;
  constructor(private readonly area: StorageAreaLike, private readonly runtime: RuntimeLike) {}

  private invoke<T>(call: (callback: (value: T) => void) => Promise<T> | void): Promise<PlatformResult<T>> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: T) => {
        if (settled) return;
        settled = true;
        const lastError = this.runtime.lastError;
        resolve(lastError
          ? { ok: false, code: "unknown", message: errorMessage(lastError), cause: lastError }
          : { ok: true, value });
      };
      try {
        const promise = call(finish);
        if (promise && typeof promise.then === "function") {
          promise.then(finish, (cause) => {
            if (!settled) { settled = true; resolve({ ok: false, code: "unknown", message: errorMessage(cause), cause }); }
          });
        }
      } catch (cause) {
        if (!settled) { settled = true; resolve({ ok: false, code: "unknown", message: errorMessage(cause), cause }); }
      }
    });
  }

  async get<T>(key: string): Promise<PlatformResult<T | undefined>> {
    const result = await this.invoke<Record<string, unknown>>((callback) => this.area.get(key, callback));
    return result.ok ? { ok: true, value: result.value[key] as T | undefined } : result;
  }
  set(key: string, value: unknown): Promise<PlatformResult<void>> {
    return this.invoke<void>((callback) => this.area.set({ [key]: value }, callback));
  }
  remove(key: string): Promise<PlatformResult<void>> {
    return this.invoke<void>((callback) => this.area.remove(key, callback));
  }
}
