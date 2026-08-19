export function createInitialAssetRelease(
  assetId: string,
  onReleased: (assetId: string) => void,
): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    onReleased(assetId);
  };
}
