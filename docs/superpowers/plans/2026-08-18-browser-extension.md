# PindouVerse Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 `platforms/extension` 原型完善为可发布到 Chrome Web Store 和 Microsoft Edge Add-ons 的完整 Manifest V3 PindouVerse 编辑器。

**Architecture:** 根目录 `src/` 继续承载共享 React 编辑器、Zustand store 和算法；新增可注入的平台服务边界，隔离文件、GitHub、存储、外链和浏览器图片任务。MV3 service worker 只负责扩展生命周期、唯一编辑器标签页与一次性右键图片任务，编辑器业务状态仍留在共享 store。

**Tech Stack:** React 19、Zustand 5、TypeScript 5.6、Vite 6、Manifest V3、Chrome Extension API、File System Access API、IndexedDB、Vitest、Playwright、GitHub REST/Device Flow。

---

## 实施约束

- 当前工作区已有无关修改：`.claude/skills/pindou-poster/scripts/make_poster.py` 和 `scripts/__pycache__/`。每次只 `git add` 任务明确列出的文件，禁止 `git add .`。
- 实施依据：`docs/superpowers/specs/2026-08-18-browser-extension-design.md`。
- UI 以 VS Code webview 当前共享 `App` 为合同；不得复制一套浏览器专属菜单。
- 每项任务严格执行红灯测试、最小实现、绿灯验证、独立提交。
- 阶段末必须运行根测试、VS Code webview 测试和扩展构建，不能只运行新增测试。

## 目标文件结构

```text
src/platform/
├── result.ts                 # 跨平台操作结果
├── capabilities.ts           # 运行环境和 feature flags
├── services.ts               # 平台服务接口
├── serviceRegistry.ts        # 服务注入点
├── projectFileService.ts     # 项目文件共享类型
├── imageImportService.ts     # 图片资源共享类型
├── githubService.ts          # GitHub 会话和 API 类型
└── recoveryStorage.ts        # 自动恢复与快照接口

src/utils/canvasExport.ts      # VS Code/浏览器共享 Canvas 渲染

platforms/extension/
├── background.ts             # MV3 service worker
├── browserApi.ts             # 可测试的 Chrome API 薄包装
├── platformServices.ts       # 浏览器服务组合根
├── projectFileService.ts     # File System Access + 下载回退
├── imageImportService.ts     # 本地/网页图片资源
├── githubService.ts          # Device Flow + Gist
├── browserStorage.ts         # chrome.storage.local
├── recoveryStorage.ts        # IndexedDB recovery/snapshot
├── manifest.base.json        # 无 Side Panel 的最小权限 MV3 manifest
├── playwright.config.ts      # 扩展 E2E
├── tsconfig.json             # 扩展类型检查
├── store/chrome.json         # Chrome 商店 overlay
├── store/edge.json           # Edge 商店 overlay
└── tests/                    # 单元、合同和 E2E 测试

scripts/
├── build-extension.mjs
├── validate-extension-manifest.mjs
└── package-extension.mjs
```

---

## 阶段一：平台边界与 MV3 外壳

### Task 1：建立平台结果、capability 和服务注册表

**Files:**
- Create: `src/platform/result.ts`
- Create: `src/platform/capabilities.ts`
- Create: `src/platform/services.ts`
- Create: `src/platform/serviceRegistry.ts`
- Test: `src/platform/capabilities.test.ts`
- Modify: `src/main.tsx`
- Modify: `platforms/vscode/webview/main.tsx`
- Modify: `platforms/extension/main.tsx`

- [ ] **Step 1: 写 capability 与注册表失败测试**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createBrowserCapabilities } from "./capabilities";
import {
  getPlatformServices,
  resetPlatformServicesForTest,
} from "./serviceRegistry";

describe("platform capabilities", () => {
  beforeEach(resetPlatformServicesForTest);

  it("identifies Chrome extension and disables AI", () => {
    expect(createBrowserCapabilities("chrome", true)).toEqual({
      runtime: "browser-extension",
      browserBrand: "chrome",
      projectFileHandles: true,
      downloadFallback: true,
      githubDeviceFlow: true,
      gistSync: true,
      ai: false,
      browserImageTasks: true,
    });
  });

  it("requires services before App starts", () => {
    expect(() => getPlatformServices()).toThrow(/not initialized/i);
  });
});
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `npx vitest run src/platform/capabilities.test.ts`  
Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现结果模型与 capability**

```ts
// src/platform/result.ts
export type PlatformErrorCode =
  | "cancelled"
  | "permission-denied"
  | "invalid-data"
  | "network"
  | "authentication"
  | "rate-limited"
  | "unsupported"
  | "unknown";

export type PlatformResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: PlatformErrorCode;
      message?: string;
      retryAfterSeconds?: number;
      cause?: unknown;
    };
```

```ts
// src/platform/capabilities.ts
export interface PlatformCapabilities {
  runtime: "tauri" | "vscode" | "browser-extension";
  browserBrand?: "chrome" | "edge";
  projectFileHandles: boolean;
  downloadFallback: boolean;
  githubDeviceFlow: boolean;
  gistSync: boolean;
  ai: boolean;
  browserImageTasks: boolean;
}

export function createBrowserCapabilities(
  browserBrand: "chrome" | "edge",
  projectFileHandles: boolean,
): PlatformCapabilities {
  return {
    runtime: "browser-extension",
    browserBrand,
    projectFileHandles,
    downloadFallback: true,
    githubDeviceFlow: true,
    gistSync: true,
    ai: false,
    browserImageTasks: true,
  };
}
```

- [ ] **Step 4: 定义服务接口和注册表**

```ts
// src/platform/services.ts
import type { PlatformCapabilities } from "./capabilities";
import type { ProjectFileService } from "./projectFileService";
import type { ImageImportService } from "./imageImportService";
import type { GitHubService } from "./githubService";
import type { RecoveryStorage } from "./recoveryStorage";

export interface PlatformStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ExternalLinkService {
  open(url: string): Promise<boolean>;
}

export interface PlatformServices {
  capabilities: PlatformCapabilities;
  projectFiles: ProjectFileService;
  images: ImageImportService;
  github: GitHubService;
  recovery: RecoveryStorage;
  storage: PlatformStorage;
  externalLinks: ExternalLinkService;
}
```

