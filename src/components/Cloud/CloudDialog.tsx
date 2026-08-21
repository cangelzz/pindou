import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditorStore, projectFromEditorState } from "../../store/editorStore";
import { getPlatformServices } from "../../platform/serviceRegistry";
import type { GistProject, GistRevision } from "../../platform/services";
import type { PlatformResult } from "../../platform/result";
import { appConfirm } from "../Dialog/AppDialog";
import { CloudComparePreview } from "./CloudComparePreview";
import { LatestRequest } from "../../platform/latestRequest";
import { confirmCloudDelete } from "../../platform/deleteCloudCoordinator";
import { captureUploadIntent, runAuthorizedUpload, runInitialUpload, type UploadEvent } from "../../platform/cloudUploadCoordinator";
import { cloudErrorText } from "./cloudErrorText";

interface CloudDialogProps { onClose: () => void }

export function CloudDialog({ onClose }: CloudDialogProps) {
  const { t, i18n } = useTranslation();
  const github = getPlatformServices().github;
  const [projects, setProjects] = useState<GistProject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const historyRequests = useRef(new LatestRequest());
  const [revisions, setRevisions] = useState<{ gistId: string; name: string; values: GistRevision[] } | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [compare, setCompare] = useState<Extract<UploadEvent, { type: "compare" }> | null>(null);
  const cloudGistId = useEditorStore((s) => s.cloudGistId);
  const cloudProjectName = useEditorStore((s) => s.cloudProjectName);
  const projectPath = useEditorStore((s) => s.projectPath);
  const isDirty = useEditorStore((s) => s.isDirty);
  const derivedName = cloudProjectName || projectPath?.replace(/\\/g, "/").split("/").pop()?.replace(/\.pindou$/i, "") || "";

  const run = async <T,>(operation: () => Promise<PlatformResult<T>>, successHandler: (value: T) => void) => {
    setLoading(true); setError(null); setSuccess(null);
    const result = await operation();
    setLoading(false);
    if (!result.ok) { const message = cloudErrorText(result, t); if (message) setError(message); return false; }
    successHandler(result.value); return true;
  };
  const refresh = useCallback(() => run(() => github.listProjects(), setProjects), [github]);
  useEffect(() => { void refresh(); }, [refresh]);

  const deps = () => ({ current: () => useEditorStore.getState(), begin: () => useEditorStore.getState().beginCloudOperation(), buildProject: () => projectFromEditorState(useEditorStore.getState()), metadata: (id: string) => github.getProjectMetadata(id), download: (id: string, version: string) => github.downloadProject(id, version), upload: (name: string, project: any, id?: string, version?: string) => github.uploadProject(name, project, id, version) });
  const applyUploadEvent = (event: UploadEvent) => {
    if (event.type === "stale") { setError(t("cloud.stale")); return; }
    if (event.type === "error") { setError(cloudErrorText(event.error, t)); return; }
    if (event.type === "compare") { if (event.linked) useEditorStore.getState().setCloudSyncStatus("remote-newer"); setCompare(event); return; }
    useEditorStore.getState().setCloudSync(event.value.gistId, event.value.updatedAt, event.intent.name, event.intent.contentRevision, event.value.version); setShowUpload(false); setSuccess(t("cloud.uploadSuccess", { name: event.intent.name })); void refresh();
  };
  const upload = async (name: string, gistId?: string) => { setLoading(true); setError(null); const d = deps(); const event = await runInitialUpload(d, captureUploadIntent(d, name, gistId)); setLoading(false); applyUploadEvent(event); };
  const uploadAuthorized = async (event: Extract<UploadEvent, { type: "compare" }>) => { setLoading(true); setCompare(null); const result = await runAuthorizedUpload(deps(), event.intent, event.version); setLoading(false); applyUploadEvent(result); };
  const download = async (gistId: string, name: string, revision?: string) => {
    if (isDirty && !(await appConfirm(t("cloud.dirtyConfirm"), { title: t("cloud.overwriteTitle") }))) return;
    const startingGeneration = useEditorStore.getState().projectGeneration;
    const ticket = useEditorStore.getState().beginCloudDownload();
    const cloudTicket = useEditorStore.getState().cloudOperationGeneration;
    const startingRevision = useEditorStore.getState().contentRevision;
    await run(() => github.downloadProject(gistId, revision), async (value) => {
      const current = useEditorStore.getState();
      if (current.projectGeneration !== startingGeneration) return;
      if (current.contentRevision !== startingRevision && !(await appConfirm(t("cloud.changedConfirm"), { title: t("cloud.overwriteTitle") }))) return;
      if (useEditorStore.getState().replaceProjectFromCloud(value.project, gistId, name || value.name, value.updatedAt, ticket, value.version, cloudTicket)) onClose();
    });
  };
  const remove = async (gistId: string, name: string) => {
    if (!(await confirmCloudDelete(() => appConfirm(t("cloud.deleteConfirm", { name }), { title: t("cloud.deleteTitle") }), () => useEditorStore.getState().invalidateCloudOperations()))) return;
    historyRequests.current.invalidate();
    await run(() => github.deleteProject(gistId), () => {
      useEditorStore.getState().clearCloudAssociation(gistId);
      setProjects((old) => old?.filter((p) => p.gistId !== gistId) ?? old); setSuccess(t("cloud.deleteSuccess", { name }));
    });
  };
  const history = async (project: GistProject) => {
    if (!github.listRevisions) return; const request = historyRequests.current.begin(); setLoading(true);
    const result = await github.listRevisions(project.gistId); if (!historyRequests.current.current(request)) return;
    setLoading(false); if (result.ok) setRevisions({ gistId: project.gistId, name: project.name, values: result.value }); else setError(cloudErrorText(result, t));
  };

  if (compare) { const state = useEditorStore.getState(); return <CloudComparePreview localData={compare.intent.project.canvasData} localSize={compare.intent.project.canvasSize} localTimestamp={state.cloudUpdatedAt ?? ""} cloudData={compare.remote.project.canvasData} cloudSize={compare.remote.project.canvasSize} cloudTimestamp={compare.remote.updatedAt} onChooseLocal={() => void uploadAuthorized(compare)} onChooseCloud={() => { const value = compare.remote; setCompare(null); void download(value.gistId, value.name, value.version); }} onCancel={() => setCompare(null)} />; }
  const primaryButton = "px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:opacity-50";
  const secondaryButton = "px-3 py-1.5 text-xs border rounded hover:bg-gray-100 disabled:opacity-50";
  const compactButton = "px-2 py-0.5 border rounded text-[10px] hover:bg-gray-100 shrink-0";
  return <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg shadow-xl w-[440px] max-h-[75vh] flex flex-col">
      <div className="px-4 py-3 border-b flex justify-between items-center"><h2 className="font-semibold text-sm">☁️ {t("cloud.projectsTitle")}</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button></div>
      {error && <div className="mx-4 mt-2 text-xs text-red-600 bg-red-50 border rounded px-2 py-1">{error}</div>}
      {success && <div className="mx-4 mt-2 text-xs text-green-600 bg-green-50 border rounded px-2 py-1">{success}</div>}
      <div className="flex-1 overflow-y-auto p-3">
        {revisions ? <div><button className="text-xs text-blue-500 hover:underline mb-2" onClick={() => setRevisions(null)}>{t("cloud.back")}</button>{revisions.values.map((r, i) => <div key={r.sha} className="flex items-center gap-2 py-1.5 border-b text-xs"><span className="flex-1 text-gray-600">{i + 1}. {new Date(r.committedAt).toLocaleString(i18n.language === "zh-CN" ? "zh-CN" : "en-US")}</span><button className="px-2 py-0.5 bg-green-500 text-white rounded text-[10px] hover:bg-green-600" onClick={() => download(revisions.gistId, revisions.name, r.sha)}>{t("cloud.restore")}</button></div>)}</div>
          : loading && projects === null ? <p className="text-xs text-gray-400 text-center py-4">{t("cloud.loading")}</p>
          : <div className="flex flex-col gap-1">{projects?.length === 0 && <p className="text-xs text-center text-gray-400 py-4">{t("cloud.empty")}</p>}{projects?.map((p) => <div key={p.gistId} className={`flex items-center gap-2 p-2 border rounded text-xs ${cloudGistId === p.gistId ? "bg-blue-50 border-blue-300" : "bg-gray-50"}`}><div className="flex-1 min-w-0"><div className="font-medium truncate"><span data-user-content>{p.name}</span>{cloudGistId === p.gistId && <span className="text-blue-500 text-[10px]"> · {t("cloud.current")}</span>}</div><div className="text-gray-400 text-[10px]">{new Date(p.updatedAt).toLocaleString(i18n.language === "zh-CN" ? "zh-CN" : "en-US")}</div></div><button className="px-2 py-0.5 bg-blue-500 text-white rounded text-[10px] hover:bg-blue-600 shrink-0" onClick={() => download(p.gistId, p.name)}>{t("cloud.download")}</button><button className={compactButton} onClick={() => history(p)}>{t("cloud.history")}</button><button className="px-2 py-0.5 border rounded text-[10px] text-red-400 hover:bg-red-50 shrink-0" onClick={() => remove(p.gistId, p.name)}>{t("cloud.delete")}</button></div>)}</div>}
      </div>
      <div className="px-4 py-2 border-t flex gap-2 items-center">
        {showUpload ? <><input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder={t("cloud.projectName")} className="flex-1 border rounded px-2 py-1 text-xs"/><button className={primaryButton} disabled={loading || !uploadName.trim()} onClick={() => { const name = uploadName.trim().replace(/\.pindou$/i, ""); void upload(name, projects?.find((p) => p.name === name)?.gistId); }}>{t("cloud.upload")}</button><button className={secondaryButton} onClick={() => setShowUpload(false)}>{t("cloud.cancel")}</button></>
          : <><button className={primaryButton} disabled={loading} onClick={() => derivedName ? void upload(derivedName, cloudGistId || projects?.find((p) => p.name === derivedName)?.gistId) : setShowUpload(true)}>{t(cloudGistId ? "cloud.sync" : "cloud.uploadCurrent")}</button><button className={secondaryButton} onClick={() => { setUploadName(derivedName); setShowUpload(true); }}>{t("cloud.saveAs")}</button><button className={secondaryButton} disabled={loading} onClick={() => void refresh()}>{loading ? t("cloud.loading") : t("cloud.refresh")}</button><div className="flex-1"/><button className={secondaryButton} onClick={onClose}>{t("cloud.close")}</button></>}
      </div>
    </div>
  </div>;
}
