import type { TFunction } from "i18next";
import type { PlatformResult } from "../../platform/result";

export function cloudErrorText(result: Extract<PlatformResult<unknown>, { ok: false }>, t: TFunction): string {
  if (result.code === "authentication") return t("cloud.authError");
  if (result.code === "rate-limited") return result.retryAfterSeconds !== undefined
    ? t("cloud.rateLimitedSeconds", { seconds: result.retryAfterSeconds })
    : t("cloud.rateLimited");
  if (result.code === "network") return t("cloud.networkError");
  if (result.code === "permission-denied") return t("cloud.permissionDenied");
  if (result.code === "unsupported") return t("cloud.unsupported");
  if (result.code === "conflict") return t("cloud.versionConflict");
  if (result.code === "invalid-data") {
    if (/25MB|exceeds/i.test(result.message ?? "")) return t("cloud.tooLarge");
    if (/preflight|version|etag/i.test(result.message ?? "")) return t("cloud.versionConflict");
    return t("cloud.invalidData");
  }
  if (result.code === "cancelled") return "";
  return t("cloud.unknownError");
}