```ts
// src/platform/serviceRegistry.ts
import type { PlatformServices } from "./services";

let current: PlatformServices | undefined;

export function setPlatformServices(services: PlatformServices): void {
  current = services;
}

export function getPlatformServices(): PlatformServices {
  if (!current) throw new Error("Platform services not initialized");
  return current;
}

export function resetPlatformServicesForTest(): void {
  current = undefined;
}
```

入口先注入包装现有 adapter/function 的过渡 services；本任务不迁移文件或 GitHub 实现。

- [ ] **Step 5: 验证三个入口可编译**

Run:

```bash
npx vitest run src/platform/capabilities.test.ts
npm run build
npm --prefix platforms/vscode run build:webview
npm run ext:build
```

Expected: 测试和三个构建全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/platform src/main.tsx platforms/vscode/webview/main.tsx platforms/extension/main.tsx
git commit -m "refactor: add injectable platform services"
```

### Task 2：把扩展改为独立标签页和 MV3 service worker

**Files:**
- Create: `platforms/extension/browserApi.ts`
- Create: `platforms/extension/background.ts`
- Create: `platforms/extension/tests/background.test.ts`
- Create: `platforms/extension/manifest.base.json`
- Modify: `platforms/extension/vite.config.ts`
- Delete: `platforms/extension/manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 写唯一编辑器 tab 失败测试**

```ts
it("focuses an existing editor tab", async () => {
  api.tabs.query.mockResolvedValue([{ id: 7, windowId: 3 }]);
  await openOrFocusEditor(api);
  expect(api.tabs.update).toHaveBeenCalledWith(7, { active: true });
  expect(api.windows.update).toHaveBeenCalledWith(3, { focused: true });
  expect(api.tabs.create).not.toHaveBeenCalled();
});

it("creates an editor tab when none exists", async () => {
  api.tabs.query.mockResolvedValue([]);
  api.tabs.create.mockResolvedValue({ id: 8 });
  await openOrFocusEditor(api);
  expect(api.tabs.create).toHaveBeenCalledWith({ url: editorUrl });
});
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `npx vitest run platforms/extension/tests/background.test.ts`  
Expected: FAIL，`openOrFocusEditor` 不存在。

- [ ] **Step 3: 实现可测试的打开/聚焦逻辑**

```ts
export async function openOrFocusEditor(api: BrowserApi): Promise<number> {
  const editorUrl = api.runtime.getURL("index.html");
  const matches = await api.tabs.query({ url: `${editorUrl}*` });
  const existing = matches[0];

  if (existing?.id !== undefined) {
    await api.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await api.windows.update(existing.windowId, { focused: true });
    }
    return existing.id;
  }

  const created = await api.tabs.create({ url: editorUrl });
  if (created.id === undefined) throw new Error("Editor tab has no id");
  return created.id;
}

