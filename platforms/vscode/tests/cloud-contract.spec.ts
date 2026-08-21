import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");

test("CloudDialog only uses PlatformServices GitHub contract", () => {
  const source = fs.readFileSync(path.join(root, "src/components/Cloud/CloudDialog.tsx"), "utf8");
  expect(source).not.toMatch(/githubToken|getGitHubToken|fetch\s*\(/);
  expect(source).not.toMatch(/from\s+["']\.\.\/\.\.\/utils\/gistSync/);
  for (const method of ["listProjects", "uploadProject", "downloadProject", "deleteProject"]) expect(source).toContain(`github.${method}`);
});

test("CloudDialog keeps styled action controls", () => {
  const source = fs.readFileSync(path.join(root, "src/components/Cloud/CloudDialog.tsx"), "utf8");
  expect(source).toContain('const primaryButton = "px-3 py-1.5 bg-blue-500');
  expect(source).toContain('const secondaryButton = "px-3 py-1.5 text-xs border');
  expect(source).toContain('const compactButton = "px-2 py-0.5 border');
  for (const key of ["cloud.download", "cloud.restore", "cloud.delete", "cloud.history", "cloud.upload", "cloud.cancel", "cloud.saveAs", "cloud.close"]) {
    expect(source, `${key} should remain a localized action`).toContain(`t("${key}")`);
  }
  expect(source).toMatch(/className="[^"]*(?:bg-blue|bg-green|text-red)[^"]*"/);
  expect(source).toMatch(/className=\{(?:primaryButton|secondaryButton|compactButton)\}/);
  expect(source).toContain('t(cloudGistId ? "cloud.sync" : "cloud.uploadCurrent")');
  expect(source).toContain('loading ? t("cloud.loading") : t("cloud.refresh")');
});

test("browser extension grants only the fixed GitHub API host", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "platforms/extension/manifest.base.json"), "utf8"));
  expect(manifest.host_permissions).toContain("https://api.github.com/*");
  expect(manifest.host_permissions).not.toContain("<all_urls>");
  const extension = fs.readFileSync(path.join(root, "platforms/vscode/src/extension.ts"), "utf8");
  expect(extension).toContain("connect-src https://api.github.com https://gist.githubusercontent.com;");
  expect(extension).not.toContain("connect-src *");
});
