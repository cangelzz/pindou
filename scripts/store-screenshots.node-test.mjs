import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import pngjs from "pngjs/lib/png.js";
import { compareStoreScreenshots, expectedStoreScreenshotPaths, selectStoreScreenshotVisualBaseline, storeScreenshotSidecarPath, validateStoreScreenshots } from "./store-screenshots.mjs";
import { publishStoreScreenshots } from "./store-screenshot-publish.mjs";

const { PNG } = pngjs;

const scenarios = [
  { id: "editor", file: "01-editor.png", sample: "dinosaur-rex.pindou" },
  { id: "image-conversion", file: "02-image-conversion.png", sample: "dinosaur-triceratops.pindou" },
  { id: "layers", file: "03-layers.png", sample: "dinosaur-raptor.pindou" },
  { id: "export", file: "04-export.png", sample: "dinosaur-brachiosaurus.pindou" },
  { id: "cloud", file: "05-cloud.png", sample: "dinosaur-rex.pindou" },
];

const png = (width, height) => PNG.sync.write(new PNG({ width, height }), { colorType: 6 });
const geometry = { canvas: { x: 0, y: 49, width: 1000, height: 751 }, artwork: { x: 100, y: 100, width: 500, height: 500 }, panel: { x: 1000, y: 49, width: 280, height: 751 }, transform: { cellSize: 10, offsetX: 100, offsetY: 51 } };

function createSet(root, width = 1280, renderPlatform = "win32") {
  for (const file of expectedStoreScreenshotPaths(root)) {
    const bytes = png(width, 800);
    const scenario = scenarios.find(({ file: name }) => name === basename(file));
    const locale = file.includes(join("global", "en")) ? "en" : "zh-CN";
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, bytes);
    writeFileSync(storeScreenshotSidecarPath(file), JSON.stringify({ image: basename(file), locale, scenario: scenario.id, sample: scenario.sample, width, height: 800, sha256: createHash("sha256").update(bytes).digest("hex"), renderPlatform, geometry }));
  }
}

function mutateMetadata(root, locale, image, mutate) {
  const file = join(root, locale === "en" ? "global/en" : "localized/zh-CN", image);
  const sidecar = storeScreenshotSidecarPath(file);
  const metadata = JSON.parse(readFileSync(sidecar, "utf8"));
  mutate(metadata);
  writeFileSync(sidecar, JSON.stringify(metadata));
}

test("manifest has the same five ordered PNG names for both locales", () => {
  const paths = expectedStoreScreenshotPaths("/assets");
  assert.deepEqual(paths.map((file) => basename(file)), [...Array(2)].flatMap(() => scenarios.map(({ file }) => file)));
});

