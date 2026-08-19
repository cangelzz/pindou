import type { ImageImportAsset, ImageImportService, WebImageTask } from "./imageImportService";

interface SchedulerUi {
  showAsset(asset: ImageImportAsset): void;
  showError(taskId: string): void;
}

export class ImageTaskScheduler {
  private queue = new Map<string, Pick<WebImageTask, "id" | "createdAt">>();
  private state: "idle" | "fetching" | "asset" | "error" = "idle";
  private activeAssetId?: string;
  private activeTaskId?: string;
  private disposed = false;
  private retryTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly service: ImageImportService,
    private readonly ui: SchedulerUi,
    private readonly scheduleRetry: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> = setTimeout,
    private readonly clearRetry: (id: ReturnType<typeof setTimeout>) => void = clearTimeout,
  ) {}

  enqueue(task: Pick<WebImageTask, "id" | "createdAt">): void {
    if (this.disposed || this.queue.has(task.id) || this.activeAssetId === task.id) return;
    this.queue.set(task.id, task);
    this.process();
  }

  completeAsset(assetId: string): void {
    if (this.state !== "asset" || this.activeAssetId !== assetId) return;
    this.activeAssetId = undefined;
    this.activeTaskId = undefined;
    this.state = "idle";
    void this.service.acknowledgeTask?.(assetId).catch(() => undefined);
    if (this.service.getAsset(assetId)) this.service.consumeAsset(assetId);
    this.process();
  }

  completeError(): void {
    if (this.state !== "error") return;
    const taskId = this.activeTaskId;
    this.activeTaskId = undefined;
    this.state = "idle";
    if (taskId) void this.service.acknowledgeTask?.(taskId).catch(() => undefined);
    this.process();
  }

  dispose(): void {
    this.disposed = true;
    const assetId = this.activeAssetId;
    const taskId = this.activeTaskId;
    this.activeAssetId = undefined;
    this.activeTaskId = undefined;
    if (taskId) void this.service.releaseTask?.(taskId).catch(() => undefined);
    if (assetId && this.service.getAsset(assetId)) this.service.consumeAsset(assetId);
    this.retryTimers.forEach((id) => this.clearRetry(id));
    this.retryTimers.clear();
    this.queue.clear();
  }

  private process(): void {
    if (this.disposed || this.state !== "idle" || this.queue.size === 0) return;
    const task = [...this.queue.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
    this.queue.delete(task.id);
    this.activeTaskId = task.id;
    this.state = "fetching";
    void this.service.fetchWebImage(task.id).then((result) => {
      if (this.disposed) {
        void this.service.releaseTask?.(task.id).catch(() => undefined);
        if (result.ok) this.service.consumeAsset(result.value.id);
        return;
      }
      if (result.ok) {
        this.state = "asset";
        this.activeAssetId = result.value.id;
        this.ui.showAsset(result.value);
      } else if (result.code === "cancelled") {
        this.activeTaskId = undefined;
        this.state = "idle";
        if (result.retryAfterSeconds) {
          const timer = this.scheduleRetry(() => {
            this.retryTimers.delete(timer);
            this.enqueue(task);
          }, result.retryAfterSeconds * 1000);
          this.retryTimers.add(timer);
        }
        this.process();
      } else {
        this.state = "error";
        this.ui.showError(task.id);
      }
    }).catch(() => {
      if (this.disposed) return;
      this.state = "error";
      this.ui.showError(task.id);
    });
  }
}
