import { describe, expect, it, vi } from "vitest";
import type { BrowserApi, BrowserMessageListener } from "../browserApi";
import { registerImageTaskHandlers, IMAGE_TASK_TTL_MS } from "../background";
import { IMAGE_TASK_KEY_PREFIX } from "../imageTaskBroker";

function fakeApi(now = 1_000) {
  const data: Record<string, unknown> = {};
  let installed: (() => void) | undefined;
  let clicked: ((info: { menuItemId: string; srcUrl?: string; pageUrl?: string }) => void) | undefined;
  let message: BrowserMessageListener | undefined;
  const local = {
    get: vi.fn(async (key?: string | null) => key == null ? { ...data } : { [key]: data[key] }),
    set: vi.fn(async (items: Record<string, unknown>) => Object.assign(data, items)),
    remove: vi.fn(async (key: string | string[]) => { for (const item of Array.isArray(key) ? key : [key]) delete data[item]; }),
  };
  const api = {
    runtime: { getURL: vi.fn(() => "chrome-extension://x/index.html"), sendMessage: vi.fn(), onInstalled: { addListener: vi.fn((h) => installed = h) }, onMessage: { addListener: vi.fn((h) => message = h), removeListener: vi.fn() } },
    tabs: { query: vi.fn(async () => []), update: vi.fn(async () => undefined), create: vi.fn(async () => ({ id: 9 })), sendMessage: vi.fn(async () => undefined) },
    windows: { update: vi.fn(async () => undefined) }, action: { onClicked: { addListener: vi.fn() } },
    contextMenus: { create: vi.fn(), remove: vi.fn(async () => undefined), onClicked: { addListener: vi.fn((h) => clicked = h) } },
    storage: { local },
  } as unknown as BrowserApi;
  const brokerRequest = (action: string, payload?: unknown) => new Promise<unknown>((resolve) => {
    expect(message?.({ type: "pindou:image-task-broker", action, payload }, {}, resolve)).toBe(true);
  });
  return { api, data, now, installed: () => installed, clicked: () => clicked, brokerRequest };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("web image context task", () => {
  it("registers menu idempotently and ignores unrelated clicks", async () => {
    const f = fakeApi(); registerImageTaskHandlers(f.api, { now: () => f.now, randomUUID: () => "id" });
    f.installed()?.(); await tick();
    expect(f.api.contextMenus.remove).toHaveBeenCalledWith("convert-image");
    expect(f.api.contextMenus.create).toHaveBeenCalledWith({ id: "convert-image", title: "Convert with PindouVerse", contexts: ["image"] });
    f.clicked()?.({ menuItemId: "other", srcUrl: "https://a/x.png" }); await tick();
    expect(f.api.tabs.create).not.toHaveBeenCalled();
  });

  it("creates an independent five-minute task key, opens editor, and sends metadata", async () => {
    const f = fakeApi(); registerImageTaskHandlers(f.api, { now: () => f.now, randomUUID: () => "unique" });
    f.clicked()?.({ menuItemId: "convert-image", srcUrl: "https://a/x.png", pageUrl: "https://a/" }); await tick();
    const task = { id: "unique", imageUrl: "https://a/x.png", pageUrl: "https://a/", createdAt: f.now, expiresAt: f.now + IMAGE_TASK_TTL_MS };
    expect(f.data[`${IMAGE_TASK_KEY_PREFIX}unique`]).toEqual(task);
    expect(f.api.tabs.sendMessage).toHaveBeenCalledWith(9, { type: "pindou:image-task", taskId: "unique", createdAt: f.now });
  });

  it("retains task when editor messaging fails and broker remains usable", async () => {
    const f = fakeApi(); vi.mocked(f.api.tabs.sendMessage).mockRejectedValueOnce(new Error("not mounted"));
    registerImageTaskHandlers(f.api, { now: () => f.now, randomUUID: () => "new" });
    f.clicked()?.({ menuItemId: "convert-image", srcUrl: "https://a/x.png" }); await tick();
    expect(f.data[`${IMAGE_TASK_KEY_PREFIX}new`]).toBeDefined();
    expect(await f.brokerRequest("list")).toMatchObject({ ok: true, value: [expect.objectContaining({ id: "new" })] });
  });

  it("serializes context creation and runtime claim without touching another task", async () => {
    const f = fakeApi(); let id = 0;
    registerImageTaskHandlers(f.api, { now: () => f.now, randomUUID: () => `id-${++id}` });
    f.clicked()?.({ menuItemId: "convert-image", srcUrl: "https://a/1.png" });
    f.clicked()?.({ menuItemId: "convert-image", srcUrl: "https://a/2.png" }); await tick(); await tick();
    expect(await f.brokerRequest("claim", { taskId: "id-1" })).toMatchObject({ ok: true, value: { task: { id: "id-1" }, claimId: expect.any(String) } });
    expect(f.data[`${IMAGE_TASK_KEY_PREFIX}id-2`]).toBeDefined();
  });
});
