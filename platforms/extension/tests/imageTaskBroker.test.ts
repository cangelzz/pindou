import { describe, expect, it, vi } from "vitest";
import { WebImageTaskBroker, IMAGE_TASK_KEY_PREFIX, IMAGE_TASK_LEASE_MS } from "../imageTaskBroker";
import type { BrowserStorageArea } from "../browserApi";

function storageFixture(seed: Record<string, unknown> = {}) {
  const data = { ...seed };
  const storage: BrowserStorageArea = {
    get: vi.fn(async (key?: string | null) => key == null ? { ...data } : { [key]: data[key] }),
    set: vi.fn(async (items) => { Object.assign(data, items); }),
    remove: vi.fn(async (key) => { for (const item of Array.isArray(key) ? key : [key]) delete data[item]; }),
  };
  return { data, storage };
}
const task = (id: string, createdAt: number, expiresAt = 99_999) => ({ id, imageUrl: `https://x/${id}.png`, createdAt, expiresAt });

describe("WebImageTaskBroker leases", () => {
  it("allows one active lease without deleting the task", async () => {
    const f = storageFixture({ [`${IMAGE_TASK_KEY_PREFIX}same`]: task("same", 1) });
    let claimId = 0;
    const broker = new WebImageTaskBroker(f.storage, () => 2, () => `claim-${++claimId}`);
    const [a, b] = await Promise.all([broker.claim("same"), broker.claim("same")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const success = a.ok ? a : b.ok ? b : undefined;
    expect(success?.value).toMatchObject({ task: { id: "same" }, claimId: "claim-1" });
    expect(f.data[`${IMAGE_TASK_KEY_PREFIX}same`]).toMatchObject({ claim: { id: "claim-1", expiresAt: 2 + IMAGE_TASK_LEASE_MS } });
  });

  it("ack removes only a matching lease and release makes it immediately listable", async () => {
    const f = storageFixture({ [`${IMAGE_TASK_KEY_PREFIX}t`]: task("t", 1) });
    const broker = new WebImageTaskBroker(f.storage, () => 2, () => "lease");
    await broker.claim("t");
    expect(await broker.list()).toEqual({ ok: true, value: [] });
    expect(await broker.release("t", "wrong")).toMatchObject({ ok: false, code: "cancelled" });
    expect(await broker.release("t", "lease")).toEqual({ ok: true, value: undefined });
    expect(await broker.list()).toMatchObject({ ok: true, value: [{ id: "t" }] });
    await broker.claim("t");
    expect(await broker.ack("t", "lease")).toEqual({ ok: true, value: undefined });
    expect(await broker.list()).toEqual({ ok: true, value: [] });
  });

  it("recovers an expired lease after worker restart", async () => {
    let now = 10;
    const stored = { ...task("t", 1), claim: { id: "old", expiresAt: 20 } };
    const f = storageFixture({ [`${IMAGE_TASK_KEY_PREFIX}t`]: stored });
    const restarted = new WebImageTaskBroker(f.storage, () => now, () => "new");
    expect(await restarted.list()).toEqual({ ok: true, value: [] });
    now = 21;
    expect(await restarted.list()).toEqual({ ok: true, value: [task("t", 1)] });
    expect(f.data[`${IMAGE_TASK_KEY_PREFIX}t`]).toEqual(task("t", 1));
    expect(await restarted.claim("t")).toMatchObject({ ok: true, value: { claimId: "new" } });
  });

  it("keeps an active lease beyond the original task TTL and renews its recovery window", async () => {
    let now = 0;
    const f = storageFixture({ [`${IMAGE_TASK_KEY_PREFIX}t`]: task("t", 1, 5) });
    const broker = new WebImageTaskBroker(f.storage, () => now, () => "lease");
    const claimed = await broker.claim("t"); expect(claimed).toMatchObject({ ok: true });
    now = 6;
    expect(await broker.list()).toEqual({ ok: true, value: [] });
    expect(await broker.claim("t")).toMatchObject({ ok: false, code: "cancelled", retryAfterSeconds: expect.any(Number) });
    now = IMAGE_TASK_LEASE_MS - 1;
    expect(await broker.renew("t", "lease")).toEqual({ ok: true, value: undefined });
    const stored = f.data[`${IMAGE_TASK_KEY_PREFIX}t`] as any;
    expect(stored.expiresAt).toBeGreaterThan(stored.claim.expiresAt);
    expect(await broker.ack("t", "lease")).toEqual({ ok: true, value: undefined });
  });

  it("drains matching durable ack markers and ignores mismatched claims", async () => {
    const f = storageFixture({
      [`${IMAGE_TASK_KEY_PREFIX}done`]: { ...task("done", 1), claim: { id: "right", expiresAt: 100 } },
      [`pindou.pendingImageAck.done`]: { taskId: "done", claimId: "right" },
      [`${IMAGE_TASK_KEY_PREFIX}keep`]: { ...task("keep", 1), claim: { id: "current", expiresAt: 100 } },
      [`pindou.pendingImageAck.keep`]: { taskId: "keep", claimId: "wrong" },
    });
    const broker = new WebImageTaskBroker(f.storage, () => 2);
    expect(await broker.drainPendingAcks()).toEqual({ ok: true, value: undefined });
    expect(f.data[`${IMAGE_TASK_KEY_PREFIX}done`]).toBeUndefined();
    expect(f.data[`${IMAGE_TASK_KEY_PREFIX}keep`]).toBeDefined();
    expect(f.data[`pindou.pendingImageAck.done`]).toBeUndefined();
    expect(f.data[`pindou.pendingImageAck.keep`]).toBeUndefined();
  });

  it("treats repeated ack of an already removed task as success", async () => {
    const broker = new WebImageTaskBroker(storageFixture().storage, () => 2);
    expect(await broker.ack("gone", "lease")).toEqual({ ok: true, value: undefined });
  });

  it("removes an expired task when claimed", async () => {
    const f = storageFixture({ [`${IMAGE_TASK_KEY_PREFIX}old`]: task("old", 1, 2) });
    const broker = new WebImageTaskBroker(f.storage, () => 5);
    expect(await broker.claim("old")).toMatchObject({ ok: false, code: "cancelled" });
    expect(f.data[`${IMAGE_TASK_KEY_PREFIX}old`]).toBeUndefined();
  });
});
