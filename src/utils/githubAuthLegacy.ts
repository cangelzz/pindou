import { invoke } from "@tauri-apps/api/core";
import type { DeviceFlowStatus } from "../platform/services";
import { setGitHubToken } from "./githubToken";
export { clearGitHubToken, getGitHubToken, setGitHubToken } from "./githubToken";

export interface DeviceCodeInfo {
  device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number;
}

export async function requestDeviceCode(): Promise<DeviceCodeInfo> {
  return invoke<DeviceCodeInfo>("github_request_device_code");
}

export async function pollForToken(deviceCode: string, interval: number, expiresIn: number, onStatus?: (status: DeviceFlowStatus) => void, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + expiresIn * 1000;
  let currentInterval = Math.max(interval, 5) * 1000;
  while (!signal?.aborted) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(currentInterval, remaining)));
    if (signal?.aborted || Date.now() >= deadline) break;
    try {
      const data = await invoke<{ access_token: string | null; error: string | null }>("github_poll_token", { deviceCode });
      if (signal?.aborted || Date.now() >= deadline) return false;
      if (data.access_token) { setGitHubToken(data.access_token); onStatus?.("authorized"); return true; }
      if (data.error === "authorization_pending") { onStatus?.("authorization-pending"); continue; }
      if (data.error === "slow_down") { currentInterval += 5000; onStatus?.("slow-down"); continue; }
      if (data.error === "expired_token") { onStatus?.("expired"); return false; }
      if (data.error === "access_denied") { onStatus?.("denied"); return false; }
      return false;
    } catch {
      if (signal?.aborted) return false;
      onStatus?.("retrying");
    }
  }
  if (!signal?.aborted) onStatus?.("expired");
  return false;
}
