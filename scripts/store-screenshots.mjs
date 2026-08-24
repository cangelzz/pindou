import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs/lib/png.js";

const { PNG } = pngjs;

export const STORE_SCREENSHOT_SCENARIOS = [
  { id: "editor", file: "01-editor.png", sample: "dinosaur-rex.pindou" },
  { id: "image-conversion", file: "02-image-conversion.png", sample: "dinosaur-triceratops.pindou" },
  { id: "layers", file: "03-layers.png", sample: "dinosaur-raptor.pindou" },
  { id: "export", file: "04-export.png", sample: "dinosaur-brachiosaurus.pindou" },
  { id: "cloud", file: "05-cloud.png", sample: "dinosaur-rex.pindou" },
];
export const STORE_SCREENSHOT_NAMES = STORE_SCREENSHOT_SCENARIOS.map(({ file }) => file);
export const STORE_SCREENSHOT_LOCALES = ["global/en", "localized/zh-CN"];
export const STORE_SCREENSHOT_SIDECAR_SUFFIX = ".metadata.json";

export function expectedStoreScreenshotPaths(root) { return STORE_SCREENSHOT_LOCALES.flatMap((locale) => STORE_SCREENSHOT_NAMES.map((name) => join(root, locale, name))); }
export function storeScreenshotSidecarPath(file) { const { dir, name } = parse(file); return join(dir, `${name}${STORE_SCREENSHOT_SIDECAR_SUFFIX}`); }
export function selectStoreScreenshotVisualBaseline(platform, committedPlatform, storeAssetsRoot, ciAssetsRoot) {
  return platform === committedPlatform ? storeAssetsRoot : join(ciAssetsRoot, platform);
}

function validateGeometry(geometry, width, height, file) {
  if (!geometry || typeof geometry !== "object" || Object.keys(geometry).length === 0) throw new Error(`Invalid screenshot metadata geometry: ${file}`);
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const rect = (key) => {
    const value = geometry[key];
    if (!value || typeof value !== "object" || !["x", "y", "width", "height"].every((field) => finite(value[field]))
      || value.width <= 0 || value.height <= 0 || value.x < 0 || value.y < 0
      || value.x + value.width > width || value.y + value.height > height) throw new Error(`Invalid screenshot metadata geometry ${key}: ${file}`);
    return value;
  };
  const canvas = rect("canvas"), artwork = rect("artwork"), panel = rect("panel");
  const transform = geometry.transform;
  if (!transform || typeof transform !== "object" || !["cellSize", "offsetX", "offsetY"].every((field) => finite(transform[field]))
    || transform.cellSize <= 0 || transform.offsetX < 0 || transform.offsetY < 0) throw new Error(`Invalid screenshot metadata geometry transform: ${file}`);
  if (artwork.x !== canvas.x + transform.offsetX || artwork.y !== canvas.y + transform.offsetY
    || artwork.x + artwork.width > canvas.x + canvas.width || artwork.y + artwork.height > canvas.y + canvas.height
    || panel.x < canvas.x + canvas.width) throw new Error(`Invalid screenshot metadata geometry relationship: ${file}`);
}

function hasPerceptualDifference(actualBytes, committedBytes) {
  const actual = PNG.sync.read(actualBytes), committed = PNG.sync.read(committedBytes);
  if (actual.width !== committed.width || actual.height !== committed.height) return true;
  const blockSize = 40;
  const blockColumns = Math.ceil(actual.width / blockSize);
  const blockSums = new Float64Array(blockColumns * Math.ceil(actual.height / blockSize));
  const blockCounts = new Uint32Array(blockSums.length);
  let totalDifference = 0, changedPixels = 0;
  const compositeChannel = (image, index, offset) => {
    const alpha = image.data[index + 3] / 255;
    return (image.data[index + offset] * alpha + 255 * (1 - alpha)) / 255;
  };
  for (let y = 0; y < actual.height; y++) for (let x = 0; x < actual.width; x++) {
    const index = (y * actual.width + x) * 4;
    let pixelDifference = 0;
    for (let offset = 0; offset < 3; offset++) pixelDifference += Math.abs(compositeChannel(actual, index, offset) - compositeChannel(committed, index, offset));
    pixelDifference /= 3;
    totalDifference += pixelDifference;
    if (pixelDifference > 0.08) changedPixels++;
    const block = Math.floor(y / blockSize) * blockColumns + Math.floor(x / blockSize);
    blockSums[block] += pixelDifference;
    blockCounts[block]++;
  }
  const pixels = actual.width * actual.height;
  const maxBlockMean = blockSums.reduce((maximum, sum, index) => Math.max(maximum, sum / blockCounts[index]), 0);
  return totalDifference / pixels > 0.03 || changedPixels / pixels > 0.01 || maxBlockMean > 0.12;
}

