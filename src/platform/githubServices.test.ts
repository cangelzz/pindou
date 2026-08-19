import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { VSCodeGitHubService } from "./vscodeGitHubService";
import { clearGitHubToken, getGitHubToken } from "../utils/githubToken";

describe("VSCodeGitHubService", () => {
  beforeEach(() => clearGitHubToken());

  it("uses the newly logged-in token immediately for Gist operations", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const service = new VSCodeGitHubService(async () => ({ token: "fresh-token", account: { label: "octocat", id: "42" } }), fetcher);
    expect(await service.login()).toMatchObject({ ok: true });
    expect(await service.listProjects()).toEqual({ ok: true, value: [] });
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer fresh-token" }) }));
  });

  it("delegates complete Gist operations through the authenticated session token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const service = new VSCodeGitHubService(async () => ({ token: "native-token", account: { label: "octocat", id: "42" } }), fetcher);
    await service.restore();
    expect(await service.listProjects()).toEqual({ ok: true, value: [] });
    expect(fetcher).toHaveBeenCalledWith("https://api.github.com/gists?per_page=100", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer native-token" }) }));
  });

  it("publishes an asynchronously restored native session and retains its token", async () => {
    const service = new VSCodeGitHubService(async () => ({
      token: "native-token",
      account: { label: "octocat", id: "42" },
    }));
    const sessions: unknown[] = [];
    service.subscribe((session) => sessions.push(session));

    await service.restore();

    expect(getGitHubToken()).toBe("native-token");
    expect(await service.getSession()).toEqual({
      ok: true,
      value: { authenticated: true, login: "octocat" },
    });
    expect(sessions).toEqual([{ authenticated: true, login: "octocat" }]);
  });
});
