import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter, SnapshotInfo } from "../adapters";
import type { ProjectFile } from "../types";
import type { ProjectFileService } from "../platform/projectFileService";
import type { RecoveryStorage } from "../platform/recoveryStorage";
import { createLegacyPlatformServices } from "../platform/services";
import { createBrowserCapabilities } from "../platform/capabilities";
import { resetPlatformServicesForTest, setPlatformServices } from "../platform/serviceRegistry";

let storeModule: typeof import("./editorStore");
const memory = new Map<string, string>();

const project = (createdAt = "2020-01-02T03:04:05.000Z", color = 7): ProjectFile => ({
  version: 3,
  canvasSize: { width: 1, height: 1 },
  canvasData: [[{ colorIndex: color }]],
  layers: [{ id: "source", name: "Source", visible: true, opacity: 1, data: [[{ colorIndex: color }]] }],
  gridConfig: { groupSize: 5, edgePadding: 0, startX: 1, startY: 1, visible: true, lineColor: "#000", lineWidth: 1, groupLineColor: "#000", groupLineWidth: 2 },
  projectInfo: { title: "Original" },
  createdAt,
  updatedAt: "2024-01-01T00:00:00.000Z",
});

function recovery(overrides: Partial<RecoveryStorage> = {}): RecoveryStorage {
  return {
    availability: "available",
    saveAutosave: vi.fn(async () => ({ ok: true as const, value: undefined })),
    loadAutosave: vi.fn(async () => ({ ok: true as const, value: null })),
    clearAutosave: vi.fn(async () => ({ ok: true as const, value: undefined })),
    saveSnapshot: vi.fn(async (_project, label, sourceProjectId) => ({ ok: true as const, value: { path: "snapshot", name: label, modified: "2025-01-01", sourceProjectId } })),
    listSnapshots: vi.fn(async () => ({ ok: true as const, value: [] })),
    loadSnapshot: vi.fn(async () => ({ ok: false as const, code: "invalid-data" as const })),
    deleteSnapshot: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  };
}

function install(projectFiles: Partial<ProjectFileService> = {}, recoveryStorage = recovery()) {
  const legacy = createLegacyPlatformServices({} as PlatformAdapter, createBrowserCapabilities("chrome", true));
  setPlatformServices({
    ...legacy,
    recovery: recoveryStorage,
    projectFiles: {
      openProject: vi.fn(async () => ({ ok: false as const, code: "cancelled" })),
      saveProject: vi.fn(async (_project, document) => ({ ok: true as const, value: document })),
      saveProjectAs: vi.fn(async () => ({ ok: true as const, value: { displayName: "new.pindou", writable: true } })),
      exportProject: vi.fn(async () => ({ ok: true as const, value: undefined })),
      ...projectFiles,
    } as ProjectFileService,
  });
}

beforeAll(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
    clear: () => memory.clear(),
  } });
  storeModule = await import("./editorStore");
});

beforeEach(() => {
  resetPlatformServicesForTest();
  memory.clear();
  let next = 0;
  storeModule.setProjectIdentityGeneratorForTest(() => `identity-${++next}`);
  storeModule.useEditorStore.getState().newCanvas(1, 1);
  install();
});

