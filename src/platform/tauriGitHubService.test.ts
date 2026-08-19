import { describe, expect, it, vi } from "vitest";

const { pollForToken } = vi.hoisted(() => ({ pollForToken: vi.fn() }));
vi.mock("../utils/githubAuthLegacy", () => ({ requestDeviceCode: vi.fn(), pollForToken }));

import { TauriLegacyGitHubService } from "./tauriGitHubService";

describe("TauriLegacyGitHubService cancellation", () => {
  it("does not publish a session when an aborted poll later succeeds", async () => {
    let resolve!: (value: boolean) => void;
    pollForToken.mockReturnValue(new Promise((done) => { resolve = done; }));
    const service = new TauriLegacyGitHubService();
    const controller = new AbortController();
    const observed: unknown[] = [];
    service.subscribe((session) => observed.push(session));
    const polling = service.pollDeviceFlow({
      device_code: "device", user_code: "CODE", verification_uri: "https://example.test",
      expires_in: 60, interval: 0,
    }, () => {}, controller.signal);

    controller.abort();
    resolve(true);

    await expect(polling).resolves.toMatchObject({ ok: false, code: "cancelled" });
    expect(observed).toEqual([]);
    await expect(service.getSession()).resolves.toEqual({ ok: true, value: null });
  });
});