chrome.action.onClicked.addListener(() => {
  void openOrFocusEditor(chromeBrowserApi);
});
```

- [ ] **Step 4: 创建最小权限 manifest 并配置 Vite 双入口**

```json
{
  "manifest_version": 3,
  "name": "PindouVerse",
  "version": "0.1.0",
  "permissions": ["storage", "contextMenus"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_title": "打开 PindouVerse"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

Vite `rollupOptions.input` 必须同时包含 `index.html` 和 `background.ts`，并将 background entry 固定输出为 `background.js`。不得包含 `side_panel`、`content_scripts`、`host_permissions` 或 `<all_urls>`。

- [ ] **Step 5: 验证测试与构建**

Run:

```bash
npx vitest run platforms/extension/tests/background.test.ts
npm run ext:build
```

Expected: PASS；`platforms/extension/dist/manifest.json` 指向 `background.js`，且 dist 中存在该文件。

- [ ] **Step 6: 提交**

```bash
git add platforms/extension package.json package-lock.json
git commit -m "feat: open extension editor in a unique tab"
```

---

## 阶段二：本地编辑工作流

### Task 3：实现真实 `.pindou` 文件服务

**Files:**
- Create: `src/platform/projectFileService.ts`
- Create: `platforms/extension/projectFileService.ts`
- Test: `platforms/extension/tests/projectFileService.test.ts`
- Modify: `src/store/editorStore.ts`
- Modify: `src/adapters/browser.ts`
- Create: `platforms/extension/platformServices.ts`

- [ ] **Step 1: 写打开、保存、取消和权限失败测试**

```ts
it("opens and normalizes the selected pindou file", async () => {
  picker.open.mockResolvedValue([handle]);
  handle.getFile.mockResolvedValue(new File([validV3], "art.pindou"));
  const result = await service.openProject();
  expect(result.ok && result.value.document.displayName).toBe("art.pindou");
  expect(result.ok && result.value.project.width).toBe(16);
});

it("keeps dirty state when writing fails", async () => {
  handle.queryPermission.mockResolvedValue("granted");
  handle.createWritable.mockRejectedValue(new DOMException("denied"));
  const result = await service.saveProject(project, documentRef);
  expect(result.ok).toBe(false);
  expect(useEditorStore.getState().isDirty).toBe(true);
});

it("treats picker cancellation as cancellation", async () => {
  picker.open.mockRejectedValue(new DOMException("cancelled", "AbortError"));
  expect(await service.openProject()).toEqual({ ok: false, code: "cancelled" });
});
```

再覆盖：无效 JSON 不替换当前项目、`prompt` 权限请求、无句柄转 Save As、Save As 取消保留旧身份、下载回退只记录建议文件名。

- [ ] **Step 2: 运行测试确认红灯**

Run: `npx vitest run platforms/extension/tests/projectFileService.test.ts`  
Expected: FAIL，服务模块不存在。

- [ ] **Step 3: 定义共享文件类型**

```ts
export interface ProjectDocumentRef {
  displayName: string;
  writable: boolean;
  handle?: FileSystemFileHandle;
  fallbackDownloadName?: string;
}

export interface OpenedProject {
  project: ProjectFile;
  document: ProjectDocumentRef;
}

export interface ProjectFileService {
  openProject(): Promise<PlatformResult<OpenedProject>>;
  saveProject(
    project: ProjectFile,
    current: ProjectDocumentRef | null,
  ): Promise<PlatformResult<ProjectDocumentRef>>;
  saveProjectAs(
    project: ProjectFile,
    suggestedName: string,
  ): Promise<PlatformResult<ProjectDocumentRef>>;
  exportProject(
    project: ProjectFile,
    suggestedName: string,
  ): Promise<PlatformResult<void>>;
}
```

- [ ] **Step 4: 实现 File System Access 和下载回退**

```ts
const [handle] = await window.showOpenFilePicker({
  multiple: false,
  types: [{
    description: "PindouVerse Project",
    accept: { "application/json": [".pindou"] },
  }],
});
const text = await (await handle.getFile()).text();
const project = normalizeProjectFromDisk(text);
```

写盘必须使用 `serializeProjectToV3(project)`。支持句柄时依次执行 `queryPermission({ mode: "readwrite" })`、必要时 `requestPermission`、`createWritable()`、`write()`、`close()`。无 API 时以隐藏 file input 打开、以 Blob + anchor download 保存。

- [ ] **Step 5: 接入 store，只有成功后清 dirty**

`editorStore` 增加内存字段 `projectDocument: ProjectDocumentRef | null`。`openProject`、`saveProject`、`saveProjectAs` 只有在 `result.ok` 后更新 `projectPath`、`projectDocument`、`lastSavedAt`、baseline 和 `isDirty: false`。取消、拒绝和异常不能覆盖当前状态。`FileSystemFileHandle` 不持久化到 Zustand persistence 或 IndexedDB。

- [ ] **Step 6: 停止 BrowserAdapter 把正式项目写入 IndexedDB**

移除 `BrowserAdapter.saveProject/loadProject` 对正式 `projects` store 的写入依赖；旧数据只允许作为兼容读取入口，不能成为新保存路径。

- [ ] **Step 7: 验证文件 round trip 和 VS Code 回归**

Run:

```bash
npx vitest run platforms/extension/tests/projectFileService.test.ts
npx vitest run src/utils/projectSerialization.test.ts
npm test
npm --prefix platforms/vscode run test:webview -- tests/file-ops.spec.ts
```

Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add src/platform/projectFileService.ts src/store/editorStore.ts src/adapters/browser.ts platforms/extension/projectFileService.ts platforms/extension/platformServices.ts platforms/extension/tests/projectFileService.test.ts
git commit -m "feat: save browser projects as real pindou files"
```

### Task 4：分离正式文件、自动恢复和快照

**Files:**
- Create: `src/platform/recoveryStorage.ts`
- Create: `platforms/extension/recoveryStorage.ts`
- Test: `platforms/extension/tests/recoveryStorage.test.ts`
- Modify: `src/store/editorStore.ts`
- Modify: `src/App.tsx`
- Modify: `src/adapters/browser.ts`

- [ ] **Step 1: 写 recovery 失败测试**

```ts
it("autosaves recovery data without clearing dirty", async () => {
  useEditorStore.setState({ isDirty: true });
  await useEditorStore.getState().autoSave();
  expect(recovery.saveAutosave).toHaveBeenCalledOnce();
  expect(projectFiles.saveProject).not.toHaveBeenCalled();
  expect(useEditorStore.getState().isDirty).toBe(true);
});

it("marks a restored snapshot dirty", async () => {
  await useEditorStore.getState().restoreSnapshot("snapshot-1");
  expect(useEditorStore.getState().isDirty).toBe(true);
});
```

补充快照倒序、删除、导出产生可下载 `.pindou` 文件测试。

- [ ] **Step 2: 运行测试确认红灯**

Run: `npx vitest run platforms/extension/tests/recoveryStorage.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 定义并实现 recovery 接口**

```ts
export interface RecoveryStorage {
  saveAutosave(project: ProjectFile): Promise<void>;
  loadAutosave(): Promise<ProjectFile | null>;
  saveSnapshot(project: ProjectFile, label: string): Promise<SnapshotInfo>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  loadSnapshot(id: string): Promise<ProjectFile>;
  deleteSnapshot(id: string): Promise<void>;
}
```

浏览器实现使用 IndexedDB 独立 object stores：`autosave` 和 `snapshots`。自动备份不得调用 `ProjectFileService.saveProject`，不得下载文件或写回当前正式文件。

- [ ] **Step 4: 修正快照语义和浏览器文案**

恢复快照后设置 `isDirty: true`。浏览器 capability 下显示：

```text
快照仅保存在当前浏览器配置中；清理浏览器数据或卸载扩展会删除本地备份和快照。
```

“快照另存为”调用 `projectFiles.exportProject()`，而非只写 IndexedDB。

- [ ] **Step 5: 验证**

Run:

```bash
npx vitest run platforms/extension/tests/recoveryStorage.test.ts
npm test
npm --prefix platforms/vscode run test:webview -- tests/snapshot-list.spec.ts tests/snapshot-export.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/platform/recoveryStorage.ts src/store/editorStore.ts src/App.tsx src/adapters/browser.ts platforms/extension/recoveryStorage.ts platforms/extension/tests/recoveryStorage.test.ts
git commit -m "feat: separate browser recovery from project files"
```

### Task 5：保护 dirty 项目的新建流程

**Files:**
- Test: `platforms/vscode/tests/new-project-contract.spec.ts`
- Modify: `src/App.tsx`
- Modify: `src/store/editorStore.ts`
- Modify: `platforms/vscode/tests/file-ops.spec.ts`

- [ ] **Step 1: 写取消新建保留状态的失败测试**

```ts
test("cancelling New preserves a dirty project", async ({ page }) => {
  await setStoreState(page, {
    isDirty: true,
    projectPath: "old.pindou",
    cloudGistId: "gist-1",
  });
  await page.getByRole("button", { name: /^新建$/ }).click();
  await page.getByRole("button", { name: /^取消$/ }).click();
  expect(await getStoreState(page, "projectPath")).toBe("old.pindou");
  expect(await getStoreState(page, "cloudGistId")).toBe("gist-1");
  expect(await getStoreState(page, "isDirty")).toBe(true);
});
```

另写确认新建后清除 `projectPath`、`projectDocument`、`cloudGistId` 和 baseline 的测试。

- [ ] **Step 2: 运行测试确认红灯**

Run: `npm --prefix platforms/vscode run test:webview -- tests/new-project-contract.spec.ts`  
Expected: FAIL，dirty 新建没有保护。

- [ ] **Step 3: 在 App 层实现异步确认**

新增 `requestNewCanvas()`：dirty 时先显示应用内确认对话框；取消不执行任何 store action。确认后，VS Code 继续调用 `window.__pindouRequestNewProject`；浏览器/Tauri 打开现有尺寸对话框。最终 `newCanvas()` 清除旧本地/云端身份。不要在纯 store action 中调用浏览器 dialog。

- [ ] **Step 4: 验证**

Run:

```bash
npm --prefix platforms/vscode run test:webview -- tests/new-project-contract.spec.ts tests/file-ops.spec.ts
npm test
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/App.tsx src/store/editorStore.ts platforms/vscode/tests/new-project-contract.spec.ts platforms/vscode/tests/file-ops.spec.ts
git commit -m "feat: protect dirty projects when creating canvases"
```

### Task 6：实现网页图片右键任务并接入转换向导

**Files:**
- Create: `src/platform/imageImportService.ts`
- Create: `platforms/extension/imageImportService.ts`
- Test: `platforms/extension/tests/imageTasks.test.ts`
- Modify: `platforms/extension/background.ts`
- Modify: `platforms/extension/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Import/ImageImportDialog.tsx`
- Create: `src/components/Import/WebImageImportErrorDialog.tsx`

- [ ] **Step 1: 写 context menu 和一次性任务失败测试**

```ts
it("registers an image-only context menu", async () => {
  await registerContextMenu(api);
  expect(api.contextMenus.create).toHaveBeenCalledWith({
    id: "convert-image",
    title: "在 PindouVerse 中转换",
    contexts: ["image"],
  });
});

it("consumes a web image task exactly once", async () => {
  await store.create({ id: "task-1", imageUrl: imageUrl, expiresAt: now + 60_000 });
  expect(await store.consume("task-1", now)).toBeDefined();
  expect(await store.consume("task-1", now)).toBeUndefined();
});

it("drops expired tasks", async () => {
  await store.create({ id: "task-1", imageUrl, expiresAt: now - 1 });
  expect(await store.consume("task-1", now)).toBeUndefined();
});
```

再覆盖成功 fetch 后删除任务、非 `image/*` 响应失败和 fetch 错误回退。

- [ ] **Step 2: 运行测试确认红灯**

Run: `npx vitest run platforms/extension/tests/imageTasks.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 定义图片资源与任务类型**

```ts
export interface WebImageTask {
  id: string;
  imageUrl: string;
  pageUrl?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ImageImportAsset {
  id: string;
  file: File;
  displayName: string;
  source: "local" | "web-context-menu";
  sourcePageUrl?: string;
}

export interface ImageImportService {
  chooseLocalImage(): Promise<PlatformResult<ImageImportAsset>>;
  fetchWebImage(taskId: string): Promise<PlatformResult<ImageImportAsset>>;
  getAsset(id: string): ImageImportAsset | undefined;
  consumeAsset(id: string): void;
}
```

- [ ] **Step 4: 注册菜单并创建任务**

```ts
chrome.runtime.onInstalled.addListener(() => void registerContextMenu(chromeBrowserApi));
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "convert-image" || !info.srcUrl) return;
  const task = await taskStore.create(info.srcUrl, tab?.url);
  const editorTabId = await openOrFocusEditor(chromeBrowserApi);
  await chrome.tabs.sendMessage(editorTabId, {
    type: "pindou:image-task",
    taskId: task.id,
  }).catch(() => undefined);
});
```

不增加 host permissions 或 content script。

- [ ] **Step 5: 将预置图片注入现有向导**

`ImageImportDialog` 增加：

```ts
interface ImageImportDialogProps {
  onClose(): void;
  initialAsset?: ImageImportAsset;
}
```

编辑器启动查询 pending task，并监听 runtime message。使用 `fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" })`，验证 `response.ok` 和 `Content-Type`，构造 `File` 后以 `initialAsset` 打开现有转换向导。

