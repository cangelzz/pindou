import type { ImageImportService, WebImageTask } from "../../src/platform/imageImportService";
import type { BrowserApi, BrowserMessageListener } from "./browserApi";

export interface ImageTaskInbox {
  start(): Promise<void>;
  subscribe(listener: (task: Pick<WebImageTask, "id" | "createdAt">) => void): () => void;
  dispose(): void;
}

export function createImageTaskInbox(api: BrowserApi, service: ImageImportService): ImageTaskInbox {
  const listeners = new Set<(task: Pick<WebImageTask, "id" | "createdAt">) => void>();
  const pending = new Map<string, Pick<WebImageTask, "id" | "createdAt">>();
  const notified = new Set<string>();
  let started = false;
  let disposed = false;
  let refreshing = false;
  let refreshRequested = false;

  const flush = () => {
    if (!listeners.size) return;
    const tasks = [...pending.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const task of tasks) {
      if (notified.has(task.id)) continue;
      listeners.forEach((listener) => listener(task));
      notified.add(task.id);
    }
  };

  const refresh = async () => {
    refreshRequested = true;
    if (!started || refreshing || disposed) return;
    refreshing = true;
    try {
      while (refreshRequested && !disposed) {
        refreshRequested = false;
        try {
          const result = await service.listPendingTasks?.();
          if (!result?.ok) continue;
          const liveIds = new Set(result.value.map((task) => task.id));
          for (const id of pending.keys()) if (!liveIds.has(id)) { pending.delete(id); notified.delete(id); }
          result.value.forEach((task) => pending.set(task.id, task));
          flush();
        } catch {
          // A later runtime wake or subscription retries discovery.
        }
      }
    } finally {
      refreshing = false;
    }
  };

  const onMessage: BrowserMessageListener = (message) => {
    if ((message as { type?: string })?.type === "pindou:image-task") void refresh();
  };
  api.runtime.onMessage.addListener(onMessage);

  return {
    async start() { started = true; await refresh(); },
    subscribe(listener) {
      listeners.add(listener);
      flush();
      void refresh();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) notified.clear();
      };
    },
    dispose() {
      disposed = true;
      api.runtime.onMessage.removeListener(onMessage);
      listeners.clear(); pending.clear(); notified.clear();
    },
  };
}
