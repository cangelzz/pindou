import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareStoreScreenshots, validateStoreScreenshots } from "./store-screenshots.mjs";
import { publishStoreScreenshots } from "./store-screenshot-publish.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const update = process.env.PINDOU_UPDATE_STORE_SCREENSHOTS === "1" || process.argv.includes("--update");
const check = process.argv.includes("--check");
if (update && check) throw new Error("--update and --check cannot be combined");
const temporary = mkdtempSync(join(tmpdir(), "pindou-store-screenshots-"));
const output = temporary;
const target = join(root, "platforms/extension/store-assets");
const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
try {
  for (const args of [["run", "ext:build:test"], ["exec", "playwright", "test", "--", "--config", "platforms/extension/playwright.config.ts", "store-screenshots.spec.ts"]]) {
    const result = spawnSync(command, npmCli ? [npmCli, ...args] : args, { cwd: root, stdio: "inherit", env: { ...process.env, PINDOU_STORE_SCREENSHOT_OUTPUT: output } });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  validateStoreScreenshots(output);
  if (update) publishStoreScreenshots(output, target);
  if (check) {
    validateStoreScreenshots(target);
    const changed = compareStoreScreenshots(output, target);
    if (changed.length) throw new Error(`Store screenshots differ from committed assets:\n${changed.join("\n")}`);
  }
  console.log(`${update ? "Updated" : check ? "Verified committed" : "Rendered and validated"} bilingual store screenshots at ${update || check ? target : output}`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