- [ ] **Step 6: 实现明确失败回退**

`WebImageImportErrorDialog` 显示 CORS、防盗链、登录态或临时 URL 等可能原因，并提供“选择本地图片”和“关闭”。不得使用 `alert()`，不得请求全站权限。

- [ ] **Step 7: 验证**

Run:

```bash
npx vitest run platforms/extension/tests/imageTasks.test.ts
npm test
npm run ext:build
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/platform/imageImportService.ts src/App.tsx src/components/Import/ImageImportDialog.tsx src/components/Import/WebImageImportErrorDialog.tsx platforms/extension/background.ts platforms/extension/main.tsx platforms/extension/imageImportService.ts platforms/extension/tests/imageTasks.test.ts
git commit -m "feat: import web images through extension tasks"
```

### Task 7：锁定菜单合同、正确环境标识并关闭浏览器 AI

**Files:**
- Test: `platforms/vscode/tests/menu-contract.spec.ts`
- Test: `platforms/extension/tests/menu-contract.spec.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Canvas/CanvasToolbar.tsx`
- Modify: `src/hooks/useVoiceControl.ts`
- Refactor: `src/utils/llmVoice.ts`
- Modify: `platforms/vscode/webview/main.tsx`

- [ ] **Step 1: 写 VS Code 菜单合同失败测试**

