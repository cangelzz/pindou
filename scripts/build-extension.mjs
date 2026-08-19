import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

import { scanExtensionArtifacts } from "./assert-extension-no-ai.mjs";
import { validateDirectory, validateOverlay } from "./validate-extension-manifest.mjs";
import { computeVersion } from "./version.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const extensionRoot = join(repoRoot, "platforms/extension");
const [brand = "chrome", buildKind] = process.argv.slice(2);
assert.ok(brand === "chrome" || brand === "edge", "Usage: build-extension.mjs <chrome|edge> [test]");
assert.ok(buildKind === undefined || buildKind === "test", "Usage: build-extension.mjs <chrome|edge> [test]");
const testBuild = buildKind === "test";
const version = computeVersion({ repoRoot });
assert.match(version, /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}$/, "computed project version must be three integers");

const staging = join(extensionRoot, `.dist-${brand}-${process.pid}`);
const branded = join(extensionRoot, "dist", brand);
const legacy = join(extensionRoot, testBuild ? "dist-test" : "dist");
rmSync(staging, { recursive: true, force: true });
try {
  execFileSync(
    process.execPath,
    [join(repoRoot, "node_modules/vite/bin/vite.js"), "build", "--config", join(extensionRoot, "vite.config.ts"), "--mode", testBuild ? "test" : "production"],
    { cwd: repoRoot, stdio: "inherit", env: { ...process.env, PINDOU_EXTENSION_BRAND: brand, PINDOU_EXTENSION_OUT_DIR: staging } },
  );
  const base = JSON.parse(readFileSync(join(extensionRoot, "manifest.base.json"), "utf8"));
  const overlay = JSON.parse(readFileSync(join(extensionRoot, "store", `${brand}.json`), "utf8"));
  validateOverlay(overlay);
  cpSync(join(extensionRoot, "_locales"), join(staging, "_locales"), { recursive: true });
  writeFileSync(join(staging, "manifest.json"), `${JSON.stringify({ ...base, ...overlay, version }, null, 2)}\n`);
  validateDirectory(staging, version);
  if (!testBuild) scanExtensionArtifacts(staging);

  if (testBuild) {
    rmSync(legacy, { recursive: true, force: true });
    cpSync(staging, legacy, { recursive: true });
  } else {
    rmSync(branded, { recursive: true, force: true });
    mkdirSync(join(extensionRoot, "dist"), { recursive: true });
    cpSync(staging, branded, { recursive: true });
    if (brand === "chrome") {
      for (const entry of readdirSync(legacy)) {
        if (entry !== "chrome" && entry !== "edge") rmSync(join(legacy, entry), { recursive: true, force: true });
      }
      for (const entry of readdirSync(staging)) cpSync(join(staging, entry), join(legacy, entry), { recursive: true });
      validateDirectory(legacy, version);
      scanExtensionArtifacts(legacy);
    }
  }
  console.log(`Built and validated ${brand}${testBuild ? " test" : ""} extension ${version}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
