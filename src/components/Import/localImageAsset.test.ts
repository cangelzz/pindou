import { describe, expect, it, vi } from "vitest";
import { loadLocallySelectedImage } from "./loadLocallySelectedImage";
import type { ImageImportAsset } from "../../platform/imageImportService";

const asset: ImageImportAsset = {
  id: "local-1",
  file: new File(["image"], "cat.png", { type: "image/png" }),
  displayName: "cat.png",
  source: "local",
};

function fixture(previewImage: () => Promise<unknown>) {
  const images = { chooseLocalImage: vi.fn(async () => ({ ok: true as const, value: asset })) };
  const imageImports = { consumeAsset: vi.fn() };
  const adapter = { setImageImportFile: vi.fn(), previewImage: vi.fn(previewImage) };
  return { images, imageImports, adapter };
}

describe("loadLocallySelectedImage", () => {
  it("releases the selected asset exactly once after preview succeeds", async () => {
    const f = fixture(async () => ({ original_width: 1 }));
    await expect(loadLocallySelectedImage(f.images as never, f.imageImports as never, f.adapter as never))
      .resolves.toMatchObject({ displayName: "cat.png", preview: { original_width: 1 } });
    expect(f.adapter.setImageImportFile).toHaveBeenCalledWith(asset.file);
    expect(f.imageImports.consumeAsset).toHaveBeenCalledTimes(1);
    expect(f.imageImports.consumeAsset).toHaveBeenCalledWith(asset.id);
  });

  it("releases the selected asset exactly once when preview fails", async () => {
    const f = fixture(async () => { throw new Error("decode failed"); });
    await expect(loadLocallySelectedImage(f.images as never, f.imageImports as never, f.adapter as never))
      .rejects.toThrow("decode failed");
    expect(f.imageImports.consumeAsset).toHaveBeenCalledTimes(1);
    expect(f.imageImports.consumeAsset).toHaveBeenCalledWith(asset.id);
  });
});