为顶部菜单增加稳定的 `data-testid="top-menu"`、`data-menu-id` 和 `data-separator-id`，测试实际 DOM：

```ts
expect(await page.locator('[data-testid="top-menu"] [data-menu-id]').allTextContents())
  .toEqual([
    "新建", "调整画布", "打开", "保存", "另存为", "项目信息",
    "导入图片", "导入图纸BETA", "导出", "历史记录", "版本",
    "登录 GitHub", "反馈",
  ]);
```

另测 baseline 才显示“对比”、登录才显示“云端”、Gist 关联才显示云状态、登录状态互斥、`导入图纸 BETA` 始终存在且导入时 disabled。

- [ ] **Step 2: 写浏览器 capability 失败测试**

```ts
test("browser menu contains no AI controls", async ({ page }) => {
  await expect(page.getByText("AI语音")).toHaveCount(0);
  await expect(page.getByText("AI 语音增强")).toHaveCount(0);
});
```

反馈正文应包含 `Browser Extension (Chrome)` 或 `Browser Extension (Edge)`。

- [ ] **Step 3: 运行合同测试确认红灯**

Run:

```bash
npm --prefix platforms/vscode run test:webview -- tests/menu-contract.spec.ts
npm run ext:test:contract
```

Expected: FAIL，缺少稳定 menu id，且浏览器仍可能出现 AI 设置。

- [ ] **Step 4: capability 驱动 UI，不建立浏览器菜单副本**

```ts
export function getEnvironmentLabel(capabilities: PlatformCapabilities): string {
  if (capabilities.runtime === "vscode") return "VS Code Extension";
  if (capabilities.runtime === "browser-extension") {
    return `Browser Extension (${capabilities.browserBrand === "edge" ? "Edge" : "Chrome"})`;
  }
  return "Desktop (Tauri)";
}
```

共享 `App` 根据 `capabilities.ai` 决定 AI Beta 设置和工具栏能力；浏览器固定为 false。GitHub auth 从 `llmVoice.ts` 移出，Tauri AI 代码由桌面入口动态加载，使扩展 bundle 不包含 AI endpoint 或 `github_models_chat`。

- [ ] **Step 5: 增加构建产物无 AI 断言**

扩展验证脚本后续正式建立前，先在测试中读取 dist JS 并断言不包含：

```ts
expect(bundle).not.toContain("github_models_chat");
expect(bundle).not.toContain("models.inference.ai.azure.com");
expect(bundle).not.toContain("client_secret");
```

- [ ] **Step 6: 验证**

Run:

```bash
npm --prefix platforms/vscode run test:webview -- tests/menu-contract.spec.ts
npm run ext:build
npm run ext:test:contract
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/App.tsx src/components/Canvas/CanvasToolbar.tsx src/hooks/useVoiceControl.ts src/utils/llmVoice.ts platforms/vscode/webview/main.tsx platforms/vscode/tests/menu-contract.spec.ts platforms/extension/tests/menu-contract.spec.ts
git commit -m "feat: enforce shared menus and browser capabilities"
```

---

## 阶段三：GitHub、Gist 与共享导出

### Task 8：实现 GitHub Device Flow 和扩展 token 存储

**Files:**
- Create: `src/platform/githubService.ts`
- Create: `platforms/extension/browserStorage.ts`
- Create: `platforms/extension/githubService.ts`
- Test: `platforms/extension/tests/githubService.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Cloud/CloudDialog.tsx`
- Modify: `platforms/extension/main.tsx`
- Modify: `platforms/vscode/webview/main.tsx`

- [ ] **Step 1: 写 session 与轮询失败测试**

```ts
it("stores the token only in extension local storage", async () => {
  await service.persistSession({ accessToken: "token" });
  expect(chrome.storage.local.set).toHaveBeenCalledWith({
    "github.accessToken": "token",
  });
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it("continues after authorization_pending", async () => {
  fetchMock
    .mockResolvedValueOnce(json({ error: "authorization_pending" }))
    .mockResolvedValueOnce(json({ access_token: "token" }));
  expect(await service.pollDeviceFlow(flow, onStatus)).toMatchObject({ ok: true });
  expect(sleep).toHaveBeenCalledWith(flow.intervalSeconds * 1000);
});
```

再覆盖 `slow_down` 增加 5 秒、`access_denied`、过期、取消、401 清 session、启动恢复。

- [ ] **Step 2: 运行测试确认红灯**

Run: `npx vitest run platforms/extension/tests/githubService.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 定义 GitHub 服务类型**

```ts
export interface GitHubSession { accessToken: string }

export interface DeviceFlowHandle {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSeconds: number;
  cancel(): void;
}

export interface GitHubService {
  restoreSession(): Promise<GitHubSession | null>;
  startDeviceFlow(): Promise<PlatformResult<DeviceFlowHandle>>;
  pollDeviceFlow(
    flow: DeviceFlowHandle,
    onStatus: (status: string) => void,
  ): Promise<PlatformResult<GitHubSession>>;
  logout(): Promise<void>;
  listProjects(): Promise<PlatformResult<GistProject[]>>;
  uploadProject(input: UploadGistProject): Promise<PlatformResult<GistUploadResult>>;
  downloadProject(gistId: string): Promise<PlatformResult<DownloadedGistProject>>;
  deleteProject(gistId: string): Promise<PlatformResult<void>>;
}
```

- [ ] **Step 4: 实现 Device Flow**

请求 `https://github.com/login/device/code`，scope 为 `gist`；轮询 `https://github.com/login/oauth/access_token`，grant type 为 `urn:ietf:params:oauth:grant-type:device_code`。使用构建变量 `VITE_GITHUB_CLIENT_ID`，禁止任何 `client_secret`。`fetch`、`sleep`、`now` 可注入测试；每个 flow 使用 `AbortController`，关闭对话框立即 `cancel()`。

- [ ] **Step 5: 改为异步 session 状态**

