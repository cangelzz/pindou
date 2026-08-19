import { useState, useEffect, useRef, useCallback } from "react";
import { PixelCanvas } from "./components/Canvas/PixelCanvas";
import { CanvasToolbar } from "./components/Canvas/CanvasToolbar";
import { ColorPalette } from "./components/Palette/ColorPalette";
import { BeadCounter } from "./components/Stats/BeadCounter";
import { ImageImportDialog } from "./components/Import/ImageImportDialog";
import { BlueprintImportDialog } from "./components/Import/BlueprintImportDialog";
import { BlueprintDimsConfirmDialog } from "./components/Import/BlueprintDimsConfirmDialog";
import { ExportDialog } from "./components/Export/ExportDialog";
import { CloudDialog } from "./components/Cloud/CloudDialog";
import { ProjectInfoDialog } from "./components/ProjectInfo/ProjectInfoDialog";
import { ChangesCompareDialog } from "./components/Canvas/ChangesCompareDialog";
import { DialogHost, appPrompt, appAlert, appConfirm } from "./components/Dialog/AppDialog";
import { useEditorStore } from "./store/editorStore";
import { getAdapter } from "./adapters";
import { getPlatformServices } from "./platform/serviceRegistry";
import type { BlueprintImportResult, ImagePreview } from "./adapters";
import { MARD_COLORS } from "./data/mard221";
import { getEffectiveColor, getEffectiveHex, type ColorOverrideMap } from "./utils/colorHelper";
import type { DeviceCodeInfo, GitHubSession } from "./platform/services";
import { connectGitHubSession } from "./platform/githubSession";
import { layerAccentColor } from "./utils/layerColors";
import type { HistoryAction, HistoryEntry, CanvasData, CanvasSize } from "./types";
import { createAutosaveScheduler } from "./utils/autosaveScheduler";
import type { ImageImportAsset } from "./platform/imageImportService";
import { WebImageImportErrorDialog } from "./components/Import/WebImageImportErrorDialog";
import { ImageTaskScheduler } from "./platform/imageTaskScheduler";
import { createImageTaskSchedulerLifecycle } from "./platform/imageTaskSchedulerLifecycle";

/** Render a small color swatch (or hatched empty marker for null) */
function ColorSwatch({ colorIndex, overrides }: { colorIndex: number | null; overrides: ColorOverrideMap }) {
  if (colorIndex === null) {
    return (
      <span
        className="inline-block w-3 h-3 rounded-sm border border-gray-300 align-middle"
        style={{
          backgroundImage:
            "linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%)",
          backgroundSize: "6px 6px",
          backgroundPosition: "0 0, 3px 3px",
        }}
        title="空"
      />
    );
  }
  const hex = getEffectiveHex(colorIndex, overrides);
  const code = MARD_COLORS[colorIndex]?.code ?? "?";
  return (
    <span
      className="inline-block w-3 h-3 rounded-sm border border-gray-300 align-middle"
      style={{ backgroundColor: hex }}
      title={code}
    />
  );
}

/** Render the inline summary of a history action (1-pixel: from→to + pos; many: count) */
function renderActionSummary(action: HistoryAction, overrides: ColorOverrideMap) {
  if (action.kind === "layers") return <span>图层快照</span>;
  const { entries } = action;
  if (entries.length === 1) {
    const e = entries[0];
    return (
      <span className="flex items-center gap-1 min-w-0">
        <ColorSwatch colorIndex={e.prevColorIndex} overrides={overrides} />
        <span className="text-[10px] text-gray-400">→</span>
        <ColorSwatch colorIndex={e.newColorIndex} overrides={overrides} />
        <span className="text-[10px] text-gray-400 ml-1">@({e.col + 1},{e.row + 1})</span>
      </span>
    );
  }
  return <span>{entries.length} 个像素变更</span>;
}

/** Verbose tooltip text describing an action */
function describeAction(action: HistoryAction, overrides: ColorOverrideMap): string {
  if (action.kind === "layers") return "图层快照（结构性操作）";
  const label = (idx: number | null) => {
    if (idx === null) return "空";
    const c = MARD_COLORS[idx];
    if (!c) return "?";
    const ov = overrides.get(idx);
    return ov ? `${c.code}(${ov.hex})` : `${c.code} ${c.name}`;
  };
  const fmt = (e: HistoryEntry) => `(${e.col + 1},${e.row + 1}) ${label(e.prevColorIndex)} → ${label(e.newColorIndex)}`;
  const { entries } = action;
  if (entries.length <= 5) return entries.map(fmt).join("\n");
  const head = entries.slice(0, 5).map(fmt).join("\n");
  return `${head}\n... 共 ${entries.length} 个像素变更`;
}

/** Extract hex color (#RRGGBB) from an rgba() string */
function rgbaToHex(rgba: string): string {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#000000";
  const [, r, g, b] = m;
  return "#" + [r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
}

/** Extract alpha from an rgba() string (0-1) */
function rgbaAlpha(rgba: string): number {
  const m = rgba.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/);
  return m ? parseFloat(m[1]) : 1;
}

/** Convert hex + alpha to rgba() string */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface ImageTaskSource { subscribe(listener: (task: { id: string; createdAt: number }) => void): () => void }

