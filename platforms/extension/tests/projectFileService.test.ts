import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
    configurable: true,
  });
});

import {
  BrowserProjectFileService,
  browserDownloadSink,
  createBrowserFileApi,
  type BrowserFileApi,
  type DownloadSink,
} from "../projectFileService";
import type { ProjectFile } from "../../../src/types";
import type { ProjectDocumentRef, ProjectFileService } from "../../../src/platform/projectFileService";
import { createLegacyPlatformServices } from "../../../src/platform/services";
import { createBrowserCapabilities } from "../../../src/platform/capabilities";
import { resetPlatformServicesForTest, setPlatformServices } from "../../../src/platform/serviceRegistry";
import { useEditorStore } from "../../../src/store/editorStore";
import type { PlatformAdapter } from "../../../src/adapters";

const project = (color = 7): ProjectFile => ({
  version: 2,
  canvasSize: { width: 1, height: 1 },
  canvasData: [[{ colorIndex: color }]],
  layers: [{ id: "layer", name: "Layer", visible: true, opacity: 1, data: [[{ colorIndex: color }]] }],
  gridConfig: { groupSize: 5, edgePadding: 0, startX: 1, startY: 1, visible: true, lineColor: "#000", lineWidth: 1, groupLineColor: "#000", groupLineWidth: 2 },
  createdAt: "before",
  updatedAt: "before",
});

function abortError(): Error {
  const error = new Error("cancelled");
  error.name = "AbortError";
  return error;
}

function handle(options: {
  name?: string;
  text?: string;
  permission?: PermissionState;
  requestPermission?: PermissionState;
  createError?: Error;
  writeError?: Error;
  closeError?: Error;
} = {}) {
  const write = vi.fn(async () => {
    if (options.writeError) throw options.writeError;
  });
  const close = vi.fn(async () => {
    if (options.closeError) throw options.closeError;
  });
  const abort = vi.fn(async () => {});
  const writable = { write, close, abort };
  const value = {
    kind: "file" as const,
    name: options.name ?? "real.pindou",
    getFile: vi.fn(async () => ({ text: async () => options.text ?? JSON.stringify(project()) } as File)),
    queryPermission: vi.fn(async () => options.permission ?? "granted"),
    requestPermission: vi.fn(async () => options.requestPermission ?? "granted"),
    createWritable: vi.fn(async () => {
      if (options.createError) throw options.createError;
      return writable;
    }),
    isSameEntry: vi.fn(),
  };
  return { value: value as unknown as FileSystemFileHandle, write, close, abort };
}

function service(api: Partial<BrowserFileApi>, download: DownloadSink = vi.fn(async () => {})) {
  return new BrowserProjectFileService(api as BrowserFileApi, download);
}

