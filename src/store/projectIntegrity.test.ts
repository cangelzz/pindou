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

describe("persistence outcomes", () => {
  it("distinguishes skipped and saved autosaves without mutating status on skip", async () => {
    const saveAutosave = vi.fn(async () => ({ ok: true as const, value: undefined }));
    install({}, recovery({ saveAutosave }));
    const before = { kind: "saved" as const, at: "before" };
    storeModule.useEditorStore.setState({ isDirty: false, autoSaveEnabled: true, saveStatus: before });
    await expect(storeModule.useEditorStore.getState().autoSave()).resolves.toEqual({ ok: true, value: "skipped" });
    expect(saveAutosave).not.toHaveBeenCalled();
    expect(storeModule.useEditorStore.getState().saveStatus).toEqual(before);

    storeModule.useEditorStore.setState({ isDirty: true });
    await expect(storeModule.useEditorStore.getState().autoSave()).resolves.toEqual({ ok: true, value: "saved" });
    storeModule.useEditorStore.getState().reportAutosaveResult({ ok: true, value: "saved" }, storeModule.useEditorStore.getState().createAutosaveTicket());
    expect(saveAutosave).toHaveBeenCalledOnce();
    expect(storeModule.useEditorStore.getState().saveStatus?.kind).toBe("autosaved");
  });

  it("returns save failures and converts thrown saves to unknown without changing dirty state", async () => {
    install({ saveProjectAs: vi.fn(async () => ({ ok: false as const, code: "permission-denied" as const })) });
    storeModule.useEditorStore.setState({ isDirty: true, saveStatus: null });
    await expect(storeModule.useEditorStore.getState().saveProject()).resolves.toEqual({ ok: false, code: "permission-denied" });
    expect(storeModule.useEditorStore.getState()).toMatchObject({ isDirty: true, saveStatus: null });

    install({ saveProjectAs: vi.fn(async () => { throw new Error("disk"); }) });
    await expect(storeModule.useEditorStore.getState().saveProjectAs()).resolves.toMatchObject({ ok: false, code: "unknown" });
    expect(storeModule.useEditorStore.getState()).toMatchObject({ isDirty: true, saveStatus: null });
  });
});

describe("open staleness", () => {
  it("returns a language-neutral stale result when content changes while the picker is pending", async () => {
    let finish!: (result: any) => void;
    install({ openProject: vi.fn((): Promise<any> => new Promise((resolve) => { finish = resolve; })) });
    const pending = storeModule.useEditorStore.getState().openProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 3);
    finish({ ok: true as const, value: { project: project(undefined, 9), document: { displayName: "picked.pindou", writable: true } } });
    await expect(pending).resolves.toEqual({ ok: false as const, code: "stale" });
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
    storeModule.useEditorStore.setState({ projectDocument: { displayName: "A.pindou", writable: true }, projectPath: "A.pindou", cloudGistId: "gist", baselineCanvasData: [[{ colorIndex: 1 }]], saveStatus: { kind: "saved", at: "2026-08-20T00:00:00.000Z" } });
    await storeModule.useEditorStore.getState().restoreSnapshot(info(sourceProjectId));
    expect(storeModule.useEditorStore.getState()).toMatchObject({ projectDocument: null, projectPath: null, cloudGistId: null, baselineCanvasData: null, saveStatus: null, isDirty: true });
    expect(storeModule.useEditorStore.getState().projectId).not.toBe(oldIdentity);
    await storeModule.useEditorStore.getState().saveProject();
    expect(saveProject).not.toHaveBeenCalled();
    expect(saveProjectAs).toHaveBeenCalledOnce();
  });
});

