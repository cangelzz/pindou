import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultPackagePath = resolve(import.meta.dirname, "../platforms/vscode/package.json");

export function readExtensionVersion({
  packagePath = defaultPackagePath,
  readFile = (path) => readFileSync(path, "utf8"),
} = {}) {
  const packageJson = JSON.parse(readFile(packagePath));
  const { version } = packageJson;
  assert.equal(typeof version, "string", "extension package version must be a string");
  assert.match(version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/, "extension package version must contain exactly three integers without leading zeros");
  const components = version.split(".").map(Number);
  assert.ok(components.some((component) => component !== 0), "extension package version cannot be all zero");
  assert.ok(components.every((component) => component <= 65535), "extension package version components must be between 0 and 65535");
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2]) throw new Error("Usage: extension-version.mjs");
  console.log(readExtensionVersion());
}
