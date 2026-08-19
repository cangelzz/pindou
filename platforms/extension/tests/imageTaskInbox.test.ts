import { describe, expect, it, vi } from "vitest";
import { createImageTaskInbox } from "../imageTaskInbox";
import type { BrowserApi, BrowserMessageListener } from "../browserApi";

function apiFixture() {
  let listener: BrowserMessageListener | undefined;
  const api = { runtime: { onMessage: { addListener: vi.fn((fn) => listener = fn), removeListener: vi.fn() } } } as unknown as BrowserApi;
  return { api, wake: () => listener?.({ type: "pindou:image-task" }, {}, vi.fn()), listener: () => listener };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("image task editor inbox", () => {
  it("uses runtime messages only as wakes and emits broker metadata FIFO", async () => {
    const f = apiFixture();
    const service = { listPendingTasks: vi.fn(async () => ({ ok: true as const, value: [
      { id: "A", createdAt: 1 }, { id: "B", createdAt: 2 },
    ] })) };
    const inbox = createImageTaskInbox(f.api, service as never);
    const received: string[] = []; inbox.subscribe((task) => received.push(task.id));
    f.wake(); f.wake();
    await inbox.start(); await tick();
    expect(received).toEqual(["A", "B"]);
    expect(service.listPendingTasks).toHaveBeenCalledTimes(1);
  });

  it("starts and flushes runtime tasks even when the initial broker list rejects", async () => {
    const f = apiFixture();
    let attempt = 0;
    const service = { listPendingTasks: vi.fn(async () => {
      if (++attempt === 1) throw new Error("broker unavailable");
      return { ok: true as const, value: [{ id: "live", createdAt: 3 }] };
    }) };
    const inbox = createImageTaskInbox(f.api, service as never);
    const received: string[] = []; inbox.subscribe((task) => received.push(task.id));
    await expect(inbox.start()).resolves.toBeUndefined();
    f.wake(); await tick();
    expect(received).toEqual(["live"]);
  });

  it("retains startup tasks until a subscriber receives them", async () => {
    const f = apiFixture();
    const service = { listPendingTasks: vi.fn(async () => ({ ok: true as const, value: [{ id: "waiting", createdAt: 1 }] })) };
    const inbox = createImageTaskInbox(f.api, service as never);
    await inbox.start();
    const received: string[] = []; inbox.subscribe((task) => received.push(task.id)); await tick();
    expect(received).toEqual(["waiting"]);
  });

  it("re-announces an unclaimed task after the last subscriber leaves and StrictMode resubscribes", async () => {
    const f = apiFixture();
    const service = { listPendingTasks: vi.fn(async () => ({ ok: true as const, value: [{ id: "strict", createdAt: 1 }] })) };
    const inbox = createImageTaskInbox(f.api, service as never);
    await inbox.start();
    const first: string[] = []; const unsubscribe = inbox.subscribe((task) => first.push(task.id)); await tick();
    unsubscribe();
    const second: string[] = []; inbox.subscribe((task) => second.push(task.id)); await tick();
    expect(first).toEqual(["strict"]);
    expect(second).toEqual(["strict"]);
  });

  it("deduplicates overlapping wakes while a subscriber remains active", async () => {
    const f = apiFixture();
    const service = { listPendingTasks: vi.fn(async () => ({ ok: true as const, value: [{ id: "once", createdAt: 1 }] })) };
    const inbox = createImageTaskInbox(f.api, service as never);
    const received: string[] = []; inbox.subscribe((task) => received.push(task.id));
    await inbox.start(); f.wake(); f.wake(); await tick();
    expect(received).toEqual(["once"]);
    inbox.dispose();
    expect(f.api.runtime.onMessage.removeListener).toHaveBeenCalledWith(f.listener());
  });
});
