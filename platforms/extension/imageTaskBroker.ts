import type { WebImageTask } from "../../src/platform/imageImportService";
import type { PlatformResult } from "../../src/platform/result";
import type { BrowserStorageArea } from "./browserApi";

export const IMAGE_TASK_KEY_PREFIX = "pindou.webImageTask.";
export const PENDING_ACK_KEY_PREFIX = "pindou.pendingImageAck.";
export const IMAGE_TASK_LEASE_MS = 10 * 60 * 1000;
export const IMAGE_TASK_RECOVERY_MS = 5 * 60 * 1000;
export interface StoredWebImageTask extends WebImageTask { claim?: { id: string; expiresAt: number } }
export interface ClaimedWebImageTask { task: WebImageTask; claimId: string }

export class WebImageTaskBroker {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly storage: BrowserStorageArea,
    private readonly now: () => number = Date.now,
    private readonly randomUUID: () => string = () => crypto.randomUUID(),
  ) {}

  create(task: WebImageTask): Promise<PlatformResult<void>> {
    return this.run(async () => { await this.storage.set({ [this.key(task.id)]: task }); return { ok: true, value: undefined }; });
  }

  list(): Promise<PlatformResult<WebImageTask[]>> {
    return this.run(async () => {
      const all = await this.storage.get(null);
      const live: WebImageTask[] = [];
      const remove: string[] = [];
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(IMAGE_TASK_KEY_PREFIX) || !isTask(value)) continue;
        if (value.claim && value.claim.expiresAt > this.now()) continue;
        if (value.expiresAt <= this.now()) { remove.push(key); continue; }
        if (value.claim) { delete value.claim; await this.storage.set({ [key]: value }); }
        live.push(publicTask(value));
      }
      if (remove.length) await this.storage.remove(remove);
      live.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      return { ok: true, value: live };
    });
  }

  claim(taskId: string): Promise<PlatformResult<ClaimedWebImageTask>> {
    return this.run(async () => {
      const key = this.key(taskId); const stored = await this.storage.get(key); const value = stored[key];
      if (!isTask(value)) return { ok: false, code: "cancelled", message: "Task unavailable" };
      if (value.claim && value.claim.expiresAt > this.now()) return {
        ok: false, code: "cancelled", message: "Task already leased",
        retryAfterSeconds: Math.ceil((value.claim.expiresAt - this.now()) / 1000),
      };
      if (value.expiresAt <= this.now()) { await this.storage.remove(key); return { ok: false, code: "cancelled", message: "Task expired" }; }
      const claimId = this.randomUUID();
      const leaseExpiresAt = this.now() + IMAGE_TASK_LEASE_MS;
      value.claim = { id: claimId, expiresAt: leaseExpiresAt };
      value.expiresAt = Math.max(value.expiresAt, leaseExpiresAt + IMAGE_TASK_RECOVERY_MS);
      await this.storage.set({ [key]: value });
      return { ok: true, value: { task: publicTask(value), claimId } };
    });
  }

  ack(taskId: string, claimId: string): Promise<PlatformResult<void>> { return this.finish(taskId, claimId, true); }
  release(taskId: string, claimId: string): Promise<PlatformResult<void>> { return this.finish(taskId, claimId, false); }
  renew(taskId: string, claimId: string): Promise<PlatformResult<void>> {
    return this.run(async () => {
      const key = this.key(taskId); const stored = await this.storage.get(key); const value = stored[key];
      if (!isTask(value) || value.claim?.id !== claimId) return { ok: false, code: "cancelled", message: "Lease unavailable" };
      const leaseExpiresAt = this.now() + IMAGE_TASK_LEASE_MS;
      value.claim.expiresAt = leaseExpiresAt;
      value.expiresAt = Math.max(value.expiresAt, leaseExpiresAt + IMAGE_TASK_RECOVERY_MS);
      await this.storage.set({ [key]: value });
      return { ok: true, value: undefined };
    });
  }
  cleanup(): Promise<PlatformResult<void>> { return this.run(async () => { await this.cleanupExpired(); return { ok: true, value: undefined }; }); }
  drainPendingAcks(): Promise<PlatformResult<void>> {
    return this.run(async () => {
      const all = await this.storage.get(null);
      for (const [markerKey, marker] of Object.entries(all)) {
        if (!markerKey.startsWith(PENDING_ACK_KEY_PREFIX)) continue;
        const pending = marker as { taskId?: string; claimId?: string };
        if (pending.taskId && pending.claimId) {
          const key = this.key(pending.taskId); const stored = await this.storage.get(key); const value = stored[key];
          if (isTask(value) && value.claim?.id === pending.claimId) await this.storage.remove(key);
        }
        await this.storage.remove(markerKey);
      }
      return { ok: true, value: undefined };
    });
  }

  private finish(taskId: string, claimId: string, remove: boolean): Promise<PlatformResult<void>> {
    return this.run(async () => {
      const key = this.key(taskId); const stored = await this.storage.get(key); const value = stored[key];
      if (!isTask(value)) return remove ? { ok: true, value: undefined } : { ok: false, code: "cancelled", message: "Lease unavailable" };
      if (value.claim?.id !== claimId) return { ok: false, code: "cancelled", message: "Lease unavailable" };
      if (remove) await this.storage.remove(key); else { delete value.claim; await this.storage.set({ [key]: value }); }
      return { ok: true, value: undefined };
    });
  }
  private async cleanupExpired() { const all = await this.storage.get(null); const keys = Object.entries(all).filter(([k,v]) => k.startsWith(IMAGE_TASK_KEY_PREFIX) && isTask(v) && v.expiresAt <= this.now()).map(([k]) => k); if (keys.length) await this.storage.remove(keys); }
  private key(id: string) { return `${IMAGE_TASK_KEY_PREFIX}${id}`; }
  private run<T>(op: () => Promise<PlatformResult<T>>): Promise<PlatformResult<T>> { const result = this.queue.catch(() => undefined).then(op).catch((cause) => ({ ok: false as const, code: "unknown" as const, cause })); this.queue = result; return result; }
}
function isTask(value: unknown): value is StoredWebImageTask { const t = value as Partial<StoredWebImageTask> | null; return !!t && typeof t.id === "string" && typeof t.imageUrl === "string" && typeof t.createdAt === "number" && typeof t.expiresAt === "number"; }
function publicTask(value: StoredWebImageTask): WebImageTask { const { claim: _claim, ...task } = value; return task; }
