import { describe, expect, it, vi } from "vitest";
import { connectGitHubSession } from "./githubSession";
import type { GitHubSession } from "./services";

describe("connectGitHubSession", () => {
  it("subscribes first and ignores a stale initial read after a newer event", async () => {
    let listener!: (session: GitHubSession | null) => void;
    let resolveInitial!: (value: any) => void;
    const onSession = vi.fn();
    const service: any = {
      subscribe(fn: typeof listener) { listener = fn; return () => {}; },
      getSession() { return new Promise((resolve) => { resolveInitial = resolve; }); },
    };

    connectGitHubSession(service, onSession);
    listener({ authenticated: true, login: "new" });
    resolveInitial({ ok: true, value: null });
    await Promise.resolve();

    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith({ authenticated: true, login: "new" });
  });
});
