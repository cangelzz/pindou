import type { ProjectFile } from "../../src/types";
import type { SnapshotInfo } from "../../src/adapters";
import type { PlatformResult } from "../../src/platform/result";
import type { RecoveryStorage } from "../../src/platform/recoveryStorage";
import { normalizeProjectFromDisk, serializeProjectToV3 } from "../../src/utils/projectSerialization";

export const RECOVERY_DB_NAME = "pindouverse";
const DB_VERSION = 2;
const STORE_AUTOSAVE = "autosave";
const STORE_SNAPSHOTS = "snapshots";
const STORE_PROJECTS = "projects";
const AUTOSAVE_KEY = "current";

export interface RecoveryDatabase {
  get(store: string, key: string): Promise<unknown>;
  put(store: string, key: string, value: unknown): Promise<void>;
  entries(store: string): Promise<[string, unknown][]>;
  delete(store: string, key: string): Promise<void>;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(RECOVERY_DB_NAME, DB_VERSION);
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of [STORE_PROJECTS, STORE_AUTOSAVE, STORE_SNAPSHOTS]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (settled) { db.close(); return; }
      settled = true; resolve(db);
    };
    request.onblocked = () => fail(new Error("Recovery database upgrade is blocked; close older application pages and retry"));
    request.onerror = () => fail(request.error);
  });
}

export const indexedDbRecoveryDatabase: RecoveryDatabase = {
  async get(store, key) {
    const db = await openDatabase();
    if (!db.objectStoreNames.contains(store)) { db.close(); return undefined; }
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => { const value = request.result; db.close(); resolve(value); };
      request.onerror = () => { const error = request.error; db.close(); reject(error); };
    });
  },
  async put(store, key, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
      tx.onabort = () => { const error = tx.error; db.close(); reject(error); };
    });
  },
  async entries(store) {
    const db = await openDatabase();
    if (!db.objectStoreNames.contains(store)) { db.close(); return []; }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const keys = tx.objectStore(store).getAllKeys();
      const values = tx.objectStore(store).getAll();
      tx.oncomplete = () => { const result = keys.result.map((key, i) => [String(key), values.result[i]] as [string, unknown]); db.close(); resolve(result); };
      tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
      tx.onabort = () => { const error = tx.error; db.close(); reject(error); };
    });
  },
  async delete(store, key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite"); tx.objectStore(store).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
      tx.onabort = () => { const error = tx.error; db.close(); reject(error); };
    });
  },
};

type StoredSnapshot = { label: string; timestamp: string; sourceProjectId?: string; serializedProject?: string; project?: ProjectFile };

function validateSnapshot(value: unknown): StoredSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid snapshot record");
  const record = value as Partial<StoredSnapshot>;
  if (typeof record.label !== "string" || typeof record.timestamp !== "string" || Number.isNaN(Date.parse(record.timestamp))) {
    throw new Error("Invalid snapshot metadata");
  }
  const validSerialized = typeof record.serializedProject === "string";
  const validLegacy = record.project !== null && typeof record.project === "object";
  if (!validSerialized && !validLegacy) throw new Error("Missing or invalid snapshot payload");
  return record as StoredSnapshot;
}

function failure<T>(cause: unknown, invalidData = false): PlatformResult<T> {
  return { ok: false, code: invalidData ? "invalid-data" : "unknown", cause };
}

function normalizeStored(value: unknown): ProjectFile {
  if (typeof value === "string") return normalizeProjectFromDisk(value);
  if (value && typeof value === "object") return normalizeProjectFromDisk(JSON.stringify(value));
  throw new Error("Invalid recovery project");
}

export class BrowserRecoveryStorage implements RecoveryStorage {
  readonly availability = "available" as const;
  constructor(private readonly db: RecoveryDatabase = indexedDbRecoveryDatabase) {}