describe("project timestamps", () => {
  it("preserves an opened createdAt through save, save-as, autosave and snapshot", async () => {
    const opened = project();
    const saved: ProjectFile[] = [];
    const autosaved: ProjectFile[] = [];
    const snapshotted: ProjectFile[] = [];
    install({
      openProject: vi.fn(async () => ({ ok: true as const, value: { project: opened, document: { displayName: "old.pindou", writable: true } } })),
      saveProject: vi.fn(async (value, document) => { saved.push(value); return { ok: true as const, value: document }; }),
      saveProjectAs: vi.fn(async (value) => { saved.push(value); return { ok: true as const, value: { displayName: "copy.pindou", writable: true } }; }),
    }, recovery({
      saveAutosave: vi.fn(async (value) => { autosaved.push(value); return { ok: true as const, value: undefined }; }),
      saveSnapshot: vi.fn(async (value, label, sourceProjectId) => { snapshotted.push(value); return { ok: true as const, value: { path: "s", name: label, modified: "now", sourceProjectId } }; }),
    }));

    await storeModule.useEditorStore.getState().openProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 8);
    await storeModule.useEditorStore.getState().saveProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 9);
    await storeModule.useEditorStore.getState().saveProjectAs();
    storeModule.useEditorStore.setState({ isDirty: true });
    await storeModule.useEditorStore.getState().autoSave();
    await storeModule.useEditorStore.getState().createSnapshot("snapshot");

    expect([...saved, ...autosaved, ...snapshotted].map((value) => value.createdAt)).toEqual(Array(4).fill(opened.createdAt));
  });

  it("keeps a new project's ISO createdAt stable across builds", () => {
    const state = storeModule.useEditorStore.getState();
    const first = storeModule.projectFromEditorState(state, "2030-01-01T00:00:00.000Z");
    const second = storeModule.projectFromEditorState(state, "2031-01-01T00:00:00.000Z");
    expect(first.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe("2031-01-01T00:00:00.000Z");
  });

  it("preserves createdAt when downloading a cloud project", () => {
    storeModule.useEditorStore.getState().replaceProjectFromCloud(project(), "gist", "Cloud", "remote");
    expect(storeModule.projectFromEditorState(storeModule.useEditorStore.getState()).createdAt).toBe(project().createdAt);
  });
});

describe("persistent change tracking", () => {
  it.each([
    ["grid origin", () => storeModule.useEditorStore.getState().setGridStartCoords(2, 3)],
    ["grid margin", () => storeModule.useEditorStore.getState().setEdgePadding(2)],
    ["grid visibility", () => storeModule.useEditorStore.getState().setGridVisible(false)],
    ["grid color", () => storeModule.useEditorStore.getState().setGridLineColor("#123")],
    ["grid width", () => storeModule.useEditorStore.getState().setGridLineWidth(3)],
    ["group color", () => storeModule.useEditorStore.getState().setGridGroupLineColor("#456")],
    ["group width", () => storeModule.useEditorStore.getState().setGridGroupLineWidth(4)],
    ["layer add", () => storeModule.useEditorStore.getState().addLayer("Two")],
    ["layer visibility", () => storeModule.useEditorStore.getState().setLayerVisible(storeModule.useEditorStore.getState().activeLayerId, false)],
    ["layer opacity", () => storeModule.useEditorStore.getState().setLayerOpacity(storeModule.useEditorStore.getState().activeLayerId, 0.5)],
    ["layer rename", () => storeModule.useEditorStore.getState().renameLayer(storeModule.useEditorStore.getState().activeLayerId, "Renamed")],
    ["project info", () => storeModule.useEditorStore.getState().setProjectInfo({ title: "Changed" })],
  ])("marks %s dirty, advances content revision and enables autosave", async (_name, change) => {
    const saveAutosave = vi.fn(async () => ({ ok: true as const, value: undefined }));
    install({}, recovery({ saveAutosave }));
    storeModule.useEditorStore.setState({ isDirty: false });
    const revision = storeModule.useEditorStore.getState().contentRevision;
    change();
    expect(storeModule.useEditorStore.getState().isDirty).toBe(true);
    expect(storeModule.useEditorStore.getState().contentRevision).toBeGreaterThan(revision);
    await storeModule.useEditorStore.getState().autoSave();
    expect(saveAutosave).toHaveBeenCalledOnce();
  });

  it("does not mark selection and zoom-only actions dirty", () => {
    storeModule.useEditorStore.setState({ isDirty: false });
    storeModule.useEditorStore.getState().setZoom(2);
    storeModule.useEditorStore.getState().setSelection(new Set(["0,0"]));
    expect(storeModule.useEditorStore.getState().isDirty).toBe(false);
  });
});

