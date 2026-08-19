import type { ProjectFile } from "../../src/types";
import type {
  OpenedProject,
  ProjectDocumentRef,
  ProjectFileService,
} from "../../src/platform/projectFileService";
import type { PlatformResult } from "../../src/platform/result";
import { normalizeProjectFromDisk, serializeProjectToV3 } from "../../src/utils/projectSerialization";

const PROJECT_PICKER_OPTIONS: Pick<FilePickerOptions, "types"> = {
  types: [{ description: "PinDou Project", accept: { "application/json": [".pindou"] } }],
};

export interface BrowserFileApi {
  showOpenFilePicker?: (options: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  pickFile: (accept: string) => Promise<File | null>;
}

export type DownloadSink = (blob: Blob, filename: string) => Promise<void>;

function errorResult<T>(error: unknown, invalidData = false): PlatformResult<T> {
  if (error instanceof Error && error.name === "AbortError") {
    return { ok: false, code: "cancelled", cause: error };
  }
  if (invalidData && (error instanceof SyntaxError || error instanceof Error)) {
    return { ok: false, code: "invalid-data", cause: error };
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return { ok: false, code: "permission-denied", cause: error };
  }
  return { ok: false, code: "unknown", cause: error };
}

async function writeHandle(
  handle: FileSystemFileHandle,
  serializedProject: string,
): Promise<PlatformResult<void>> {
  let writable: FileSystemWritableFileStream | undefined;
  try {
    const permission = await handle.queryPermission({ mode: "readwrite" });
    const finalPermission = permission === "granted"
      ? permission
      : await handle.requestPermission({ mode: "readwrite" });
    if (finalPermission !== "granted") return { ok: false, code: "permission-denied" };
    writable = await handle.createWritable();
    await writable.write(serializedProject);
    await writable.close();
    return { ok: true, value: undefined };
  } catch (error) {
    if (writable) {
      try { await writable.abort(); } catch { /* preserve original error */ }
    }
    return errorResult(error);
  }
}

export class BrowserProjectFileService implements ProjectFileService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: BrowserFileApi,
    private readonly download: DownloadSink,
  ) {}

  private queueWrite(handle: FileSystemFileHandle, project: ProjectFile): Promise<PlatformResult<void>> {
    const serializedProject = serializeProjectToV3(project);
    const operation = this.writeQueue.catch(() => {}).then(() => writeHandle(handle, serializedProject));
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async openProject(): Promise<PlatformResult<OpenedProject>> {
    try {
      let file: File;
      let document: ProjectDocumentRef;
      if (this.api.showOpenFilePicker) {
        const [handle] = await this.api.showOpenFilePicker({ ...PROJECT_PICKER_OPTIONS, multiple: false });
        if (!handle) return { ok: false, code: "cancelled" };
        file = await handle.getFile();
        document = { displayName: handle.name, writable: true, handle };
      } else {
        const picked = await this.api.pickFile(".pindou,application/json");
        if (!picked) return { ok: false, code: "cancelled" };
        file = picked;
        document = {
          displayName: picked.name,
          writable: false,
          fallbackDownloadName: picked.name,
        };
      }
      let rawJson: string;
      try {
        rawJson = await file.text();
      } catch (error) {
        return errorResult(error);
      }
      try {
        return { ok: true, value: { project: normalizeProjectFromDisk(rawJson), document } };
      } catch (error) {
        return errorResult(error, true);
      }
    } catch (error) {
      return errorResult(error);
    }
  }

  async saveProject(
    project: ProjectFile,
    current: ProjectDocumentRef,
  ): Promise<PlatformResult<ProjectDocumentRef>> {
    if (!current.handle) {
      return this.saveProjectAs(project, current.fallbackDownloadName ?? current.displayName);
    }
    const result = await this.queueWrite(current.handle, project);
    return result.ok ? { ok: true, value: current } : result;
  }

  async saveProjectAs(
    project: ProjectFile,
    suggestedName: string,
  ): Promise<PlatformResult<ProjectDocumentRef>> {
    try {
      if (this.api.showSaveFilePicker) {
        const handle = await this.api.showSaveFilePicker({ ...PROJECT_PICKER_OPTIONS, suggestedName });
        const result = await this.queueWrite(handle, project);
        return result.ok
          ? { ok: true, value: { displayName: handle.name, writable: true, handle } }
          : result;
      }
      const serializedProject = serializeProjectToV3(project);
      await this.download(
        new Blob([serializedProject], { type: "application/json" }),
        suggestedName,
      );
      return {
        ok: true,
        value: { displayName: suggestedName, writable: false, fallbackDownloadName: suggestedName },
      };
    } catch (error) {
      return errorResult(error);
    }
  }

  async exportProject(project: ProjectFile, suggestedName: string): Promise<PlatformResult<void>> {
    const result = await this.saveProjectAs(project, suggestedName);
    return result.ok ? { ok: true, value: undefined } : result;
  }
}

export interface FilePickerEnvironment {
  window: Window;
  schedule(callback: () => void, delayMs: number): number;
  cancelSchedule(id: number): void;
  supportsCancelEvent?: boolean;
  focusCancelDelayMs?: number;
}

export function createBrowserFileApi(
  target: Window = window,
  environment: FilePickerEnvironment = {
    window: target,
    schedule: (callback, delayMs) => target.setTimeout(callback, delayMs),
    cancelSchedule: (id) => target.clearTimeout(id),
  },
): BrowserFileApi {
  const pickerWindow = target as Window & {
    showOpenFilePicker?: BrowserFileApi["showOpenFilePicker"];
    showSaveFilePicker?: BrowserFileApi["showSaveFilePicker"];
  };
  return {
    showOpenFilePicker: pickerWindow.showOpenFilePicker?.bind(target),
    showSaveFilePicker: pickerWindow.showSaveFilePicker?.bind(target),
    pickFile: (accept) => new Promise((resolve) => {
      const input = target.document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.style.display = "none";
      let settled = false;
      let focusTimer: number | null = null;
      const supportsCancelEvent = environment.supportsCancelEvent ?? ("oncancel" in input);
      const onFocus = () => {
        if (focusTimer !== null) environment.cancelSchedule(focusTimer);
        focusTimer = environment.schedule(
          () => finish(input.files?.[0] ?? null),
          environment.focusCancelDelayMs ?? 700,
        );
      };
      const cleanup = () => {
        input.onchange = null;
        input.oncancel = null;
        environment.window.removeEventListener("focus", onFocus);
        if (focusTimer !== null) environment.cancelSchedule(focusTimer);
        input.remove();
      };
      const finish = (file: File | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(file);
      };
      try {
        input.onchange = () => finish(input.files?.[0] ?? null);
        input.oncancel = supportsCancelEvent ? () => finish(null) : null;
        if (!supportsCancelEvent) environment.window.addEventListener("focus", onFocus);
        target.document.body.appendChild(input);
        input.click();
      } catch (error) {
        if (!settled) {
          settled = true;
          cleanup();
        }
        throw error;
      }
    }),
  };
}

export const browserDownloadSink: DownloadSink = async (blob, filename) => {
  const url = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    URL.revokeObjectURL(url);
  }
};
