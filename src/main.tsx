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
import { createNavigatorLocaleService, WebStorageService } from "./platform/webRuntimeServices";
import { bootstrapUiLanguage } from "./i18n/bootstrap";
import { initializeI18n } from "./i18n";
import { renderStartupFailure } from "./i18n/startup";
import { useEditorStore } from "./store/editorStore";

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
const services = {
  ...legacyServices,
  github: new TauriLegacyGitHubService(),
  voiceEnhancement: tauriVoiceEnhancementService,
  storage: new WebStorageService(),
  locale: createNavigatorLocaleService(),
  externalLinks: tauriExternalLinks,
  window: tauriWindowService,
};
setPlatformServices(services);

import("@tauri-apps/api/app").then(({ getVersion }) => {
  getVersion().then((v) => { (window as any).__pindouVersion = v; });
}).catch(() => {});

async function start() {
  try { await bootstrapUiLanguage(services); }
  catch { await initializeI18n("en"); }
  useEditorStore.getState().localizeDefaultLayerNames();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode><App /></React.StrictMode>
  );
}

void start().catch((error) => {
  renderStartupFailure(document.getElementById("root") as HTMLElement, error);
});
