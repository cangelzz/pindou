import React from "react";
import ReactDOM from "react-dom/client";
import App from "../../src/App";
import "../../src/styles.css";
import { setAdapter } from "../../src/adapters";
import { MobileAdapter } from "../../src/adapters/mobile";
import { createMobileCapabilities } from "../../src/platform/capabilities";
import { setPlatformServices } from "../../src/platform/serviceRegistry";
import { createLegacyPlatformServices } from "../../src/platform/services";
import { TauriLegacyGitHubService } from "../../src/platform/tauriGitHubService";
import { tauriVoiceEnhancementService } from "../../src/utils/voiceEnhancement";
import { tauriExternalLinks, tauriWindowService } from "../../src/platform/tauriRuntimeServices";
import { createNavigatorLocaleService, WebStorageService } from "../../src/platform/webRuntimeServices";
import { bootstrapUiLanguage } from "../../src/i18n/bootstrap";
import { initializeI18n } from "../../src/i18n";
import { renderStartupFailure } from "../../src/i18n/startup";

const adapter = new MobileAdapter();
setAdapter(adapter);
const legacyServices = createLegacyPlatformServices(adapter, createMobileCapabilities("ios"));
const services = { ...legacyServices, github: new TauriLegacyGitHubService(), voiceEnhancement: tauriVoiceEnhancementService, storage: new WebStorageService(), locale: createNavigatorLocaleService(), externalLinks: tauriExternalLinks, window: tauriWindowService };
setPlatformServices(services);

async function start() {
  try { await bootstrapUiLanguage(services); }
  catch { await initializeI18n("en"); }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode><App /></React.StrictMode>);
}
void start().catch((error) => {
  renderStartupFailure(document.getElementById("root") as HTMLElement, error);
});