describe("BrowserProjectFileService", () => {
  it("opens and parses the real file while retaining its handle", async () => {
    const h = handle({ name: "opened.pindou", text: JSON.stringify(project(3)) });
    const picker = vi.fn(async () => [h.value]);
    const result = await service({ showOpenFilePicker: picker }).openProject();

    expect(picker).toHaveBeenCalledWith({
      multiple: false,
      types: [{ description: "PinDou Project", accept: { "application/json": [".pindou"] } }],
    });
    expect(result).toMatchObject({ ok: true, value: { project: { version: 3 }, document: { displayName: "opened.pindou", writable: true } } });
    if (result.ok) expect(result.value.document.handle).toBe(h.value);
  });

  it("maps malformed project JSON to invalid-data", async () => {
    const h = handle({ text: "{" });
    const result = await service({ showOpenFilePicker: async () => [h.value] }).openProject();
    expect(result).toMatchObject({ ok: false, code: "invalid-data" });
  });

  it("maps a present non-array layers value to invalid-data", async () => {
    const h = handle({ text: JSON.stringify({ canvasSize: { width: 1, height: 1 }, canvasData: [[null]], layers: {} }) });
    const result = await service({ showOpenFilePicker: async () => [h.value] }).openProject();
    expect(result).toMatchObject({ ok: false, code: "invalid-data" });
  });

  it("does not misreport file read failures as invalid project data", async () => {
    const h = handle();
    (h.value.getFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: async () => { throw new Error("read failed"); },
    } as File);
    const result = await service({ showOpenFilePicker: async () => [h.value] }).openProject();
    expect(result).toMatchObject({ ok: false, code: "unknown" });
  });

  it("maps picker cancellation to cancelled", async () => {
    const result = await service({ showOpenFilePicker: async () => { throw abortError(); } }).openProject();
    expect(result).toMatchObject({ ok: false, code: "cancelled" });
  });

  it("writes compact v3 JSON to a retained handle and never serializes the handle", async () => {
    const h = handle();
    const current: ProjectDocumentRef = { displayName: "real.pindou", writable: true, handle: h.value };
    const result = await service({}).saveProject(project(), current);

    expect(result).toEqual({ ok: true, value: current });
    expect(h.write).toHaveBeenCalledOnce();
    const text = h.write.mock.calls[0][0] as unknown as string;
    expect(JSON.parse(text)).toMatchObject({ version: 3, canvasData: [[7]], layers: [{ data: [[7]] }] });
    expect(text).not.toContain("real.pindou");
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("requests readwrite permission when query returns prompt", async () => {
    const h = handle({ permission: "prompt", requestPermission: "granted" });
    const result = await service({}).saveProject(project(), { displayName: h.value.name, writable: true, handle: h.value });
    expect(result.ok).toBe(true);
    expect((h.value as any).requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
  });

  it("requests permission for any non-granted state and returns permission-denied when refused", async () => {
    const h = handle({ permission: "denied", requestPermission: "denied" });
    const result = await service({}).saveProject(project(), { displayName: h.value.name, writable: true, handle: h.value });
    expect(result).toMatchObject({ ok: false, code: "permission-denied" });
    expect((h.value as any).requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
    expect((h.value as any).createWritable).not.toHaveBeenCalled();
  });

  it("recovers when a denied query is granted by the permission request", async () => {
    const h = handle({ permission: "denied", requestPermission: "granted" });
    const result = await service({}).saveProject(project(), { displayName: h.value.name, writable: true, handle: h.value });
    expect(result.ok).toBe(true);
    expect(h.write).toHaveBeenCalledOnce();
  });

  it.each([
    ["createWritable", { createError: new Error("create") }],
    ["write", { writeError: new Error("write") }],
    ["close", { closeError: new Error("close") }],
  ])("reports %s failure as unknown", async (name, options) => {
    const h = handle(options);
    const result = await service({}).saveProject(project(), { displayName: h.value.name, writable: true, handle: h.value });
    expect(result).toMatchObject({ ok: false, code: "unknown" });
    if (name !== "createWritable") expect(h.abort).toHaveBeenCalledOnce();
  });

  it("preserves the original write error when best-effort abort also fails", async () => {
    const h = handle({ writeError: new Error("original write") });
    h.abort.mockRejectedValue(new Error("abort failed"));
    const result = await service({}).saveProject(project(), { displayName: h.value.name, writable: true, handle: h.value });
    expect(result).toMatchObject({ ok: false, code: "unknown", cause: expect.objectContaining({ message: "original write" }) });
  });

  it("serializes writes across distinct handles that may represent the same file", async () => {
    let finishFirst!: () => void;
    const writes: number[] = [];
    const firstHandle = handle({ name: "same.pindou" });
    const secondHandle = handle({ name: "same.pindou" });
    (firstHandle.value.createWritable as ReturnType<typeof vi.fn>).mockResolvedValue({
      write: async (text: string) => { writes.push(JSON.parse(text).canvasData[0][0]); await new Promise<void>((resolve) => { finishFirst = resolve; }); },
      close: vi.fn(), abort: vi.fn(),
    });
    (secondHandle.value.createWritable as ReturnType<typeof vi.fn>).mockResolvedValue({
      write: async (text: string) => { writes.push(JSON.parse(text).canvasData[0][0]); },
      close: vi.fn(), abort: vi.fn(),
    });
    const svc = service({});
    const first = svc.saveProject(project(1), { displayName: "same.pindou", writable: true, handle: firstHandle.value });
    const second = svc.saveProject(project(2), { displayName: "same.pindou", writable: true, handle: secondHandle.value });
    await vi.waitFor(() => expect(writes).toEqual([1]));
    finishFirst();
    await Promise.all([first, second]);
    expect(writes).toEqual([1, 2]);
  });

  it("snapshots a queued project's nested data at enqueue time", async () => {
    let finishFirst!: () => void;
    const writes: string[] = [];
    const h = handle();
    (h.value.createWritable as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ write: async () => { await new Promise<void>((resolve) => { finishFirst = resolve; }); }, close: vi.fn(), abort: vi.fn() })
      .mockResolvedValueOnce({ write: async (text: string) => { writes.push(text); }, close: vi.fn(), abort: vi.fn() });
    const svc = service({});
    const ref = { displayName: h.value.name, writable: true, handle: h.value };
    const first = svc.saveProject(project(1), ref);
    const queued = project(2);
    const second = svc.saveProject(queued, ref);
    queued.canvasData[0][0].colorIndex = 9;
    queued.layers![0].data[0][0].colorIndex = 9;
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    finishFirst();
    await Promise.all([first, second]);
    expect(JSON.parse(writes[0])).toMatchObject({ canvasData: [[2]], layers: [{ data: [[2]] }] });
  });

  it("serializes writes to the same handle and continues after a failed write", async () => {
    let finishFirst!: () => void;
    const writes: string[] = [];
    const h = handle();
    (h.value.createWritable as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ write: async (text: string) => { writes.push(text); await new Promise<void>((resolve) => { finishFirst = resolve; }); }, close: vi.fn(), abort: vi.fn() })
      .mockResolvedValueOnce({ write: async (text: string) => { writes.push(text); }, close: vi.fn(), abort: vi.fn() });
    const svc = service({});
    const ref = { displayName: h.value.name, writable: true, handle: h.value };
    const first = svc.saveProject(project(1), ref);
    const second = svc.saveProject(project(2), ref);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    finishFirst();
    await Promise.all([first, second]);
    expect(writes.map((text) => JSON.parse(text).canvasData[0][0])).toEqual([1, 2]);

    (h.value.createWritable as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ write: async () => { throw new Error("fail"); }, close: vi.fn(), abort: vi.fn() })
      .mockResolvedValueOnce({ write: async (text: string) => { writes.push(text); }, close: vi.fn(), abort: vi.fn() });
    await Promise.all([svc.saveProject(project(3), ref), svc.saveProject(project(4), ref)]);
    expect(JSON.parse(writes.at(-1)!).canvasData[0][0]).toBe(4);
  });

  it("maps save-as picker AbortError to cancelled", async () => {
    const result = await service({ showSaveFilePicker: async () => { throw abortError(); } })
      .saveProjectAs(project(), "cancelled.pindou");
    expect(result).toMatchObject({ ok: false, code: "cancelled" });
  });

  it("uses save picker for save-as and retains the new handle", async () => {
    const h = handle({ name: "chosen.pindou" });
    const picker = vi.fn(async () => h.value);
    const result = await service({ showSaveFilePicker: picker }).saveProjectAs(project(), "suggested.pindou");
    expect(picker).toHaveBeenCalledWith({
      suggestedName: "suggested.pindou",
      types: [{ description: "PinDou Project", accept: { "application/json": [".pindou"] } }],
    });
    expect(result.ok && result.value.handle).toBe(h.value);
  });

  it("falls back to injected file input for open", async () => {
    const picked = { name: "fallback.pindou", text: async () => JSON.stringify(project(4)) } as File;
    const result = await service({ pickFile: async () => picked }).openProject();
    expect(result).toMatchObject({ ok: true, value: { project: { canvasData: [[{ colorIndex: 4 }]] }, document: { displayName: "fallback.pindou", writable: false, fallbackDownloadName: "fallback.pindou" } } });
    if (result.ok) expect(result.value.document.handle).toBeUndefined();
  });

  it("routes a document without a handle through fallback download", async () => {
    const download = vi.fn(async () => {});
    const ref = { displayName: "download.pindou", writable: false, fallbackDownloadName: "download.pindou" };
    const result = await service({}, download).saveProject(project(), ref);
    expect(result).toEqual({ ok: true, value: ref });
    expect(download).toHaveBeenCalledOnce();
  });

  it("downloads a v3 blob without serializing the document handle", async () => {
    let downloaded!: Blob;
    const download = vi.fn(async (blob: Blob) => { downloaded = blob; });
    const h = handle();
    const value = { ...project(), transient: { handle: h.value } } as ProjectFile;
    await service({}, download).saveProjectAs(value, "fallback.pindou");
    const parsed = JSON.parse(await downloaded.text());
    expect(parsed).toMatchObject({ version: 3, canvasData: [[7]] });
    expect(JSON.stringify(parsed)).not.toContain("real.pindou");
  });

  it("returns success from fallback save only after the download sink resolves", async () => {
    let release!: () => void;
    const download = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const pending = service({}, download).saveProjectAs(project(), "fallback.pindou");
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    const result = await pending;
    expect(result).toEqual({ ok: true, value: { displayName: "fallback.pindou", writable: false, fallbackDownloadName: "fallback.pindou" } });
    expect(download).toHaveBeenCalledWith(expect.any(Blob), "fallback.pindou");
  });

  it("maps fallback download rejection to unknown", async () => {
    const result = await service({}, async () => { throw new Error("download failed"); }).saveProjectAs(project(), "fallback.pindou");
    expect(result).toMatchObject({ ok: false, code: "unknown" });
  });

  it("cleans up the input after the picker emits cancel", async () => {
    const remove = vi.fn();
    const append = vi.fn();
    const input = {
      type: "",
      accept: "",
      files: null,
      style: { display: "" },
      onchange: null,
      oncancel: null,
      click: vi.fn(function (this: { oncancel: null | (() => void) }) { this.oncancel?.(); }),
      remove,
    };
    const target = {
      document: { createElement: () => input, body: { appendChild: append } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: (callback: () => void) => { callback(); return 1; },
      clearTimeout: vi.fn(),
    } as unknown as Window;
    const result = await new BrowserProjectFileService(createBrowserFileApi(target), vi.fn()).openProject();
    expect(result).toMatchObject({ ok: false, code: "cancelled" });
    expect(input.onchange).toBeNull();
    expect(input.oncancel).toBeNull();
    expect(remove).toHaveBeenCalledOnce();
  });

  it.each(["append", "click"])("cleans input resources when %s throws synchronously", async (stage) => {
    const input = { type: "", accept: "", files: null, style: { display: "" }, onchange: null, oncancel: null, remove: vi.fn(), click: vi.fn() };
    if (stage === "click") input.click.mockImplementation(() => { throw new Error("click failed"); });
    const target = {
      document: {
        createElement: () => input,
        body: { appendChild: vi.fn(() => { if (stage === "append") throw new Error("append failed"); }) },
      },
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as Window;
    const result = await new BrowserProjectFileService(createBrowserFileApi(target, {
      window: target, schedule: vi.fn(), cancelSchedule: vi.fn(), supportsCancelEvent: true,
    }), vi.fn()).openProject();
    expect(result).toMatchObject({ ok: false, code: "unknown" });
    expect(input.remove).toHaveBeenCalledOnce();
    expect(input.onchange).toBeNull();
    expect(input.oncancel).toBeNull();
  });

  it("revokes download URL when createElement throws", async () => {
    const originalDocument = globalThis.document;
    const originalUrl = globalThis.URL;
    const revoke = vi.fn();
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => { throw new Error("create failed"); } } });
    Object.defineProperty(globalThis, "URL", { configurable: true, value: { createObjectURL: () => "blob:x", revokeObjectURL: revoke } });
    await expect(browserDownloadSink(new Blob(["x"]), "x.pindou")).rejects.toThrow("create failed");
    expect(revoke).toHaveBeenCalledWith("blob:x");
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, "URL", { configurable: true, value: originalUrl });
  });

  it("does not schedule focus cancellation when the input supports cancel events", async () => {
    const input = { type: "", accept: "", files: null, style: { display: "" }, onchange: null, oncancel: null, click: vi.fn(), remove: vi.fn() };
    const schedule = vi.fn();
    const target = { document: { createElement: () => input, body: { appendChild: vi.fn() } }, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Window;
    const api = createBrowserFileApi(target, { window: target, schedule, cancelSchedule: vi.fn(), supportsCancelEvent: true, focusCancelDelayMs: 700 });
    const pending = new BrowserProjectFileService(api, vi.fn()).openProject();
    expect(target.addEventListener).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    input.oncancel?.(new Event("cancel"));
    await pending;
  });

  it("keeps only the latest focus timer and lets change win before it fires", async () => {
    let focus!: () => void;
    let nextId = 0;
    const callbacks = new Map<number, () => void>();
    const schedule = vi.fn((callback: () => void) => { callbacks.set(++nextId, callback); return nextId; });
    const cancelSchedule = vi.fn((id: number) => callbacks.delete(id));
    const picked = { name: "picked.pindou", text: async () => JSON.stringify(project()) } as File;
    const input = { type: "", accept: "", files: null as FileList | null, style: { display: "" }, onchange: null, click: vi.fn(), remove: vi.fn() };
    const target = {
      document: { createElement: () => input, body: { appendChild: vi.fn() } },
      addEventListener: vi.fn((_type: string, listener: () => void) => { focus = listener; }),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const api = createBrowserFileApi(target, { window: target, schedule, cancelSchedule, supportsCancelEvent: false, focusCancelDelayMs: 700 });
    const pending = new BrowserProjectFileService(api, vi.fn()).openProject();
    focus();
    const oldCallback = callbacks.get(1)!;
    focus();
    expect(cancelSchedule).toHaveBeenCalledWith(1);
    input.files = { 0: picked, length: 1, item: () => picked } as FileList;
    input.onchange?.(new Event("change"));
    expect((await pending).ok).toBe(true);
    oldCallback();
    expect(input.remove).toHaveBeenCalledOnce();
    expect(target.removeEventListener).toHaveBeenCalledWith("focus", focus);
    expect(callbacks.size).toBe(0);
  });
});