describe("localized default layer names", () => {
  it.each([
    ["en", (number: number) => `Layer ${number}`, ["Layer 1", "Layer 2"]],
    ["zh-CN", (number: number) => `图层 ${number}`, ["图层 1", "图层 2"]],
  ] as const)("keeps canonical names while displaying defaults in %s", async (_language, provider, displayNames) => {
    const { getLayerDisplayName, setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider(provider);
    storeModule.useEditorStore.getState().newCanvas(2, 2);
    storeModule.useEditorStore.getState().addLayer();
    const before = storeModule.useEditorStore.getState().layers;
    expect(before.map((layer) => layer.name)).toEqual(["Layer 1", "Layer 2"]);
    expect(before.map(getLayerDisplayName)).toEqual(displayNames);
    expect(storeModule.useEditorStore.getState().layers).toBe(before);
  });

  it("keeps stable generated-name indexes when layers are removed and added", async () => {
    const { getLayerDisplayName, normalizeDefaultLayerPromptName, setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider((number) => `图层 ${number}`);
    storeModule.useEditorStore.getState().newCanvas(2, 2);
    storeModule.useEditorStore.getState().addLayer();
    const second = storeModule.useEditorStore.getState().layers[1];
    storeModule.useEditorStore.getState().removeLayer(second.id);
    const stateAfterDelete = storeModule.useEditorStore.getState();
    const promptLayer = { name: `Layer ${stateAfterDelete.nextDefaultLayerNameIndex}`, defaultNameIndex: stateAfterDelete.nextDefaultLayerNameIndex };
    const promptValue = getLayerDisplayName(promptLayer);
    expect(promptValue).toBe("图层 3");
    expect(normalizeDefaultLayerPromptName(promptValue, promptValue)).toBeUndefined();
    stateAfterDelete.addLayer(normalizeDefaultLayerPromptName(promptValue, promptValue));
    expect(storeModule.useEditorStore.getState().layers.map((layer) => layer.defaultNameIndex)).toEqual([1, 3]);
  });

  it("uses the stable generated-name sequence when moving a selection to a new layer", () => {
    storeModule.useEditorStore.getState().newCanvas(2, 2);
    storeModule.useEditorStore.getState().addLayer();
    storeModule.useEditorStore.getState().addLayer();
    const second = storeModule.useEditorStore.getState().layers[1];
    storeModule.useEditorStore.getState().removeLayer(second.id);
    storeModule.useEditorStore.setState({ selection: new Set(["0,0"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 } });
    storeModule.useEditorStore.getState().moveSelectionToNewLayer();
    expect(storeModule.useEditorStore.getState().layers.map((layer) => layer.defaultNameIndex)).toEqual([1, 3, 4]);
    expect(storeModule.useEditorStore.getState().nextDefaultLayerNameIndex).toBe(5);
  });

  it.each(["open", "snapshot"] as const)("preserves generated-name metadata through %s hydration", async (kind) => {
    const generated = { ...project(), layers: [{ ...project().layers![0], name: "Layer 1", defaultNameIndex: 1 }] };
    if (kind === "open") {
      install({ openProject: vi.fn(async () => ({ ok: true as const, value: { project: generated, document: { displayName: "x.pindou", writable: true } } })) });
      await storeModule.useEditorStore.getState().openProject();
    } else {
      install({}, recovery({ loadSnapshot: vi.fn(async () => ({ ok: true as const, value: generated })) }));
      await storeModule.useEditorStore.getState().restoreSnapshot("snapshot");
    }
    const { setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider((number) => `Layer ${number}`);
    storeModule.useEditorStore.getState().localizeDefaultLayerNames();
    expect(storeModule.useEditorStore.getState().layers[0]).toMatchObject({ name: "Layer 1", defaultNameIndex: 1 });
  });

  it("marks an empty add-layer name as generated without persisting localization", async () => {
    const { getLayerDisplayName, setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider((number) => `图层 ${number}`);
    storeModule.useEditorStore.getState().addLayer();
    const layers = storeModule.useEditorStore.getState().layers;
    const layer = layers[layers.length - 1];
    expect(layer).toMatchObject({ name: "Layer 2", defaultNameIndex: 2 });
    expect(getLayerDisplayName(layer)).toBe("图层 2");
  });

  it("creates canonical generated layers and preserves custom names", async () => {
    const { setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider((number) => `图层 ${number}`);
    storeModule.useEditorStore.getState().newCanvas(2, 2);
    expect(storeModule.useEditorStore.getState().layers[0].name).toBe("Layer 1");
    const id = storeModule.useEditorStore.getState().layers[0].id;
    storeModule.useEditorStore.getState().renameLayer(id, "自定义");
    setDefaultLayerNameProvider((number) => `Layer ${number}`);
    storeModule.useEditorStore.getState().localizeDefaultLayerNames();
    expect(storeModule.useEditorStore.getState().layers[0].name).toBe("自定义");
  });

  it("does not mutate untouched generated layers when language changes", async () => {
    const { setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider((number) => `Layer ${number}`);
    storeModule.useEditorStore.getState().newCanvas(2, 2);
    const before = storeModule.useEditorStore.getState().layers;
    setDefaultLayerNameProvider((number) => `图层 ${number}`);
    storeModule.useEditorStore.getState().localizeDefaultLayerNames();
    expect(storeModule.useEditorStore.getState().layers).toBe(before);
    expect(before[0]).toMatchObject({ name: "Layer 1", defaultNameIndex: 1 });
  });

  it("migrates only exact historical default names and derives the next index from the max marker", () => {
    const empty = [[{ colorIndex: null }]];
    storeModule.useEditorStore.getState().loadProjectLayers([
      { id: "en", name: "Layer 7", data: empty, visible: true, opacity: 1 },
      { id: "zh", name: "图层 3", data: empty, visible: true, opacity: 1 },
      { id: "marker", name: "stale localized value", defaultNameIndex: 11, data: empty, visible: true, opacity: 1 },
      { id: "custom", name: "拼豆层 12", data: empty, visible: true, opacity: 1 },
    ], { width: 1, height: 1 });
    const state = storeModule.useEditorStore.getState();
    expect(state.layers.map(({ name, defaultNameIndex }) => ({ name, defaultNameIndex }))).toEqual([
      { name: "Layer 7", defaultNameIndex: 7 },
      { name: "Layer 3", defaultNameIndex: 3 },
      { name: "Layer 11", defaultNameIndex: 11 },
      { name: "拼豆层 12", defaultNameIndex: undefined },
    ]);
    expect(state.nextDefaultLayerNameIndex).toBe(12);
  });
});

describe("autosave lifecycle", () => {
  it("keeps loaded project save status on the replacement content revision", async () => {
    const loaded = project();
    storeModule.useEditorStore.setState({ contentRevision: 11 });
    storeModule.useEditorStore.getState().loadProjectDocument(loaded, "loaded.pindou");
    expect(storeModule.useEditorStore.getState().currentSaveStatus()).toMatchObject({ kind: "saved", revision: 12 });

    install({ openProject: vi.fn(async () => ({ ok: true as const, value: { project: loaded, document: { displayName: "opened.pindou", writable: true } } })) });
    await storeModule.useEditorStore.getState().openProject();
    expect(storeModule.useEditorStore.getState().currentSaveStatus()).toMatchObject({ kind: "saved", revision: 13 });
  });

  it("only exposes save status for the current content revision", () => {
    storeModule.useEditorStore.setState({ contentRevision: 4, saveStatus: { kind: "saved", at: "now", revision: 3 } });
    expect(storeModule.useEditorStore.getState().currentSaveStatus()).toBeNull();
    storeModule.useEditorStore.setState({ saveStatus: { kind: "saved", at: "now", revision: 4 } });
    expect(storeModule.useEditorStore.getState().currentSaveStatus()).toEqual({ kind: "saved", at: "now", revision: 4 });
  });

  it("captures the revision completed by formal save when edits race the write", async () => {
    let finish!: (value: any) => void;
    install({ saveProjectAs: vi.fn((): Promise<any> => new Promise((resolve) => { finish = resolve; })) });
    storeModule.useEditorStore.setState({ contentRevision: 5, isDirty: true });
    const pending = storeModule.useEditorStore.getState().saveProjectAs();
    storeModule.useEditorStore.getState().setCell(0, 0, 9);
    finish({ ok: true as const, value: { displayName: "saved.pindou", writable: true } });
    await pending;
    expect(storeModule.useEditorStore.getState().saveStatus?.revision).toBe(5);
    expect(storeModule.useEditorStore.getState().currentSaveStatus()).toBeNull();
  });

  it("captures the autosave ticket revision in its status", () => {
    storeModule.useEditorStore.setState({ contentRevision: 8, isDirty: true });
    const ticket = storeModule.useEditorStore.getState().createAutosaveTicket();
    expect(storeModule.useEditorStore.getState().reportAutosaveResult({ ok: true, value: "saved" }, ticket)).toBe(true);
    expect(storeModule.useEditorStore.getState().saveStatus?.revision).toBe(8);
  });

  it("ignores a stale autosave result after replacing project A with B", async () => {
    const stateA = storeModule.useEditorStore.getState();
    const ticket = stateA.createAutosaveTicket();
    storeModule.useEditorStore.getState().newCanvas(3, 3);
    storeModule.useEditorStore.getState().reportAutosaveResult({ ok: true, value: "saved" }, ticket);
    expect(storeModule.useEditorStore.getState().saveStatus).toBeNull();
    expect(storeModule.useEditorStore.getState().reportAutosaveResult({ ok: false, code: "network" }, ticket)).toBe(false);
    expect(storeModule.useEditorStore.getState().lastAutosaveErrorCode).toBeNull();
  });

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
    await expect(formal).resolves.toMatchObject({ ok: false, code: "unknown" });
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
