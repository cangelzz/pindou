import { useState, useEffect, useRef } from "react";
import { useEditorStore } from "../../store/editorStore";
import type { EditorTool } from "../../types";
import { getPlatformServices } from "../../platform/serviceRegistry";
import { useTranslation } from "react-i18next";

const tools: { id: EditorTool; labelKey: string; icon: string; shortcut: string }[] = [
  { id: "select", labelKey: "tools.select", icon: "⬚", shortcut: "S" },
  { id: "wand", labelKey: "tools.wand", icon: "✦", shortcut: "W" },
  { id: "pen", labelKey: "tools.pen", icon: "✏️", shortcut: "P" },
  { id: "fill", labelKey: "tools.fill", icon: "🪣", shortcut: "F" },
  { id: "eyedropper", labelKey: "tools.eyedropper", icon: "💧", shortcut: "I" },
  { id: "pan", labelKey: "tools.pan", icon: "✋", shortcut: "Space" },
];

const shapeTools: { id: EditorTool; labelKey: string; icon: string; shortcut: string }[] = [
  { id: "line", labelKey: "tools.line", icon: "⟋", shortcut: "L" },
  { id: "rect", labelKey: "tools.rect", icon: "⬜", shortcut: "R" },
  { id: "circle", labelKey: "tools.circle", icon: "⭕", shortcut: "C" },
];

const eraserTools: { id: EditorTool; labelKey: string; icon: string; shortcut: string }[] = [
  { id: "eraser", labelKey: "tools.eraserCell", icon: "🩹", shortcut: "E" },
  { id: "eraserFill", labelKey: "tools.eraserFill", icon: "🧽", shortcut: "" },
];

