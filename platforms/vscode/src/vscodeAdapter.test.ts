import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postedMessages: Array<Record<string, unknown>> = [];
let testWindow: EventTarget;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  postedMessages.length = 0;
  testWindow = new EventTarget();
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage(message: Record<string, unknown>) {
      postedMessages.push(message);
    },
    getState: () => undefined,
    setState: () => undefined,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function adapterModule() {
  return import("./vscodeAdapter");
}

function replyTo(index: number, payload: Record<string, unknown>) {
  const requestId = postedMessages[index].requestId;
  testWindow.dispatchEvent(new MessageEvent("message", {
    data: { requestId, ...payload },
  }));
}

describe("VS Code in-place save RPC", () => {
  it("waits for the host save result and carries a requestId", async () => {
    const { VScodeAdapter } = await adapterModule();
    testWindow.dispatchEvent(new MessageEvent("message", { data: { type: "loadDocument", content: "{}", path: "/current.pindou" } }));
    const request = new VScodeAdapter().saveProject("/current.pindou", { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: null }]] } as any);

    expect(postedMessages[0]).toMatchObject({ type: "save", requestId: 1 });
    replyTo(0, { type: "saveResult", success: true });
    await expect(request).resolves.toBeUndefined();
  });

  it("rejects failed and timed-out host saves", async () => {
    const { VScodeAdapter } = await adapterModule();
    testWindow.dispatchEvent(new MessageEvent("message", { data: { type: "loadDocument", content: "{}", path: "/current.pindou" } }));
    const adapter = new VScodeAdapter();
    const failed = adapter.saveProject("/current.pindou", { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: null }]] } as any);
    replyTo(0, { type: "saveResult", success: false, error: "disk full" });
    await expect(failed).rejects.toThrow("disk full");

    const timedOut = adapter.saveProject("/current.pindou", { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: null }]] } as any);
    const rejection = expect(timedOut).rejects.toThrow("VS Code request save timed out");
    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
  });
});

describe("VS Code RPC timeout classification", () => {
  it("allows readFile to resolve after five seconds", async () => {
    const { sendRequest } = await adapterModule();
    const request = sendRequest("readFile", { path: "/large.pindou" });

    await vi.advanceTimersByTimeAsync(6_000);
    replyTo(0, { data: "ok" });

    await expect(request).resolves.toMatchObject({ data: "ok" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows a large export write to resolve within 120 seconds", async () => {
    const { sendRequest } = await adapterModule();
    const request = sendRequest("writeFile", { path: "/large.png", operation: "export" });

    await vi.advanceTimersByTimeAsync(61_000);
    replyTo(0, { success: true });

    await expect(request).resolves.toMatchObject({ success: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["listSnapshots", "getAutosaveDir"])(
    "allows slow metadata operation %s to resolve after five seconds",
    async (type) => {
      const { sendRequest } = await adapterModule();
      const request = sendRequest(type);

      await vi.advanceTimersByTimeAsync(6_000);
      replyTo(0, { data: "ok" });

      await expect(request).resolves.toMatchObject({ data: "ok" });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["showOpenDialog", "showSaveDialog"])(
    "does not time out file dialog %s",
    async (type) => {
      const { sendRequest } = await adapterModule();
      const request = sendRequest(type);

      await vi.advanceTimersByTimeAsync(121_000);
      replyTo(0, { path: null });

      await expect(request).resolves.toMatchObject({ path: null });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["storageGet", "getUiEnvironment"])(
    "times out bootstrap operation %s at five seconds and removes it from pending requests",
    async (type) => {
      const { sendRequest } = await adapterModule();
      const request = sendRequest(type);
      const rejection = expect(request).rejects.toThrow(`VS Code request ${type} timed out`);

      await vi.advanceTimersByTimeAsync(5_000);
      await rejection;
      expect(vi.getTimerCount()).toBe(0);

      const lateReply = { requestId: postedMessages[0].requestId } as Record<string, unknown>;
      Object.defineProperty(lateReply, "error", {
        get: () => { throw new Error("timed-out request remained pending"); },
      });
      expect(() => testWindow.dispatchEvent(new MessageEvent("message", { data: lateReply }))).not.toThrow();
    },
  );
});