describe("open staleness", () => {
  it("cancels an open result when content changes while the picker is pending", async () => {
    let finish!: (result: any) => void;
    install({ openProject: vi.fn((): Promise<any> => new Promise((resolve) => { finish = resolve; })) });
    const pending = storeModule.useEditorStore.getState().openProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 3);
    finish({ ok: true as const, value: { project: project(undefined, 9), document: { displayName: "picked.pindou", writable: true } } });
    await expect(pending).resolves.toMatchObject({ ok: false as const, code: "cancelled", message: expect.stringContaining("修改") });
    expect(storeModule.useEditorStore.getState().canvasData[0][0].colorIndex).toBe(3);
  });
});

describe("stable project identity", () => {
  it("writes the same projectId across save-as and cloud serialization", async () => {
    const saved: ProjectFile[] = [];
    install({ saveProjectAs: vi.fn(async (value) => { saved.push(value); return { ok: true as const, value: { displayName: "copy.pindou", writable: true } }; }) });
    const projectId = storeModule.useEditorStore.getState().projectId;
    await storeModule.useEditorStore.getState().saveProjectAs();
    expect(saved[0].projectId).toBe(projectId);
    expect(storeModule.projectFromEditorState(storeModule.useEditorStore.getState()).projectId).toBe(projectId);
  });

  it("adopts a persisted projectId on open and cloud download", async () => {
    const persisted = { ...project(), projectId: "persisted-project" };
    install({ openProject: vi.fn(async () => ({ ok: true as const, value: { project: persisted, document: { displayName: "saved.pindou", writable: true } } })) });
    await storeModule.useEditorStore.getState().openProject();
    expect(storeModule.useEditorStore.getState().projectId).toBe("persisted-project");
    storeModule.useEditorStore.getState().newCanvas(1, 1);
    storeModule.useEditorStore.getState().replaceProjectFromCloud(persisted, "gist", "Cloud", "remote");
    expect(storeModule.useEditorStore.getState().projectId).toBe("persisted-project");
  });
});

describe("snapshot identity", () => {
  const info = (sourceProjectId?: string): SnapshotInfo => ({ path: "snapshot", name: "Snapshot", modified: "now", sourceProjectId });

  it("preserves local document and cloud association only for the same identity", async () => {
    const currentIdentity = storeModule.useEditorStore.getState().projectId;
    install({}, recovery({ loadSnapshot: vi.fn(async () => ({ ok: true as const, value: { project: project(undefined, 5), sourceProjectId: currentIdentity } })) }));
    const document = { displayName: "A.pindou", writable: true };
    storeModule.useEditorStore.setState({ projectDocument: document, projectPath: document.displayName, cloudGistId: "gist", baselineCanvasData: [[{ colorIndex: 1 }]] });
    await storeModule.useEditorStore.getState().restoreSnapshot(info(currentIdentity));
    expect(storeModule.useEditorStore.getState()).toMatchObject({ projectDocument: document, projectPath: "A.pindou", cloudGistId: "gist", projectId: currentIdentity, isDirty: true });
  });

  it("preserves legacy-adapter snapshots when the serialized ProjectFile carries the same projectId", async () => {
    const currentProjectId = storeModule.useEditorStore.getState().projectId;
    install({}, recovery({ loadSnapshot: vi.fn(async () => ({ ok: true as const, value: { ...project(undefined, 4), projectId: currentProjectId } })) }));
    const document = { displayName: "legacy.pindou", writable: true };
    storeModule.useEditorStore.setState({ projectDocument: document, projectPath: document.displayName });
    await storeModule.useEditorStore.getState().restoreSnapshot("legacy-path");
    expect(storeModule.useEditorStore.getState()).toMatchObject({ projectDocument: document, projectPath: "legacy.pindou", projectId: currentProjectId });
  });

  it.each(["different", undefined])("detaches a %s identity snapshot so Ctrl+S uses save-as", async (sourceProjectId) => {
    const saveProject = vi.fn();
    const saveProjectAs = vi.fn(async () => ({ ok: true as const, value: { displayName: "restored.pindou", writable: true } }));
    install({ saveProject, saveProjectAs }, recovery({ loadSnapshot: vi.fn(async () => ({ ok: true as const, value: { project: project(undefined, 5), sourceProjectId } })) }));
    const oldIdentity = storeModule.useEditorStore.getState().projectId;
    storeModule.useEditorStore.setState({ projectDocument: { displayName: "A.pindou", writable: true }, projectPath: "A.pindou", cloudGistId: "gist", baselineCanvasData: [[{ colorIndex: 1 }]], lastSavedAt: "saved" });
    await storeModule.useEditorStore.getState().restoreSnapshot(info(sourceProjectId));
    expect(storeModule.useEditorStore.getState()).toMatchObject({ projectDocument: null, projectPath: null, cloudGistId: null, baselineCanvasData: null, lastSavedAt: null, isDirty: true });
    expect(storeModule.useEditorStore.getState().projectId).not.toBe(oldIdentity);
    await storeModule.useEditorStore.getState().saveProject();
    expect(saveProject).not.toHaveBeenCalled();
    expect(saveProjectAs).toHaveBeenCalledOnce();
  });
});

