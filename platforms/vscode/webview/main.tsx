import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "../../../src/App";
import { setAdapter } from "../../../src/adapters";
import { VScodeAdapter, setDocumentLoadHandler, signalReady, requestGitHubToken, requestNewProject, sendRequest } from "../src/vscodeAdapter";
import { useEditorStore } from "../../../src/store/editorStore";
import { VSCodeGitHubService } from "../../../src/platform/vscodeGitHubService";
import { normalizeProjectFromDisk } from "../../../src/utils/projectSerialization";
import { setPlatformServices } from "../../../src/platform/serviceRegistry";
import { createLegacyPlatformServices } from "../../../src/platform/services";
import { VSCodeLocaleService, VSCodeStorageService } from "../src/vscodeServices";
import { bootstrapUiLanguage } from "../../../src/i18n/bootstrap";
import { initializeI18n } from "../../../src/i18n";
import { renderStartupFailure } from "../../../src/i18n/startup";
import { appAlert, appConfirm, appPrompt } from "../../../src/components/Dialog/AppDialog";
import "./styles.css";

declare const __PINDOU_VERSION__: string;

// Initialize VS Code adapter
const adapter = new VScodeAdapter();
setAdapter(adapter);
const githubService = new VSCodeGitHubService(requestGitHubToken);
const mutableCapabilities = {
  runtime: "vscode",
  projectFileHandles: true,
  downloadFallback: false,
  githubDeviceFlow: false,
  gistSync: true,
  ai: false,
  browserImageTasks: true,
  basicVoiceControl: true,
  environmentLabel: "VS Code Extension",
} as const;
const legacyServices = createLegacyPlatformServices(adapter, mutableCapabilities);
const services = {
  ...legacyServices,
  github: githubService,
  storage: new VSCodeStorageService(sendRequest),
  locale: new VSCodeLocaleService(sendRequest),
};
setPlatformServices(services);

(window as any).__pindouVersion = __PINDOU_VERSION__;
// Expose the Zustand store on window for Playwright tests. Harmless in
// production (the global is unreachable from any normal user flow) but
// gives tests a stable hook to read state and dispatch actions.
(window as any).__pindouStore = useEditorStore;
// Expose the platform adapter for Playwright tests (e.g. blueprint import).
// Same rationale as __pindouStore — unreachable from any normal user flow.
(window as any).__pindouAdapter = adapter;
(window as any).__pindouDialogs = { prompt: appPrompt, alert: appAlert, confirm: appConfirm };

// Test seams exercise the real App DOM; production capabilities stay fixed unless a test calls this hook.
(window as any).__pindouTestGitHub = { setSession: (session: any) => githubService.setSessionForTest(session) };
(window as any).__pindouTestPlatform = {
  setCapabilities: (patch: Record<string, unknown>) => {
    Object.assign(mutableCapabilities, patch);
    const canvasSize = useEditorStore.getState().canvasSize;
    useEditorStore.setState({ canvasSize: { ...canvasSize } });
  },
};

// Lets the app route the "新建" toolbar button through the extension host so a
// fresh untitled_<ts>.pindou tab opens instead of mutating the currently open
// file's webview in place. App.tsx checks for this and falls back to the
// in-process newCanvas action when not in VS Code.
(window as any).__pindouRequestNewProject = (width: number, height: number): void => {
  requestNewProject(width, height);
};

// VS Code owns Ctrl+Z / Ctrl+Y. The extension binds those keys (scoped to our
// custom editor) to the pindouverse.undo/redo commands, which post {type:'undo'}
// / {type:'redo'} here. This keeps VS Code's built-in document-text undo from
// reverting the whole .pindou file to its last-saved state — the bug that wiped
// every unsaved edit and emptied the redo stack on a single Ctrl+Z.
//
// __pindouHostHandlesUndo tells PixelCanvas to stand down its own Ctrl+Z/Y
// handler in VS Code so we never undo twice per keypress.
(window as any).__pindouHostHandlesUndo = true;
let languageBootstrapComplete = false;
let latestHostLanguage: { language: "en" | "zh-CN"; revision: number } | null = null;
let appliedLanguageRevision = -1;
async function applyLatestHostLanguage() {
  if (!languageBootstrapComplete || !latestHostLanguage || latestHostLanguage.revision <= appliedLanguageRevision) return;
  const update = latestHostLanguage;
  appliedLanguageRevision = update.revision;
  await initializeI18n(update.language);
  useEditorStore.getState().localizeDefaultLayerNames();
}
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg?.type === "uiLanguageChanged" && (msg.language === "en" || msg.language === "zh-CN") && Number.isInteger(msg.revision) && msg.revision >= 0) {
    if (!latestHostLanguage || msg.revision > latestHostLanguage.revision) latestHostLanguage = { language: msg.language, revision: msg.revision };
    void applyLatestHostLanguage();
    return;
  }
  if (!msg || (msg.type !== "undo" && msg.type !== "redo")) return;
  // A focused text input owns Ctrl+Z for native text editing — don't hijack it.
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const store = useEditorStore.getState();
  if (msg.type === "undo") store.undo();
  else store.redo();
});

// Handle document load from extension host
setDocumentLoadHandler((content: string, path: string, isUntitled: boolean, isBackup: boolean) => {
  try {
    const project = normalizeProjectFromDisk(content);
    if (project.canvasSize && project.canvasData) {
      // Use the same whole-project load boundary as other platforms so timestamps,
      // document identity, cloud detachment and transient resets cannot drift.
      useEditorStore.getState().loadProjectDocument(project, isUntitled ? null : path, isBackup);
    }
  } catch (e) {
    console.error("Failed to parse .pindou file:", e);
  }
});

// Wrapper that signals ready AFTER React has mounted,
// so all Zustand store subscriptions are established before data arrives.
// Also auto-requests GitHub token from VS Code's built-in auth.
function WebviewApp() {
  useEffect(() => {
    signalReady();
    void githubService.restore().catch(() => {
      // Ignore — user not logged in to GitHub in VS Code.
    });
  }, []);
  return <App />;
}

// Initialize language before mounting. RPCs intentionally happen before ready;
// the host accepts requestId messages as soon as the webview listener is attached.
async function start() {
  try {
    await bootstrapUiLanguage(services);
  } catch {
    await initializeI18n("en");
  }
  useEditorStore.getState().localizeDefaultLayerNames();
  languageBootstrapComplete = true;
  await applyLatestHostLanguage();
  ReactDOM.createRoot(document.getElementById("root")!).render(<WebviewApp />);
}

void start().catch((error) => {
  renderStartupFailure(document.getElementById("root") as HTMLElement, error);
});
