import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createWriteStream, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ZipArchive } from "archiver";

import { scanExtensionArtifacts } from "./assert-extension-no-ai.mjs";
import { readExtensionVersion } from "./extension-version.mjs";
import { validateDirectory, validateZip } from "./validate-extension-manifest.mjs";

const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");
const FORBIDDEN = /(^|\/)(src|tests?|e2e)(\/|$)|\.(?:map|ts|tsx)$|(?:\.spec|\.test)\.[^/]+$/i;
const BRANDS = new Set(["chrome", "edge"]);
const repoRoot = resolve(import.meta.dirname, "..");

function files(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory() ? files(root, join(directory, entry.name)) : [join(directory, entry.name)])
    .sort((a, b) => relative(root, a).localeCompare(relative(root, b), "en"));
}

const defaultFsOps = { existsSync, linkSync, readFileSync, rmSync, unlinkSync };

export function publishArtifact(temporary, target, fsOps = defaultFsOps) {
  try {
    fsOps.linkSync(temporary, target);
    fsOps.unlinkSync(temporary);
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      fsOps.unlinkSync(temporary);
      throw new Error(`Unable to atomically claim extension artifact name ${target}: hard links are required`, { cause: error });
    }
  }
  const existing = fsOps.readFileSync(target);
  const candidate = fsOps.readFileSync(temporary);
  fsOps.unlinkSync(temporary);
  if (!existing.equals(candidate)) {
    throw new Error(`Artifact already exists with different content: ${target}; remove it explicitly or build a new version`);
  }
}

export async function packageExtension({ brand, distDir, artifactsDir, version, fsOps = defaultFsOps }) {
  assert.ok(BRANDS.has(brand), "brand must be chrome or edge");
  assert.ok(existsSync(distDir), `extension build is missing: ${distDir}`);
  scanExtensionArtifacts(distDir);
  validateDirectory(distDir, version);
  const inputFiles = files(distDir);
  for (const file of inputFiles) {
    const name = relative(distDir, file).replaceAll("\\", "/");
    assert.ok(!FORBIDDEN.test(name), `forbidden source or test artifact: ${name}`);
  }
  mkdirSync(artifactsDir, { recursive: true });
  const target = join(artifactsDir, `pindouverse-${brand}-${version}.zip`);
  const temporary = `${target}.tmp-${crypto.randomUUID()}`;
  rmSync(temporary, { force: true });
  try {
    await new Promise((resolveArchive, reject) => {
      const output = createWriteStream(temporary, { flags: "wx" });
      const archive = new ZipArchive({ zlib: { level: 9 }, forceLocalTime: false });
      output.on("close", resolveArchive);
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      for (const file of inputFiles) {
        const name = relative(distDir, file).replaceAll("\\", "/");
        archive.append(readFileSync(file), { name, date: FIXED_DATE, mode: 0o100644 });
      }
      archive.finalize().catch(reject);
    });
    await validateZip(temporary, version);
    publishArtifact(temporary, target, fsOps);
    return target;
  } catch (error) {
    fsOps.rmSync(temporary, { force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const brands = process.argv.slice(2);
  const selected = brands.length ? brands : ["chrome", "edge"];
  for (const brand of selected) assert.ok(BRANDS.has(brand), "Usage: package-extension.mjs [chrome|edge ...]");
  const version = readExtensionVersion({ packagePath: join(repoRoot, "platforms/vscode/package.json") });
  for (const brand of selected) {
    const target = await packageExtension({
      brand,
      distDir: join(repoRoot, "platforms/extension/dist", brand),
      artifactsDir: join(repoRoot, "artifacts"),
      version,
    });
    console.log(`Packaged ${basename(target)}`);
  }
}
