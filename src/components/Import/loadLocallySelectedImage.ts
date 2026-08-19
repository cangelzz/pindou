import type { ImagePreview, PlatformAdapter } from "../../adapters";
import type { ImageImportService } from "../../platform/imageImportService";
import type { ImageService } from "../../platform/services";

type ImageFileAdapter = Pick<PlatformAdapter, "previewImage"> & { setImageImportFile(file: File): void };

export async function loadLocallySelectedImage(
  images: Pick<ImageService, "chooseLocalImage">,
  imageImports: Pick<ImageImportService, "consumeAsset">,
  adapter: ImageFileAdapter,
): Promise<{ displayName: string; preview: ImagePreview } | null> {
  const result = await images.chooseLocalImage();
  if (!result.ok) return null;
  const asset = result.value;
  try {
    adapter.setImageImportFile(asset.file);
    return { displayName: asset.displayName, preview: await adapter.previewImage(asset.displayName) };
  } finally {
    imageImports.consumeAsset(asset.id);
  }
}