describe("editor store project document semantics", () => {
  beforeEach(() => {
    resetPlatformServicesForTest();
    localStorage.clear();
    useEditorStore.getState().newCanvas(1, 1);
  });

  function install(projectFiles: ProjectFileService) {
    const services = createLegacyPlatformServices({} as PlatformAdapter, createBrowserCapabilities("chrome", true));
    setPlatformServices({ ...services, projectFiles });
  }

  it("does not replace the current dirty project when open fails", async () => {
    useEditorStore.getState().setCell(0, 0, 9);
    const before = useEditorStore.getState().canvasData;
    install({ openProject: async () => ({ ok: false, code: "invalid-data" }), saveProject: vi.fn(), saveProjectAs: vi.fn(), exportProject: vi.fn() });
    await useEditorStore.getState().openProject();
    expect(useEditorStore.getState()).toMatchObject({ isDirty: true, projectDocument: null });
    expect(useEditorStore.getState().canvasData).toBe(before);
  });

  it("saves through retained document and clears dirty only on success", async () => {
    const document = { displayName: "retained.pindou", writable: true };
    const saveProject = vi.fn(async () => ({ ok: true as const, value: document }));
    install({ openProject: vi.fn(), saveProject, saveProjectAs: vi.fn(), exportProject: vi.fn() });
    useEditorStore.setState({ projectDocument: document, projectPath: document.displayName, isDirty: true });
    await useEditorStore.getState().saveProject();
    expect(saveProject).toHaveBeenCalledWith(expect.any(Object), document);
    expect(useEditorStore.getState()).toMatchObject({ projectDocument: document, projectPath: "retained.pindou", isDirty: false });
  });

  it("routes save without a document to save-as and keeps dirty on cancellation", async () => {
    const saveProjectAs = vi.fn(async () => ({ ok: false as const, code: "cancelled" as const }));
    install({ openProject: vi.fn(), saveProject: vi.fn(), saveProjectAs, exportProject: vi.fn() });
    useEditorStore.setState({ projectDocument: null, projectPath: null, isDirty: true });
    await useEditorStore.getState().saveProject();
    expect(saveProjectAs).toHaveBeenCalledOnce();
    expect(useEditorStore.getState()).toMatchObject({ projectDocument: null, projectPath: null, isDirty: true });
  });

  it("keeps the old document identity when save-as is cancelled", async () => {
    const oldDocument = { displayName: "old.pindou", writable: true };
    install({ openProject: vi.fn(), saveProject: vi.fn(), saveProjectAs: async () => ({ ok: false, code: "cancelled" }), exportProject: vi.fn() });
    useEditorStore.setState({ projectDocument: oldDocument, projectPath: oldDocument.displayName, isDirty: true });
    await useEditorStore.getState().saveProjectAs();
    expect(useEditorStore.getState()).toMatchObject({ projectDocument: oldDocument, projectPath: "old.pindou", isDirty: true });
  });

  it("ignores an older save-as result that completes after a newer save-as", async () => {
    const first = { displayName: "first.pindou", writable: true };
    const second = { displayName: "second.pindou", writable: true };
    let finishFirst!: (value: { ok: true; value: typeof first }) => void;
    const saveProjectAs = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, value: second });
    install({ openProject: vi.fn(), saveProject: vi.fn(), saveProjectAs, exportProject: vi.fn() });
    useEditorStore.setState({ isDirty: true });
    const oldSave = useEditorStore.getState().saveProjectAs();
    await useEditorStore.getState().saveProjectAs();
    const afterNewSave = useEditorStore.getState();
    finishFirst({ ok: true, value: first });
    await oldSave;
    expect(useEditorStore.getState()).toMatchObject({
      projectPath: "second.pindou",
      projectDocument: second,
      lastSavedAt: afterNewSave.lastSavedAt,
      baselineCanvasData: afterNewSave.baselineCanvasData,
      isDirty: afterNewSave.isDirty,
    });
  });

  it("does not let an older save overwrite a project opened while it was pending", async () => {
    const oldDocument = { displayName: "old.pindou", writable: true };
    const openedDocument = { displayName: "opened.pindou", writable: true };
    let finishSave!: (value: { ok: true; value: typeof oldDocument }) => void;
    install({
      saveProject: vi.fn(() => new Promise((resolve) => { finishSave = resolve; })),
      saveProjectAs: vi.fn(),
      exportProject: vi.fn(),
      openProject: vi.fn(async () => ({ ok: true, value: { project: project(12), document: openedDocument } })),
    });
    useEditorStore.setState({ projectDocument: oldDocument, projectPath: oldDocument.displayName, isDirty: true });
    const saving = useEditorStore.getState().saveProject();
    await useEditorStore.getState().openProject();
    const afterOpen = useEditorStore.getState();
    finishSave({ ok: true, value: oldDocument });
    await saving;
    expect(useEditorStore.getState()).toMatchObject({
      projectPath: "opened.pindou",
      projectDocument: openedDocument,
      lastSavedAt: afterOpen.lastSavedAt,
      baselineCanvasData: afterOpen.baselineCanvasData,
      isDirty: afterOpen.isDirty,
    });
  });

  it("invalidates a pending save-as when a new canvas replaces the document", async () => {
    const staleDocument = { displayName: "stale.pindou", writable: true };
    let finish!: (value: { ok: true; value: typeof staleDocument }) => void;
    install({
      openProject: vi.fn(),
      saveProject: vi.fn(),
      saveProjectAs: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
      exportProject: vi.fn(),
    });
    useEditorStore.setState({ isDirty: true });
    const pending = useEditorStore.getState().saveProjectAs();
    useEditorStore.getState().newCanvas(3, 4);
    const newCanvasState = useEditorStore.getState();
    finish({ ok: true, value: staleDocument });
    await pending;
    expect(useEditorStore.getState()).toMatchObject({
      canvasSize: { width: 3, height: 4 },
      projectPath: null,
      projectDocument: null,
      lastSavedAt: newCanvasState.lastSavedAt,
      baselineCanvasData: newCanvasState.baselineCanvasData,
      isDirty: newCanvasState.isDirty,
    });
  });

  it("keeps edits made while a save is pending dirty", async () => {
    const document = { displayName: "slow.pindou", writable: true };
    let finish!: (value: { ok: true; value: typeof document }) => void;
    const pending = new Promise<{ ok: true; value: typeof document }>((resolve) => { finish = resolve; });
    install({ openProject: vi.fn(), saveProject: vi.fn(async () => pending), saveProjectAs: vi.fn(), exportProject: vi.fn() });
    useEditorStore.setState({ projectDocument: document, projectPath: document.displayName, isDirty: true });
    const saving = useEditorStore.getState().saveProject();
    useEditorStore.getState().setCell(0, 0, 11);
    finish({ ok: true, value: document });
    await saving;
    expect(useEditorStore.getState().isDirty).toBe(true);
  });
});
