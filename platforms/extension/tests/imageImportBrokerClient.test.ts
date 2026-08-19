import { describe, expect, it, vi } from "vitest";
import { ExtensionImageImportService } from "../imageImportService";

const task = { id: "same", imageUrl: "https://x/cat", createdAt: 1, expiresAt: 10_000 };

describe("ExtensionImageImportService broker client", () => {
  it("two service instances rely on broker claim so only one fetches", async () => {
    let claimed = false;
    const broker = { request: vi.fn(async (action: string) => action === "renew" ? { ok: true, value: undefined } : claimed ? { ok: false, code: "cancelled" } : (claimed = true, { ok: true, value: { task, claimId: "lease" } })) };
    const fetcher = vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { headers: { "Content-Type": "image/png" } }));
    const a = new ExtensionImageImportService(broker, fetcher, undefined, () => "a");
    const b = new ExtensionImageImportService(broker, fetcher, undefined, () => "b");
    const results = await Promise.all([a.fetchWebImage("same"), b.fetchWebImage("same")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("retries acknowledge twice and succeeds on the third attempt", async () => {
    let acknowledgements = 0;
    const broker = { request: vi.fn(async (action: string) => {
      if (action === "claim") return { ok: true, value: { task, claimId: "lease" } };
      if (action === "renew") return { ok: true, value: undefined };
      if (action === "ack") return ++acknowledgements === 3 ? { ok: true, value: undefined } : { ok: false, code: "network" };
      return { ok: true, value: undefined };
    }), queueAck: vi.fn() };
    const fetcher = vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { headers: { "Content-Type": "image/png" } }));
    const service = new ExtensionImageImportService(broker, fetcher);
    await service.fetchWebImage("same");
    await expect(service.acknowledgeTask("same")).resolves.toEqual({ ok: true, value: undefined });
    expect(acknowledgements).toBe(3); expect(broker.queueAck).not.toHaveBeenCalled();
  });

  it("queues a durable marker when all acknowledge attempts fail", async () => {
    const broker = { request: vi.fn(async (action: string) => action === "claim" ? { ok: true, value: { task, claimId: "lease" } } : action === "renew" ? { ok: true, value: undefined } : { ok: false, code: "network" }), queueAck: vi.fn(async () => ({ ok: true, value: undefined })) };
    const fetcher = vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { headers: { "Content-Type": "image/png" } }));
    const service = new ExtensionImageImportService(broker, fetcher); await service.fetchWebImage("same");
    await expect(service.acknowledgeTask("same")).resolves.toEqual({ ok: true, value: undefined });
    expect(broker.queueAck).toHaveBeenCalledWith("same", "lease");
  });

  it("retries release twice and succeeds on the third attempt", async () => {
    let releases = 0;
    const broker = { request: vi.fn(async (action: string) => {
      if (action === "claim") return { ok: true, value: { task, claimId: "lease" } };
      if (action === "renew") return { ok: true, value: undefined };
      if (action === "release") return ++releases === 3 ? { ok: true, value: undefined } : { ok: false, code: "network" };
      return { ok: true, value: undefined };
    }) };
    const fetcher = vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { headers: { "Content-Type": "image/png" } }));
    const service = new ExtensionImageImportService(broker, fetcher);
    await service.fetchWebImage("same");
    await expect(service.releaseTask("same")).resolves.toEqual({ ok: true, value: undefined });
    expect(releases).toBe(3);
  });

  it("maps a rejected broker claim to unknown instead of rejecting", async () => {
    const broker = { request: vi.fn(async () => { throw new Error("runtime disconnected"); }) };
    const service = new ExtensionImageImportService(broker);
    await expect(service.fetchWebImage("task")).resolves.toMatchObject({ ok: false, code: "unknown" });
  });

  it("lists pending metadata through broker without touching storage", async () => {
    const broker = { request: vi.fn(async () => ({ ok: true, value: [task] })) };
    const service = new ExtensionImageImportService(broker);
    expect(await service.listPendingTasks()).toEqual({ ok: true, value: [task] });
    expect(broker.request).toHaveBeenCalledWith("list");
  });
});
