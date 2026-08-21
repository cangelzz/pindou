import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { cloudErrorText } from "./cloudErrorText";

const dictionaries = {
  en: { "cloud.tooLarge": "Project is too large", "cloud.invalidData": "Invalid cloud data", "cloud.versionConflict": "Version conflict", "cloud.unsupported": "Unsupported", "cloud.permissionDenied": "Permission denied", "cloud.unknownError": "Unknown" },
  zh: { "cloud.tooLarge": "项目过大", "cloud.invalidData": "云端数据无效", "cloud.versionConflict": "版本冲突", "cloud.unsupported": "不支持", "cloud.permissionDenied": "权限不足", "cloud.unknownError": "未知错误" },
};

describe.each(Object.entries(dictionaries))("cloud error mapping in %s", (_lang, values) => {
  const t = ((key: keyof typeof values) => values[key] ?? key) as TFunction;
  it.each([
    [{ ok: false, code: "invalid-data", message: "Gist project exceeds 25MB" } as const, "cloud.tooLarge"],
    [{ ok: false, code: "invalid-data", message: "malformed response" } as const, "cloud.invalidData"],
    [{ ok: false, code: "conflict", message: "secret diagnostic" } as const, "cloud.versionConflict"],
    [{ ok: false, code: "unsupported", message: "internal service name" } as const, "cloud.unsupported"],
    [{ ok: false, code: "permission-denied", message: "token details" } as const, "cloud.permissionDenied"],
    [{ ok: false, code: "unknown", message: "sensitive backend text" } as const, "cloud.unknownError"],
  ])("maps $0 without exposing service messages", (result, key) => {
    expect(cloudErrorText(result, t)).toBe(values[key as keyof typeof values]);
    expect(cloudErrorText(result, t)).not.toContain(result.message!);
  });
});
