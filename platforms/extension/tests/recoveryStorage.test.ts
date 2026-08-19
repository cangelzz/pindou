import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
  }, configurable: true });
});

import "fake-indexeddb/auto";
import { BrowserRecoveryStorage, RECOVERY_DB_NAME, indexedDbRecoveryDatabase, type RecoveryDatabase } from "../recoveryStorage";
import type { ProjectFile } from "../../../src/types";
import type { ProjectFileService } from "../../../src/platform/projectFileService";
import { createAutosaveScheduler } from "../../../src/utils/autosaveScheduler";
import type { RecoveryStorage } from "../../../src/platform/recoveryStorage";
import { createLegacyPlatformServices } from "../../../src/platform/services";
import { createBrowserCapabilities } from "../../../src/platform/capabilities";
import { resetPlatformServicesForTest, setPlatformServices } from "../../../src/platform/serviceRegistry";
import { useEditorStore } from "../../../src/store/editorStore";
import type { PlatformAdapter } from "../../../src/adapters";

const project = (color = 1): ProjectFile => ({
  version: 2, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: color }]],
  layers: [{ id: "l", name: "L", visible: true, opacity: 1, data: [[{ colorIndex: color }]] }],
  gridConfig: { groupSize: 5, edgePadding: 0, startX: 1, startY: 1, visible: true, lineColor: "#000", lineWidth: 1, groupLineColor: "#000", groupLineWidth: 2 },
  createdAt: "before", updatedAt: "before",
});

class MemoryDb implements RecoveryDatabase {
  stores = new Map<string, Map<string, unknown>>();
  fail = false;
  private store(name: string) { let value = this.stores.get(name); if (!value) this.stores.set(name, value = new Map()); return value; }
  async get(store: string, key: string) { if (this.fail) throw new Error("db"); return this.store(store).get(key); }
  async put(store: string, key: string, value: unknown) { if (this.fail) throw new Error("db"); this.store(store).set(key, structuredClone(value)); }
  async entries(store: string) { if (this.fail) throw new Error("db"); return [...this.store(store).entries()]; }
  async delete(store: string, key: string) { if (this.fail) throw new Error("db"); this.store(store).delete(key); }
}

function recovery(db = new MemoryDb()) { return { db, service: new BrowserRecoveryStorage(db) }; }

function install(recoveryStorage: RecoveryStorage, projectFiles?: Partial<ProjectFileService>) {
  const legacy = createLegacyPlatformServices({} as PlatformAdapter, createBrowserCapabilities("chrome", true));
  setPlatformServices({ ...legacy, recovery: recoveryStorage, projectFiles: {
    openProject: vi.fn(), saveProject: vi.fn(), saveProjectAs: vi.fn(), exportProject: vi.fn(), ...projectFiles,
  } as ProjectFileService });
}