export function compareStoreScreenshots(actualRoot, committedRoot, { comparePixels = true } = {}) {
  const imageFiles = expectedStoreScreenshotPaths("");
  const metadata = imageFiles.map((file) => ({
    file,
    actual: JSON.parse(readFileSync(join(actualRoot, storeScreenshotSidecarPath(file)), "utf8")),
    committed: JSON.parse(readFileSync(join(committedRoot, storeScreenshotSidecarPath(file)), "utf8")),
  }));
  const changedImages = comparePixels
    ? imageFiles.filter((file) => hasPerceptualDifference(readFileSync(join(actualRoot, file)), readFileSync(join(committedRoot, file))))
    : [];
  const semanticMetadata = ({ sha256, renderPlatform, renderEnvironment, ...semantic }) => semantic;
  const changedMetadata = metadata
    .filter(({ actual, committed }) => JSON.stringify(semanticMetadata(actual)) !== JSON.stringify(semanticMetadata(committed)))
    .map(({ file }) => storeScreenshotSidecarPath(file));
  return [...changedImages, ...changedMetadata];
}

export function validateStoreScreenshots(root, { expectedPlatform } = {}) {
  const geometries = new Map();
  let renderPlatform;
  for (const localePath of STORE_SCREENSHOT_LOCALES) {
    const directory = join(root, localePath);
    const expectedLocale = localePath === "global/en" ? "en" : "zh-CN";
    if (!existsSync(directory)) throw new Error(`Screenshot directory missing: ${directory}`);
    const actual = readdirSync(directory).filter((name) => statSync(join(directory, name)).isFile()).sort();
    const expected = STORE_SCREENSHOT_NAMES.flatMap((name) => [name, `${parse(name).name}${STORE_SCREENSHOT_SIDECAR_SUFFIX}`]).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Screenshot set mismatch in ${directory}: expected exactly PNGs and metadata sidecars for ${STORE_SCREENSHOT_NAMES.join(", ")}`);
    for (const scenario of STORE_SCREENSHOT_SCENARIOS) {
      const file = join(directory, scenario.file);
      const bytes = readFileSync(file);
      let decoded;
      try { decoded = PNG.sync.read(bytes, { checkCRC: true }); }
      catch (error) { throw new Error(`Invalid PNG data: ${file}`, { cause: error }); }
      const { width, height } = decoded;
      if (width !== 1280 || height !== 800) throw new Error(`${file} must be 1280x800, got ${width}x${height}`);
      const metadata = JSON.parse(readFileSync(storeScreenshotSidecarPath(file), "utf8"));
      if (metadata.image !== scenario.file || metadata.width !== width || metadata.height !== height) throw new Error(`Invalid screenshot metadata: ${file}`);
      if (metadata.locale !== expectedLocale) throw new Error(`Invalid screenshot metadata locale: ${file}`);
      if (metadata.scenario !== scenario.id) throw new Error(`Invalid screenshot metadata scenario: ${file}`);
      if (metadata.sample !== scenario.sample) throw new Error(`Invalid screenshot metadata sample: ${file}`);
      if (!['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32'].includes(metadata.renderPlatform)) throw new Error(`Invalid screenshot metadata render platform: ${file}`);
      if (renderPlatform === undefined) renderPlatform = metadata.renderPlatform;
      else if (renderPlatform !== metadata.renderPlatform) throw new Error(`Mixed render platforms in screenshot set: ${file}`);
      if (expectedPlatform !== undefined && metadata.renderPlatform !== expectedPlatform) throw new Error(`Invalid expected render platform ${expectedPlatform}: ${file}`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (metadata.sha256 !== sha256) throw new Error(`Screenshot metadata hash mismatch: ${file}`);
      validateGeometry(metadata.geometry, width, height, file);
      const canonicalGeometry = JSON.stringify(metadata.geometry);
      if (expectedLocale === "en") geometries.set(scenario.id, canonicalGeometry);
      else if (geometries.get(scenario.id) !== canonicalGeometry) throw new Error(`Locale geometry mismatch for scenario ${scenario.id}: ${file}`);
    }
  }
  return { renderPlatform };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] ?? fileURLToPath(new URL("../platforms/extension/store-assets/", import.meta.url));
  validateStoreScreenshots(root); console.log(`Validated ${STORE_SCREENSHOT_NAMES.length * STORE_SCREENSHOT_LOCALES.length} store screenshots.`);
}
