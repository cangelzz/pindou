let provider = (number: number) => `Layer ${number}`;

export function getCanonicalDefaultLayerName(number: number): string {
  return `Layer ${number}`;
}

export function getDefaultLayerName(number: number): string {
  return provider(number);
}

export function getLayerDisplayName(layer: { name: string; defaultNameIndex?: number }): string {
  return layer.defaultNameIndex === undefined ? layer.name : getDefaultLayerName(layer.defaultNameIndex);
}

export function getHistoricalDefaultLayerNameIndex(name: string): number | undefined {
  const match = /^(?:Layer|图层) (\d+)$/.exec(name);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function canonicalizeDefaultLayer<T extends { name: string; defaultNameIndex?: number; isDefaultName?: boolean }>(
  layer: T,
  fallbackIndex: number,
): T & { defaultNameIndex?: number } {
  const index = Number.isSafeInteger(layer.defaultNameIndex) && layer.defaultNameIndex! > 0
    ? layer.defaultNameIndex
    : getHistoricalDefaultLayerNameIndex(layer.name)
      ?? (layer.isDefaultName === true ? fallbackIndex : undefined);
  if (index === undefined) return { ...layer, defaultNameIndex: undefined };
  return { ...layer, name: getCanonicalDefaultLayerName(index), defaultNameIndex: index };
}

export function normalizeDefaultLayerPromptName(value: string, displayedDefault: string): string | undefined {
  const trimmed = value.trim();
  return !trimmed || trimmed === displayedDefault ? undefined : trimmed;
}

export function setDefaultLayerNameProvider(next: (number: number) => string): void {
  provider = next;
}