describe("BrowserRecoveryStorage", () => {
  it("stores an immutable autosave and maps malformed autosave separately from database errors", async () => {
    const { db, service } = recovery(); const value = project(2);
    expect((await service.saveAutosave(value)).ok).toBe(true);
    value.canvasData[0][0].colorIndex = 9;
    expect(await service.loadAutosave()).toMatchObject({ ok: true, value: { version: 3, canvasData: [[{ colorIndex: 2 }]] } });
    db.stores.set("autosave", new Map([["current", "{"]]));
    expect(await service.loadAutosave()).toMatchObject({ ok: false, code: "invalid-data" });
    db.fail = true;
    expect(await service.loadAutosave()).toMatchObject({ ok: false, code: "unknown" });
  });

  it("lists snapshots newest first, persists identity and deletes them", async () => {
    const { service } = recovery();
    vi.useFakeTimers();
    vi.setSystemTime(100); await service.saveSnapshot(project(1), "old", "project-A");
    vi.setSystemTime(200); await service.saveSnapshot(project(2), "new", "project-B");
    vi.useRealTimers();
    const listed = await service.listSnapshots();
    expect(listed.ok && listed.value.map((x) => [x.name, x.sourceProjectId])).toEqual([["new", "project-B"], ["old", "project-A"]]);
    if (listed.ok) {
      expect(await service.loadSnapshot(listed.value[0].path)).toMatchObject({ ok: true, value: { sourceProjectId: "project-B" } });
      await service.deleteSnapshot(listed.value[0].path);
    }
    expect((await service.listSnapshots())).toMatchObject({ ok: true, value: [{ name: "old", sourceProjectId: "project-A" }] });
  });

  it("deletes current and legacy autosaves", async () => {
    const { db, service } = recovery();
    await service.saveAutosave(project(2));
    db.stores.set("projects", new Map([["__autosave__\\autosave.pindou", project(3)]]));
    expect(await service.clearAutosave()).toMatchObject({ ok: true });
    expect(await service.loadAutosave()).toEqual({ ok: true, value: null });
  });

  it("validates metadata but leaves full payload normalization for load", async () => {
    const { db, service } = recovery();
    db.stores.set("snapshots", new Map([
      ["healthy", { label: "healthy", timestamp: "2020-01-02", serializedProject: JSON.stringify(project()) }],
      ["bad-payload", { label: "deletable", timestamp: "2020-01-01", serializedProject: "{" }],
    ]));
    expect(await service.listSnapshots()).toMatchObject({ ok: true, value: [
      { path: "healthy", name: "healthy" }, { path: "bad-payload", name: "deletable" },
    ] });
    expect(await service.loadSnapshot("bad-payload")).toMatchObject({ ok: false, code: "invalid-data" });
  });

  it.each([
    ["bad-label", { label: 1, timestamp: "2020-01-01", serializedProject: "{}" }],
    ["bad-date", { label: "bad", timestamp: "not-a-date", serializedProject: "{}" }],
    ["missing-payload", { label: "bad", timestamp: "2020-01-01" }],
    ["bad-payload-type", { label: "bad", timestamp: "2020-01-01", serializedProject: 3 }],
  ])("rejects invalid snapshot metadata: %s", async (key, record) => {
    const { db, service } = recovery(); db.stores.set("snapshots", new Map([[key, record]]));
    expect(await service.listSnapshots()).toMatchObject({ ok: false, code: "invalid-data" });
  });

  it("maps database failures without fabricating or misreporting invalid data", async () => {
    const { db, service } = recovery(); db.fail = true;
    expect(await service.listSnapshots()).toMatchObject({ ok: false, code: "unknown" });
    expect(await service.loadSnapshot("snapshot")).toMatchObject({ ok: false, code: "unknown" });
    expect(await service.saveAutosave(project())).toMatchObject({ ok: false, code: "unknown" });
    expect(await service.deleteSnapshot("snapshot")).toMatchObject({ ok: false, code: "unknown" });
  });

  it("treats cleared browser storage as empty", async () => {
    const { service } = recovery();
    expect(await service.loadAutosave()).toEqual({ ok: true, value: null });
    expect(await service.listSnapshots()).toEqual({ ok: true, value: [] });
  });

  it("reads legacy autosave and snapshot records from the projects store", async () => {
    const { db, service } = recovery();
    db.stores.set("projects", new Map([
      ["__autosave__\\autosave.pindou", project(4)],
      ["snapshot_10_legacy", { project: project(5), label: "legacy", timestamp: "2020-01-01T00:00:00.000Z" }],
    ]));
    expect(await service.loadAutosave()).toMatchObject({ ok: true, value: { canvasData: [[{ colorIndex: 4 }]] } });
    const listed = await service.listSnapshots();
    expect(listed).toMatchObject({ ok: true, value: [{ name: "legacy" }] });
    if (listed.ok) expect(await service.loadSnapshot(listed.value[0].path)).toMatchObject({ ok: true, value: { project: { canvasData: [[{ colorIndex: 5 }]] }, sourceProjectId: undefined } });
  });
});

function deleteRecoveryDb() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(RECOVERY_DB_NAME);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
}

function createLegacyDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(RECOVERY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("projects");
      request.result.createObjectStore("snapshots");
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["projects", "snapshots"], "readwrite");
      tx.objectStore("projects").put(project(4), "__autosave__\\autosave.pindou");
      tx.objectStore("snapshots").put({ project: project(5), label: "legacy", timestamp: "2020-01-01T00:00:00.000Z" }, "snapshot_legacy");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe("real IndexedDB upgrade and transactions", () => {
  beforeEach(deleteRecoveryDb);

  it("upgrades v1 without losing legacy records and creates the autosave store", async () => {
    await createLegacyDatabase();
    const service = new BrowserRecoveryStorage(indexedDbRecoveryDatabase);
    expect(await service.loadAutosave()).toMatchObject({ ok: true, value: { canvasData: [[{ colorIndex: 4 }]] } });
    expect(await service.listSnapshots()).toMatchObject({ ok: true, value: [{ path: "snapshot_legacy", name: "legacy" }] });
    expect((await service.saveAutosave(project(8))).ok).toBe(true);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(RECOVERY_DB_NAME, 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining(["projects", "snapshots", "autosave"]));
    db.close();
  });

  it("waits for put and delete transactions to complete", async () => {
    await indexedDbRecoveryDatabase.put("autosave", "current", "value");
    expect(await indexedDbRecoveryDatabase.get("autosave", "current")).toBe("value");
    await indexedDbRecoveryDatabase.delete("autosave", "current");
    expect(await indexedDbRecoveryDatabase.get("autosave", "current")).toBeUndefined();
  });

  it("keeps keys and values paired in entries", async () => {
    await indexedDbRecoveryDatabase.put("snapshots", "b", { label: "B" });
    await indexedDbRecoveryDatabase.put("snapshots", "a", { label: "A" });
    expect(await indexedDbRecoveryDatabase.entries("snapshots")).toEqual([
      ["a", { label: "A" }], ["b", { label: "B" }],
    ]);
  });
});

describe("autosave scheduler", () => {
  it("serializes ticks and ignores a result after disposal", async () => {
    let resolve!: (value: any) => void;
    const run = vi.fn(() => new Promise((done) => { resolve = done; }));
    const report = vi.fn();
    const scheduler = createAutosaveScheduler(run, report);
    const first = scheduler.tick(); const overlapping = scheduler.tick();
    expect(run).toHaveBeenCalledOnce();
    await overlapping;
    scheduler.dispose(); resolve({ ok: false, code: "unknown" }); await first;
    expect(report).not.toHaveBeenCalled();
  });

  it("reports current results in order", async () => {
    const report = vi.fn(); const run = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: "unknown" })
      .mockResolvedValueOnce({ ok: true, value: undefined });
    const scheduler = createAutosaveScheduler(run, report);
    await scheduler.tick(); await scheduler.tick();
    expect(report.mock.calls.map((call) => call[0])).toEqual([
      { ok: false, code: "unknown" }, { ok: true, value: undefined },
    ]);
  });
});