App 不再用同步 `useState(hasToken())`。增加订阅 GitHub service session 的 hook：启动时 `restoreSession()`；登录成功立即显示“✓ GitHub 已登录”和“云端”；登出立即清 `chrome.storage.local` 并更新 UI。验证地址通过 `ExternalLinkService` 打开，失败时允许复制 URL。

- [ ] **Step 6: 验证**

Run:

```bash
npx vitest run platforms/extension/tests/githubService.test.ts
npm run ext:build
npm run ext:test:contract
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/platform/githubService.ts src/App.tsx src/components/Cloud/CloudDialog.tsx platforms/extension/browserStorage.ts platforms/extension/githubService.ts platforms/extension/main.tsx platforms/extension/tests/githubService.test.ts platforms/vscode/webview/main.tsx
git commit -m "feat: authenticate extension with GitHub Device Flow"
```

### Task 9：迁移 Gist API 并修正云端状态语义

**Files:**
- Modify: `src/utils/gistSync.ts`
- Modify: `src/components/Cloud/CloudDialog.tsx`
- Modify: `src/store/editorStore.ts`
- Extend: `platforms/extension/tests/githubService.test.ts`
- Test: `platforms/vscode/tests/cloud-contract.spec.ts`

- [ ] **Step 1: 写完整项目和状态失败测试**

```ts
it("uploads a complete v3 project", async () => {
  await github.uploadProject(input);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  const saved = JSON.parse(body.files["project.pindou"].content);
  expect(saved.version).toBe(3);
  expect(saved.layers).toEqual(input.project.layers);
  expect(saved.projectInfo).toEqual(input.project.projectInfo);
});

it("does not clear local dirty after cloud upload", async () => {
  useEditorStore.setState({ isDirty: true });
  await uploadCurrentProject();
  expect(useEditorStore.getState().isDirty).toBe(true);
});
```

再覆盖下载后 `projectDocument/projectPath === null`、401 清 session、403 rate limit、最近上传列表最终一致性和删除关联 Gist。

- [ ] **Step 2: 运行测试确认红灯**

Run:

```bash
npx vitest run platforms/extension/tests/githubService.test.ts
npm --prefix platforms/vscode run test:webview -- tests/cloud-contract.spec.ts
```

Expected: FAIL。

- [ ] **Step 3: 统一项目构造和序列化**

将 `buildProjectFile` 从 store 私有函数提取为可复用的纯函数；上传使用 `serializeProjectToV3`，下载使用 `normalizeProjectFromDisk`。删除 CloudDialog 手工构造 v1 项目的代码。

- [ ] **Step 4: 分离本地 dirty 与云同步状态**

```ts
export type CloudSyncStatus =
  | "unlinked"
  | "synced"
  | "local-changes"
  | "remote-newer";
```

Gist 上传成功不得设置 `isDirty: false`。下载项目时显式设置 `projectDocument: null`、`projectPath: null`、`cloudGistId`、`cloudUpdatedAt` 和项目名；首次本地保存必须进入 Save As。401 清 session；403 rate-limit 映射 `retryAfterSeconds`。

- [ ] **Step 5: 验证**

Run:

```bash
npx vitest run platforms/extension/tests/githubService.test.ts
npm test
npm --prefix platforms/vscode run test:webview -- tests/cloud-contract.spec.ts tests/menu-contract.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/utils/gistSync.ts src/components/Cloud/CloudDialog.tsx src/store/editorStore.ts platforms/extension/tests/githubService.test.ts platforms/vscode/tests/cloud-contract.spec.ts
git commit -m "feat: sync complete projects through Gist services"
```

### Task 10：抽取浏览器与 VS Code 共享 Canvas 导出

**Files:**
- Create: `src/utils/canvasExport.ts`
- Test: `src/utils/canvasExport.test.ts`
- Modify: `src/adapters/browser.ts`
- Modify: `platforms/vscode/src/vscodeAdapter.ts`
- Modify: `platforms/vscode/tests/export.spec.ts`
- Test: `platforms/extension/tests/export-contract.spec.ts`

- [ ] **Step 1: 写共享渲染失败测试**

```ts
it("uses one-cell axis margins on all four sides", async () => {
  const blob = await renderBlueprintBlob(request, { appIcon: null });
  const bitmap = await createImageBitmap(blob);
  expect(bitmap.width).toBe(expectedContentWidth + 2 * request.cellSize);
  expect(bitmap.height).toBe(expectedContentHeight + 2 * request.cellSize);
});

it("returns PNG and JPEG blobs with the requested mime type", async () => {
  expect((await renderBlueprintBlob(pngRequest, assets)).type).toBe("image/png");
  expect((await renderPreviewBlob(jpegRequest, assets)).type).toBe("image/jpeg");
});
```

再覆盖 header、watermark、legend、5/10 格网和透明豆。

- [ ] **Step 2: 运行测试确认红灯**

Run: `npx vitest run src/utils/canvasExport.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 定义共享 renderer**

```ts
export async function renderBlueprintBlob(
  request: Omit<ExportImageRequest, "output_path">,
  assets: { appIcon?: CanvasImageSource | null },
): Promise<Blob>;

