import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanExtensionArtifacts } from "./assert-extension-no-ai.mjs";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "pindou-ext-scan-"));
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

function rejects(files, pattern) {
  const root = fixture(files);
  try { assert.throws(() => scanExtensionArtifacts(root), pattern); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

rejects({ "manifest.json": '{"description":"__TAURI"}' }, /manifest\.json.*__TAURI/);
rejects({ "style.css": ".x{content:'aiVoice'}" }, /style\.css.*aiVoice/);
rejects({ "app.js.map": "{}" }, /source map/i);
rejects({ "source.test.ts": "safe" }, /source or test artifact/i);
rejects({ "unknown.asset": Buffer.from([0, 1, 2]) }, /unknown extension/i);
rejects({ "known.txt": Buffer.from([0x41, 0, 0x42]) }, /NUL bytes/i);
rejects({ "utf16.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("client_secret", "utf16le")]) }, /client_secret/);
rejects({ "manifest.json": '{"sdk":"@anthropic-ai/sdk"}' }, /@anthropic-ai\/sdk/);
rejects({ "app.js": "globalThis.__pindouExtensionTest = {}" }, /__pindouExtensionTest/);
rejects({ "background.js": "if (message.type === 'pindou:test') {}" }, /pindou:test/);
rejects({ "style.css": ".x{content:'api.openai.com'}" }, /api\.openai\.com/);

const binaryRoot = fixture({ "icons/icon.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]) });
try { assert.doesNotThrow(() => scanExtensionArtifacts(binaryRoot)); }
finally { rmSync(binaryRoot, { recursive: true, force: true }); }

console.log("Extension artifact scanner fixture tests passed.");
