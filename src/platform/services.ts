import type { PlatformAdapter } from "../adapters";
import type { PlatformCapabilities } from "./capabilities";
import type { PlatformResult } from "./result";
import type { ProjectFile } from "../types";
import type { ProjectDocumentRef, ProjectFileService } from "./projectFileService";
import type { RecoveryStorage } from "./recoveryStorage";
import type { ImageImportService } from "./imageImportService";
import type { VoiceCommand } from "../hooks/useVoiceControl";
import { i18n } from "../i18n";
export type { ProjectDocumentRef, OpenedProject, ProjectFileService } from "./projectFileService";
export type { ImageImportAsset, ImageImportService, WebImageTask } from "./imageImportService";
export type { RecoveryStorage } from "./recoveryStorage";

export type ServiceAvailability = "available" | "legacy-adapter" | "unsupported";

class LegacyProjectFileService implements ProjectFileService {
  readonly #adapter: PlatformAdapter;

  constructor(adapter: PlatformAdapter) {
    this.#adapter = adapter;
  }

  async openProject() {
    try {
      const path = await this.#adapter.showOpenDialog([{ name: "PinDou Project", extensions: ["pindou"] }]);
      if (!path) return { ok: false as const, code: "cancelled" as const };
      const project = await this.#adapter.loadProject(path);
      return { ok: true as const, value: { project, document: { displayName: path, writable: true } } };
    } catch (cause) {
      return { ok: false as const, code: "unknown" as const, cause };
    }
  }

  async saveProject(project: ProjectFile, current: ProjectDocumentRef) {
    try {
      await this.#adapter.saveProject(current.displayName, project);
      return { ok: true as const, value: current };
    } catch (cause) {
      return { ok: false as const, code: "unknown" as const, cause };
    }
  }

  async saveProjectAs(project: ProjectFile, suggestedName: string) {
    try {
      const path = await this.#adapter.showSaveDialog(
        [{ name: "PinDou Project", extensions: ["pindou"] }],
        suggestedName,
      );
      if (!path) return { ok: false as const, code: "cancelled" as const };
      await this.#adapter.saveProject(path, project);
      return { ok: true as const, value: { displayName: path, writable: true } };
    } catch (cause) {
      return { ok: false as const, code: "unknown" as const, cause };
    }
  }

  async exportProject(project: ProjectFile, suggestedName: string) {
    try {
      const path = await this.#adapter.showSaveDialog(
        [{ name: "PinDou Project", extensions: ["pindou"] }],
        suggestedName,
      );
      if (!path) return { ok: false as const, code: "cancelled" as const };
      await this.#adapter.writeProjectFile(path, project);
      return { ok: true as const, value: undefined };
    } catch (cause) {
      return { ok: false as const, code: "unknown" as const, cause };
    }
  }
}

export interface ImageService {
  readonly availability: ServiceAvailability;
  chooseLocalImage(): Promise<PlatformResult<import("./imageImportService").ImageImportAsset>>;
  /** Transitional image selection until dialogs move out of the adapter. */
  showOpenDialog: PlatformAdapter["showOpenDialog"];
  previewImage: PlatformAdapter["previewImage"];
  importImage: PlatformAdapter["importImage"];
  readFileBase64: PlatformAdapter["readFileBase64"];
  exportImage: PlatformAdapter["exportImage"];
  exportPreview: PlatformAdapter["exportPreview"];
  importBlueprint: PlatformAdapter["importBlueprint"];
  detectBlueprintDims: PlatformAdapter["detectBlueprintDims"];
}

export type RecoveryService = RecoveryStorage;

export interface GitHubSession {
  authenticated: true;
  login: string;
}

export interface GistProject {
  gistId: string;
  name: string;
  description: string;
  updatedAt: string;
  isPublic: boolean;
}

export interface GistUploadResult {
  gistId: string;
  updatedAt: string;
  version: string;
}
export interface GistMetadata { updatedAt: string; version: string; etag?: string }

