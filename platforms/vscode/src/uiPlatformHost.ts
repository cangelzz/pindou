export const UI_LANGUAGE_KEY = "pindou.uiLanguage";

type UiPlatformMessage = {
  type?: string;
  requestId?: number;
  key?: unknown;
  value?: unknown;
};

type Dependencies = {
  language: string;
  globalState: {
    get(key: string): unknown;
    update(key: string, value: unknown): PromiseLike<void> | PromiseLike<void>;
  };
  postMessage(message: Record<string, unknown>): PromiseLike<boolean> | PromiseLike<boolean>;
  onLanguageChanged?(language: "en" | "zh-CN", revision: number): PromiseLike<void> | void;
};

let languageRevision = 0;

export async function handleUiPlatformMessage(
  message: UiPlatformMessage,
  dependencies: Dependencies,
): Promise<boolean> {
  const { type, requestId } = message;
  const isUiRpc = type === "getUiEnvironment" || type === "storageGet" || type === "storageSet" || type === "storageRemove";
  if (!isUiRpc || typeof requestId !== "number") return false;

  if (type === "getUiEnvironment") {
    await dependencies.postMessage({
      type: "uiEnvironment",
      requestId,
      language: dependencies.language || "en",
      revision: languageRevision,
    });
    return true;
  }

  if (type !== "storageGet" && type !== "storageSet" && type !== "storageRemove") return false;

  const key = String(message.key ?? "");
  if (key !== UI_LANGUAGE_KEY) {
    await dependencies.postMessage({
      type: "storageResult",
      requestId,
      error: `Unsupported storage key: ${key}`,
    });
    return true;
  }

  if (type === "storageSet" && message.value !== "en" && message.value !== "zh-CN") {
    await dependencies.postMessage({
      type: "storageResult",
      requestId,
      error: "Invalid UI language preference",
    });
    return true;
  }

  try {
    if (type === "storageGet") {
      await dependencies.postMessage({
        type: "storageResult",
        requestId,
        value: dependencies.globalState.get(key),
        revision: languageRevision,
      });
    } else {
      await dependencies.globalState.update(key, type === "storageSet" ? message.value : undefined);
      if (type === "storageSet") {
        const revision = ++languageRevision;
        await dependencies.onLanguageChanged?.(message.value as "en" | "zh-CN", revision);
        await dependencies.postMessage({ type: "storageResult", requestId, revision });
      } else {
        await dependencies.postMessage({ type: "storageResult", requestId });
      }
    }
  } catch (cause) {
    await dependencies.postMessage({
      type: "storageResult",
      requestId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
  return true;
}
