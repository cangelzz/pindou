import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { setAdapter } from "./adapters";
import { TauriAdapter } from "./adapters/tauri";
import { setPlatformServices } from "./platform/serviceRegistry";
import { createLegacyPlatformServices } from "./platform/services";
import { TauriLegacyGitHubService } from "./platform/tauriGitHubService";
import { tauriVoiceEnhancementService } from "./utils/voiceEnhancement";
import { tauriExternalLinks, tauriWindowService } from "./platform/tauriRuntimeServices";

const adapter = new TauriAdapter();
setAdapter(adapter);
const legacyServices = createLegacyPlatformServices(adapter, {
  runtime: "tauri",
  projectFileHandles: true,
  downloadFallback: false,
  githubDeviceFlow: true,
  gistSync: true,
  ai: true,
  browserImageTasks: false,
  basicVoiceControl: true,
  environmentLabel: "Desktop App",
});
setPlatformServices({
  ...legacyServices,
  github: new TauriLegacyGitHubService(),
  voiceEnhancement: tauriVoiceEnhancementService,
  externalLinks: tauriExternalLinks,
  window: tauriWindowService,
});

import("@tauri-apps/api/app").then(({ getVersion }) => {
  getVersion().then((v) => { (window as any).__pindouVersion = v; });
}).catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