export interface DownloadedGistProject extends GistUploadResult {
  name: string;
  project: ProjectFile;
}

export interface GistRevision {
  sha: string;
  committedAt: string;
}

export interface DeviceCodeInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type DeviceFlowStatus = "authorization-pending" | "slow-down" | "authorized" | "expired" | "denied" | "retrying";

export interface GitHubService {
  readonly availability: ServiceAvailability;
  getSession(): Promise<PlatformResult<GitHubSession | null>>;
  restore?(): Promise<PlatformResult<GitHubSession | null>>;
  subscribe?(listener: (session: GitHubSession | null) => void): () => void;
  readonly configured?: boolean;
  login(): Promise<PlatformResult<GitHubSession>>;
  startDeviceFlow?(signal: AbortSignal): Promise<PlatformResult<DeviceCodeInfo>>;
  pollDeviceFlow?(info: DeviceCodeInfo, onStatus: (status: DeviceFlowStatus) => void, signal: AbortSignal): Promise<PlatformResult<GitHubSession>>;
  logout(): Promise<PlatformResult<void>>;
  listProjects(): Promise<PlatformResult<GistProject[]>>;
  uploadProject(name: string, project: ProjectFile, gistId?: string, expectedVersion?: string): Promise<PlatformResult<GistUploadResult>>;
  downloadProject(gistId: string, revision?: string): Promise<PlatformResult<DownloadedGistProject>>;
  getProjectMetadata(gistId: string): Promise<PlatformResult<GistMetadata>>;
  getProjectUpdatedAt(gistId: string): Promise<PlatformResult<string>>;
  deleteProject(gistId: string): Promise<PlatformResult<void>>;
  listRevisions?(gistId: string): Promise<PlatformResult<GistRevision[]>>;
}

export interface VoiceEnhancementResult {
  command: VoiceCommand;
  enhanced: boolean;
  repeat?: number;
  gotoCol?: number;
  gotoRow?: number;
}

export interface VoiceEnhancementService {
  interpret(transcript: string): Promise<VoiceEnhancementResult>;
}

export interface StorageService {
  readonly availability: ServiceAvailability;
  get<T>(key: string): Promise<PlatformResult<T | undefined>>;
  set(key: string, value: unknown): Promise<PlatformResult<void>>;
  remove(key: string): Promise<PlatformResult<void>>;
}

export interface LocaleService {
  getSystemLanguage(): Promise<PlatformResult<string>>;
}

export interface ExternalLinkService {
  readonly availability: ServiceAvailability;
  open(url: string): Promise<PlatformResult<void>>;
}

export interface WindowService {
  setTitle(title: string): void;
  installDirtyCloseGuard(isDirty: () => boolean): () => void;
}

export interface PlatformServices {
  readonly capabilities: PlatformCapabilities;
  readonly projectFiles: ProjectFileService;
  readonly images: ImageService;
  readonly imageImports: ImageImportService;
  readonly github: GitHubService;
  readonly voiceEnhancement?: VoiceEnhancementService;
  readonly recovery: RecoveryService;
  readonly storage: StorageService;
  readonly locale: LocaleService;
  readonly externalLinks: ExternalLinkService;
  readonly window?: WindowService;
}

function unsupported<T>(service: string): PlatformResult<T> {
  return {
    ok: false,
    code: "unsupported",
    message: `${service} has not been migrated to platform services`,
  };
}

/**
 * Transitional boundary. Domain-specific facades delegate only their own
 * existing adapter methods; unsupported services cannot be mistaken for live ones.
 */
