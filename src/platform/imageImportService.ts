import type { PlatformResult } from "./result";

export interface WebImageTask {
  id: string;
  imageUrl: string;
  pageUrl?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ImageImportAsset {
  id: string;
  file: File;
  displayName: string;
  source: "local" | "web-context-menu";
  sourcePageUrl?: string;
}

export interface ImageImportService {
  chooseLocalImage(): Promise<PlatformResult<ImageImportAsset>>;
  fetchWebImage(taskId: string): Promise<PlatformResult<ImageImportAsset>>;
  getAsset(id: string): ImageImportAsset | undefined;
  consumeAsset(id: string): void;
  acknowledgeTask?(id: string): Promise<PlatformResult<void>>;
  releaseTask?(id: string): Promise<PlatformResult<void>>;
  renewTask?(id: string): Promise<PlatformResult<void>>;
  listPendingTasks?(): Promise<PlatformResult<WebImageTask[]>>;
}
