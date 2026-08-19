export interface PlatformCapabilities {
  runtime: "tauri" | "vscode" | "browser-extension" | "android" | "ios";
  browserBrand?: "chrome" | "edge";
  projectFileHandles: boolean;
  downloadFallback: boolean;
  githubDeviceFlow: boolean;
  gistSync: boolean;
  ai: boolean;
  browserImageTasks: boolean;
  basicVoiceControl: boolean;
  environmentLabel?: string;
  platformLabel?: string;
}

export function createMobileCapabilities(
  runtime: "android" | "ios",
): PlatformCapabilities {
  return {
    runtime,
    projectFileHandles: true,
    downloadFallback: false,
    githubDeviceFlow: true,
    gistSync: true,
    ai: true,
    browserImageTasks: false,
    basicVoiceControl: true,
    environmentLabel: runtime === "android" ? "Android" : "iOS",
    platformLabel: runtime === "android" ? "Android" : "iOS",
  };
}

export function createBrowserCapabilities(
  browserBrand: "chrome" | "edge",
  projectFileHandles: boolean,
): PlatformCapabilities {
  return {
    runtime: "browser-extension",
    browserBrand,
    projectFileHandles,
    downloadFallback: true,
    githubDeviceFlow: true,
    gistSync: true,
    ai: false,
    browserImageTasks: true,
    basicVoiceControl: true,
    environmentLabel: `Browser Extension (${browserBrand === "edge" ? "Edge" : "Chrome"})`,
  };
}
