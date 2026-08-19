import { describe, expect, it, vi } from "vitest";
import { BrowserGitHubService } from "../githubService";
import { GITHUB_ACCESS_TOKEN_KEY, GITHUB_REVOKED_SESSION_KEY } from "../browserStorage";

const info = { device_code: "device", user_code: "USER-CODE", verification_uri: "https://github.com/login/device", expires_in: 30, interval: 1 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function setup(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {};
  const storage = {
    get: vi.fn(async (key: string) => ({ ok: true as const, value: values[key] })),
    set: vi.fn(async (key: string, value: unknown) => { values[key] = value; return { ok: true as const, value: undefined }; }),
    remove: vi.fn(async (key: string) => { delete values[key]; return { ok: true as const, value: undefined }; }),
  };
  const fetch = vi.fn();
  let time = 1000;
  const service = new BrowserGitHubService({ clientId: "client", storage, fetch, sleep: vi.fn(async () => {}), now: () => time, ...overrides });
  return { service, storage, fetch, values, advance: (ms: number) => { time += ms; } };
}

describe("BrowserGitHubService", () => {
  it("binds the native fetch receiver before storing it", async () => {
    const originalFetch = globalThis.fetch;
    const nativeFetch = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(response(info));
    });
    globalThis.fetch = nativeFetch as typeof fetch;
    const storage = {
      get: vi.fn(async () => ({ ok: true as const, value: undefined })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
      remove: vi.fn(async () => ({ ok: true as const, value: undefined })),
    };
    try {
      const service = new BrowserGitHubService({ clientId: "client", storage });
      expect(await service.startDeviceFlow(new AbortController().signal)).toEqual({ ok: true, value: info });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("starts device flow with GitHub form endpoints and validates the response", async () => {
    const { service, fetch } = setup();
    fetch.mockResolvedValueOnce(response(info));
    expect(await service.startDeviceFlow(new AbortController().signal)).toEqual({ ok: true, value: info });
    expect(fetch).toHaveBeenCalledWith("https://github.com/login/device/code", expect.objectContaining({
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: "client_id=client&scope=gist",
    }));
  });

  it("does not request when client id is missing", async () => {
    const { service, fetch } = setup({ clientId: "" });
    expect(service.configured).toBe(false);
    expect(await service.startDeviceFlow(new AbortController().signal)).toMatchObject({ ok: false, code: "authentication", message: expect.stringContaining("client") });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("polls pending to success, stores token, and publishes session", async () => {
    const { service, fetch, storage } = setup();
    fetch.mockResolvedValueOnce(response({ error: "authorization_pending" })).mockResolvedValueOnce(response({ access_token: "secret-token", token_type: "bearer", scope: "gist" }));
    const listener = vi.fn(); service.subscribe(listener);
    expect(await service.pollDeviceFlow(info, vi.fn(), new AbortController().signal)).toEqual({ ok: true, value: { authenticated: true, login: "GitHub" } });
    expect(storage.set).toHaveBeenCalledWith(GITHUB_ACCESS_TOKEN_KEY, "secret-token");
    expect(listener).toHaveBeenCalledWith({ authenticated: true, login: "GitHub" });
  });

  it("permanently and cumulatively increases polling interval on slow_down", async () => {
    const sleeps: number[] = [];
    const { service, fetch } = setup({ sleep: async (ms: number) => { sleeps.push(ms); } });
    fetch.mockResolvedValueOnce(response({ error: "slow_down" })).mockResolvedValueOnce(response({ error: "slow_down" })).mockResolvedValueOnce(response({ access_token: "t", token_type: "bearer", scope: "gist" }));
    await service.pollDeviceFlow(info, vi.fn(), new AbortController().signal);
    expect(sleeps).toEqual([1000, 6000, 11000]);
  });

  it.each([
    [{ error: "access_denied", error_description: "The user denied access" }, "authentication", "denied"],
    [{ error: "expired_token" }, "authentication", "expired"],
  ])("maps OAuth failure %o", async (body, code, message) => {
    const { service, fetch } = setup(); fetch.mockResolvedValueOnce(response(body));
    expect(await service.pollDeviceFlow(info, vi.fn(), new AbortController().signal)).toMatchObject({ ok: false, code, message: expect.stringContaining(message) });
  });

  it("handles deadline, cancellation, network, non-2xx, and invalid JSON", async () => {
    const expired = setup();
    expect(await expired.service.pollDeviceFlow({ ...info, expires_in: 0 }, vi.fn(), new AbortController().signal)).toMatchObject({ ok: false, code: "authentication", message: expect.stringContaining("expired") });
    const cancelled = setup(); const controller = new AbortController(); controller.abort();
    expect(await cancelled.service.pollDeviceFlow(info, vi.fn(), controller.signal)).toMatchObject({ ok: false, code: "cancelled" });
    const network = setup(); network.fetch.mockRejectedValueOnce(new Error("offline"));
    expect(await network.service.pollDeviceFlow(info, vi.fn(), new AbortController().signal)).toMatchObject({ ok: false, code: "network" });
    const http = setup(); http.fetch.mockResolvedValueOnce(response({}, 503));
    expect(await http.service.pollDeviceFlow(info, vi.fn(), new AbortController().signal)).toMatchObject({ ok: false, code: "network" });
    const invalid = setup(); invalid.fetch.mockResolvedValueOnce(new Response("nope", { status: 200 }));
    expect(await invalid.service.pollDeviceFlow(info, vi.fn(), new AbortController().signal)).toMatchObject({ ok: false, code: "invalid-data" });
  });

  it("prevents an older flow and a logged-out pending response from storing a token", async () => {
    let resolveOld!: (value: Response) => void;
    const { service, fetch, storage } = setup({ sleep: async () => {} });
    fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }));
    const old = service.pollDeviceFlow(info, vi.fn(), new AbortController().signal);
    await vi.waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    fetch.mockResolvedValueOnce(response({ access_token: "new", token_type: "bearer", scope: "gist" }));
    await service.pollDeviceFlow({ ...info, device_code: "new-device" }, vi.fn(), new AbortController().signal);
    resolveOld(response({ access_token: "old", token_type: "bearer", scope: "gist" }));
    expect(await old).toMatchObject({ ok: false, code: "cancelled" });
    expect(storage.set).not.toHaveBeenCalledWith(GITHUB_ACCESS_TOKEN_KEY, "old");

    let resolveLogout!: (value: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveLogout = resolve; }));
    const pending = service.pollDeviceFlow(info, vi.fn(), new AbortController().signal);
    await vi.waitFor(() => expect(resolveLogout).toBeTypeOf("function"));
    await service.logout(); resolveLogout(response({ access_token: "late", token_type: "bearer", scope: "gist" }));
    expect(await pending).toMatchObject({ ok: false, code: "cancelled" });
    expect(storage.set).not.toHaveBeenCalledWith(GITHUB_ACCESS_TOKEN_KEY, "late");
  });

  it("serializes token commits so an old suspended write cannot delete a newer token", async () => {
    let releaseOld!: () => void;
    const { service, fetch, storage, values } = setup({ sleep: async () => {} });
    storage.set.mockImplementationOnce(async (key: string, value: unknown) => {
      await new Promise<void>((resolve) => { releaseOld = resolve; });
      values[key] = value;
      return { ok: true as const, value: undefined };
    });
    fetch.mockResolvedValueOnce(response({ access_token: "old", token_type: "bearer", scope: "gist" }));
    const old = service.pollDeviceFlow(info, vi.fn(), new AbortController().signal);
    await vi.waitFor(() => expect(releaseOld).toBeTypeOf("function"));
    fetch.mockResolvedValueOnce(response({ access_token: "new", token_type: "bearer", scope: "gist" }));
    const newer = service.pollDeviceFlow({ ...info, device_code: "new-device" }, vi.fn(), new AbortController().signal);
    releaseOld();
    expect(await old).toMatchObject({ ok: false, code: "cancelled" });
    expect(await newer).toMatchObject({ ok: true });
    expect(values[GITHUB_ACCESS_TOKEN_KEY]).toBe("new");
  });

  it("queues logout after an in-flight token write and leaves storage empty", async () => {
    let releaseWrite!: () => void;
    const { service, fetch, storage, values } = setup({ sleep: async () => {} });
    storage.set.mockImplementationOnce(async (key: string, value: unknown) => {
      await new Promise<void>((resolve) => { releaseWrite = resolve; });
      values[key] = value;
      return { ok: true as const, value: undefined };
    });
    fetch.mockResolvedValueOnce(response({ access_token: "late", token_type: "bearer", scope: "gist" }));
    const pending = service.pollDeviceFlow(info, vi.fn(), new AbortController().signal);
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf("function"));
    const loggedOut = service.logout();
    releaseWrite();
    expect(await pending).toMatchObject({ ok: false, code: "cancelled" });
    expect(await loggedOut).toEqual({ ok: true, value: undefined });
    expect(values[GITHUB_ACCESS_TOKEN_KEY]).toBeUndefined();
  });

  it("publishes logout only after credential removal succeeds", async () => {
    let finish!: () => void;
    const { service, storage } = setup();
    storage.remove.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true as const, value: undefined }); }));
    (service as any).session = { authenticated: true, login: "GitHub" };
    const listener = vi.fn(); service.subscribe(listener);
    const result = service.logout();
    expect(listener).not.toHaveBeenCalled();
    expect(await service.getSession()).toEqual({ ok: true, value: { authenticated: true, login: "GitHub" } });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish(); expect(await result).toEqual({ ok: true, value: undefined });
    expect(listener).toHaveBeenCalledWith(null);
  });

  it("keeps the authenticated session when credential removal fails", async () => {
    const { service, storage } = setup();
    (service as any).session = { authenticated: true, login: "GitHub" };
    storage.remove.mockResolvedValueOnce({ ok: false, code: "unknown", message: "denied" });
    const listener = vi.fn(); service.subscribe(listener);
    expect(await service.logout()).toMatchObject({ ok: false, code: "unknown" });
    expect(await service.getSession()).toEqual({ ok: true, value: { authenticated: true, login: "GitHub" } });
    expect(listener).not.toHaveBeenCalled();
  });

  it.each(["abort", "deadline"])("cleans a token when %s happens during storage set", async (reason) => {
    let release!: () => void;
    let time = 0;
    const { service, fetch, storage, values } = setup({ sleep: async () => {}, now: () => time });
    storage.set.mockImplementationOnce(async (key: string, value: unknown) => {
      await new Promise<void>((resolve) => { release = resolve; });
      values[key] = value;
      return { ok: true as const, value: undefined };
    });
    fetch.mockResolvedValueOnce(response({ access_token: "transient", token_type: "bearer", scope: "gist" }));
    const controller = new AbortController();
    const pending = service.pollDeviceFlow({ ...info, expires_in: 2 }, vi.fn(), controller.signal);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    if (reason === "abort") controller.abort(); else time = 3000;
    release();
    expect(await pending).toMatchObject({ ok: false, code: reason === "abort" ? "cancelled" : "authentication" });
    expect(values[GITHUB_ACCESS_TOKEN_KEY]).toBeUndefined();
    expect(await service.getSession()).toEqual({ ok: true, value: null });
  });

  it("keeps the current session when storage restore fails", async () => {
    const { service, storage } = setup();
    (service as any).session = { authenticated: true, login: "GitHub" };
    storage.get.mockResolvedValueOnce({ ok: false, code: "unknown", message: "read denied" });
    expect(await service.restore()).toMatchObject({ ok: false, code: "unknown" });
    expect(await service.getSession()).toEqual({ ok: true, value: { authenticated: true, login: "GitHub" } });
  });

  it("restores a token without allowing stale restore to overwrite a newer logout", async () => {
    let resolve!: (value: any) => void;
    const storage = { get: vi.fn(() => new Promise((r) => { resolve = r; })), set: vi.fn(), remove: vi.fn(async () => ({ ok: true as const, value: undefined })) };
    const service = new BrowserGitHubService({ clientId: "client", storage: storage as any, fetch: vi.fn(), sleep: vi.fn(), now: () => 0 });
    const restoring = service.restore(); await service.logout(); resolve({ ok: true, value: "old" }); await restoring;
    expect(await service.getSession()).toEqual({ ok: true, value: null });
  });

  it("requires and rechecks the latest history version before updating", async () => {
    const { service, fetch, values } = setup(); values[GITHUB_ACCESS_TOKEN_KEY] = "token"; await service.restore();
    const project = { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: 1 }]], createdAt: "c", updatedAt: "u" } as any;
    expect(await service.uploadProject("X", project, "g")).toMatchObject({ ok: false, code: "conflict" });
    fetch.mockResolvedValueOnce(response({ id: "g", updated_at: "u", history: [{ version: "newer" }], files: { "pindouverse__X.pindou": { content: "{}" } } }));
    expect(await service.uploadProject("X", project, "g", "expected")).toMatchObject({ ok: false, code: "conflict" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uploads complete compact v3 projects and updates an existing linked gist", async () => {
    const { service, fetch, values } = setup();
    values[GITHUB_ACCESS_TOKEN_KEY] = "token";
    await service.restore();
    fetch.mockResolvedValueOnce(response({ id: "g1", updated_at: "2026-01-01", history: [{ version: "etag" }], files: { "pindouverse__Old.pindou": { content: "{}" } } })).mockResolvedValueOnce(response({ id: "g1", updated_at: "2026-01-02", history: [{ version: "v2" }] })).mockResolvedValueOnce(response({ id: "g1", updated_at: "2026-01-02", history: [{ version: "v2" }, { version: "etag" }], files: { "pindouverse__Full.pindou": { content: JSON.stringify({ version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[4]], layers: [{ id: "layer", name: "Top", visible: true, opacity: 1, data: [[4]] }], gridConfig: { groupSize: 5 }, projectInfo: { title: "Full" }, createdAt: "created", updatedAt: "updated" }) } } }));
    const project: any = {
      version: 2, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: 4 }]],
      layers: [{ id: "layer", name: "Top", visible: true, opacity: 1, data: [[{ colorIndex: 4 }]] }],
      gridConfig: { groupSize: 5 }, projectInfo: { title: "Full" }, createdAt: "created", updatedAt: "updated",
    };
    expect(await service.uploadProject("Full", project, "g1", "etag")).toEqual({ ok: true, value: { gistId: "g1", updatedAt: "2026-01-02", version: "v2" } });
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("https://api.github.com/gists/g1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body);
    const cloud = JSON.parse(body.files["pindouverse__Full.pindou"].content);
    expect(cloud).toMatchObject({ version: 3, canvasData: [[4]], layers: [{ name: "Top", data: [[4]] }], projectInfo: { title: "Full" }, createdAt: "created" });
  });

  it("rejects oversized uploads before making a request", async () => {
    const { service, fetch, values } = setup(); values[GITHUB_ACCESS_TOKEN_KEY] = "token"; await service.restore();
    const huge = "x".repeat(25 * 1024 * 1024 + 1);
    const project = { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: null }]], projectInfo: { notes: huge }, createdAt: "c", updatedAt: "u" } as any;
    expect(await service.uploadProject("Huge", project)).toMatchObject({ ok: false, code: "invalid-data" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads truncated raw files without credentials", async () => {
    const { service, fetch, values } = setup(); values[GITHUB_ACCESS_TOKEN_KEY] = "token"; await service.restore();
    const raw = JSON.stringify({ version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[3]], createdAt: "c", updatedAt: "u" });
    fetch.mockResolvedValueOnce(response({ id: "g", updated_at: "u", files: { "pindouverse__Raw.pindou": { truncated: true, raw_url: "https://gist.githubusercontent.com/u/g/raw/file" } } })).mockResolvedValueOnce(new Response(raw, { status: 200 }));
    expect(await service.downloadProject("g")).toMatchObject({ ok: true, value: { name: "Raw" } });
    expect(fetch.mock.calls[1][1]).toEqual({ credentials: "omit" });
  });

  it("keeps a revocation tombstone when 401 credential removal fails", async () => {
    const { service, fetch, storage, values } = setup(); values[GITHUB_ACCESS_TOKEN_KEY] = "bad"; await service.restore();
    storage.remove.mockResolvedValueOnce({ ok: false, code: "unknown" }); fetch.mockResolvedValueOnce(response({}, 401));
    expect(await service.listProjects()).toMatchObject({ ok: false, code: "authentication" });
    expect(storage.set).toHaveBeenCalledWith(GITHUB_REVOKED_SESSION_KEY, true);
    expect(await service.getSession()).toEqual({ ok: true, value: null });
  });

  it("normalizes downloads and rejects oversized gist payloads", async () => {
    const { service, fetch, values } = setup(); values[GITHUB_ACCESS_TOKEN_KEY] = "token"; await service.restore();
    fetch.mockResolvedValueOnce(response({ id: "g", updated_at: "now", files: { "pindouverse__X.pindou": { content: JSON.stringify({ version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[7]], createdAt: "c", updatedAt: "u" }) } } }));
    expect(await service.downloadProject("g")).toMatchObject({ ok: true, value: { project: { version: 3, canvasData: [[{ colorIndex: 7 }]] }, name: "X" } });
    fetch.mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "Content-Length": String(26 * 1024 * 1024) } }));
    expect(await service.downloadProject("large")).toMatchObject({ ok: false, code: "invalid-data" });
  });

  it("does not let an old 401 clear a newly logged-in token", async () => {
    let old401!: (r: Response) => void;
    const { service, fetch, values, storage } = setup({ sleep: async () => {} }); values[GITHUB_ACCESS_TOKEN_KEY] = "old"; await service.restore();
    fetch.mockImplementationOnce(() => new Promise(r => { old401 = r; })); const old = service.listProjects(); await vi.waitFor(() => expect(old401).toBeTypeOf("function"));
    fetch.mockResolvedValueOnce(response({ access_token: "new", token_type: "bearer", scope: "gist" })); await service.pollDeviceFlow(info, vi.fn(), new AbortController().signal);
    old401(response({}, 401)); expect(await old).toMatchObject({ ok: false, code: "authentication" });
    expect(values[GITHUB_ACCESS_TOKEN_KEY]).toBe("new"); expect(storage.remove).not.toHaveBeenCalledWith(GITHUB_ACCESS_TOKEN_KEY);
    expect(await service.getSession()).toMatchObject({ ok: true, value: { authenticated: true } });
  });

  it("does not let a stale tombstone restore remove a newly logged-in token", async () => {
    let release!: (value: any) => void;
    const { service, fetch, values, storage } = setup({ sleep: async () => {} }); values[GITHUB_REVOKED_SESSION_KEY] = true; values[GITHUB_ACCESS_TOKEN_KEY] = "old";
    storage.remove.mockImplementationOnce(() => new Promise(r => { release = r; })); const restoring = service.restore(); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    fetch.mockResolvedValueOnce(response({ access_token: "new", token_type: "bearer", scope: "gist" })); const login = service.pollDeviceFlow(info, vi.fn(), new AbortController().signal);
    release({ ok: true, value: undefined }); await restoring; await login;
    expect(values[GITHUB_ACCESS_TOKEN_KEY]).toBe("new"); expect(await service.getSession()).toMatchObject({ ok: true, value: { authenticated: true } });
  });

  it("clears credentials and publishes logout on bad credentials", async () => {
    const { service, fetch, storage, values } = setup(); values[GITHUB_ACCESS_TOKEN_KEY] = "bad"; await service.restore();
    const listener = vi.fn(); service.subscribe(listener);
    fetch.mockResolvedValueOnce(response({ message: "Bad credentials" }, 401));
    expect(await service.listProjects()).toMatchObject({ ok: false, code: "authentication" });
    expect(storage.remove).toHaveBeenCalledWith(GITHUB_ACCESS_TOKEN_KEY);
    expect(listener).toHaveBeenCalledWith(null);
  });

  it("maps GitHub rate limits with retry duration", async () => {
    const { service, fetch, values } = setup({ now: () => 1000 }); values[GITHUB_ACCESS_TOKEN_KEY] = "token"; await service.restore();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: "rate" }), { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "11" } }));
    expect(await service.listProjects()).toMatchObject({ ok: false, code: "rate-limited", retryAfterSeconds: 10 });
  });

  it("keeps recent uploads and deletions stable while GitHub list is eventually consistent", async () => {
    const { service, fetch, values, advance } = setup(); values[GITHUB_ACCESS_TOKEN_KEY] = "token"; await service.restore();
    fetch.mockResolvedValueOnce(response({ id: "new", updated_at: "u", history: [{ version: "v1" }] })).mockResolvedValueOnce(response({ id: "new", updated_at: "u", history: [{ version: "v1" }], files: { "pindouverse__New.pindou": { content: JSON.stringify({ version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[null]], createdAt: "c", updatedAt: "u" }) } } }));
    await service.uploadProject("New", { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: null }]], createdAt: "c", updatedAt: "u" } as any);
    fetch.mockResolvedValueOnce(response([]));
    expect(await service.listProjects()).toMatchObject({ ok: true, value: [expect.objectContaining({ gistId: "new" })] });
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 })); await service.deleteProject("new");
    fetch.mockResolvedValueOnce(response([{ id: "new", updated_at: "u", public: false, files: { "pindouverse__New.pindou": {} } }]));
    expect(await service.listProjects()).toEqual({ ok: true, value: [] });
    advance(61_000);
  });
});
