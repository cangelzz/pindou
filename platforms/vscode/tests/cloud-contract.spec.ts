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
  for (const label of ["下载", "恢复", "删除"]) {
    const button = new RegExp(`<button[^>]*className=["'][^"']+(?:bg-|border|hover:)[^"']*["'][^>]*>[^<]*${label}[^<]*</button>`, "s");
    expect(source, `${label} button should retain Tailwind interaction styles`).toMatch(button);
  }
  for (const label of ["历史", "上传", "取消", "上传当前项目", "另存为...", "刷新", "关闭"]) {
    expect(source, `${label} button should use a styled control class`).toMatch(new RegExp(`<button[^>]*className=\\{(?:primaryButton|secondaryButton|compactButton)\\}[^>]*>[^<]*${label.replaceAll(".", "\\.")}`, "s"));
  }
});

test("browser extension grants only the fixed GitHub API host", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "platforms/extension/manifest.base.json"), "utf8"));
  expect(manifest.host_permissions).toContain("https://api.github.com/*");
  expect(manifest.host_permissions).not.toContain("<all_urls>");
  const extension = fs.readFileSync(path.join(root, "platforms/vscode/src/extension.ts"), "utf8");
  expect(extension).toContain("connect-src https://api.github.com https://gist.githubusercontent.com;");
  expect(extension).not.toContain("connect-src *");
});
