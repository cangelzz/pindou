import type { ProjectFile } from "../types";
import type { DownloadedGistProject, GistMetadata, GistUploadResult } from "./services";
import type { PlatformResult } from "./result";

export type UploadIntent = { project: ProjectFile; projectGeneration: number; contentRevision: number; ticket: number; name: string; gistId?: string; linked: boolean; cloudVersion: string | null };
export type UploadCoordinatorDeps = {
  current(): { projectGeneration: number; contentRevision: number; cloudOperationGeneration: number; cloudGistId: string | null; cloudVersion: string | null };
  begin(): number;
  buildProject(): ProjectFile;
  metadata(id: string): Promise<PlatformResult<GistMetadata>>;
  download(id: string, version: string): Promise<PlatformResult<DownloadedGistProject>>;
  upload(name: string, project: ProjectFile, id?: string, version?: string): Promise<PlatformResult<GistUploadResult>>;
};
export type UploadEvent = { type: "success"; value: GistUploadResult; intent: UploadIntent } | { type: "compare"; remote: DownloadedGistProject; version: string; intent: UploadIntent; linked: boolean } | { type: "error"; error: Extract<PlatformResult<unknown>, { ok: false }> } | { type: "stale" };
export function captureUploadIntent(d: UploadCoordinatorDeps, name: string, gistId?: string): UploadIntent { const s = d.current(); const project = d.buildProject(); const ticket = d.begin(); return { project, projectGeneration: s.projectGeneration, contentRevision: s.contentRevision, ticket, name, gistId, linked: !!gistId && s.cloudGistId === gistId, cloudVersion: s.cloudVersion }; }
function current(d: UploadCoordinatorDeps, i: UploadIntent) { const s = d.current(); return s.projectGeneration === i.projectGeneration && s.contentRevision === i.contentRevision && s.cloudOperationGeneration === i.ticket; }
async function compare(d: UploadCoordinatorDeps, i: UploadIntent, m: GistMetadata): Promise<UploadEvent> { if (!i.gistId || !current(d, i)) return { type: "stale" }; const remote = await d.download(i.gistId, m.version); if (!current(d, i)) return { type: "stale" }; return remote.ok ? { type: "compare", remote: remote.value, version: m.version, intent: i, linked: i.linked } : { type: "error", error: remote }; }
export async function runInitialUpload(d: UploadCoordinatorDeps, i: UploadIntent): Promise<UploadEvent> { if (!current(d, i)) return { type: "stale" }; if (i.gistId) { const m = await d.metadata(i.gistId); if (!current(d, i)) return { type: "stale" }; if (!m.ok) return { type: "error", error: m }; if (!i.linked || m.value.version !== i.cloudVersion) return compare(d, i, m.value); return runAuthorizedUpload(d, i, m.value.version); } const result = await d.upload(i.name, i.project); if (!current(d, i)) return { type: "stale" }; return result.ok ? { type: "success", value: result.value, intent: i } : { type: "error", error: result }; }
export async function runAuthorizedUpload(d: UploadCoordinatorDeps, i: UploadIntent, version: string): Promise<UploadEvent> { if (!current(d, i)) return { type: "stale" }; const result = await d.upload(i.name, i.project, i.gistId, version); if (!current(d, i)) return { type: "stale" }; if (result.ok) return { type: "success", value: result.value, intent: i }; if (result.code !== "conflict" || !i.gistId) return { type: "error", error: result }; const m = await d.metadata(i.gistId); if (!current(d, i)) return { type: "stale" }; return m.ok ? compare(d, i, m.value) : { type: "error", error: m }; }
