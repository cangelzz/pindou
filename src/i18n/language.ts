export type UiLanguage = "en" | "zh-CN";

export const UI_LANGUAGE_KEY = "pindou.uiLanguage";

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "en" || value === "zh-CN";
}

export function normalizeUiLanguage(value: unknown): UiLanguage {
  if (typeof value !== "string") return "en";

  const languageTag = value.replaceAll("_", "-").trim();

  try {
    if (typeof Intl.Locale === "function") {
      const locale = new Intl.Locale(languageTag);
      if (locale.language !== "zh") return "en";
      if (locale.script) return locale.script === "Hans" ? "zh-CN" : "en";
      if (locale.region === "CN" || locale.region === "SG") return "zh-CN";
      return "en";
    }
  } catch {
    return "en";
  }

  const subtags = languageTag.split("-");
  if (subtags.some((part) => !/^[A-Za-z0-9]{1,8}$/.test(part))) return "en";
  if (subtags[0]?.toLowerCase() !== "zh") return "en";
  let index = 1;
  let script: string | undefined;
  let region: string | undefined;
  if (/^[A-Za-z]{4}$/.test(subtags[index] ?? "")) script = subtags[index++].toLowerCase();
  if (/^(?:[A-Za-z]{2}|[0-9]{3})$/.test(subtags[index] ?? "")) region = subtags[index++].toUpperCase();
  while (/^(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3})$/.test(subtags[index] ?? "")) index++;
  const singletons = new Set<string>();
  while (index < subtags.length) {
    const singleton = subtags[index].toLowerCase();
    if (!/^[A-Za-z0-9]$/.test(singleton) || singletons.has(singleton)) return "en";
    singletons.add(singleton);
    index++;
    const start = index;
    const privateUse = singleton === "x";
    while (index < subtags.length && (privateUse ? /^[A-Za-z0-9]{1,8}$/ : /^[A-Za-z0-9]{2,8}$/).test(subtags[index])) index++;
    if (index === start || (privateUse && index !== subtags.length)) return "en";
  }
  if (script) return script === "hans" ? "zh-CN" : "en";
  return region === "CN" || region === "SG" ? "zh-CN" : "en";
}

export function selectUiLanguage(saved: unknown, detected: unknown): UiLanguage {
  return isUiLanguage(saved) ? saved : normalizeUiLanguage(detected);
}