test("validator decodes real PNGs and rejects wrong dimensions", () => {
  const root = mkdtempSync(join(tmpdir(), "pindou-shots-"));
  try {
    assert.throws(() => validateStoreScreenshots(root), /missing/i);
    createSet(root);
    assert.doesNotThrow(() => validateStoreScreenshots(root));
    createSet(root, 1200);
    assert.throws(() => validateStoreScreenshots(root), /1280x800/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("validator rejects truncated and CRC-corrupt PNG data", () => {
  const root = mkdtempSync(join(tmpdir(), "pindou-corrupt-"));
  try {
    createSet(root);
    const file = expectedStoreScreenshotPaths(root)[0];
    const valid = readFileSync(file);
    writeFileSync(file, valid.subarray(0, valid.length - 8));
    assert.throws(() => validateStoreScreenshots(root), /Invalid PNG data/i);
    writeFileSync(file, valid);
    const corrupt = Buffer.from(valid);
    corrupt[corrupt.length - 5] ^= 0xff;
    writeFileSync(file, corrupt);
    assert.throws(() => validateStoreScreenshots(root), /Invalid PNG data/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("validator requires non-empty finite in-bounds relational geometry", () => {
  const root = mkdtempSync(join(tmpdir(), "pindou-geometry-"));
  try {
    createSet(root);
    mutateMetadata(root, "en", "01-editor.png", (metadata) => { metadata.geometry.canvas = {}; });
    assert.throws(() => validateStoreScreenshots(root), /geometry/i);
    createSet(root);
    mutateMetadata(root, "en", "01-editor.png", (metadata) => { metadata.geometry.artwork.width = 0; });
    assert.throws(() => validateStoreScreenshots(root), /geometry/i);
    createSet(root);
    mutateMetadata(root, "en", "01-editor.png", (metadata) => { metadata.geometry.artwork.x += 1; });
    assert.throws(() => validateStoreScreenshots(root), /geometry/i);
    createSet(root);
    mutateMetadata(root, "en", "01-editor.png", (metadata) => { metadata.geometry.panel.x = 999; });
    assert.throws(() => validateStoreScreenshots(root), /geometry/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("validator rejects swapped locale and incorrect exact scenario descriptors", () => {
  const root = mkdtempSync(join(tmpdir(), "pindou-descriptor-"));
  try {
    createSet(root);
    mutateMetadata(root, "en", "01-editor.png", (metadata) => { metadata.locale = "zh-CN"; });
    assert.throws(() => validateStoreScreenshots(root), /locale/i);
    createSet(root);
    mutateMetadata(root, "en", "01-editor.png", (metadata) => { delete metadata.renderPlatform; });
    assert.throws(() => validateStoreScreenshots(root), /render platform/i);
    createSet(root);
    mutateMetadata(root, "en", "01-editor.png", (metadata) => { metadata.renderPlatform = "linux"; });
    assert.throws(() => validateStoreScreenshots(root), /mixed render platforms/i);
    createSet(root);
    assert.throws(() => validateStoreScreenshots(root, { expectedPlatform: "linux" }), /expected render platform/i);
    createSet(root);
    mutateMetadata(root, "en", "01-editor.png", (metadata) => { metadata.scenario = "cloud"; });
    assert.throws(() => validateStoreScreenshots(root), /scenario/i);
    createSet(root);
    mutateMetadata(root, "en", "01-editor.png", (metadata) => { metadata.sample = "dinosaur-raptor.pindou"; });
    assert.throws(() => validateStoreScreenshots(root), /sample/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("validator requires matching geometry across en and zh-CN", () => {
  const root = mkdtempSync(join(tmpdir(), "pindou-locale-geometry-"));
  try {
    createSet(root);
    mutateMetadata(root, "zh-CN", "03-layers.png", (metadata) => { metadata.geometry.panel.x -= 1; });
    assert.throws(() => validateStoreScreenshots(root), /locale.*geometry|geometry.*locale/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("semantic comparison ignores cross-platform pixels but reports geometry changes", () => {
  const root = mkdtempSync(join(tmpdir(), "pindou-semantic-compare-"));
  const actual = join(root, "actual"), committed = join(root, "committed");
  try {
    createSet(actual, 1280, "linux"); createSet(committed, 1280, "win32");
    const pngFile = expectedStoreScreenshotPaths(actual)[0];
    const visiblyChanged = PNG.sync.read(readFileSync(pngFile));
    for (let y = 201; y < 239; y++) for (let x = 121; x < 159; x++) {
      const index = (y * visiblyChanged.width + x) * 4;
      visiblyChanged.data[index] = 255;
      visiblyChanged.data[index + 3] = 255;
    }
    writeFileSync(pngFile, PNG.sync.write(visiblyChanged));
    assert.deepEqual(compareStoreScreenshots(actual, committed, { comparePixels: false }), []);

    const metadataFile = storeScreenshotSidecarPath(expectedStoreScreenshotPaths(actual)[1]);
    const metadata = JSON.parse(readFileSync(metadataFile, "utf8"));
    metadata.geometry.transform.offsetX += 1;
    metadata.geometry.artwork.x += 1;
    writeFileSync(metadataFile, JSON.stringify(metadata));
    assert.deepEqual(compareStoreScreenshots(actual, committed, { comparePixels: false }).map((file) => basename(file)), ["02-image-conversion.metadata.json"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("visual baseline selection uses store assets only on the same platform", () => {
  assert.equal(selectStoreScreenshotVisualBaseline("win32", "win32", "/store", "/ci"), "/store");
  assert.equal(selectStoreScreenshotVisualBaseline("linux", "win32", "/store", "/ci"), join("/ci", "linux"));
});

test("render environment provenance does not affect semantic comparison", () => {
  const root = mkdtempSync(join(tmpdir(), "pindou-provenance-compare-"));
  const actual = join(root, "actual"), committed = join(root, "committed");
  try {
    createSet(actual, 1280, "linux"); createSet(committed, 1280, "win32");
    mutateMetadata(actual, "en", "01-editor.png", (metadata) => { metadata.renderEnvironment = { runner: "ubuntu-24.04" }; });
    assert.deepEqual(compareStoreScreenshots(actual, committed, { comparePixels: false }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("same-platform comparison reports a visible PNG regression after full validation", () => {
  const root = mkdtempSync(join(tmpdir(), "pindou-pixel-compare-"));
  const actual = join(root, "actual"), baseline = join(root, "baseline");
  try {
    createSet(actual, 1280, "linux"); createSet(baseline, 1280, "linux");
    const pngFile = expectedStoreScreenshotPaths(actual)[0];
    const visiblyChanged = PNG.sync.read(readFileSync(pngFile));
    for (let y = 201; y < 239; y++) for (let x = 121; x < 159; x++) {
      const index = (y * visiblyChanged.width + x) * 4;
      visiblyChanged.data[index] = 255;
      visiblyChanged.data[index + 3] = 255;
    }
    const bytes = PNG.sync.write(visiblyChanged);
    writeFileSync(pngFile, bytes);
    mutateMetadata(actual, "en", "01-editor.png", (metadata) => { metadata.sha256 = createHash("sha256").update(bytes).digest("hex"); });

    assert.doesNotThrow(() => validateStoreScreenshots(actual, { expectedPlatform: "linux" }));
    assert.doesNotThrow(() => validateStoreScreenshots(baseline, { expectedPlatform: "linux" }));
    assert.deepEqual(compareStoreScreenshots(actual, baseline, { comparePixels: true }).map((file) => basename(file)), ["01-editor.png"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("atomic publisher restores the previous complete set when the final swap fails", () => {
  const root = mkdtempSync(join(tmpdir(), "pindou-publish-"));
  const source = join(root, "source"), target = join(root, "store-assets");
  try {
    createSet(source); createSet(target);
    const oldFile = expectedStoreScreenshotPaths(target)[0];
    const oldPng = PNG.sync.read(readFileSync(oldFile)); oldPng.data[0] = 255;
    const oldBytes = PNG.sync.write(oldPng);
    writeFileSync(oldFile, oldBytes);
    const oldMetadata = JSON.parse(readFileSync(storeScreenshotSidecarPath(oldFile), "utf8")); oldMetadata.sha256 = createHash("sha256").update(oldBytes).digest("hex"); writeFileSync(storeScreenshotSidecarPath(oldFile), JSON.stringify(oldMetadata));
    let renames = 0;
    assert.throws(() => publishStoreScreenshots(source, target, { rename(from, to) { renames += 1; if (renames === 2) throw new Error("swap failed"); renameSync(from, to); } }), /swap failed/);
    assert.equal(PNG.sync.read(readFileSync(expectedStoreScreenshotPaths(target)[0])).data[0], 255);
    assert.doesNotThrow(() => validateStoreScreenshots(target));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