export async function renderPreviewBlob(
  request: Omit<ExportPreviewRequest, "output_path">,
  assets: { appIcon?: CanvasImageSource | null },
): Promise<Blob>;
```

以 `platforms/vscode/src/vscodeAdapter.ts` 当前四边 axis margin、顶部/底部列号、左右行号、网格、外框、header、水印和图例布局为合同。两个 adapter 只负责将 Blob 写文件或下载。

- [ ] **Step 4: 删除两套重复 Canvas 绘制**

`BrowserAdapter.exportImage/exportPreview` 和 `VSCodeAdapter.exportImage/exportPreview` 都调用共享 renderer。VS Code 用 RPC/file sink，浏览器用 Blob download sink。

- [ ] **Step 5: 增加跨平台导出合同**

在同一 Linux Chromium 环境比较尺寸和稳定像素采样；PNG 可在相同运行环境比较 hash，JPEG 不跨 OS 比较字节。

- [ ] **Step 6: 验证**

Run:

```bash
npx vitest run src/utils/canvasExport.test.ts
npm --prefix platforms/vscode run test:webview -- tests/export.spec.ts
npm run ext:test:contract -- --grep export
npm run ext:build
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/utils/canvasExport.ts src/utils/canvasExport.test.ts src/adapters/browser.ts platforms/vscode/src/vscodeAdapter.ts platforms/vscode/tests/export.spec.ts platforms/extension/tests/export-contract.spec.ts
git commit -m "refactor: share Canvas exports across platforms"
```

---

## 阶段四：E2E、构建和发布

### Task 11：建立 Playwright 浏览器扩展 E2E

**Files:**
- Create: `platforms/extension/playwright.config.ts`
- Create: `platforms/extension/tests/fixtures.ts`
- Create: `platforms/extension/tests/extension.spec.ts`
- Create: `platforms/extension/tests/mockGithub.ts`
- Create: `platforms/extension/tests/fixtures/sample.pindou`
- Create: `platforms/extension/tests/fixtures/public-image.png`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 添加扩展测试依赖和脚本**

增加根 dev dependencies：`@playwright/test`、`@types/chrome`。增加：

```json
{
  "scripts": {
    "ext:build:test": "node scripts/build-extension.mjs chrome test",
    "ext:test:contract": "playwright test -c platforms/extension/playwright.config.ts --project=contract",
    "ext:test:e2e": "playwright test -c platforms/extension/playwright.config.ts --project=extension"
  }
}
```

- [ ] **Step 2: 创建 persistent context fixture**

```ts
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent("serviceworker");
const extensionId = new URL(worker.url()).host;
```

CI 用 `xvfb-run -a`。固定 Playwright Chromium 版本，避免 headless extension 支持差异。

- [ ] **Step 3: 写唯一标签页与 dirty 新建 E2E**

连续调用 production `openOrFocusEditor()` 的测试 seam，断言只有一个 extension editor page；第二次聚焦已有 tab。通过 store hook 修改 dirty，验证取消/确认新建状态。工具栏物理点击保留给手工 smoke，不增加生产后门。

- [ ] **Step 4: 写文件与下载 E2E**

注入 fake `showOpenFilePicker/showSaveFilePicker` 和 fake handle，验证 v3 round trip、写失败保留 dirty。移除 picker API 后用 `page.waitForEvent("download")` 验证文件名和 JSON；再次 Save 应再次下载。

- [ ] **Step 5: 写网页图片、Device Flow 和 Gist E2E**

通过 background 创建图片任务，route mock 返回 `image/png`，断言自动打开转换向导且 task 删除；失败时出现本地导入按钮。mock GitHub device code、pending、token success、Gist list/create/get/delete，断言 token 只在 `chrome.storage.local`，下载 Gist 后 `projectPath === null`。

- [ ] **Step 6: 写重启恢复 E2E**

关闭编辑器页面后重新打开，验证 settings/token 从 extension storage 恢复，recovery snapshot 从 IndexedDB 恢复。

- [ ] **Step 7: 运行完整扩展 E2E**

Run:

```bash
npm run ext:build:test
npm run ext:test:contract
npm run ext:test:e2e
```

Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add platforms/extension/playwright.config.ts platforms/extension/tests package.json package-lock.json
git commit -m "test: cover extension workflows with Playwright"
```

### Task 12：生成、验证并打包 Chrome/Edge 产物

**Files:**
- Create: `scripts/build-extension.mjs`
- Create: `scripts/validate-extension-manifest.mjs`
- Create: `scripts/package-extension.mjs`
- Create: `platforms/extension/store/chrome.json`
- Create: `platforms/extension/store/edge.json`
- Create: `platforms/extension/tsconfig.json`
- Modify: `platforms/extension/vite.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/version.sh`

- [ ] **Step 1: 写 manifest 验证脚本的失败测试/fixture**

验证器必须执行：

```js
assert.equal(manifest.manifest_version, 3);
assert.deepEqual([...manifest.permissions].sort(), ["contextMenus", "storage"]);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
assert.equal(manifest.side_panel, undefined);
assert.equal(manifest.background.service_worker, "background.js");
assert.equal(manifest.action.default_popup, undefined);
```

为带 `<all_urls>`、Side Panel 和错误 background 名称的 fixtures 断言非零退出码。

- [ ] **Step 2: 运行验证器测试确认红灯**

Run: `node --test scripts/validate-extension-manifest.test.mjs`  
Expected: FAIL，脚本不存在。

- [ ] **Step 3: 实现 build 与品牌 overlay**

`build-extension.mjs` 从根 `package.json` 读取版本，合并 `manifest.base.json` 与 `store/chrome.json` 或 `store/edge.json`，运行扩展 `tsc --noEmit` 和 Vite build。两个品牌只允许 name/description/listing metadata 差异，不允许权限差异。

- [ ] **Step 4: 实现安全产物扫描**

验证器递归扫描 dist，拒绝：`client_secret`、`github_models_chat`、`models.inference.ai.azure.com`、`<all_urls>`。确认无 source map、测试文件和源码。

- [ ] **Step 5: 实现可重复 zip**

使用 `archiver` 将 dist 内容直接放在 zip 根目录，输出：

```text
artifacts/pindouverse-chrome-<version>.zip
artifacts/pindouverse-edge-<version>.zip
```

zip 根必须直接包含 `manifest.json`、`index.html`、`background.js`、assets 和 icons，不能嵌套 `dist/`。

- [ ] **Step 6: 增加命令与版本同步**

```json
{
  "scripts": {
    "ext:build:chrome": "node scripts/build-extension.mjs chrome",
    "ext:build:edge": "node scripts/build-extension.mjs edge",
    "ext:validate": "node scripts/validate-extension-manifest.mjs platforms/extension/dist",
    "ext:package": "node scripts/package-extension.mjs"
  }
}
```

扩展 manifest 不硬编码版本；构建时从根版本写入。`scripts/version.sh --apply` 保持根 package、Tauri 和现有平台版本一致，不创建第二个版本源。