export function createLegacyPlatformServices(
  adapter: PlatformAdapter,
  capabilities: PlatformCapabilities,
): PlatformServices {
  return {
    capabilities,
    projectFiles: new LegacyProjectFileService(adapter),
    images: {
      availability: "legacy-adapter",
      chooseLocalImage: async () => {
        try {
          const path = await adapter.showOpenDialog([{ name: i18n.t("import.image.fileFilter"), extensions: ["png", "jpg", "jpeg", "bmp", "gif", "webp"] }]);
          if (!path) return { ok: false, code: "cancelled" };
          return { ok: false, code: "unsupported", message: "Legacy adapter does not expose File objects" };
        } catch (cause) { return { ok: false, code: "unknown", cause }; }
      },
      showOpenDialog: (...args) => adapter.showOpenDialog(...args),
      previewImage: (...args) => adapter.previewImage(...args),
      importImage: (...args) => adapter.importImage(...args),
      readFileBase64: (...args) => adapter.readFileBase64(...args),
      exportImage: (...args) => adapter.exportImage(...args),
      exportPreview: (...args) => adapter.exportPreview(...args),
      importBlueprint: (...args) => adapter.importBlueprint(...args),
      detectBlueprintDims: (...args) => adapter.detectBlueprintDims(...args),
    },
    imageImports: {
      chooseLocalImage: async () => unsupported("Image import"),
      fetchWebImage: async () => unsupported("Web image import"),
      getAsset: () => undefined,
      consumeAsset: () => {},
    },
    recovery: {
      availability: "legacy-adapter",
      saveAutosave: async (project) => {
        try {
          const dir = await adapter.getAutosaveDir();
          await adapter.saveProject(`${dir}\\autosave.pindou`, project);
          return { ok: true, value: undefined };
        } catch (cause) { return { ok: false, code: "unknown", cause }; }
      },
      loadAutosave: async () => ({ ok: false, code: "unsupported" }),
      clearAutosave: adapter.clearAutosave ? async () => {
        try { await adapter.clearAutosave!(); return { ok: true, value: undefined }; }
        catch (cause) { return { ok: false, code: "unknown", cause }; }
      } : undefined,
      saveSnapshot: async (project, label, sourceProjectId) => {
        try {
          await adapter.saveSnapshot(project, label, sourceProjectId);
          return { ok: true, value: { path: "", name: label, modified: new Date().toISOString(), sourceProjectId } };
        } catch (cause) { return { ok: false, code: "unknown", cause }; }
      },
      listSnapshots: async () => {
        try { return { ok: true, value: await adapter.listSnapshots() }; }
        catch (cause) { return { ok: false, code: "unknown", cause }; }
      },
      loadSnapshot: async (id) => {
        try { return { ok: true, value: await adapter.loadSnapshot(id) }; }
        catch (cause) { return { ok: false, code: "unknown", cause }; }
      },
      deleteSnapshot: async (id) => {
        try { await adapter.deleteSnapshot(id); return { ok: true, value: undefined }; }
        catch (cause) { return { ok: false, code: "unknown", cause }; }
      },
    },
    github: {
      availability: "unsupported",
      getSession: async () => unsupported("GitHub session"),
      login: async () => unsupported("GitHub login"),
      logout: async () => unsupported("GitHub logout"),
      listProjects: async () => unsupported("Gist listing"),
      uploadProject: async (_name, _project, _gistId) => unsupported("Gist upload"),
      downloadProject: async (_id, _revision) => unsupported("Gist download"),
      getProjectMetadata: async (_id) => unsupported("Gist metadata"),
      getProjectUpdatedAt: async (_id) => unsupported("Gist metadata"),
      deleteProject: async (_id) => unsupported("Gist deletion"),
    },
    storage: {
      availability: "unsupported",
      get: async <T>(_key: string) => unsupported<T | undefined>("Storage"),
      set: async (_key, _value) => unsupported<void>("Storage"),
      remove: async (_key) => unsupported<void>("Storage"),
    },
    locale: {
      getSystemLanguage: async () => unsupported<string>("Locale"),
    },
    externalLinks: {
      availability: "unsupported",
      open: async (_url) => unsupported<void>("External links"),
    },
  };
}
