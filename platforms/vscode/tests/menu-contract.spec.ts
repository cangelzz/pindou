import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { DIST_DIR, setupPage, setStoreState } from "./helpers";

const coreOrder = [
  "new", "resize", "open", "save", "save-as", "project-info",
  "import-image", "import-blueprint", "export", "history", "version", "language", "login", "feedback",
];

async function menuIds(page: import("@playwright/test").Page) {
  return page.locator('[data-testid="top-menu"] > [data-menu-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("data-menu-id")),
  );
}

async function topLayout(page: import("@playwright/test").Page) {
  return page.locator('[data-testid="top-menu"] > [data-menu-id], [data-testid="top-menu"] > [data-separator-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("data-menu-id") ?? `separator:${node.getAttribute("data-separator-id")}`),
  );
}

for (const locale of [
  {
    language: "en",
    labels: ["New", "Resize Canvas", "Open", "Save", "Save As", "Project Info", "Import Image", "Import Blueprint BETA", "Export", "History", "Versions", "🌐 中文", "Sign in to GitHub", "Feedback"],
  },
  {
    language: "zh-CN",
    labels: ["新建", "调整画布", "打开", "保存", "另存为", "项目信息", "导入图片", "导入图纸 BETA", "导出", "历史记录", "版本", "🌐 EN", "登录 GitHub", "反馈"],
  },
] as const) {
  test(`VS Code renders the shared top-menu contract in strict order (${locale.language})`, async ({ page }) => {
    await setupPage(page, { savedLanguage: locale.language });
    await expect(page.locator('[data-testid="top-menu"]')).toHaveCount(1);
    expect(await menuIds(page)).toEqual(coreOrder);
    expect(await page.locator('[data-testid="top-menu"] > [data-menu-id]').allTextContents()).toEqual(locale.labels);
    expect(await topLayout(page)).toEqual([
      "new", "resize", "open", "save", "save-as", "project-info", "separator:files",
      "import-image", "import-blueprint", "export", "separator:history", "history",
      "version", "language", "login", "feedback",
    ]);
    await expect(page.locator('[data-menu-id="import-blueprint"]')).toBeEnabled();
    await expect(page.locator('[data-menu-id="import-blueprint"]')).toContainText("BETA");
    await expect(page.locator('[data-menu-id="feedback"]')).toHaveAttribute("data-feedback-environment", "VS Code Extension");
  });
}

const matrix = [
  { name: "none", baseline: false, session: false, gist: false },
  { name: "baseline only", baseline: true, session: false, gist: false },
  { name: "session only", baseline: false, session: true, gist: false },
  { name: "session and gist", baseline: false, session: true, gist: true },
  { name: "session and baseline", baseline: true, session: true, gist: false },
  { name: "all", baseline: true, session: true, gist: true },
  { name: "gist residue", baseline: false, session: false, gist: true },
] as const;

for (const state of matrix) {
  test(`menu matrix: ${state.name}`, async ({ page }) => {
    await setupPage(page);
    await setStoreState(page, {
      baselineCanvasData: state.baseline ? [[{ colorIndex: null }]] : null,
      cloudGistId: state.gist ? "gist-1" : null,
    });
    await page.evaluate((session) => (window as any).__pindouTestGitHub?.setSession(
      session ? { authenticated: true, login: "octocat" } : null,
    ), state.session);
    const conditional = [
      ...(state.baseline ? ["compare"] : []),
      ...(state.session ? ["cloud"] : []),
      ...(state.session && state.gist ? ["cloud-status"] : []),
    ];
    expect(await menuIds(page)).toEqual([
      "new", "resize", "open", "save", "save-as", "project-info",
      "import-image", "import-blueprint", "export",
      "history", ...conditional, "version", "language",
      state.session ? "logged-in" : "login", "feedback",
    ]);
    await expect(page.locator('[data-menu-id="compare"]')).toHaveCount(state.baseline ? 1 : 0);
    await expect(page.locator('[data-menu-id="cloud"]')).toHaveCount(state.session ? 1 : 0);
    await expect(page.locator('[data-menu-id="cloud-status"]')).toHaveCount(state.session && state.gist ? 1 : 0);
    await expect(page.locator('[data-menu-id="login"]')).toHaveCount(state.session ? 0 : 1);
    await expect(page.locator('[data-menu-id="logged-in"]')).toHaveCount(state.session ? 1 : 0);
  });
}

test("browser capabilities render the shared menu without AI and identify browser brand", async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => (window as any).__pindouTestPlatform?.setCapabilities({
    runtime: "browser-extension",
    browserBrand: "edge",
    environmentLabel: "Browser Extension (Edge)",
    ai: false,
  }));
  await expect(page.locator('[data-testid="top-menu"]')).toHaveCount(1);
  await expect(page.locator('[data-menu-id="feedback"]')).toHaveAttribute(
    "data-feedback-environment",
    "Browser Extension (Edge)",
  );
  await expect(page.getByText(/AI语音|AI 语音增强/)).toHaveCount(0);
  expect(await menuIds(page)).toEqual(coreOrder);
});

test("VS Code ai=false removes AI controls but keeps non-AI Beta settings", async ({ page }) => {
  await setupPage(page);
  await expect(page.getByText(/AI语音|AI 语音增强/)).toHaveCount(0);
  await expect(page.locator('[data-testid="ai-voice-status"]')).toHaveCount(0);
  await page.getByTestId("beta-settings").click();
  await expect(page.getByText("图纸导入（从导出的图纸还原画布）")).toBeVisible();
  await expect(page.getByText("AI 语音增强（GitHub Models LLM）")).toHaveCount(0);
});

test("VS Code bundles contain no AI endpoint or command path", () => {
  const assets = path.join(DIST_DIR, "assets");
  const text = fs.readdirSync(assets)
    .filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(path.join(assets, name), "utf8"))
    .join("\n");
  expect(text).not.toContain("github_models_chat");
  expect(text).not.toContain("models.inference.ai.azure.com");
});
