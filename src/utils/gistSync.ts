import type { ProjectFile } from "../types";
import type { DownloadedGistProject, GistProject, GistRevision, GistUploadResult } from "../platform/services";
import type { PlatformResult } from "../platform/result";
import { normalizeProjectFromDisk, serializeProjectToV3 } from "./projectSerialization";

export type { DownloadedGistProject, GistProject, GistRevision, GistUploadResult };

export const GIST_API = "https://api.github.com";
const PREFIX = "pindouverse__";
const SUFFIX = ".pindou";
export const MAX_GIST_PROJECT_BYTES = 25 * 1024 * 1024;

export function toFilename(name: string): string { return `${PREFIX}${name}${SUFFIX}`; }
export function fromFilename(filename: string): string | null {
  if (!filename.startsWith(PREFIX) || !filename.endsWith(SUFFIX)) return null;
  return filename.slice(PREFIX.length, -SUFFIX.length);
}
export function gistDescription(name: string): string { return `PindouVerse: ${name}`; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, stable((value as any)[key])]));
  return value;
}
export function canonicalizeProject(project: ProjectFile): string {
  const normalized = normalizeProjectFromDisk(serializeProjectToV3(project));
  return JSON.stringify(stable(JSON.parse(serializeProjectToV3(normalized))));
}
export function serializeGistProject(project: ProjectFile): string { return serializeProjectToV3(project); }
export function parseGistProject(content: string): ProjectFile {
  if (new TextEncoder().encode(content).byteLength > MAX_GIST_PROJECT_BYTES) throw new Error("Gist project exceeds 25MB");
  return normalizeProjectFromDisk(content);
}
export function githubHeaders(token: string, json = false): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(json ? { "Content-Type": "application/json" } : {}) };
}
export function pindouFiles(data: any): [string, any][] {
  if (!data || typeof data !== "object" || !data.files || typeof data.updated_at !== "string") throw new Error("Invalid Gist response");
  const files = Object.entries(data.files as Record<string, any>).filter(([filename]) => fromFilename(filename) !== null);
  if (files.length !== 1) throw new Error(files.length ? "Ambiguous PindouVerse Gist" : "No PindouVerse project found in Gist");
  return files;
}
export function projectFromGist(data: any, content?: string): DownloadedGistProject {
  const [[filename, file]] = pindouFiles(data);
  const value = content ?? file?.content;
  if (typeof value !== "string") throw new Error("Missing PindouVerse project content");
  return { gistId: String(data.id ?? ""), name: fromFilename(filename)!, updatedAt: data.updated_at, version: String(data.history?.[0]?.version ?? data.version ?? ""), project: parseGistProject(value) };
}
export function mapGistList(data: unknown): GistProject[] {
  if (!Array.isArray(data)) throw new Error("Invalid Gist list response");
  const result: GistProject[] = [];
  for (const gist of data as any[]) {
    if (!gist || typeof gist !== "object") continue;
    const filenames = Object.keys(gist.files ?? {}).filter((item) => fromFilename(item) !== null);
    if (filenames.length !== 1 || typeof gist.id !== "string" || typeof gist.updated_at !== "string") continue;
    const filename = filenames[0];
    result.push({ gistId: gist.id, name: fromFilename(filename)!, description: typeof gist.description === "string" ? gist.description : "", updatedAt: gist.updated_at, isPublic: gist.public === true });
  }
  return result;
}
export function parseRetryAfter(response: Response, now = Date.now()): number | undefined {
  const retry = response.headers.get("retry-after");
  if (retry && Number.isFinite(Number(retry))) return Math.max(0, Math.ceil(Number(retry)));
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  return Number.isFinite(reset) && reset > 0 ? Math.max(0, Math.ceil(reset - now / 1000)) : undefined;
}
export function transportError(response: Response, message: string, now = Date.now()): PlatformResult<never> {
  if (response.status === 401) return { ok: false, code: "authentication", message };
  if (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))) return { ok: false, code: "rate-limited", message, retryAfterSeconds: parseRetryAfter(response, now) };
  if (response.status === 403) return { ok: false, code: "permission-denied", message };
  if (response.status === 404) return { ok: false, code: "invalid-data", message };
  return { ok: false, code: response.status >= 500 ? "network" : "unknown", message };
}
