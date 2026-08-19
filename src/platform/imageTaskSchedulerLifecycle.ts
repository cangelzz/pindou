import type { ImageTaskScheduler } from "./imageTaskScheduler";
import type { WebImageTask } from "./imageImportService";

interface InboxLike {
  subscribe(listener: (task: Pick<WebImageTask, "id" | "createdAt">) => void): () => void;
}

export function createImageTaskSchedulerLifecycle(
  createScheduler: () => ImageTaskScheduler,
  inbox: InboxLike | undefined,
  ref: { current: ImageTaskScheduler | null },
) {
  return {
    setup() {
      const scheduler = createScheduler();
      ref.current = scheduler;
      const unsubscribe = inbox?.subscribe((task) => scheduler.enqueue(task));
      return () => {
        unsubscribe?.();
        scheduler.dispose();
        if (ref.current === scheduler) ref.current = null;
      };
    },
  };
}
