import type { LocaleService, StorageService } from "./services";
import type { PlatformResult } from "./result";

type NavigatorLike = { readonly language?: string };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function unknownFailure(cause: unknown): PlatformResult<never> {
  return { ok: false, code: "unknown", cause };
}

export function createNavigatorLocaleService(navigatorLike: NavigatorLike = navigator): LocaleService {
  return {
    async getSystemLanguage() {
      try {
        return { ok: true, value: navigatorLike.language || "en" };
      } catch (cause) {
        return unknownFailure(cause);
      }
    },
  };
}

export class WebStorageService implements StorageService {
  readonly availability = "available" as const;
  private readonly storageProvider: () => StorageLike;

  constructor(storageOrProvider: StorageLike | (() => StorageLike) = () => globalThis.localStorage) {
    this.storageProvider = typeof storageOrProvider === "function"
      ? storageOrProvider
      : () => storageOrProvider;
  }

  async get<T>(key: string): Promise<PlatformResult<T | undefined>> {
    try {
      const value = this.storageProvider().getItem(key);
      return { ok: true, value: value === null ? undefined : JSON.parse(value) as T };
    } catch (cause) {
      return unknownFailure(cause);
    }
  }

  async set(key: string, value: unknown): Promise<PlatformResult<void>> {
    try {
      this.storageProvider().setItem(key, JSON.stringify(value));
      return { ok: true, value: undefined };
    } catch (cause) {
      return unknownFailure(cause);
    }
  }

  async remove(key: string): Promise<PlatformResult<void>> {
    try {
      this.storageProvider().removeItem(key);
      return { ok: true, value: undefined };
    } catch (cause) {
      return unknownFailure(cause);
    }
  }
}