describe("editor recovery semantics", () => {
  beforeEach(() => { resetPlatformServicesForTest(); localStorage.clear(); useEditorStore.getState().newCanvas(1, 1); });

  it("autosaves only through recovery and does not alter document metadata or dirty state", async () => {
    const saveAutosave = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const saveProject = vi.fn(); const document = { displayName: "real.pindou", writable: true };
    install({ availability: "available", saveAutosave, loadAutosave: vi.fn(), saveSnapshot: vi.fn(), listSnapshots: vi.fn(), loadSnapshot: vi.fn(), deleteSnapshot: vi.fn() }, { saveProject });
    useEditorStore.setState({ projectDocument: document, projectPath: "real.pindou", isDirty: true, lastSavedAt: "saved", baselineCanvasData: [[{ colorIndex: 8 }]] });
    await useEditorStore.getState().autoSave();
    expect(saveAutosave).toHaveBeenCalledOnce(); expect(saveProject).not.toHaveBeenCalled();
    expect(useEditorStore.getState()).toMatchObject({ projectDocument: document, projectPath: "real.pindou", isDirty: true, lastSavedAt: "saved", baselineCanvasData: [[{ colorIndex: 8 }]] });
  });

  it("updates snapshots locally when create/delete succeeds even if listing fails", async () => {
    const created = { path: "new", name: "new", modified: "2025-01-02" };
    install({ availability: "available", saveAutosave: vi.fn(), loadAutosave: vi.fn(), saveSnapshot: async () => ({ ok: true, value: created }), listSnapshots: async () => ({ ok: false, code: "unknown" }), loadSnapshot: vi.fn(), deleteSnapshot: async () => ({ ok: true, value: undefined }) });
    useEditorStore.setState({ snapshots: [{ path: "old", name: "old", modified: "2025-01-01" }] });
    expect(await useEditorStore.getState().createSnapshot("new")).toMatchObject({ ok: true });
    expect(useEditorStore.getState().snapshots.map((item) => item.path)).toEqual(["new", "old"]);
    await useEditorStore.getState().deleteSnapshot("new");
    expect(useEditorStore.getState().snapshots.map((item) => item.path)).toEqual(["old"]);
  });

  it("cancels stale list results and invalidates pending loads after create/delete", async () => {
    let resolveA!: (value: any) => void; let resolveB!: (value: any) => void; let resolveC!: (value: any) => void;
    const listSnapshots = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveC = resolve; }));
    const created = { path: "created", name: "created", modified: "3" };
    install({ availability: "available", saveAutosave: vi.fn(), loadAutosave: vi.fn(), saveSnapshot: async () => ({ ok: true, value: created }), listSnapshots, loadSnapshot: vi.fn(), deleteSnapshot: async () => ({ ok: true, value: undefined }) });
    const a = useEditorStore.getState().loadSnapshots(); const b = useEditorStore.getState().loadSnapshots();
    resolveB({ ok: true, value: [{ path: "new", name: "new", modified: "2" }] }); await b;
    resolveA({ ok: false, code: "unknown" });
    expect(await a).toMatchObject({ ok: false, code: "cancelled" });
    const c = useEditorStore.getState().loadSnapshots();
    await useEditorStore.getState().createSnapshot("created");
    resolveC({ ok: true, value: [{ path: "stale", name: "stale", modified: "1" }] });
    expect(await c).toMatchObject({ ok: false, code: "cancelled" });
    expect(useEditorStore.getState().snapshots.map((item) => item.path)).toEqual(["created", "new"]);
  });

  it("returns autosave failures, records one observable error, and clears it after success", async () => {
    const saveAutosave = vi.fn().mockResolvedValueOnce({ ok: false, code: "unknown" }).mockResolvedValueOnce({ ok: false, code: "unknown" }).mockResolvedValueOnce({ ok: true, value: undefined });
    install({ availability: "available", saveAutosave, loadAutosave: vi.fn(), saveSnapshot: vi.fn(), listSnapshots: vi.fn(), loadSnapshot: vi.fn(), deleteSnapshot: vi.fn() });
    useEditorStore.setState({ isDirty: true });
    const first = await useEditorStore.getState().autoSave();
    expect(first).toMatchObject({ ok: false, code: "unknown" });
    useEditorStore.getState().reportAutosaveResult(first);
    expect(useEditorStore.getState().lastAutosaveErrorCode).toBe("unknown");
    await useEditorStore.getState().autoSave();
    expect(useEditorStore.getState().lastAutosaveErrorCode).toBe("unknown");
    const success = await useEditorStore.getState().autoSave();
    useEditorStore.getState().reportAutosaveResult(success);
    expect(useEditorStore.getState().lastAutosaveErrorCode).toBeNull();
  });

  it("keeps state unchanged and returns recovery failures to the UI", async () => {
    install({ availability: "available", saveAutosave: async () => ({ ok: false, code: "unknown" }), loadAutosave: vi.fn(), saveSnapshot: async () => ({ ok: false, code: "unknown" }), listSnapshots: async () => ({ ok: false, code: "unknown" }), loadSnapshot: async () => ({ ok: false, code: "invalid-data" }), deleteSnapshot: vi.fn() });
    useEditorStore.setState({ isDirty: true, snapshots: [{ path: "keep", name: "keep", modified: "now" }] }); const before = useEditorStore.getState();
    await useEditorStore.getState().autoSave(); await useEditorStore.getState().loadSnapshots();
    expect(await useEditorStore.getState().createSnapshot("retry me")).toMatchObject({ ok: false, code: "unknown" });
    expect(await useEditorStore.getState().restoreSnapshot("bad")).toMatchObject({ ok: false, code: "invalid-data" });
    expect(await useEditorStore.getState().exportSnapshot("bad", "bad")).toMatchObject({ ok: false, code: "invalid-data" });
    expect(useEditorStore.getState().isDirty).toBe(true); expect(useEditorStore.getState().snapshots).toEqual(before.snapshots);
  });

  it("restores a same-identity snapshot as a new generation while retaining document cloud and baseline", async () => {
    const document = { displayName: "current.pindou", writable: true }; const baseline = [[{ colorIndex: 7 }]];
    const identity = useEditorStore.getState().projectId;
    install({ availability: "available", saveAutosave: vi.fn(), loadAutosave: vi.fn(), saveSnapshot: vi.fn(), listSnapshots: vi.fn(), loadSnapshot: async () => ({ ok: true, value: { project: project(5), sourceProjectId: identity } }), deleteSnapshot: vi.fn() });
    useEditorStore.setState({ projectDocument: document, projectPath: document.displayName, projectGeneration: 10, cloudGistId: "gist", cloudUpdatedAt: "cloud-time", cloudProjectName: "cloud", baselineCanvasData: baseline, lastSavedAt: "saved" });
    await useEditorStore.getState().restoreSnapshot({ path: "snapshot", name: "snapshot", modified: "now", sourceProjectId: identity });
    expect(useEditorStore.getState()).toMatchObject({ projectDocument: document, projectPath: "current.pindou", projectGeneration: 11, cloudGistId: "gist", cloudUpdatedAt: "cloud-time", cloudProjectName: "cloud", baselineCanvasData: baseline, lastSavedAt: "saved", isDirty: true, canvasData: [[{ colorIndex: 5 }]] });
  });

  it("invalidates pending save results when host document-load actions replace the project", async () => {
    let resolveSave!: (value: any) => void;
    const saveProject = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    install({ availability: "available", saveAutosave: vi.fn(), loadAutosave: vi.fn(), saveSnapshot: vi.fn(), listSnapshots: vi.fn(), loadSnapshot: vi.fn(), deleteSnapshot: vi.fn() }, { saveProject });
    const document = { displayName: "old.pindou", writable: true };
    useEditorStore.setState({ projectDocument: document, projectPath: document.displayName, isDirty: true, lastSavedAt: "before", baselineCanvasData: [[{ colorIndex: 1 }]] });

    const pendingSave = useEditorStore.getState().saveProject();
    useEditorStore.getState().loadProjectLayers(project(8).layers!, { width: 1, height: 1 });
    useEditorStore.setState({ projectPath: "loaded.pindou", projectDocument: { displayName: "loaded.pindou", writable: true }, lastSavedAt: "loaded", baselineCanvasData: [[{ colorIndex: 8 }]] });
    resolveSave({ ok: true, value: { displayName: "stale.pindou", writable: true } });
    await pendingSave;

    expect(useEditorStore.getState()).toMatchObject({ projectPath: "loaded.pindou", lastSavedAt: "loaded", baselineCanvasData: [[{ colorIndex: 8 }]], canvasData: [[{ colorIndex: 8 }]] });
  });

  it("ignores a pending restore after another project replacement", async () => {
    let resolveRestore!: (value: any) => void;
    install({ availability: "available", saveAutosave: vi.fn(), loadAutosave: vi.fn(), saveSnapshot: vi.fn(), listSnapshots: vi.fn(), loadSnapshot: () => new Promise((resolve) => { resolveRestore = resolve; }), deleteSnapshot: vi.fn() });
    useEditorStore.setState({ projectGeneration: 20 });

    const pending = useEditorStore.getState().restoreSnapshot("A");
    useEditorStore.getState().loadCanvasData([[{ colorIndex: 8 }]], { width: 1, height: 1 });
    resolveRestore({ ok: true, value: project(5) });

    expect(await pending).toMatchObject({ ok: false, code: "cancelled" });
    expect(useEditorStore.getState()).toMatchObject({ projectGeneration: 21, canvasData: [[{ colorIndex: 8 }]] });
  });

  it("lets the later restore win when restores complete out of order", async () => {
    const resolves = new Map<string, (value: any) => void>();
    install({ availability: "available", saveAutosave: vi.fn(), loadAutosave: vi.fn(), saveSnapshot: vi.fn(), listSnapshots: vi.fn(), loadSnapshot: (path) => new Promise((resolve) => { resolves.set(path, resolve); }), deleteSnapshot: vi.fn() });

    const restoreA = useEditorStore.getState().restoreSnapshot("A");
    const restoreB = useEditorStore.getState().restoreSnapshot("B");
    resolves.get("B")!({ ok: true, value: project(2) });
    expect(await restoreB).toMatchObject({ ok: true });
    resolves.get("A")!({ ok: true, value: project(1) });

    expect(await restoreA).toMatchObject({ ok: false, code: "cancelled" });
    expect(useEditorStore.getState().canvasData).toEqual([[{ colorIndex: 2 }]]);
  });

  it("invalidates a pending save before applying a restored snapshot", async () => {
    let resolveSave!: (value: any) => void;
    const saveProject = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    install({ availability: "available", saveAutosave: vi.fn(), loadAutosave: vi.fn(), saveSnapshot: vi.fn(), listSnapshots: vi.fn(), loadSnapshot: async () => ({ ok: true, value: project(5) }), deleteSnapshot: vi.fn() }, { saveProject });
    const document = { displayName: "current.pindou", writable: true };
    useEditorStore.setState({ projectDocument: document, projectPath: document.displayName, isDirty: true, lastSavedAt: "before" });

    const pendingSave = useEditorStore.getState().saveProject();
    await useEditorStore.getState().restoreSnapshot("snapshot");
    resolveSave({ ok: true, value: { displayName: "stale.pindou", writable: true } });
    await pendingSave;

    expect(useEditorStore.getState()).toMatchObject({ projectPath: null, projectDocument: null, lastSavedAt: null, isDirty: true, canvasData: [[{ colorIndex: 5 }]] });
  });

  it("exports a snapshot without changing current project state", async () => {
    const exportProject = vi.fn(async () => ({ ok: true as const, value: undefined })); const document = { displayName: "current.pindou", writable: true };
    install({ availability: "available", saveAutosave: vi.fn(), loadAutosave: vi.fn(), saveSnapshot: vi.fn(), listSnapshots: vi.fn(), loadSnapshot: async () => ({ ok: true, value: project(6) }), deleteSnapshot: vi.fn() }, { exportProject });
    useEditorStore.setState({ projectDocument: document, projectPath: document.displayName, isDirty: true, baselineCanvasData: [[{ colorIndex: 3 }]], lastSavedAt: "saved" }); const before = useEditorStore.getState();
    await useEditorStore.getState().exportSnapshot("id", "my:snapshot");
    expect(exportProject).toHaveBeenCalledWith(expect.objectContaining({ canvasData: [[{ colorIndex: 6 }]] }), "my_snapshot.pindou");
    expect(useEditorStore.getState()).toMatchObject({ projectDocument: document, projectPath: before.projectPath, isDirty: true, baselineCanvasData: before.baselineCanvasData, lastSavedAt: "saved" });
  });
});
