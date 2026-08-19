import { describe, expect, it, vi } from "vitest";
import { ImageTaskScheduler } from "./imageTaskScheduler";
import type { ImageImportAsset, ImageImportService } from "./imageImportService";

const asset = (id: string): ImageImportAsset => ({ id, file: new File([id], `${id}.png`), displayName: `${id}.png`, source: "web-context-menu" });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => resolve = r); return { promise, resolve }; }

describe("ImageTaskScheduler", () => {
  it("holds B while A fetches and while A dialog owns its asset, then consumes A before B", async () => {
    const a = deferred<any>();
    const service = { fetchWebImage: vi.fn((id: string) => id === "A" ? a.promise : Promise.resolve({ ok: true, value: asset(id) })), getAsset: vi.fn(() => asset("A")), consumeAsset: vi.fn() } as unknown as ImageImportService;
    const shown: string[] = [];
    const scheduler = new ImageTaskScheduler(service, { showAsset: (x) => shown.push(x.id), showError: vi.fn() });
    scheduler.enqueue({ id: "A", createdAt: 1 }); scheduler.enqueue({ id: "B", createdAt: 2 });
    expect(service.fetchWebImage).toHaveBeenCalledTimes(1);
    a.resolve({ ok: true, value: asset("A") }); await Promise.resolve(); await Promise.resolve();
    expect(shown).toEqual(["A"]); expect(service.fetchWebImage).toHaveBeenCalledTimes(1);
    scheduler.completeAsset("A"); await Promise.resolve(); await Promise.resolve();
    expect(service.consumeAsset).toHaveBeenCalledWith("A"); expect(shown).toEqual(["A", "B"]);
  });

  it("turns a rejected fetch into an error and continues after close", async () => {
    const service = { fetchWebImage: vi.fn((id: string) => id === "A" ? Promise.reject(new Error("broker down")) : Promise.resolve({ ok: true, value: asset(id) })), consumeAsset: vi.fn() } as unknown as ImageImportService;
    const errors: string[] = [], shown: string[] = [];
    const scheduler = new ImageTaskScheduler(service, { showAsset: (x) => shown.push(x.id), showError: (id) => errors.push(id) });
    scheduler.enqueue({ id: "A", createdAt: 1 }); scheduler.enqueue({ id: "B", createdAt: 2 }); await Promise.resolve(); await Promise.resolve();
    expect(errors).toEqual(["A"]);
    scheduler.completeError(); await Promise.resolve(); await Promise.resolve(); expect(shown).toEqual(["B"]);
  });

  it("retries a deferred cancelled claim and clears the timer on dispose", async () => {
    const callbacks: Array<() => void> = [];
    const clear = vi.fn(); let attempts = 0;
    const service = { fetchWebImage: vi.fn(async () => ++attempts === 1 ? { ok: false, code: "cancelled", retryAfterSeconds: 2 } : { ok: true, value: asset("A") }), getAsset: vi.fn(() => asset("A")), consumeAsset: vi.fn() } as unknown as ImageImportService;
    const shown: string[] = [];
    const scheduler = new ImageTaskScheduler(service, { showAsset: (x) => shown.push(x.id), showError: vi.fn() }, (cb) => { callbacks.push(cb); return 7 as any; }, clear);
    scheduler.enqueue({ id: "A", createdAt: 1 }); await Promise.resolve(); await Promise.resolve();
    expect(shown).toEqual([]); callbacks[0](); await Promise.resolve(); await Promise.resolve(); expect(shown).toEqual(["A"]);
    scheduler.dispose(); expect(clear).not.toHaveBeenCalled();
  });

  it("silently skips cancelled claims and processes the next task", async () => {
    const service = { fetchWebImage: vi.fn(async (id: string) => id === "A" ? { ok: false, code: "cancelled" } : { ok: true, value: asset(id) }), consumeAsset: vi.fn() } as unknown as ImageImportService;
    const errors: string[] = [], shown: string[] = [];
    const scheduler = new ImageTaskScheduler(service, { showAsset: (x) => shown.push(x.id), showError: (id) => errors.push(id) });
    scheduler.enqueue({ id: "A", createdAt: 1 }); scheduler.enqueue({ id: "B", createdAt: 2 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(errors).toEqual([]); expect(shown).toEqual(["B"]);
  });

  it("waits for error close before processing B", async () => {
    const service = { fetchWebImage: vi.fn(async (id: string) => id === "A" ? { ok: false, code: "network" } : { ok: true, value: asset(id) }), consumeAsset: vi.fn() } as unknown as ImageImportService;
    const errors: string[] = [], shown: string[] = [];
    const scheduler = new ImageTaskScheduler(service, { showAsset: (x) => shown.push(x.id), showError: (id) => errors.push(id) });
    scheduler.enqueue({ id: "A", createdAt: 1 }); scheduler.enqueue({ id: "B", createdAt: 2 }); await Promise.resolve(); await Promise.resolve();
    expect(errors).toEqual(["A"]); expect(shown).toEqual([]);
    scheduler.completeError(); await Promise.resolve(); await Promise.resolve(); expect(shown).toEqual(["B"]);
  });

  it.each(["dialog-first", "dispose-first"])("releases an active web asset once when cleanup order is %s", async (order) => {
    const active = asset("A");
    const service = {
      fetchWebImage: vi.fn(async () => ({ ok: true as const, value: active })),
      getAsset: vi.fn(() => active),
      consumeAsset: vi.fn(),
    } as unknown as ImageImportService;
    const scheduler = new ImageTaskScheduler(service, { showAsset: vi.fn(), showError: vi.fn() });
    scheduler.enqueue({ id: "A", createdAt: 1 }); await Promise.resolve(); await Promise.resolve();
    if (order === "dialog-first") {
      scheduler.completeAsset("A");
      scheduler.dispose();
    } else {
      scheduler.dispose();
      scheduler.completeAsset("A");
    }
    expect(service.consumeAsset).toHaveBeenCalledTimes(1);
    expect(service.consumeAsset).toHaveBeenCalledWith("A");
  });

  it("releases a claimed task on dispose so another scheduler can claim and display it", async () => {
    let leased = false;
    const active = asset("A");
    const service = {
      fetchWebImage: vi.fn(async () => leased ? { ok: false, code: "cancelled" } : (leased = true, { ok: true, value: active })),
      getAsset: vi.fn(() => active), consumeAsset: vi.fn(),
      releaseTask: vi.fn(async () => { leased = false; return { ok: true, value: undefined }; }),
      acknowledgeTask: vi.fn(async () => ({ ok: true, value: undefined })),
    } as unknown as ImageImportService;
    const first = new ImageTaskScheduler(service, { showAsset: vi.fn(), showError: vi.fn() });
    first.enqueue({ id: "A", createdAt: 1 }); await Promise.resolve(); await Promise.resolve(); first.dispose(); await Promise.resolve();
    const shown: string[] = [];
    const second = new ImageTaskScheduler(service, { showAsset: (x) => shown.push(x.id), showError: vi.fn() });
    second.enqueue({ id: "A", createdAt: 1 }); await Promise.resolve(); await Promise.resolve();
    expect(service.releaseTask).toHaveBeenCalledWith("A"); expect(shown).toEqual(["A"]);
  });

  it("consumes a late success after unmount", async () => {
    const pending = deferred<any>();
    const service = { fetchWebImage: vi.fn(() => pending.promise), consumeAsset: vi.fn() } as unknown as ImageImportService;
    const scheduler = new ImageTaskScheduler(service, { showAsset: vi.fn(), showError: vi.fn() });
    scheduler.enqueue({ id: "A", createdAt: 1 }); scheduler.dispose();
    pending.resolve({ ok: true, value: asset("A") }); await Promise.resolve(); await Promise.resolve();
    expect(service.consumeAsset).toHaveBeenCalledWith("A");
  });
});
