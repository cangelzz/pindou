import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareStoreScreenshots, selectStoreScreenshotVisualBaseline, validateStoreScreenshots } from "./store-screenshots.mjs";
import { publishStoreScreenshots } from "./store-screenshot-publish.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const update = process.env.PINDOU_UPDATE_STORE_SCREENSHOTS === "1" || process.argv.includes("--update");
const updateCiBaseline = process.argv.includes("--update-ci-baseline");
const check = process.argv.includes("--check");
if ([update, updateCiBaseline, check].filter(Boolean).length > 1) throw new Error("--update, --update-ci-baseline, and --check cannot be combined");
if (updateCiBaseline && process.platform !== "linux") throw new Error("--update-ci-baseline must run in the pinned Linux CI environment");
const temporary = mkdtempSync(join(tmpdir(), "pindou-store-screenshots-"));
const output = temporary;
const target = join(root, "platforms/extension/store-assets");
const ciBaselineRoot = join(root, "platforms/extension/store-assets-ci");
const ciBaseline = join(ciBaselineRoot, process.platform);
const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
try {
  for (const args of [["run", "ext:build:test"], ["exec", "playwright", "test", "--", "--config", "platforms/extension/playwright.config.ts", "store-screenshots.spec.ts"]]) {
    const result = spawnSync(command, npmCli ? [npmCli, ...args] : args, { cwd: root, stdio: "inherit", env: { ...process.env, PINDOU_STORE_SCREENSHOT_OUTPUT: output } });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  validateStoreScreenshots(output, { expectedPlatform: process.platform });
  if (update) publishStoreScreenshots(output, target);
  if (updateCiBaseline) publishStoreScreenshots(output, ciBaseline);
  if (check) {
    const { renderPlatform: committedPlatform } = validateStoreScreenshots(target);
    const semanticChanges = compareStoreScreenshots(output, target, { comparePixels: false });
    if (semanticChanges.length) throw new Error(`Store screenshot metadata differs from committed assets:\n${semanticChanges.join("\n")}`);
    const visualBaseline = selectStoreScreenshotVisualBaseline(process.platform, committedPlatform, target, ciBaselineRoot);
    validateStoreScreenshots(visualBaseline, { expectedPlatform: process.platform });
    const visualChanges = compareStoreScreenshots(output, visualBaseline, { comparePixels: true });
    if (visualChanges.length) throw new Error(`Store screenshots differ from the ${process.platform} visual baseline:\n${visualChanges.join("\n")}`);
  }
  const action = update ? "Updated" : updateCiBaseline ? "Updated CI baseline" : check ? "Verified committed" : "Rendered and validated";
  console.log(`${action} bilingual store screenshots at ${update ? target : updateCiBaseline ? ciBaseline : check ? target : output}`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
