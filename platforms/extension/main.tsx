import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import "@/styles.css";
import { setAdapter } from "@/adapters";
import { BrowserAdapter } from "@/adapters/browser";
import { createBrowserCapabilities } from "@/platform/capabilities";
import { setPlatformServices } from "@/platform/serviceRegistry";
import { createLegacyPlatformServices } from "@/platform/services";
import { BrowserProjectFileService, browserDownloadSink, createBrowserFileApi } from "./projectFileService";
import { BrowserRecoveryStorage } from "./recoveryStorage";
import { createImageTaskBrokerClient, getProductionBrowserApi } from "./browserApi";
import { ExtensionImageImportService } from "./imageImportService";
import { createImageTaskInbox } from "./imageTaskInbox";
import { BrowserStorage } from "./browserStorage";
import { BrowserGitHubService } from "./githubService";
import { BrowserExternalLinkService } from "./externalLinkService";
import { getGitHubClientId } from "./config";
import { useEditorStore } from "@/store/editorStore";

declare const __PINDOU_EXTENSION_TEST__: boolean;

const adapter = new BrowserAdapter();
setAdapter(adapter);
const browserBrand = /Edg\//.test(navigator.userAgent) ? "edge" : "chrome";
const projectFileHandles = "showOpenFilePicker" in window && "showSaveFilePicker" in window;
const legacyServices = createLegacyPlatformServices(
  adapter,
  createBrowserCapabilities(browserBrand, projectFileHandles),
);
const browserApi = getProductionBrowserApi();
void browserApi?.runtime.sendMessage({ type: "pindou:editor-ready" });
if (browserApi) {
  browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if ((message as { type?: string })?.type !== "pindou:identify-editor") return;
    sendResponse({ ok: true, marker: "pindou-editor" });
  });
}
const fileApi = createBrowserFileApi();
const imageImports = browserApi
  ? new ExtensionImageImportService(createImageTaskBrokerClient(browserApi), fetch, fileApi)
  : legacyServices.imageImports;
const storage = browserApi ? new BrowserStorage(browserApi.storage.local, browserApi.runtime) : legacyServices.storage;
const github = browserApi
  ? new BrowserGitHubService({ clientId: getGitHubClientId(import.meta.env.VITE_GITHUB_CLIENT_ID), storage })
  : legacyServices.github;
setPlatformServices({
  ...legacyServices,
  projectFiles: new BrowserProjectFileService(fileApi, browserDownloadSink),
  images: { ...legacyServices.images, chooseLocalImage: () => imageImports.chooseLocalImage() },
  imageImports,
  recovery: new BrowserRecoveryStorage(),
  storage,
  github,
  externalLinks: browserApi ? new BrowserExternalLinkService(browserApi.tabs) : legacyServices.externalLinks,
});
void github.restore?.();
const imageTaskInbox = browserApi ? createImageTaskInbox(browserApi, imageImports) : undefined;
void imageTaskInbox?.start();
window.addEventListener("unload", () => imageTaskInbox?.dispose(), { once: true });

if (__PINDOU_EXTENSION_TEST__) {
  const allowedActions = new Set([
    "newCanvas", "setCell", "addLayer", "setProjectInfo", "openProject", "saveProject", "saveProjectAs",
    "autoSave", "createSnapshot", "loadSnapshots", "restoreSnapshot", "deleteSnapshot",
  ]);
  Object.defineProperty(globalThis, "__pindouExtensionTest", {
    configurable: true,
    value: {
      getStore(keys: string[]) {
        const state = useEditorStore.getState() as unknown as Record<string, unknown>;
        return Object.fromEntries(keys.map((key) => [key, state[key]]));
      },
      async callStore(action: string, args: unknown[]) {
        if (!allowedActions.has(action)) throw new Error(`Store action is not available to E2E: ${action}`);
        const candidate = (useEditorStore.getState() as unknown as Record<string, unknown>)[action];
        if (typeof candidate !== "function") throw new Error(`Unknown store action: ${action}`);
        return candidate(...args);
      },
    },
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App imageTaskInbox={imageTaskInbox} />
  </React.StrictMode>
);
