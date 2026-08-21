import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "../../store/editorStore";
import { MARD_COLORS } from "../../data/mard221";
import { getEffectiveColor } from "../../utils/colorHelper";
import { getAdapter } from "../../adapters";
import {
  loadWatermarkSettings,
  saveWatermarkSettings,
  computeWatermarkLines,
  composeHeaderDescription,
  resolveWatermarkAuthor,
} from "../../utils/blueprintDecorations";
import type { WatermarkPayload } from "../../adapters";
import { appAlert } from "../Dialog/AppDialog";
import { buildExportOutcomeMessage, type ExportFailure, type ExportItem } from "./exportOutcome";

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const canvasData = useEditorStore((s) => s.canvasData);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const importedFileName = useEditorStore((s) => s.importedFileName);
  const projectPath = useEditorStore((s) => s.projectPath);
  const gridConfig = useEditorStore((s) => s.gridConfig);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);
  const projectInfo = useEditorStore((s) => s.projectInfo);
  const setProjectInfo = useEditorStore((s) => s.setProjectInfo);
  const [watermark, setWatermark] = useState(() => loadWatermarkSettings());

  const projectAuthor = projectInfo?.author ?? "";
  const projectTitle = projectInfo?.title ?? "";
  const [titleInput, setTitleInput] = useState(projectTitle);
  const hasProjectTitle = projectTitle.trim().length > 0;

  const headerTitle = hasProjectTitle ? projectTitle : titleInput;
  const watermarkPayload: WatermarkPayload = useMemo(
    () => ({
      show_header: watermark.showHeader,
      app_description: composeHeaderDescription(
        headerTitle,
        resolveWatermarkAuthor(watermark.authorOverride, projectAuthor)
      ),
      watermark_lines: computeWatermarkLines(watermark, projectAuthor),
    }),
    [watermark, projectAuthor, headerTitle]
  );

  // Persist settings when the dialog unmounts, even if the user closes without exporting
  useEffect(() => {
    return () => {
      saveWatermarkSettings(watermark);
    };
  }, [watermark]);

  const [cellSize, setCellSize] = useState(30);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [isExporting, setIsExporting] = useState(false);
  const [exportBlueprint, setExportBlueprint] = useState(true);
  const [exportPreview, setExportPreview] = useState(false);
  const [exportMirror, setExportMirror] = useState(false);
  const [includeByNameLegend, setIncludeByNameLegend] = useState(false);

  const outputWidth = canvasSize.width * cellSize;
  const outputHeight = canvasSize.height * cellSize;

  const ext = format === "jpeg" ? "jpg" : format;
  const projectName = projectPath
    ? projectPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ?? null
    : null;
  const baseName = projectName || importedFileName || "pindou";

  const buildCells = () =>
    canvasData.map((row) =>
      row.map((cell) => {
        if (cell.colorIndex === null) return null;
        const base = MARD_COLORS[cell.colorIndex];
        if (!base) return null;
        const c = getEffectiveColor(cell.colorIndex, colorOverrides);
        return { color_code: base.code, r: c.rgb![0], g: c.rgb![1], b: c.rgb![2] };
      })
    );

  const mirrorCells = (cells: ReturnType<typeof buildCells>) =>
    cells.map((row) => [...row].reverse());

  const handleExport = async () => {
    if (!exportBlueprint && !exportPreview) return;

    // Capture labels with the request so a later language switch cannot alter queued rendering.
    const labels = {
      legendByCount: t("export.labels.legendByCount"),
      legendByCode: t("export.labels.legendByCode"),
    };
    const adapter = getAdapter();

    // Ask user to pick a folder (use save dialog for the blueprint path)
    let blueprintPath: string | null = null;
    if (exportBlueprint) {
      blueprintPath = await adapter.showSaveDialog(
        [
          format === "png"
            ? { name: t("export.pngFilter"), extensions: ["png"] }
            : { name: t("export.jpegFilter"), extensions: ["jpg", "jpeg"] },
        ],
        `${baseName}_pindou_export.${ext}`,
      );
      if (!blueprintPath) return;
    }

    setIsExporting(true);
    try {
      const cells = buildCells();
      saveWatermarkSettings(watermark);

      const results: ExportItem[] = [];
      const errors: ExportFailure[] = [];

      const tryExport = async (item: ExportItem, fn: () => Promise<void>) => {
        try {
          await fn();
          results.push(item);
        } catch (diagnostic) {
          errors.push({ item, diagnostic });
        }
      };

      if (exportBlueprint && blueprintPath) {
        await tryExport("blueprint", () =>
          adapter.exportImage({
            width: canvasSize.width,
            height: canvasSize.height,
            cell_size: cellSize,
            cells,
            output_path: blueprintPath!,
            format,
            start_x: gridConfig.startX,
            start_y: gridConfig.startY,
            edge_padding: gridConfig.edgePadding,
            watermark: watermarkPayload,
            legend_options: { include_by_count: true, include_by_name: includeByNameLegend },
            labels,
          }),
        );

        if (exportMirror) {
          const mirrorPath = blueprintPath.replace(/\.([^.]+)$/, "_mirror.$1");
          await tryExport("mirrorBlueprint", () =>
            adapter.exportImage({
              width: canvasSize.width,
              height: canvasSize.height,
              cell_size: cellSize,
              cells: mirrorCells(cells),
              output_path: mirrorPath,
              format,
              start_x: gridConfig.startX,
              start_y: gridConfig.startY,
              edge_padding: gridConfig.edgePadding,
              watermark: watermarkPayload,
              legend_options: { include_by_count: true, include_by_name: includeByNameLegend },
            labels,
            }),
          );
        }
      }

      if (exportPreview) {
        let previewPath: string;
        if (blueprintPath) {
          previewPath = blueprintPath.replace(/\.[^.]+$/, "_preview.jpg");
        } else {
          const selected = await adapter.showSaveDialog(
            [{ name: t("export.jpegFilter"), extensions: ["jpg", "jpeg"] }],
            `${baseName}_pindou_preview.jpg`,
          );
          if (!selected) {
            setIsExporting(false);
            return;
          }
          previewPath = selected;
        }

        await tryExport("preview", () =>
          adapter.exportPreview({
            width: canvasSize.width,
            height: canvasSize.height,
            pixel_size: cellSize,
            cells,
            output_path: previewPath,
            watermark: watermarkPayload,
          }),
        );

        if (exportMirror) {
          const mirrorPreviewPath = previewPath.replace(/\.([^.]+)$/, "_mirror.$1");
          await tryExport("mirrorPreview", () =>
            adapter.exportPreview({
              width: canvasSize.width,
              height: canvasSize.height,
              pixel_size: cellSize,
              cells: mirrorCells(cells),
              output_path: mirrorPreviewPath,
              watermark: watermarkPayload,
            }),
          );
        }
      }

      // Persist the typed title to project info only after an export actually
      // produced output, so cancelling every save dialog leaves the project clean.
      const typedTitle = titleInput.trim();
      if (!hasProjectTitle && typedTitle && results.length > 0) {
        setProjectInfo({ ...(projectInfo ?? {}), title: typedTitle });
      }

      await appAlert(buildExportOutcomeMessage(t, results, errors), { title: t("export.resultTitle") });
      onClose();
    } catch (e) {
      await appAlert(t("export.failure"), { title: t("export.failureTitle") });
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[440px]">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-sm">{t("export.dialogTitle")}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {/* Cell size */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">{t("export.cellSize")}</label>
            <input
              type="number"
              min={10}
              max={100}
              value={cellSize}
              onChange={(e) => setCellSize(Number(e.target.value))}
              className="w-20 px-2 py-1 text-xs border rounded"
            />
            <p className="text-[10px] text-gray-400 mt-0.5">
              {t("export.outputSize", { width: outputWidth, height: outputHeight })}
            </p>
          </div>

          {/* Format */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">{t("export.format")}</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="format"
                  checked={format === "png"}
                  onChange={() => setFormat("png")}
                />
                PNG
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="format"
                  checked={format === "jpeg"}
                  onChange={() => setFormat("jpeg")}
                />
                JPEG
              </label>
            </div>
          </div>

          {/* Export options */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">{t("export.contents")}</label>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportBlueprint}
                  onChange={(e) => setExportBlueprint(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span>📋 {t("export.blueprint")}</span>
              </label>
              {exportBlueprint && (
                <label className="flex items-center gap-2 text-[11px] cursor-pointer pl-6 text-gray-600">
                  <input
                    type="checkbox"
                    checked={includeByNameLegend}
                    onChange={(e) => setIncludeByNameLegend(e.target.checked)}
                    className="w-3 h-3"
                  />
                  <span>{t("export.byCodeLegend")}</span>
                </label>
              )}
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportPreview}
                  onChange={(e) => setExportPreview(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span>🎨 {t("export.preview")}</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportMirror}
                  onChange={(e) => setExportMirror(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span>🪞 {t("export.mirror")}</span>
              </label>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-600 mb-1 block">{t("export.watermark")}</label>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={watermark.showHeader}
                  onChange={(e) => setWatermark({ ...watermark, showHeader: e.target.checked })}
                  className="w-3.5 h-3.5"
                />
                <span>{t("export.header")}</span>
              </label>
              {watermark.showHeader && (
                <div className="pl-6">
                  <label className="text-[11px] text-gray-500 block mb-0.5">{t("export.projectTitle")}</label>
                  {hasProjectTitle ? (
                    <>
                      <input
                        type="text"
                        value={projectTitle}
                        disabled
                        className="w-full px-2 py-1 text-xs border rounded bg-gray-50 text-gray-500"
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {t("export.projectTitleSource")}
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={titleInput}
                        onChange={(e) => setTitleInput(e.target.value)}
                        placeholder={t("export.titlePlaceholder")}
                        className="w-full px-2 py-1 text-xs border rounded"
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {titleInput.trim()
                          ? t("export.titleWillSave")
                          : t("export.titleAppOnly")}
                      </p>
                    </>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={watermark.appWatermark}
                  onChange={(e) => setWatermark({ ...watermark, appWatermark: e.target.checked })}
                  className="w-3.5 h-3.5"
                />
                <span>{t("export.appWatermark")}</span>
              </label>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={watermark.authorWatermark}
                  onChange={(e) => setWatermark({ ...watermark, authorWatermark: e.target.checked })}
                  className="w-3.5 h-3.5"
                />
                <span>{t("export.authorWatermark")}</span>
              </label>
              {watermark.authorWatermark && (
                <div className="pl-6">
                  <label className="text-[11px] text-gray-500 block mb-0.5">{t("export.author")}</label>
                  {projectAuthor ? (
                    <>
                      <input
                        type="text"
                        value={projectAuthor}
                        disabled
                        className="w-full px-2 py-1 text-xs border rounded bg-gray-50 text-gray-500"
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {t("export.authorSource")}
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={watermark.authorOverride}
                        onChange={(e) => setWatermark({ ...watermark, authorOverride: e.target.value })}
                        placeholder={t("export.notSet")}
                        className="w-full px-2 py-1 text-xs border rounded"
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {watermark.authorOverride.trim()
                          ? t("export.authorRemembered")
                          : t("export.authorMissing")}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleExport}
            disabled={isExporting || (!exportBlueprint && !exportPreview)}
            className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-40"
          >
            {t(isExporting ? "export.exporting" : "export.button")}
          </button>
        </div>
      </div>
    </div>
  );
}
