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

const adapter = new MobileAdapter();
setAdapter(adapter);
const legacyServices = createLegacyPlatformServices(adapter, createMobileCapabilities("android"));
setPlatformServices({ ...legacyServices, github: new TauriLegacyGitHubService(), voiceEnhancement: tauriVoiceEnhancementService, externalLinks: tauriExternalLinks, window: tauriWindowService });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
