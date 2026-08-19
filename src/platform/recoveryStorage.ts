import type { SnapshotInfo } from "../adapters";
import type { ProjectFile } from "../types";
import type { PlatformResult } from "./result";
import type { ServiceAvailability } from "./services";

export interface LoadedSnapshot {
  project: ProjectFile;
  sourceProjectId?: string;
}

export interface RecoveryStorage {
  readonly availability: ServiceAvailability;
  saveAutosave(project: ProjectFile): Promise<PlatformResult<void>>;
  loadAutosave(): Promise<PlatformResult<ProjectFile | null>>;
  clearAutosave?(): Promise<PlatformResult<void>>;
  saveSnapshot(project: ProjectFile, label: string, sourceProjectId?: string): Promise<PlatformResult<SnapshotInfo>>;
  listSnapshots(): Promise<PlatformResult<SnapshotInfo[]>>;
  loadSnapshot(id: string): Promise<PlatformResult<LoadedSnapshot | ProjectFile>>;
  deleteSnapshot(id: string): Promise<PlatformResult<void>>;
}