- [ ] **Step 7: 验证两个包**

Run:

```bash
npm run ext:build:chrome
npm run ext:validate
npm run ext:build:edge
npm run ext:validate
npm run ext:package
```

Expected: 两个 zip 创建成功，验证器无输出错误。

- [ ] **Step 8: 提交**

```bash
git add scripts/build-extension.mjs scripts/validate-extension-manifest.mjs scripts/validate-extension-manifest.test.mjs scripts/package-extension.mjs platforms/extension/manifest.base.json platforms/extension/store platforms/extension/tsconfig.json platforms/extension/vite.config.ts package.json package-lock.json scripts/version.sh
git commit -m "build: package validated Chrome and Edge extensions"
```

### Task 13：接入 CI 和 GitHub Release 产物

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 在 CI 新增 extension job**

```yaml
test-extension:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - uses: actions/setup-node@v6
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - run: npx playwright install --with-deps chromium
    - run: npm run ext:build:chrome
    - run: npm run ext:validate
    - run: xvfb-run -a npm run ext:test:e2e
    - run: npm run ext:build:edge
    - run: npm run ext:validate
    - run: npm run ext:package
    - uses: actions/upload-artifact@v4
      if: always()
      with:
        name: browser-extension-artifacts
        path: |
          artifacts/*.zip
          platforms/extension/test-results/
```

让最终 build job `needs` 包含 `test-extension`。

- [ ] **Step 2: 在 release workflow 生成双商店 zip**

在版本计算后构建、验证和打包 Chrome/Edge，并把两个 zip 上传至 GitHub draft release。第一版不自动提交商店 API，因为尚未定义商店账号 secret 和不可逆发布确认流程。

- [ ] **Step 3: 本地验证 workflow 引用的命令存在**

Run:

```bash
npm run ext:build:chrome
npm run ext:validate
npm run ext:test:e2e
npm run ext:build:edge
npm run ext:validate
npm run ext:package
```

Expected: PASS，workflow 中没有不存在的 npm script。

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: validate and package browser extensions"
```

### Task 14：执行最终跨平台验收

**Files:**
- Modify only if verification exposes a specific defect; commit each fix separately with its regression test.

- [ ] **Step 1: 运行根测试和桌面构建**

Run:

```bash
npm ci
npm test
npm run build
```

Expected: PASS。

- [ ] **Step 2: 运行 VS Code 完整验证**

Run:

```bash
npm --prefix platforms/vscode ci
npm --prefix platforms/vscode run build
npm --prefix platforms/vscode run test:webview
npm --prefix platforms/vscode run test:e2e
```

Expected: webview 全部 PASS；Windows 上 host E2E 按项目规则正常跳过，Linux CI 实际执行。

- [ ] **Step 3: 运行扩展完整验证**

Run:

```bash
npm run ext:build:chrome
npm run ext:validate
npm run ext:test:contract
npm run ext:test:e2e
npm run ext:build:edge
npm run ext:validate
npm run ext:package
```

Expected: PASS，两个 zip 存在。

- [ ] **Step 4: 检查 zip 内容**

Run:

```bash
unzip -l artifacts/pindouverse-chrome-*.zip
unzip -l artifacts/pindouverse-edge-*.zip
```

Expected: zip 根含 `manifest.json`、`index.html`、`background.js`、assets 和 icons；不含源码、测试、source map、token、secret、Side Panel、content script 或 host permissions。

- [ ] **Step 5: Chrome 手工 smoke**

在 `chrome://extensions` 加载 unpacked Chrome dist，逐项验证：action 打开/聚焦唯一标签页；真实 `.pindou` 打开/保存/另存为；拒绝权限保留 dirty；公开图片右键进入转换向导；不可读取图片出现本地回退；Device Flow 登录/登出/重启恢复；Gist 上传/下载/删除；无 AI UI；反馈标识为 `Browser Extension (Chrome)`。

- [ ] **Step 6: Edge 手工 smoke**

在 `edge://extensions` 加载 Edge dist，重复关键流程；反馈标识为 `Browser Extension (Edge)`。

- [ ] **Step 7: 核对商店说明**

Chrome/Edge listing 必须明确：右键导入仅支持扩展可直接读取的公开图片；不请求所有网站数据；不注入 content script；token 存扩展本地且不跨设备同步；卸载或清理浏览器数据会删除恢复数据/快照；正式项目是用户可取得的 `.pindou` 文件。

- [ ] **Step 8: 请求代码审查**

调用 `superpowers:requesting-code-review`，审查范围为设计提交之后的全部实现提交；修复确认问题并重新执行 Steps 1–4。

- [ ] **Step 9: 进入分支收尾流程**

所有自动化和手工 smoke 均通过后调用 `superpowers:finishing-a-development-branch`。不得直接提交到 `main`；按项目规则 squash merge。

---

## 阶段检查点

每个阶段最后运行：

```bash
npm test
npm --prefix platforms/vscode run test:webview
npm run ext:build
```

预期：三个命令均 PASS。若失败，当前阶段不得标记完成，也不得开始下一阶段。

## 风险控制

1. `PlatformAdapter` 暂不一次性删除；先迁移文件、GitHub、外链和 recovery，降低回归面。
2. File System Access 原生 chooser 由单元测试验证参数，Playwright 用 fake handle 验证状态机，真实 chooser 由 Chrome/Edge smoke 验证。
3. Playwright 不稳定支持点击浏览器工具栏，因此自动化直接验证 action handler 的生产函数，手工 smoke 验证物理点击。
4. GitHub Device Flow 的 client ID 可公开，`client_secret` 绝不进入扩展、构建变量或 CI artifact。
5. 云同步状态与本地 `isDirty` 分离；上传 Gist 不能把本地文件标为已保存。
6. 自动恢复不得调用正式文件保存服务，否则可能周期性下载或覆盖文件。
7. 共享导出以当前 VS Code 四边坐标轴实现为合同，不保留两套布局。
8. 浏览器品牌只在启动/构建边界判断，业务组件只读取 capability。
