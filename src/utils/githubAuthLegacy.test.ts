import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, storage } = vi.hoisted(() => ({
  invoke: vi.fn(),
  storage: new Map<string, string>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { pollForToken } from "./githubAuthLegacy";
import { clearGitHubToken, getGitHubToken } from "./githubToken";

describe("legacy GitHub polling cancellation", () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    clearGitHubToken(); invoke.mockReset(); vi.useFakeTimers();
  });

  it("permanently increases polling delay after consecutive slow_down responses", async () => {
    vi.setSystemTime(0);
    const requestTimes: number[] = [];
    invoke.mockImplementation(() => {
      requestTimes.push(Date.now());
      return Promise.resolve(requestTimes.length < 3
        ? { access_token: null, error: "slow_down" }
        : { access_token: "token", error: null });
    });
    const polling = pollForToken("device", 5, 60);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(polling).resolves.toBe(true);
    expect(requestTimes).toEqual([5_000, 15_000, 30_000]);
  });

  it("does not request again after the deadline", async () => {
    vi.setSystemTime(0);
    invoke.mockResolvedValue({ access_token: null, error: "authorization_pending" });
    const polling = pollForToken("device", 5, 7);
    await vi.advanceTimersByTimeAsync(7_000);
    await expect(polling).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("discards a token returned after the device flow deadline", async () => {
    vi.setSystemTime(0);
    let resolvePoll!: (value: { access_token: string; error: null }) => void;
    invoke.mockImplementation(() => new Promise((resolve) => { resolvePoll = resolve; }));
    const polling = pollForToken("device", 5, 6);
    await vi.advanceTimersByTimeAsync(5_000);
    vi.setSystemTime(7_000);
    resolvePoll({ access_token: "late-token", error: null });
    await expect(polling).resolves.toBe(false);
    expect(getGitHubToken()).toBeNull();
    expect(storage.has("pindouverse_github_token")).toBe(false);
  });

  it("does not persist a token returned after cancellation", async () => {
    let resolvePoll!: (value: { access_token: string; error: null }) => void;
    invoke.mockImplementation(() => new Promise((resolve) => { resolvePoll = resolve; }));
    const controller = new AbortController();
    const polling = pollForToken("device", 0, 60, undefined, controller.signal);
    await vi.advanceTimersByTimeAsync(5000);

    controller.abort();
    resolvePoll({ access_token: "late-token", error: null });

    await expect(polling).resolves.toBe(false);
    expect(getGitHubToken()).toBeNull();
    expect(storage.has("pindouverse_github_token")).toBe(false);
  });
});