export function CanvasToolbar() {
  const { t } = useTranslation();
  const currentTool = useEditorStore((s) => s.currentTool);
  const setTool = useEditorStore((s) => s.setTool);
  const lastEraserSubmode = useEditorStore((s) => s.lastEraserSubmode);
  const selection = useEditorStore((s) => s.selection);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [showEraserMenu, setShowEraserMenu] = useState(false);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const eraserMenuRef = useRef<HTMLDivElement>(null);

  // Dismiss the tool flyouts when the user clicks anywhere outside them (e.g.
  // another tool button or the canvas) or presses Escape. Clicks on a flyout's
  // own container (its toggle button or sub-options) are ignored so toggling
  // and selecting still work.
  useEffect(() => {
    if (!showShapeMenu && !showEraserMenu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showShapeMenu && shapeMenuRef.current && !shapeMenuRef.current.contains(target)) {
        setShowShapeMenu(false);
      }
      if (showEraserMenu && eraserMenuRef.current && !eraserMenuRef.current.contains(target)) {
        setShowEraserMenu(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowShapeMenu(false);
        setShowEraserMenu(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showShapeMenu, showEraserMenu]);

  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const fitToWindow = useEditorStore((s) => s.fitToWindow);
  const blueprintMode = useEditorStore((s) => s.blueprintMode);
  const setBlueprintMode = useEditorStore((s) => s.setBlueprintMode);
  const blueprintMirror = useEditorStore((s) => s.blueprintMirror);
  const setBlueprintMirror = useEditorStore((s) => s.setBlueprintMirror);
  const gridFocusMode = useEditorStore((s) => s.gridFocusMode);
  const setGridFocusMode = useEditorStore((s) => s.setGridFocusMode);
  const voiceControlEnabled = useEditorStore((s) => s.voiceControlEnabled);
  const setVoiceControlEnabled = useEditorStore((s) => s.setVoiceControlEnabled);
  const voiceEnhancementEnabled = useEditorStore((s) => s.voiceEnhancementEnabled);
  const betaVoiceEnhancement = useEditorStore((s) => s.betaFeatures.voiceEnhancement);
  const voiceEnhancement = getPlatformServices().capabilities.ai ? getPlatformServices().voiceEnhancement : undefined;
  const aiAvailable = !!voiceEnhancement;

  return (
    <div className="flex flex-col gap-1 p-2 bg-gray-50 border-r w-12 items-center select-none">
      {/* Shape tools flyout — at top */}
      <div className="relative" ref={shapeMenuRef}>
        <button
          onClick={() => setShowShapeMenu(!showShapeMenu)}
          className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
            ${shapeTools.some((tool) => tool.id === currentTool) ? "bg-blue-500 text-white shadow" : "hover:bg-gray-200"}`}
          title={t("tools.shape")}
        >
          {shapeTools.find((tool) => tool.id === currentTool)?.icon || "📐"}
        </button>
        {showShapeMenu && (
          <div className="absolute left-full top-0 ml-1 bg-white border rounded shadow-lg flex flex-col gap-0.5 p-1 z-50">
            {shapeTools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => {
                  setTool(tool.id);
                  setShowShapeMenu(false);
                }}
                className={`w-20 h-8 rounded flex items-center gap-1.5 px-2 text-xs transition-colors
                  ${currentTool === tool.id ? "bg-blue-500 text-white" : "hover:bg-gray-100"}`}
                title={`${t(tool.labelKey)} (${tool.shortcut})`}
              >
                <span className="text-sm">{tool.icon}</span>
                <span>{t(tool.labelKey)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Basic tools (first slice: select, wand, pen, fill). The select tool
          anchors a floating clear-selection button on its right while a selection
          exists — see below. */}
      {tools.slice(0, 4).map((tool) => (
        <div key={tool.id} className="relative">
          <button
            onClick={() => setTool(tool.id)}
            className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
              ${currentTool === tool.id ? "bg-blue-500 text-white shadow" : "hover:bg-gray-200"}`}
            title={`${t(tool.labelKey)} (${tool.shortcut})`}
          >
            {tool.icon}
          </button>
          {tool.id === "select" && selection && (
            <button
              onClick={() => clearSelection()}
              aria-label={t("tools.clearSelection")}
              title={t("tools.clearSelection")}
              className="absolute left-full top-1/2 -translate-y-1/2 ml-1 z-50 w-7 h-7 rounded-full bg-white border border-gray-300 shadow-md flex items-center justify-center text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            >
              ⊘
            </button>
          )}
        </div>
      ))}

      {/* Eraser tools flyout */}
      <div className="relative" ref={eraserMenuRef}>
        <button
          onClick={() => setShowEraserMenu(!showEraserMenu)}
          className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
            ${currentTool === "eraser" || currentTool === "eraserFill" ? "bg-blue-500 text-white shadow" : "hover:bg-gray-200"}`}
          title={`${t("tools.eraser")} (E)`}
        >
          {eraserTools.find((tool) => tool.id === lastEraserSubmode)?.icon || "🩹"}
        </button>
        {showEraserMenu && (
          <div className="absolute left-full top-0 ml-1 bg-white border rounded shadow-lg flex flex-col gap-0.5 p-1 z-50">
            {eraserTools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => {
                  setTool(tool.id);
                  setShowEraserMenu(false);
                }}
                className={`w-20 h-8 rounded flex items-center gap-1.5 px-2 text-xs transition-colors
                  ${currentTool === tool.id ? "bg-blue-500 text-white" : "hover:bg-gray-100"}`}
                title={tool.shortcut ? `${t(tool.labelKey)} (${tool.shortcut})` : t(tool.labelKey)}
              >
                <span className="text-sm">{tool.icon}</span>
                <span>{t(tool.labelKey)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Basic tools (second slice: eyedropper, pan) */}
      {tools.slice(4).map((tool) => (
        <button
          key={tool.id}
          onClick={() => setTool(tool.id)}
          className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
            ${currentTool === tool.id ? "bg-blue-500 text-white shadow" : "hover:bg-gray-200"}`}
          title={`${t(tool.labelKey)} (${tool.shortcut})`}
        >
          {tool.icon}
        </button>
      ))}

      <div className="border-t my-1 w-full" />

      {/* Undo/Redo */}
      <button
        onClick={undo}
        disabled={undoStack.length === 0}
        className="w-9 h-9 rounded flex items-center justify-center text-lg hover:bg-gray-200 disabled:opacity-30"
        title={`${t("tools.undo")} (Ctrl+Z)`}
      >
        ↩
      </button>
      <button
        onClick={redo}
        disabled={redoStack.length === 0}
        className="w-9 h-9 rounded flex items-center justify-center text-lg hover:bg-gray-200 disabled:opacity-30"
        title={`${t("tools.redo")} (Ctrl+Y)`}
      >
        ↪
      </button>

      <div className="border-t my-1 w-full" />

      {/* Zoom */}
      <button
        onClick={() => setZoom(zoom * 1.25)}
        className="w-9 h-9 rounded flex items-center justify-center text-lg hover:bg-gray-200"
        title={t("tools.zoomIn")}
      >
        +
      </button>
      <span className="text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
      <button
        onClick={() => setZoom(zoom / 1.25)}
        className="w-9 h-9 rounded flex items-center justify-center text-lg hover:bg-gray-200"
        title={t("tools.zoomOut")}
      >
        −
      </button>
      <button
        onClick={() => setZoom(1)}
        className="w-9 h-7 rounded flex items-center justify-center text-xs hover:bg-gray-200"
        title={t("tools.resetZoom")}
      >
        1:1
      </button>
      <button
        onClick={() => {
          // Find the canvas container to get its dimensions
          const container = document.querySelector("[data-canvas-container]");
          if (container) {
            fitToWindow(container.clientWidth, container.clientHeight);
          }
        }}
        className="w-9 h-7 rounded flex items-center justify-center text-[9px] hover:bg-gray-200"
        title={t("tools.fitWindow")}
      >
        ⊞
      </button>

      <div className="border-t my-1 w-full" />

      {/* Blueprint mode toggle */}
      <button
        onClick={() => setBlueprintMode(!blueprintMode)}
        className={`w-9 h-9 rounded flex items-center justify-center text-sm transition-colors
          ${blueprintMode ? "bg-orange-500 text-white shadow" : "hover:bg-gray-200"}`}
        title={blueprintMode ? t("tools.exitBlueprint") : t("tools.blueprint")}
      >
        📋
      </button>

      {/* Mirror toggle (only in blueprint mode) */}
      {blueprintMode && (
        <button
          onClick={() => setBlueprintMirror(!blueprintMirror)}
          className={`w-9 h-9 rounded flex items-center justify-center text-sm transition-colors
            ${blueprintMirror ? "bg-purple-500 text-white shadow" : "hover:bg-gray-200"}`}
          title={blueprintMirror ? t("tools.exitMirror") : t("tools.mirror")}
        >
          🪞
        </button>
      )}

      {/* Grid focus toggle (only in blueprint mode) */}
      {blueprintMode && (
        <button
          onClick={() => setGridFocusMode(!gridFocusMode)}
          className={`w-9 h-9 rounded flex items-center justify-center text-sm transition-colors
            ${gridFocusMode ? "bg-teal-500 text-white shadow" : "hover:bg-gray-200"}`}
          title={gridFocusMode ? t("tools.exitGridFocus") : t("tools.gridFocus")}
        >
          🔲
        </button>
      )}

      {/* Voice control toggle (only in blueprint + grid focus mode) */}
      {getPlatformServices().capabilities.basicVoiceControl && blueprintMode && gridFocusMode && (
        <button
          onClick={() => setVoiceControlEnabled(!voiceControlEnabled)}
          className={`w-9 h-9 rounded flex items-center justify-center text-sm transition-colors
            ${voiceControlEnabled ? "bg-red-500 text-white shadow animate-pulse" : "hover:bg-gray-200"}`}
          title={voiceControlEnabled ? t("tools.voiceOff") : t("tools.voice")}
        >
          🎤
        </button>
      )}

      {/* AI voice enhancement indicator (only when feature enabled + logged in) */}
      {aiAvailable && blueprintMode && gridFocusMode && voiceEnhancementEnabled && betaVoiceEnhancement && (
        <div
          data-testid="ai-voice-status"
          className="w-9 h-7 rounded flex items-center justify-center text-[9px] bg-green-500 text-white shadow"
          title={t("voice.enabled")}
        >
          {t("voice.status")}
        </div>
      )}

    </div>
  );
}
