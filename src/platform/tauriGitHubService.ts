import type { DeviceCodeInfo, GitHubSession } from "./services";
import type { PlatformResult } from "./result";
import { SessionGitHubService } from "./sessionGitHubService";
import { getGitHubToken } from "../utils/githubToken";
import { pollForToken, requestDeviceCode } from "../utils/githubAuthLegacy";

export class TauriLegacyGitHubService extends SessionGitHubService {
  readonly availability = "legacy-adapter" as const;
  constructor(fetcher: typeof fetch = fetch) { super(fetcher); if (getGitHubToken()) this.session = { authenticated: true, login: "GitHub" }; }
  async startDeviceFlow(signal: AbortSignal): Promise<PlatformResult<DeviceCodeInfo>> {
    if (signal.aborted) return { ok: false, code: "cancelled" };
    try {
      const value = await requestDeviceCode();
      return signal.aborted ? { ok: false, code: "cancelled" } : { ok: true, value }; }
    catch (cause) { return { ok: false, code: "unknown", cause }; }
  }
  async pollDeviceFlow(info: DeviceCodeInfo, onStatus: (status: string) => void, signal: AbortSignal): Promise<PlatformResult<GitHubSession>> {
    const ok = await pollForToken(info.device_code, info.interval, info.expires_in, (status) => {
      if (!signal.aborted) onStatus(status);
    }, signal);
    if (!ok || signal.aborted) return { ok: false, code: "cancelled" };
    const session = { authenticated: true as const, login: "GitHub" };
    this.setToken(getGitHubToken());
    this.update(session);
    return { ok: true, value: session };
  }
  async login(): Promise<PlatformResult<GitHubSession>> {
    const controller = new AbortController();
    const started = await this.startDeviceFlow(controller.signal);
    if (!started.ok) return started;
    return this.pollDeviceFlow(started.value, () => {}, controller.signal);
  }
}