  async saveAutosave(project: ProjectFile): Promise<PlatformResult<void>> {
    try { await this.db.put(STORE_AUTOSAVE, AUTOSAVE_KEY, serializeProjectToV3(project)); return { ok: true, value: undefined }; }
    catch (cause) { return failure(cause); }
  }

  async loadAutosave(): Promise<PlatformResult<ProjectFile | null>> {
    let value: unknown;
    try {
      value = await this.db.get(STORE_AUTOSAVE, AUTOSAVE_KEY);
      if (value === undefined) value = await this.db.get(STORE_PROJECTS, "__autosave__\\autosave.pindou");
    } catch (cause) { return failure(cause); }
    if (value === undefined) return { ok: true, value: null };
    try { return { ok: true, value: normalizeStored(value) }; }
    catch (cause) { return failure(cause, true); }
  }

  async clearAutosave(): Promise<PlatformResult<void>> {
    try {
      await this.db.delete(STORE_AUTOSAVE, AUTOSAVE_KEY);
      await this.db.delete(STORE_PROJECTS, "__autosave__\\autosave.pindou");
      return { ok: true, value: undefined };
    } catch (cause) { return failure(cause); }
  }

  async saveSnapshot(project: ProjectFile, label: string, sourceProjectId?: string): Promise<PlatformResult<SnapshotInfo>> {
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const id = `snapshot_${now}_${Math.random().toString(36).slice(2)}`;
    try {
      await this.db.put(STORE_SNAPSHOTS, id, { label, timestamp, sourceProjectId, serializedProject: serializeProjectToV3(project) });
      return { ok: true, value: { path: id, name: label, modified: timestamp, sourceProjectId } };
    } catch (cause) { return failure(cause); }
  }

  private async allSnapshots(): Promise<[string, StoredSnapshot][]> {
    const current = (await this.db.entries(STORE_SNAPSHOTS)) as [string, StoredSnapshot][];
    const legacy = (await this.db.entries(STORE_PROJECTS))
      .filter(([key, value]) => key.startsWith("snapshot_") && value && typeof value === "object") as [string, StoredSnapshot][];
    const seen = new Set(current.map(([key]) => key));
    return [...current, ...legacy.filter(([key]) => !seen.has(key))];
  }

  async listSnapshots(): Promise<PlatformResult<SnapshotInfo[]>> {
    let records: [string, StoredSnapshot][];
    try { records = await this.allSnapshots(); }
    catch (cause) { return failure(cause); }
    try {
      const value = records.map(([path, raw]) => {
        const data = validateSnapshot(raw);
        return { path, name: data.label, modified: data.timestamp, sourceProjectId: data.sourceProjectId };
      });
      value.sort((a, b) => b.modified.localeCompare(a.modified) || b.path.localeCompare(a.path));
      return { ok: true, value };
    } catch (cause) { return failure(cause, true); }
  }

  async loadSnapshot(id: string): Promise<PlatformResult<{ project: ProjectFile; sourceProjectId?: string }>> {
    let value: StoredSnapshot | undefined;
    try {
      value = await this.db.get(STORE_SNAPSHOTS, id) as StoredSnapshot | undefined;
      if (value === undefined) value = await this.db.get(STORE_PROJECTS, id) as StoredSnapshot | undefined;
    } catch (cause) { return failure(cause); }
    if (!value) return { ok: false, code: "invalid-data", message: `Snapshot not found: ${id}` };
    try { return { ok: true, value: {
      project: normalizeStored(value.serializedProject ?? value.project),
      sourceProjectId: value.sourceProjectId ?? normalizeStored(value.serializedProject ?? value.project).projectId,
    } }; }
    catch (cause) { return failure(cause, true); }
  }

  async deleteSnapshot(id: string): Promise<PlatformResult<void>> {
    try { await this.db.delete(STORE_SNAPSHOTS, id); await this.db.delete(STORE_PROJECTS, id); return { ok: true, value: undefined }; }
    catch (cause) { return failure(cause); }
  }
}
