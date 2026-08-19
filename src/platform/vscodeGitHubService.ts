import type { GitHubSession } from "./services";
import type { PlatformResult } from "./result";
import { SessionGitHubService } from "./sessionGitHubService";
import { setGitHubToken } from "../utils/githubToken";

interface VSCodeGitHubAccount { label: string; id: string }

export class VSCodeGitHubService extends SessionGitHubService {
  readonly availability = "available" as const;
  constructor(private readonly requestToken: (createIfNone: boolean) => Promise<{ token: string | null; account: VSCodeGitHubAccount | null }>, fetcher: typeof fetch = fetch) { super(fetcher); }
  async restore(): Promise<void> {
    const result = await this.requestToken(false);
    if (result.token) {
      setGitHubToken(result.token);
      this.setToken(result.token);
      this.update({ authenticated: true, login: result.account?.label ?? "GitHub" });
    } else {
      setGitHubToken("");
      this.setToken(null);
      this.update(null);
    }
  }
  async login(): Promise<PlatformResult<GitHubSession>> {
    try {
      const result = await this.requestToken(true);
      if (!result.token) return { ok: false, code: "cancelled" };
      setGitHubToken(result.token);
      this.setToken(result.token);
      const session = { authenticated: true as const, login: result.account?.label ?? "GitHub" };
      this.update(session);
      return { ok: true, value: session };
    } catch (cause) { return { ok: false, code: "unknown", cause }; }
  }
  setSessionForTest(session: GitHubSession | null): void { this.update(session); }
}