function App({ imageTaskInbox }: { imageTaskInbox?: ImageTaskSource } = {}) {
  const [showImport, setShowImport] = useState(false);
  const [imageImportAsset, setImageImportAsset] = useState<ImageImportAsset>();
  const [showWebImageError, setShowWebImageError] = useState(false);
  const schedulerRef = useRef<ImageTaskScheduler | null>(null);
  useEffect(() => createImageTaskSchedulerLifecycle(
    () => new ImageTaskScheduler(getPlatformServices().imageImports, {
      showAsset: (asset) => { setImageImportAsset(asset); setShowImport(true); },
      showError: () => setShowWebImageError(true),
    }),
    imageTaskInbox,
    schedulerRef,
  ).setup(), [imageTaskInbox]);
  const [showExport, setShowExport] = useState(false);
  const [showNewCanvas, setShowNewCanvas] = useState(false);
  const [showNewCanvasWarning, setShowNewCanvasWarning] = useState(false);
  const newCanvasRequestRef = useRef<{
    token: number;
    projectGeneration: number;
    wasDirty: boolean;
  } | null>(null);
  const newCanvasRequestTokenRef = useRef(0);
  const openRequestRef = useRef<{ token: number; projectGeneration: number; contentRevision: number } | null>(null);
  const openRequestTokenRef = useRef(0);
  const [showOpenWarning, setShowOpenWarning] = useState(false);
  const [pendingAutosave, setPendingAutosave] = useState<import("./types").ProjectFile | null>(null);
  const autosaveRecoveryStateRef = useRef<{ projectGeneration: number; contentRevision: number } | null>(null);
  const [showAutosaveRecovery, setShowAutosaveRecovery] = useState(false);
  const [showResize, setShowResize] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showProjectInfo, setShowProjectInfo] = useState(false);
  const [showChangesCompare, setShowChangesCompare] = useState(false);
  const [showCloud, setShowCloud] = useState(false);
  const [resizeW, setResizeW] = useState(52);
  const [resizeH, setResizeH] = useState(52);
  const [resizeAnchorRow, setResizeAnchorRow] = useState(0);
  const [resizeAnchorCol, setResizeAnchorCol] = useState(0);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [autosaveDir, setAutosaveDir] = useState<string | null>(null);
  const services = getPlatformServices();
  const capabilities = services.capabilities;
  const isBrowserExtension = capabilities.runtime === "browser-extension";
  const voiceEnhancement = capabilities.ai ? services.voiceEnhancement : undefined;
  const aiAvailable = !!voiceEnhancement;
  const feedbackEnvironment = capabilities.environmentLabel ?? "Desktop";
  const feedbackPlatform = capabilities.platformLabel
    ?? (navigator.userAgent.includes("Windows") ? "Windows"
    : navigator.userAgent.includes("Mac") ? "macOS"
    : navigator.userAgent.includes("Linux") ? "Linux" : "Unknown");
  const [compareSnapshot, setCompareSnapshot] = useState<{
    canvasData: CanvasData;
    canvasSize: CanvasSize;
    name: string;
  } | null>(null);
  const [blueprintImporting, setBlueprintImporting] = useState(false);
  const [blueprintDimsPending, setBlueprintDimsPending] = useState<{
    path: string;
    preview: ImagePreview;
    detectedWidth: number;
    detectedHeight: number;
    detectedBBox: { left: number; top: number; right: number; bottom: number };
    hasMetadata: boolean;
  } | null>(null);
  const [blueprintProgress, setBlueprintProgress] = useState("");
  const [blueprintProgressFraction, setBlueprintProgressFraction] = useState(0);
  const [blueprintAbort, setBlueprintAbort] = useState<AbortController | null>(null);
  const [blueprintResult, setBlueprintResult] = useState<BlueprintImportResult | null>(null);
  // Captured at the moment the user first confirms in the dims dialog —
  // remembered so that 「重新导入 W×H」 in the preview dialog can re-run
  // importBlueprint against the same file + bbox without bouncing back to
  // the dims dialog.
  const [blueprintReimportCtx, setBlueprintReimportCtx] = useState<{
    path: string;
    bbox?: { left: number; top: number; right: number; bottom: number };
  } | null>(null);
  const [rightTab, setRightTab] = useState<"palette" | "stats" | "layers">("palette");

  // GitHub session belongs to the platform service, independently from AI.
  const [githubSession, setGitHubSession] = useState<GitHubSession | null>(null);
  useEffect(() => connectGitHubSession(services.github, setGitHubSession), [services.github]);
  const isLoggedIn = githubSession !== null;
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [loginDeviceInfo, setLoginDeviceInfo] = useState<DeviceCodeInfo | null>(null);
  const [loginStatus, setLoginStatus] = useState("");
  const [loginPolling, setLoginPolling] = useState(false);
  const loginAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => loginAbortRef.current?.abort(), []);

  const newCanvas = useEditorStore((s) => s.newCanvas);
  const isDirty = useEditorStore((s) => s.isDirty);
  const cloudGistId = useEditorStore((s) => s.cloudGistId);
  const cloudSyncStatus = useEditorStore((s) => s.cloudSyncStatus);
  const projectPath = useEditorStore((s) => s.projectPath);
  const projectGeneration = useEditorStore((s) => s.projectGeneration);
  const projectInfo = useEditorStore((s) => s.projectInfo);
  const baselineCanvasData = useEditorStore((s) => s.baselineCanvasData);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const autoSaveEnabled = useEditorStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useEditorStore((s) => s.setAutoSaveEnabled);
  const reportAutosaveResult = useEditorStore((s) => s.reportAutosaveResult);
  const voiceEnhancementEnabled = useEditorStore((s) => s.voiceEnhancementEnabled);
  const setVoiceEnhancementEnabled = useEditorStore((s) => s.setVoiceEnhancementEnabled);
  const betaFeatures = useEditorStore((s) => s.betaFeatures);
  const setBetaFeature = useEditorStore((s) => s.setBetaFeature);
  const [showBetaSettings, setShowBetaSettings] = useState(false);
  const saveProject = useEditorStore((s) => s.saveProject);
  const saveProjectAs = useEditorStore((s) => s.saveProjectAs);
  const autoSave = useEditorStore((s) => s.autoSave);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const resizeCanvas = useEditorStore((s) => s.resizeCanvas);
  const countLostPixels = useEditorStore((s) => s.countLostPixels);
  const zoom = useEditorStore((s) => s.zoom);
  const refImagePixels = useEditorStore((s) => s.refImagePixels);
  const refImageVisible = useEditorStore((s) => s.refImageVisible);
  const refImageOpacity = useEditorStore((s) => s.refImageOpacity);
  const setRefImageVisible = useEditorStore((s) => s.setRefImageVisible);
  const setRefImageOpacity = useEditorStore((s) => s.setRefImageOpacity);
  const clearRefImage = useEditorStore((s) => s.clearRefImage);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const addLayer = useEditorStore((s) => s.addLayer);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const setLayerVisible = useEditorStore((s) => s.setLayerVisible);
  const setLayerOpacity = useEditorStore((s) => s.setLayerOpacity);
  const duplicateLayer = useEditorStore((s) => s.duplicateLayer);
  const moveLayer = useEditorStore((s) => s.moveLayer);
  const mergeLayerDown = useEditorStore((s) => s.mergeLayerDown);
  const renameLayer = useEditorStore((s) => s.renameLayer);
  const showActiveLayerTag = useEditorStore((s) => s.showActiveLayerTag);
  const setShowActiveLayerTag = useEditorStore((s) => s.setShowActiveLayerTag);
  const gridConfig = useEditorStore((s) => s.gridConfig);
  const setGridStartCoords = useEditorStore((s) => s.setGridStartCoords);
  const setEdgePadding = useEditorStore((s) => s.setEdgePadding);
  const setGridVisible = useEditorStore((s) => s.setGridVisible);
  const setGridLineColor = useEditorStore((s) => s.setGridLineColor);
  const setGridLineWidth = useEditorStore((s) => s.setGridLineWidth);
  const setGridGroupLineColor = useEditorStore((s) => s.setGridGroupLineColor);
  const setGridGroupLineWidth = useEditorStore((s) => s.setGridGroupLineWidth);
  const snapshots = useEditorStore((s) => s.snapshots);
  const createSnapshot = useEditorStore((s) => s.createSnapshot);
  const loadSnapshots = useEditorStore((s) => s.loadSnapshots);
  const restoreSnapshot = useEditorStore((s) => s.restoreSnapshot);
  const exportSnapshot = useEditorStore((s) => s.exportSnapshot);
  const deleteSnapshot = useEditorStore((s) => s.deleteSnapshot);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);
  const setSelectedColor = useEditorStore((s) => s.setSelectedColor);
  const setHighlightColor = useEditorStore((s) => s.setHighlightColor);

  const [newW, setNewW] = useState(52);
  const [newH, setNewH] = useState(52);

  const requestNewCanvas = useCallback(() => {
    if (showNewCanvas || showNewCanvasWarning) return;
    const token = ++newCanvasRequestTokenRef.current;
    newCanvasRequestRef.current = { token, projectGeneration, wasDirty: isDirty };
    if (isDirty) {
      setShowNewCanvasWarning(true);
    } else {
      setShowNewCanvas(true);
    }
  }, [isDirty, projectGeneration, showNewCanvas, showNewCanvasWarning]);

  const newCanvasRequestIsCurrent = useCallback(() => {
    const request = newCanvasRequestRef.current;
    if (!request || request.token !== newCanvasRequestTokenRef.current) return false;
    const current = useEditorStore.getState();
    return current.projectGeneration === request.projectGeneration;
  }, []);

  const performOpen = useCallback(async () => {
    const request = openRequestRef.current;
    if (!request || request.token !== openRequestTokenRef.current) return;
    const current = useEditorStore.getState();
    if (current.projectGeneration !== request.projectGeneration || current.contentRevision !== request.contentRevision) {
      openRequestRef.current = null;
      return;
    }
    const result = await current.openProject();
    openRequestRef.current = null;
    if (!result.ok && result.code !== "cancelled") await appAlert("打开项目失败，请重试");
    else if (!result.ok && result.message) await appAlert(result.message);
  }, []);

  const requestOpenProject = useCallback(() => {
    if (showOpenWarning || openRequestRef.current) return;
    const current = useEditorStore.getState();
    openRequestRef.current = {
      token: ++openRequestTokenRef.current,
      projectGeneration: current.projectGeneration,
      contentRevision: current.contentRevision,
    };
    if (current.isDirty) setShowOpenWarning(true);
    else void performOpen();
  }, [performOpen, showOpenWarning]);

  useEffect(() => {
    const onHostMessage = (event: MessageEvent) => {
      if (event.data?.type === "requestNewProject") requestNewCanvas();
      if (event.data?.type === "requestOpenProject") requestOpenProject();
    };
    window.addEventListener("message", onHostMessage);
    return () => window.removeEventListener("message", onHostMessage);
  }, [requestNewCanvas, requestOpenProject]);

  useEffect(() => {
    if (!isBrowserExtension || services.recovery.availability !== "available") return;
    let cancelled = false;
    const initial = useEditorStore.getState();
    const intent = { projectGeneration: initial.projectGeneration, contentRevision: initial.contentRevision };
    void services.recovery.loadAutosave().then(async (result) => {
      if (cancelled) return;
      if (!result.ok) { await appAlert("自动备份读取失败，已继续打开空白项目"); return; }
      const current = useEditorStore.getState();
      if (current.projectGeneration !== intent.projectGeneration || current.contentRevision !== intent.contentRevision || current.isDirty) return;
      if (result.value) {
        autosaveRecoveryStateRef.current = intent;
        setPendingAutosave(result.value);
        setShowAutosaveRecovery(true);
      }
    });
    return () => { cancelled = true; };
  }, [isBrowserExtension, services.recovery]);

  const dismissAutosaveRecovery = useCallback(async () => {
    const result = await services.recovery.clearAutosave?.();
    if (result && !result.ok) { await appAlert("删除自动备份失败，请重试"); return; }
    autosaveRecoveryStateRef.current = null;
    setPendingAutosave(null);
    setShowAutosaveRecovery(false);
  }, [services.recovery]);

  const applyAutosaveRecovery = useCallback(async () => {
    if (!pendingAutosave) return;
    const intent = autosaveRecoveryStateRef.current;
    const current = useEditorStore.getState();
    if (!intent || current.projectGeneration !== intent.projectGeneration || current.contentRevision !== intent.contentRevision || current.isDirty) {
      await appAlert("项目已发生修改，自动备份未恢复");
      return;
    }
    current.restoreAutosave(pendingAutosave);
    const result = await services.recovery.clearAutosave?.();
    if (result && !result.ok) await appAlert("内容已恢复，但删除自动备份失败，下次启动可能再次提示");
    autosaveRecoveryStateRef.current = null;
    setPendingAutosave(null);
    setShowAutosaveRecovery(false);
  }, [pendingAutosave, services.recovery]);

  useEffect(() => {
    if (!showAutosaveRecovery) return;
    const initialGeneration = useEditorStore.getState().projectGeneration;
    return useEditorStore.subscribe((state) => {
      if (state.projectGeneration === initialGeneration) return;
      autosaveRecoveryStateRef.current = null;
      setPendingAutosave(null);
      setShowAutosaveRecovery(false);
    });
  }, [showAutosaveRecovery]);

  // Resizable right panel
  const [rightPanelWidth, setRightPanelWidth] = useState(224);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const autoCollapsedRef = useRef(false);

  // Auto-collapse sidebar when window is narrow (e.g. VS Code diff view)
  useEffect(() => {
    const check = () => {
      if (window.innerWidth < 600 && !sidebarCollapsed) {
        setSidebarCollapsed(true);
        autoCollapsedRef.current = true;
      } else if (window.innerWidth >= 600 && autoCollapsedRef.current) {
        setSidebarCollapsed(false);
        autoCollapsedRef.current = false;
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [sidebarCollapsed]);
  const isResizingPanel = useRef(false);
  const handlePanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingPanel.current = true;
    const startX = e.clientX;
    const startW = rightPanelWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isResizingPanel.current) return;
      const delta = startX - ev.clientX;
      setRightPanelWidth(Math.max(160, Math.min(500, startW + delta)));
    };
    const onUp = () => {
      isResizingPanel.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [rightPanelWidth]);

  // Auto-save every 60 seconds
  const autoSaveRef = useRef(autoSave);
  const reportAutosaveResultRef = useRef(reportAutosaveResult);
  autoSaveRef.current = autoSave;
  reportAutosaveResultRef.current = reportAutosaveResult;
  useEffect(() => {
    if (!autoSaveEnabled) return;
    let reportedError: string | null = null;
    const scheduler = createAutosaveScheduler(
      () => autoSaveRef.current(),
      async (result) => {
        reportAutosaveResultRef.current(result);
        if (result.ok) { reportedError = null; return; }
        if (result.code === "cancelled" || reportedError === result.code) return;
        reportedError = result.code;
        await appAlert("自动备份失败，将在稍后重试");
      },
    );
    const id = setInterval(() => { void scheduler.tick(); }, 60_000);
    return () => { clearInterval(id); scheduler.dispose(); };
  }, [autoSaveEnabled]);

  // Resolve the autosave directory path lazily, so the (i) tooltip in the
  // snapshot dialog can show the actual on-disk location.
  useEffect(() => {
    if (isBrowserExtension) return;
    if (!showSnapshots) return;
    if (autosaveDir !== null) return;
    let cancelled = false;
    getAdapter()
      .getAutosaveDir()
      .then((dir) => {
        if (!cancelled) setAutosaveDir(dir ?? "");
      })
      .catch(() => {
        if (!cancelled) setAutosaveDir("");
      });
    return () => {
      cancelled = true;
    };
  }, [showSnapshots, autosaveDir, isBrowserExtension]);

  // Refresh the snapshot list when the 版本管理 dialog opens, but only if
  // the store is empty — preserves test-injected state.
  useEffect(() => {
    if (!showSnapshots || snapshots.length > 0) return;
    let cancelled = false;
    void loadSnapshots().then(async (result) => {
      if (!cancelled && !result.ok && result.code !== "cancelled") {
        await appAlert("加载快照列表失败，请重试");
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSnapshots]);

  // Update window title with project name/path
  useEffect(() => {
    const base = "拼豆宇宙 PindouVerse";
    const infoTitle = projectInfo?.title;
    const fileName = projectPath?.replace(/\\/g, "/").split("/").pop();

    let title: string;
    if (infoTitle && fileName) {
      title = `${infoTitle} (${fileName}) - ${base}`;
    } else if (infoTitle) {
      title = `${infoTitle} - ${base}`;
    } else if (projectPath) {
      const fullTitle = `${projectPath} - ${base}`;
      const shortTitle = `${fileName} - ${base}`;
      title = fullTitle.length <= 120 ? fullTitle : shortTitle;
    } else {
      title = base;
    }

    document.title = title;
    services.window?.setTitle(title);
  }, [projectPath, projectInfo?.title]);

  // Browser owns beforeunload; desktop hosts may add a native close guard.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useEditorStore.getState().isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    const disposeNative = services.window?.installDirtyCloseGuard(
      () => useEditorStore.getState().isDirty,
    );
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      disposeNative?.();
    };
  }, [services.window]);

  // Ctrl+S shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          saveProjectAs();
        } else {
          saveProject();
        }
      } else if (e.ctrlKey && e.key === "o") {
        e.preventDefault();
        requestOpenProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveProject, saveProjectAs, requestOpenProject]);

  const handleStatColorActivate = (colorIndex: number) => {
    setSelectedColor(colorIndex);
    setHighlightColor(colorIndex);
    setRightTab("palette");
  };

  return (
    <div className="flex flex-col h-screen bg-white text-gray-800">
      {/* Top menu bar: shared by every platform; IDs are the cross-platform contract. */}
      <div data-testid="top-menu" className="flex items-center gap-1 px-2 py-1 bg-gray-100 border-b text-xs select-none">
        <span className="font-bold text-sm mr-2">🎨 拼豆宇宙</span>
        <button data-menu-id="new" onClick={requestNewCanvas} className="px-2 py-1 rounded hover:bg-gray-200">新建</button>
        <button data-menu-id="resize" onClick={() => { setResizeW(canvasSize.width); setResizeH(canvasSize.height); setResizeAnchorRow(0); setResizeAnchorCol(0); setShowResize(true); }} className="px-2 py-1 rounded hover:bg-gray-200">调整画布</button>
        <button data-menu-id="open" onClick={requestOpenProject} className="px-2 py-1 rounded hover:bg-gray-200" title="Ctrl+O">打开</button>
        <button data-menu-id="save" onClick={() => saveProject()} className="px-2 py-1 rounded hover:bg-gray-200" title="Ctrl+S">保存</button>
        <button data-menu-id="save-as" onClick={() => saveProjectAs()} className="px-2 py-1 rounded hover:bg-gray-200" title="Ctrl+Shift+S" aria-label="保存到新文件">另存为</button>
        <button data-menu-id="project-info" onClick={() => setShowProjectInfo(true)} className="px-2 py-1 rounded hover:bg-gray-200">项目信息</button>
        <div data-separator-id="files" className="border-l mx-1 h-4" />
        <button data-menu-id="import-image" onClick={() => setShowImport(true)} className="px-2 py-1 rounded hover:bg-gray-200">导入图片</button>
        <button
          data-menu-id="import-blueprint"
          onClick={async () => {
            const adapter = getAdapter();
            const path = await adapter.showOpenDialog([
              { name: "Image", extensions: ["png", "jpg", "jpeg", "bmp"] },
            ]);
            if (!path) return;
            setBlueprintImporting(true);
            setBlueprintProgress("正在分析图纸结构...");
            try {
              const [preview, dims] = await Promise.all([
                adapter.previewImage(path),
                adapter.detectBlueprintDims(path),
              ]);
              setBlueprintImporting(false);
              setBlueprintDimsPending({
                path, preview,
                detectedWidth: dims.width,
                detectedHeight: dims.height,
                detectedBBox: dims.bbox,
                hasMetadata: dims.hasMetadata,
              });
            } catch (error) {
              setBlueprintImporting(false);
              await appAlert(`图纸分析失败: ${error}`);
            }
          }}
          disabled={blueprintImporting}
          className={`px-2 py-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${blueprintImporting ? "opacity-50" : ""}`}
        >
          导入图纸 <span className="text-[8px] bg-amber-100 text-amber-700 px-1 rounded font-semibold tracking-wider">BETA</span>
        </button>
        <button data-menu-id="export" onClick={() => setShowExport(true)} className="px-2 py-1 rounded hover:bg-gray-200">导出</button>
        <div data-separator-id="history" className="border-l mx-1 h-4" />
        <button data-menu-id="history" onClick={() => setShowHistory(true)} className="px-2 py-1 rounded hover:bg-gray-200">历史记录</button>
        {baselineCanvasData && <button data-menu-id="compare" onClick={() => setShowChangesCompare(true)} className="px-2 py-1 rounded hover:bg-gray-200">对比</button>}
        {isLoggedIn && <button data-menu-id="cloud" onClick={() => setShowCloud(true)} className="px-2 py-1 rounded hover:bg-gray-200">云端</button>}
        {isLoggedIn && cloudGistId && <span data-menu-id="cloud-status" data-cloud-status={cloudSyncStatus} className={`text-xs ${cloudSyncStatus === "remote-newer" ? "text-red-600" : cloudSyncStatus === "local-changes" ? "text-orange-500" : "text-green-600"}`}>{cloudSyncStatus === "synced" ? "☁️✓" : "☁️●"}</span>}
        <button data-menu-id="version" onClick={() => setShowSnapshots(true)} className="px-2 py-1 rounded hover:bg-gray-200">版本</button>
        <div className="flex-1" />
        {isLoggedIn ? (
          <button data-menu-id="logged-in" onClick={async () => {
            const result = await services.github.logout();
            if (!result.ok) await appAlert("登出失败，未能删除本地 GitHub 凭据，请重试");
          }} className="px-2 py-1 rounded hover:bg-gray-200 text-green-600 text-xs" title="点击登出 GitHub">✓ GitHub 已登录</button>
        ) : (
          <button data-menu-id="login" disabled={services.github.availability === "unsupported" || services.github.configured === false} title={services.github.availability === "unsupported" ? "功能初始化中" : services.github.configured === false ? "未配置 GitHub Client ID" : "登录 GitHub"} onClick={async () => {
            if (!services.github.startDeviceFlow || !services.github.pollDeviceFlow) {
              await services.github.login();
              return;
            }
            const controller = new AbortController();
            loginAbortRef.current?.abort();
            loginAbortRef.current = controller;
            const isCurrent = () => loginAbortRef.current === controller && !controller.signal.aborted;
            setShowLoginDialog(true);
            setLoginDeviceInfo(null);
            setLoginPolling(false);
            setLoginStatus("正在请求验证码...");
            try {
              const started = await services.github.startDeviceFlow(controller.signal);
              if (!isCurrent()) return;
              if (!started.ok) { setLoginStatus("请求失败"); return; }
              setLoginDeviceInfo(started.value);
              setLoginStatus("请在浏览器中输入验证码");
              const opened = await services.externalLinks.open(started.value.verification_uri);
              if (!isCurrent()) return;
              if (!opened.ok) setLoginStatus("请复制上方链接到浏览器继续授权");
              setLoginPolling(true);
              const result = await services.github.pollDeviceFlow(
                started.value,
                (status) => { if (isCurrent()) setLoginStatus(status); },
                controller.signal,
              );
              if (!isCurrent()) return;
              if (result.ok) setShowLoginDialog(false);
            } catch {
              if (isCurrent()) setLoginStatus("请求失败");
            } finally {
              if (loginAbortRef.current === controller) {
                loginAbortRef.current = null;
                setLoginPolling(false);
              }
            }
          }} className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50 text-gray-500 text-xs">登录 GitHub</button>
        )}
        <button data-menu-id="feedback" data-feedback-environment={feedbackEnvironment} onClick={() => {
          const appVersion = (window as any).__pindouVersion || "dev";
          const canvas = `${canvasSize.width}x${canvasSize.height}`;
          const body = encodeURIComponent(`**描述问题**


**复现步骤**
1.
2.
3.

**环境信息**
- 版本: ${appVersion}
- 平台: ${feedbackPlatform}
- 运行环境: ${feedbackEnvironment}
- 画布: ${canvas}
`);
          const url = `https://github.com/cangelzz/pindouverse/issues/new?body=${body}`;
          void services.externalLinks.open(url).then((result) => { if (!result.ok) window.open(url, "_blank"); });
        }} className="px-2 py-1 rounded hover:bg-gray-200 text-gray-400 text-xs">反馈</button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left toolbar */}
        <CanvasToolbar />

        {/* Center canvas */}
        <PixelCanvas />

        {/* Right panel (resizable) */}
        <div className="flex min-h-0 relative">
          {!sidebarCollapsed && (
            <>
          {/* Resize handle */}
          <div
            className="w-1 cursor-col-resize hover:bg-blue-300 active:bg-blue-400 bg-gray-200 transition-colors"
            onMouseDown={handlePanelResizeStart}
          />
          <div
            className="flex flex-col border-l bg-white min-h-0"
            style={{ width: rightPanelWidth }}
          >
          {/* Tabs */}
          <div className="flex border-b text-xs">
            <button
              onClick={() => setRightTab("palette")}
              className={`flex-1 py-1.5 ${
                rightTab === "palette"
                  ? "border-b-2 border-blue-500 text-blue-600 font-semibold"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              色板
            </button>
            <button
              onClick={() => setRightTab("layers")}
              className={`flex-1 py-1.5 ${
                rightTab === "layers"
                  ? "border-b-2 border-blue-500 text-blue-600 font-semibold"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              图层
            </button>
            <button
              onClick={() => setRightTab("stats")}
              className={`flex-1 py-1.5 ${
                rightTab === "stats"
                  ? "border-b-2 border-blue-500 text-blue-600 font-semibold"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              统计
            </button>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="px-1.5 py-1.5 text-gray-300 hover:text-gray-500"
              title="折叠侧边栏"
            >
              ▶
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === "palette" && <ColorPalette />}
            {rightTab === "stats" && <BeadCounter onColorActivate={handleStatColorActivate} />}
            {rightTab === "layers" && (
              <div className="p-2 flex flex-col gap-2 text-xs overflow-y-auto">
                {/* Bead layers (top = rendered last = highest) */}
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-600">拼豆图层</span>
                  <button
                    onClick={async () => {
                      const name = await appPrompt("图层名称", `图层 ${layers.length + 1}`, { title: "新建图层" });
                      if (name !== null) addLayer(name || `图层 ${layers.length + 1}`);
                    }}
                    className="px-1.5 py-0.5 bg-blue-500 text-white rounded text-[10px] hover:bg-blue-600"
                  >
                    + 新建图层
                  </button>
                </div>

                {layers.length > 1 && (
                  <label
                    className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none border border-gray-200 rounded px-2 py-1 bg-white"
                    title="鼠标在画布上时显示当前激活图层的浮动提示"
                  >
                    <input
                      type="checkbox"
                      checked={showActiveLayerTag}
                      onChange={(e) => setShowActiveLayerTag(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span>画布上显示浮动图层提示</span>
                  </label>
                )}

                {[...layers].reverse().map((layer) => {
                  const isActive = layer.id === activeLayerId;
                  const layerIdx = layers.findIndex((l) => l.id === layer.id);
                  const accent = layerAccentColor(layerIdx);
                  return (
                    <div
                      key={layer.id}
                      className={`relative border rounded p-1.5 pl-2.5 transition-colors ${
                        isActive
                          ? "bg-blue-200/70 border-2 border-blue-500 shadow-sm"
                          : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      <div
                        className={`absolute left-0 top-0 bottom-0 rounded-l ${
                          isActive ? "w-1.5" : "w-1 opacity-70"
                        }`}
                        style={{ background: accent }}
                        aria-hidden
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={layer.visible}
                          onChange={(e) => setLayerVisible(layer.id, e.target.checked)}
                          className="w-3 h-3"
                        />
                        <button
                          onClick={() => setActiveLayer(layer.id)}
                          onDoubleClick={async () => {
                            const name = await appPrompt("重命名图层", layer.name, { title: "重命名图层" });
                            if (name !== null && name.trim()) renameLayer(layer.id, name.trim());
                          }}
                          className={`flex-1 text-left truncate ${
                            isActive ? "font-bold text-blue-900 text-sm" : "text-gray-600"
                          }`}
                          title="双击重命名"
                        >
                          {layer.name}
                        </button>
                        {isActive && <span className="text-[9px] text-blue-500">✎</span>}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(layer.opacity * 100)}
                          onChange={(e) => setLayerOpacity(layer.id, Number(e.target.value) / 100)}
                          className="flex-1 h-2"
                        />
                        <span className="text-gray-400 w-7 text-right text-[10px]">
                          {Math.round(layer.opacity * 100)}%
                        </span>
                      </div>
                      <div className="flex gap-0.5 mt-1">
                        <button
                          onClick={() => moveLayer(layer.id, "up")}
                          className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                          title="上移"
                        >↑</button>
                        <button
                          onClick={() => moveLayer(layer.id, "down")}
                          className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                          title="下移"
                        >↓</button>
                        <button
                          onClick={() => duplicateLayer(layer.id)}
                          className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                          title="复制"
                        >复制</button>
                        {layerIdx > 0 && (
                          <button
                            onClick={async () => {
                              const lower = layers[layerIdx - 1];
                              const ok = await appConfirm(
                                `向下合并？「${layer.name}」将并入「${lower.name}」，合并为一层。\n切换图层前可用 Ctrl+Z 撤销。`,
                                { title: "合并图层" },
                              );
                              if (ok) mergeLayerDown(layer.id);
                            }}
                            className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                            title="合并到下层（与下方图层合为一层）"
                          >合并到下层</button>
                        )}
                        {layers.length > 1 && (
                          <button
                            onClick={() => removeLayer(layer.id)}
                            className="px-1 py-0 border rounded text-[9px] text-red-400 hover:bg-red-50"
                            title="删除"
                          >删除</button>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="border-t my-1" />

                {/* Reference image layer */}
                <div className={`border rounded p-1.5 ${refImagePixels ? 'bg-green-50' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-1">
                    {refImagePixels ? (
                      <input
                        type="checkbox"
                        checked={refImageVisible}
                        onChange={(e) => setRefImageVisible(e.target.checked)}
                        className="w-3 h-3"
                      />
                    ) : (
                      <input type="checkbox" disabled className="w-3 h-3 opacity-30" />
                    )}
                    <span className="font-semibold text-gray-600">🖼️ 参考图 (不导出)</span>
                  </div>
                  {refImagePixels ? (
                    <>
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(refImageOpacity * 100)}
                          onChange={(e) => setRefImageOpacity(Number(e.target.value) / 100)}
                          className="flex-1 h-2"
                        />
                        <span className="text-gray-400 w-7 text-right text-[10px]">
                          {Math.round(refImageOpacity * 100)}%
                        </span>
                      </div>
                      <button
                        onClick={clearRefImage}
                        className="text-[10px] text-red-400 hover:text-red-600 underline mt-1"
                      >
                        移除
                      </button>
                    </>
                  ) : (
                    <p className="text-[10px] text-gray-400 mt-0.5">导入图片时自动设置</p>
                  )}
                </div>

                <div className="border-t my-1" />

                {/* Grid layer */}
                <div className="border rounded p-1.5 bg-gray-50">
                  <div className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={gridConfig.visible}
                      onChange={(e) => setGridVisible(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span className="font-semibold text-gray-600">📐 网格</span>
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">边距</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={gridConfig.edgePadding}
                        onChange={(e) => setEdgePadding(Number(e.target.value))}
                        className="w-12 px-1 py-0 border rounded text-center text-[10px]"
                      />
                      <span className="text-[9px] text-gray-400">格</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">起始列</span>
                      <input
                        type="number"
                        value={gridConfig.startX}
                        onChange={(e) => setGridStartCoords(Number(e.target.value), gridConfig.startY)}
                        className="w-12 px-1 py-0 border rounded text-center text-[10px]"
                      />
                      <span className="text-gray-500 w-12">起始行</span>
                      <input
                        type="number"
                        value={gridConfig.startY}
                        onChange={(e) => setGridStartCoords(gridConfig.startX, Number(e.target.value))}
                        className="w-12 px-1 py-0 border rounded text-center text-[10px]"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">细线</span>
                      <input
                        type="color"
                        value={rgbaToHex(gridConfig.lineColor)}
                        onChange={(e) => setGridLineColor(hexToRgba(e.target.value, rgbaAlpha(gridConfig.lineColor)))}
                        className="w-5 h-4 p-0 border rounded cursor-pointer"
                      />
                      <input
                        type="number"
                        min={0}
                        max={5}
                        step={0.5}
                        value={gridConfig.lineWidth}
                        onChange={(e) => setGridLineWidth(Number(e.target.value))}
                        className="w-10 px-1 py-0 border rounded text-center text-[10px]"
                      />
                      <span className="text-[9px] text-gray-400">px</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">粗线</span>
                      <input
                        type="color"
                        value={rgbaToHex(gridConfig.groupLineColor)}
                        onChange={(e) => setGridGroupLineColor(hexToRgba(e.target.value, rgbaAlpha(gridConfig.groupLineColor)))}
                        className="w-5 h-4 p-0 border rounded cursor-pointer"
                      />
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        value={gridConfig.groupLineWidth}
                        onChange={(e) => setGridGroupLineWidth(Number(e.target.value))}
                        className="w-10 px-1 py-0 border rounded text-center text-[10px]"
                      />
                      <span className="text-[9px] text-gray-400">px</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
            </>
          )}
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="w-5 flex items-center justify-center border-l bg-gray-50 hover:bg-gray-100 text-gray-300 hover:text-gray-500 text-xs"
              title="展开侧边栏"
            >
              ◀
            </button>
          )}
        </div>
      </div>

      {/* Dialogs */}
      {showImport && <ImageImportDialog
        initialAsset={imageImportAsset}
        onInitialAssetReleased={(assetId) => {
          if (imageImportAsset?.source === "web-context-menu") schedulerRef.current?.completeAsset(assetId);
          else getPlatformServices().imageImports.consumeAsset(assetId);
        }}
        onClose={() => {
          const wasLocalFallback = imageImportAsset?.source === "local";
          setShowImport(false); setImageImportAsset(undefined);
          if (wasLocalFallback) schedulerRef.current?.completeError();
        }}
      />}
      {showWebImageError && <WebImageImportErrorDialog
        onClose={() => { setShowWebImageError(false); schedulerRef.current?.completeError(); }}
        onChooseLocal={() => {
          void getPlatformServices().images.chooseLocalImage().then((result) => {
            if (result.ok) { setShowWebImageError(false); setImageImportAsset(result.value); setShowImport(true); }
          });
        }}
      />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showProjectInfo && <ProjectInfoDialog onClose={() => setShowProjectInfo(false)} />}
      {showChangesCompare && <ChangesCompareDialog onClose={() => setShowChangesCompare(false)} />}

      {/* Blueprint Import Progress Modal */}
      {blueprintImporting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4 flex flex-col gap-3">
            <div className="text-sm font-semibold">正在导入图纸</div>
            <div className="text-xs text-gray-600 truncate" title={blueprintProgress}>{blueprintProgress}</div>
            <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(blueprintProgressFraction * 100)}%` }} />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => blueprintAbort?.abort()}
                className="px-3 py-1 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50"
              >取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Blueprint pre-import dims confirmation (BETA) */}
      {blueprintDimsPending && (
        <BlueprintDimsConfirmDialog
          filePath={blueprintDimsPending.path}
          detectedWidth={blueprintDimsPending.detectedWidth}
          detectedHeight={blueprintDimsPending.detectedHeight}
          detectedBBox={blueprintDimsPending.detectedBBox}
          hasMetadata={blueprintDimsPending.hasMetadata}
          preview={blueprintDimsPending.preview}
          onCancel={() => setBlueprintDimsPending(null)}
          onRedetect={async (bbox, opts) => {
            const adapter = getAdapter();
            return await adapter.detectBlueprintDims(blueprintDimsPending.path, bbox, opts);
          }}
          onConfirm={async (w, h, bbox) => {
            const pending = blueprintDimsPending;
            setBlueprintDimsPending(null);
            const adapter = getAdapter();
            const controller = new AbortController();
            setBlueprintImporting(true);
            setBlueprintAbort(controller);
            setBlueprintProgress(`正在导入 ${w}×${h} 图纸...`);
            setBlueprintProgressFraction(0);
            try {
              const palette = MARD_COLORS
                .map((c, i) => ({ c, i }))
                .filter(({ c }) => c.rgb)
                .map(({ c, i }) => {
                  const eff = getEffectiveColor(i, colorOverrides);
                  return { code: c.code, r: eff.rgb![0], g: eff.rgb![1], b: eff.rgb![2] };
                });
              setBlueprintProgress("正在识别颜色...");
              const result = await adapter.importBlueprint(
                pending.path,
                palette,
                w,
                h,
                undefined,
                bbox,
                {
                  onProgress: (stage, frac) => {
                    setBlueprintProgress(stage);
                    setBlueprintProgressFraction(frac);
                  },
                  signal: controller.signal,
                },
              );
              setBlueprintResult(result);
              setBlueprintReimportCtx({ path: pending.path, bbox });
            } catch (e) {
              if ((e as Error)?.name !== "AbortError") {
                await appAlert(`图纸导入失败: ${e}`);
              }
            } finally {
              setBlueprintImporting(false);
              setBlueprintAbort(null);
            }
          }}
        />
      )}

      {/* Blueprint Import Preview Dialog */}
      {blueprintResult && (
        <BlueprintImportDialog
          result={blueprintResult}
          onClose={() => { setBlueprintResult(null); setBlueprintReimportCtx(null); }}
          onReimport={blueprintReimportCtx ? async (w, h) => {
            const adapter = getAdapter();
            const palette = MARD_COLORS
              .map((c, i) => ({ c, i }))
              .filter(({ c }) => c.rgb)
              .map(({ c, i }) => {
                const eff = getEffectiveColor(i, colorOverrides);
                return { code: c.code, r: eff.rgb![0], g: eff.rgb![1], b: eff.rgb![2] };
              });
            return await adapter.importBlueprint(
              blueprintReimportCtx.path,
              palette,
              w,
              h,
              undefined,
              blueprintReimportCtx.bbox,
            );
          } : undefined}
          onConfirm={(result) => {
            const codeToIndex = new Map<string, number>();
            MARD_COLORS.forEach((c, i) => codeToIndex.set(c.code, i));
            const canvasData = result.cells.map((row) =>
              row.map((cell) => ({
                colorIndex: cell.final_code ? (codeToIndex.get(cell.final_code) ?? null) : null,
              }))
            );
            useEditorStore.getState().placeImageOnCanvas(
              canvasData,
              result.width,
              result.height,
              result.width,
              result.height,
              0,
              0,
            );
            setBlueprintResult(null);
            setBlueprintReimportCtx(null);
          }}
        />
      )}

      {showOpenWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4">
            <h2 className="font-semibold text-sm mb-2">未保存的修改</h2>
            <p className="text-xs text-gray-600 mb-4">当前项目有未保存的修改，继续打开会丢失这些修改。</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowOpenWarning(false); openRequestRef.current = null; }} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100">取消</button>
              <button onClick={() => { setShowOpenWarning(false); void performOpen(); }} className="px-3 py-1.5 bg-red-500 text-white text-xs rounded hover:bg-red-600">继续</button>
            </div>
          </div>
        </div>
      )}

      {showAutosaveRecovery && pendingAutosave && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" data-testid="autosave-recovery-dialog">
          <div className="bg-white rounded-lg shadow-xl w-[380px] p-4">
            <h2 className="font-semibold text-sm mb-2">检测到未恢复的自动备份</h2>
            <p className="text-xs text-gray-600 mb-4">可以恢复上次未保存的内容，恢复后需另存为新文件。</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { autosaveRecoveryStateRef.current = null; setPendingAutosave(null); setShowAutosaveRecovery(false); }} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100">稍后</button>
              <button onClick={() => { void dismissAutosaveRecovery(); }} className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50">删除备份</button>
              <button onClick={() => { void applyAutosaveRecovery(); }} className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600">恢复</button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes guard for creating a new project. */}
      {showNewCanvasWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4">
            <h2 className="font-semibold text-sm mb-2">未保存的修改</h2>
            <p className="text-xs text-gray-600 mb-4">当前项目有未保存的修改，继续新建会丢失这些修改。</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowNewCanvasWarning(false);
                  newCanvasRequestRef.current = null;
                }}
                className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setShowNewCanvasWarning(false);
                  if (!newCanvasRequestIsCurrent()) {
                    newCanvasRequestRef.current = null;
                    return;
                  }
                  setShowNewCanvas(true);
                }}
                className="px-3 py-1.5 bg-red-500 text-white text-xs rounded hover:bg-red-600"
              >
                继续
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Canvas Dialog */}
      {showNewCanvas && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[320px] p-4">
            <h2 className="font-semibold text-sm mb-3">新建画布</h2>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                {[
                  { l: "52×52", w: 52, h: 52 },
                  { l: "104×104", w: 104, h: 104 },
                ].map((p) => (
                  <button
                    key={p.l}
                    onClick={() => { setNewW(p.w); setNewH(p.h); }}
                    className={`px-2 py-1 text-xs rounded border ${
                      newW === p.w && newH === p.h
                        ? "bg-blue-100 border-blue-400"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    {p.l}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center text-xs">
                <span>宽</span>
                <input
                  type="number"
                  min={4}
                  max={256}
                  value={newW}
                  onChange={(e) => setNewW(Number(e.target.value))}
                  className="w-16 px-2 py-1 border rounded"
                />
                <span>高</span>
                <input
                  type="number"
                  min={4}
                  max={256}
                  value={newH}
                  onChange={(e) => setNewH(Number(e.target.value))}
                  className="w-16 px-2 py-1 border rounded"
                />
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => {
                    if (!newCanvasRequestIsCurrent()) {
                      setShowNewCanvas(false);
                      newCanvasRequestRef.current = null;
                      return;
                    }
                    const request = newCanvasRequestRef.current;
                    if (request && !request.wasDirty && useEditorStore.getState().isDirty) {
                      request.wasDirty = true;
                      setShowNewCanvas(false);
                      setShowNewCanvasWarning(true);
                      return;
                    }
                    // When the host (currently VS Code) manages document tabs,
                    // route through it so a fresh untitled_<ts>.pindou tab opens.
                    // Otherwise the current tab keeps the previously opened file's
                    // path, risking an accidental overwrite on save.
                    const hostNew = (window as any).__pindouRequestNewProject as
                      | ((w: number, h: number) => void)
                      | undefined;
                    if (typeof hostNew === "function") {
                      hostNew(newW, newH);
                    } else {
                      newCanvas(newW, newH);
                    }
                    setShowNewCanvas(false);
                    newCanvasRequestRef.current = null;
                  }}
                  className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                >
                  创建
                </button>
                <button
                  onClick={() => {
                    setShowNewCanvas(false);
                    newCanvasRequestRef.current = null;
                  }}
                  className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resize Canvas Dialog */}
      {showResize && (() => {
        const lostPixels = (resizeW !== canvasSize.width || resizeH !== canvasSize.height)
          ? countLostPixels(resizeW, resizeH, resizeAnchorRow, resizeAnchorCol)
          : 0;
        const dw = resizeW - canvasSize.width;
        const dh = resizeH - canvasSize.height;
        const isSameSize = dw === 0 && dh === 0;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-[340px] p-4">
              <h2 className="font-semibold text-sm mb-3">调整画布</h2>
              <div className="flex flex-col gap-3">
                {/* Size inputs */}
                <div className="flex gap-2 items-center text-xs">
                  <span>宽</span>
                  <input
                    type="number"
                    min={4}
                    max={256}
                    value={resizeW}
                    onChange={(e) => setResizeW(Math.max(4, Math.min(256, Number(e.target.value))))}
                    className="w-16 px-2 py-1 border rounded"
                  />
                  <span>高</span>
                  <input
                    type="number"
                    min={4}
                    max={256}
                    value={resizeH}
                    onChange={(e) => setResizeH(Math.max(4, Math.min(256, Number(e.target.value))))}
                    className="w-16 px-2 py-1 border rounded"
                  />
                </div>

                {/* Preview */}
                <div className="text-xs text-gray-500">
                  {canvasSize.width}×{canvasSize.height} → {resizeW}×{resizeH}
                  {!isSameSize && (
                    <span className="ml-1">
                      ({dw >= 0 ? "+" : ""}{dw} 宽, {dh >= 0 ? "+" : ""}{dh} 高)
                    </span>
                  )}
                </div>

                {/* Anchor selector */}
                <div>
                  <div className="text-xs text-gray-500 mb-1">锚点（内容保留位置）</div>
                  <div className="inline-grid grid-cols-3 gap-1">
                    {[0, 1, 2].map((row) =>
                      [0, 1, 2].map((col) => (
                        <button
                          key={`${row}-${col}`}
                          onClick={() => { setResizeAnchorRow(row); setResizeAnchorCol(col); }}
                          className={`w-6 h-6 rounded border text-xs flex items-center justify-center ${
                            resizeAnchorRow === row && resizeAnchorCol === col
                              ? "bg-blue-500 text-white border-blue-600"
                              : "bg-gray-100 hover:bg-gray-200 border-gray-300"
                          }`}
                        >
                          {resizeAnchorRow === row && resizeAnchorCol === col ? "●" : "○"}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Warning for pixel loss */}
                {lostPixels > 0 && (
                  <div className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                    ⚠ 将裁剪 {lostPixels} 个非空像素
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => {
                      resizeCanvas(resizeW, resizeH, resizeAnchorRow, resizeAnchorCol);
                      setShowResize(false);
                    }}
                    disabled={isSameSize}
                    className={`px-3 py-1.5 text-xs rounded ${
                      isSameSize
                        ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                        : "bg-blue-500 text-white hover:bg-blue-600"
                    }`}
                  >
                    应用
                  </button>
                  <button
                    onClick={() => setShowResize(false)}
                    className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Snapshot Dialog */}
      {showSnapshots && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[70vh] flex flex-col">
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <h2 className="font-semibold text-sm">版本管理</h2>
              <button
                onClick={() => setShowSnapshots(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3 overflow-y-auto">
              {/* Local-only notice (persistent, info-pill style) */}
              <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                {isBrowserExtension
                  ? "快照仅保存在当前浏览器配置中；清理浏览器数据或卸载扩展会删除本地备份和快照。"
                  : "📍 快照保存在本地应用数据目录，换设备或重装应用会丢失"}
              </div>

              {/* Create snapshot */}
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={snapshotLabel}
                  onChange={(e) => setSnapshotLabel(e.target.value)}
                  placeholder="版本备注（可选）"
                  className="flex-1 px-2 py-1 text-xs border rounded"
                />
                <button
                  onClick={async () => {
                    const result = await createSnapshot(snapshotLabel || "手动保存");
                    if (result.ok) setSnapshotLabel("");
                    else if (result.code !== "cancelled") await appAlert("创建快照失败，请重试");
                  }}
                  className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                >
                  创建快照
                </button>
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-500 text-[10px] cursor-help select-none"
                  title={isBrowserExtension
                    ? "快照保存在当前浏览器配置中。清理浏览器数据或卸载扩展会删除本地备份和快照。"
                    : autosaveDir
                      ? `保存位置：${autosaveDir}\n如需长期保存请用列表中的「另存为」`
                      : "快照保存在本机的应用数据目录。如需长期保存请用列表中的「另存为」"
                  }
                  aria-label="快照存储位置说明"
                >
                  i
                </span>
              </div>

              {/* Snapshot list */}
              {snapshots.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">暂无快照</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {snapshots.map((s) => (
                    <div
                      key={s.path}
                      className="flex items-center gap-2 p-2 bg-gray-50 rounded border text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-gray-400">{s.modified}</div>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            const result = await getPlatformServices().recovery.loadSnapshot(s.path);
                            if (!result.ok) throw result.cause ?? new Error(result.code);
                            const project = "project" in result.value ? result.value.project : result.value;
                            setCompareSnapshot({
                              canvasData: project.canvasData,
                              canvasSize: project.canvasSize,
                              name: s.name,
                            });
                          } catch (e) {
                            await appAlert(`加载快照失败: ${e instanceof Error ? e.message : String(e)}`);
                          }
                        }}
                        className="px-2 py-1 border border-gray-300 text-blue-600 rounded hover:bg-blue-50 shrink-0"
                      >
                        对比
                      </button>
                      <button
                        onClick={async () => {
                          if (!s.sourceProjectId || s.sourceProjectId !== useEditorStore.getState().projectId) {
                            const proceed = await appConfirm("此快照无法确认属于当前项目，恢复后将需要另存为并解除云端关联。", { title: "恢复快照" });
                            if (!proceed) return;
                          }
                          const result = await restoreSnapshot(s);
                          if (result.ok) setShowSnapshots(false);
                          else if (result.code !== "cancelled") await appAlert("恢复快照失败，请检查快照数据");
                        }}
                        className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 shrink-0"
                      >
                        恢复
                      </button>
                      <button
                        onClick={async () => {
                          const result = await exportSnapshot(s.path, s.name);
                          if (result.ok) await appAlert("快照已导出", { title: "导出成功" });
                          else if (result.code !== "cancelled") await appAlert("导出快照失败，请重试", { title: "导出失败" });
                        }}
                        className="px-2 py-1 border border-blue-300 text-blue-600 rounded hover:bg-blue-50 shrink-0"
                        title="导出为独立 .pindou 文件"
                      >
                        另存为
                      </button>
                      <button
                        onClick={async () => {
                          if (!(await appConfirm(`确认删除快照「${s.name}」？此操作不可撤销。`, { title: "删除快照" }))) return;
                          try {
                            await deleteSnapshot(s.path);
                          } catch (e) {
                            await appAlert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
                          }
                        }}
                        title="删除快照"
                        className="px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50 shrink-0"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Snapshot compare dialog */}
      {compareSnapshot && (
        <ChangesCompareDialog
          onClose={() => setCompareSnapshot(null)}
          baselineData={compareSnapshot.canvasData}
          baselineSize={compareSnapshot.canvasSize}
          baselineLabel={`快照: ${compareSnapshot.name}`}
          currentLabel="当前"
          title="与快照对比"
        />
      )}

      {/* History Dialog */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] max-h-[70vh] flex flex-col">
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <h2 className="font-semibold text-sm">历史记录</h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {undoStack.length === 0 && redoStack.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">暂无操作记录</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {/* Redo entries (future states, shown on top, grayed out) */}
                  {[...redoStack].reverse().map((action, i) => {
                    const stepsForward = redoStack.length - i;
                    return (
                      <button
                        key={`redo-${i}`}
                        onClick={() => {
                          for (let s = 0; s < stepsForward; s++) redo();
                        }}
                        className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-blue-50 text-gray-400"
                        title={describeAction(action, colorOverrides)}
                      >
                        <span className="w-5 text-center text-[10px]">↪</span>
                        {renderActionSummary(action, colorOverrides)}
                      </button>
                    );
                  })}

                  {/* Current state marker */}
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs rounded bg-blue-100 text-blue-700 font-semibold">
                    <span className="w-5 text-center">●</span>
                    <span>当前状态</span>
                  </div>

                  {/* Undo entries (past states, shown below current) */}
                  {[...undoStack].reverse().map((action, i) => {
                    const stepsBack = i + 1;
                    return (
                      <button
                        key={`undo-${i}`}
                        onClick={() => {
                          for (let s = 0; s < stepsBack; s++) undo();
                          setShowHistory(false);
                        }}
                        className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-orange-50 text-gray-600"
                        title={describeAction(action, colorOverrides)}
                      >
                        <span className="w-5 text-center text-[10px]">↩</span>
                        {renderActionSummary(action, colorOverrides)}
                        <span className="text-gray-400 ml-auto text-[10px]">-{stepsBack}步</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-4 py-2 border-t flex justify-end">
              <button
                onClick={() => setShowHistory(false)}
                className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showCloud && <CloudDialog onClose={() => setShowCloud(false)} />}

      {showLoginDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4">
            <h3 className="font-semibold text-sm mb-2">登录 GitHub</h3>
            {loginDeviceInfo ? <>
              <p className="text-xs text-gray-500 mb-3">请在浏览器中打开下方链接，输入验证码完成授权：</p>
              <div className="flex flex-col items-center gap-2 mb-3">
                <a href={loginDeviceInfo.verification_uri} target="_blank" rel="noopener noreferrer" className="text-blue-500 text-xs underline">{loginDeviceInfo.verification_uri}</a>
                <div className="text-2xl font-mono font-bold tracking-widest bg-gray-100 px-4 py-2 rounded select-all">{loginDeviceInfo.user_code}</div>
              </div>
            </> : null}
            <p className="text-xs text-center text-gray-500">{loginPolling && <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-1" />}{loginStatus}</p>
            <div className="flex justify-end mt-3"><button onClick={() => { const current = loginAbortRef.current; loginAbortRef.current = null; current?.abort(); setLoginPolling(false); setShowLoginDialog(false); setLoginDeviceInfo(null); setLoginStatus(""); }} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100">{loginPolling ? "取消" : "关闭"}</button></div>
          </div>
        </div>
      )}

      {/* Bottom status bar */}
      <div className="flex items-center gap-3 px-3 py-0.5 bg-gray-100 border-t text-[10px] text-gray-500 select-none">
        <span>画布: {canvasSize.width}×{canvasSize.height}</span>
        <span>缩放: {Math.round(zoom * 100)}%</span>
        {projectPath && (
          <span className="truncate max-w-[200px]" title={projectPath}>
            {projectPath.split("\\").pop()}
          </span>
        )}
        <div className="flex-1" />
        {isDirty && <span className="text-orange-500">● 未保存</span>}
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSaveEnabled}
            onChange={(e) => setAutoSaveEnabled(e.target.checked)}
            className="w-3 h-3"
          />
          自动备份
        </label>
        {aiAvailable && betaFeatures.voiceEnhancement && (
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={voiceEnhancementEnabled}
            onChange={(e) => setVoiceEnhancementEnabled(e.target.checked)}
            className="w-3 h-3"
          />
          {voiceEnhancement!.labels.toggle}
        </label>
        )}
        <button
          data-testid="beta-settings"
          onClick={() => setShowBetaSettings(true)}
          className="text-[10px] text-gray-400 hover:text-gray-600 underline"
        >
          Beta
        </button>
        {lastSavedAt && (
          <span
            className={lastSavedAt.startsWith("自动备份") ? "text-blue-500" : "text-green-600"}
            title={lastSavedAt.startsWith("自动备份") ? "自动备份保存在项目目录的 .pindou_autosave 文件夹中" : undefined}
          >
            {lastSavedAt}
          </span>
        )}
      </div>
      {showBetaSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[320px] p-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold text-sm">Beta 功能</h2>
              <button onClick={() => setShowBetaSettings(false)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>
            <p className="text-[10px] text-gray-400 mb-3">实验性功能，可能不稳定。开启后在菜单栏中显示对应按钮。</p>
            <div className="flex flex-col gap-2 text-xs">
              {Object.entries(betaFeatures).filter(([key]) => key !== "voiceEnhancement" || aiAvailable).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => setBetaFeature(key, e.target.checked)}
                    className="w-3 h-3"
                  />
                  <span className="text-gray-600">{
                    key === "blueprintImport" ? "图纸导入（从导出的图纸还原画布）" :
                    key === "voiceEnhancement" ? voiceEnhancement!.labels.betaSetting : key
                  }</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
      <DialogHost />
    </div>
  );
}

export default App;