describe("autosave lifecycle", () => {
  it("serializes deferred autosave A, formal clear, then newer autosave B", async () => {
    let finishA!: (value: any) => void;
    let stored: ProjectFile | null = null;
    const events: string[] = [];
    const saveAutosave = vi.fn((value: ProjectFile): Promise<any> => {
      const color = value.canvasData[0][0].colorIndex;
      events.push(`save-${color}-start`);
      if (color === 1) {
        return new Promise((resolve) => { finishA = (result) => { stored = value; events.push("save-1-end"); resolve(result); }; });
      }
      stored = value;
      events.push(`save-${color}-end`);
      return Promise.resolve({ ok: true as const, value: undefined });
    });
    const clearAutosave = vi.fn(async () => { stored = null; events.push("clear"); return { ok: true as const, value: undefined }; });
    install({}, recovery({ saveAutosave, clearAutosave }));

    storeModule.useEditorStore.getState().setCell(0, 0, 1);
    const pendingA = storeModule.useEditorStore.getState().autoSave();
    const formalSave = storeModule.useEditorStore.getState().saveProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 2);
    const pendingB = storeModule.useEditorStore.getState().autoSave();

    await vi.waitFor(() => expect(saveAutosave).toHaveBeenCalledTimes(1));
    finishA({ ok: true as const, value: undefined });
    await Promise.all([pendingA, formalSave, pendingB]);

    expect(events).toEqual(["save-1-start", "save-1-end", "clear", "save-2-start", "save-2-end"]);
    expect((stored as ProjectFile | null)?.canvasData[0][0].colorIndex).toBe(2);
  });

  it("releases the autosave queue when a formal save rejects", async () => {
    const events: string[] = [];
    const saveAutosave = vi.fn(async (value: ProjectFile) => {
      events.push(`save-${value.canvasData[0][0].colorIndex}`);
      return { ok: true as const, value: undefined };
    });
    install({ saveProjectAs: vi.fn(async () => { throw new Error("write rejected"); }) }, recovery({ saveAutosave }));
    storeModule.useEditorStore.getState().setCell(0, 0, 1);
    const formal = storeModule.useEditorStore.getState().saveProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 2);
    const backup = storeModule.useEditorStore.getState().autoSave();
    await expect(formal).rejects.toThrow("write rejected");
    await expect(backup).resolves.toMatchObject({ ok: true });
    expect(events).toEqual(["save-2"]);
  });

  it("restores autosave as a detached dirty project with a new identity", () => {
    const before = storeModule.useEditorStore.getState().projectId;
    storeModule.useEditorStore.setState({ projectPath: "A.pindou", projectDocument: { displayName: "A.pindou", writable: true }, cloudGistId: "gist", baselineCanvasData: [[{ colorIndex: 1 }]] });
    storeModule.useEditorStore.getState().restoreAutosave(project(undefined, 8));
    expect(storeModule.useEditorStore.getState()).toMatchObject({ canvasData: [[{ colorIndex: 8 }]], projectPath: null, projectDocument: null, cloudGistId: null, baselineCanvasData: null, isDirty: true });
    expect(storeModule.useEditorStore.getState().projectId).not.toBe(before);
  });
});
