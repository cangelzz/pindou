export type PlatformErrorCode =
  | "cancelled"
  | "permission-denied"
  | "invalid-data"
  | "network"
  | "authentication"
  | "rate-limited"
  | "conflict"
  | "stale"
  | "unsupported"
  | "unknown";

export type PlatformResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: PlatformErrorCode;
      message?: string;
      retryAfterSeconds?: number;
      cause?: unknown;
    };
