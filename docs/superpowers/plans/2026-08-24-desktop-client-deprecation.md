# Desktop Client Deprecation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 VS Code 扩展明确为 PindouVerse 主平台、Chrome/Edge 扩展为第二优先级，并将保留源码与应急发布能力的 Desktop/Tauri 客户端标记为 Legacy / Deprecated。

**Architecture:** 通过 README 和维护指南统一产品定位，通过 workflow 名称、注释及手动确认输入降低误发桌面版本的风险，同时保留 Desktop 编译 CI 和完整 Tauri 实现。使用 `tests/workflowContract.test.ts` 锁定文档定位、版本线边界、Desktop CI 保留以及应急发布门槛。

**Tech Stack:** Markdown、GitHub Actions YAML、Vitest、Node.js

---

## 文件清单

- Modify: `README.md` — 产品平台优先级、安装/开发入口、Legacy Desktop 历史下载与维护命令。
- Modify: `platforms/vscode/README.md` — Marketplace 文档中将 VS Code 标记为主平台，移除 Desktop/Mobile 活跃可用承诺。
- Modify: `CLAUDE.md` — 将根版本系统限定为 Legacy Desktop，并说明扩展独立版本线。
- Modify: `.github/instructions/versioning.instructions.md` — 同步版本与应急发布规则。
- Modify: `.github/workflows/ci.yml` — 保留 Desktop 编译，只修改可见名称与注释。
- Modify: `.github/workflows/release.yml` — 标记 Legacy Desktop，并增加应急确认输入。
- Modify: `tests/workflowContract.test.ts` — 锁定上述政策，防止后续文档和 workflow 回退。

### Task 1: 用合同测试定义平台定位

- [ ] **Step 1: 在 `tests/workflowContract.test.ts` 加载文档**

```ts
const rootReadme = read("README.md");
const vscodeReadme = read("platforms/vscode/README.md");
const claudeGuide = read("CLAUDE.md");
const versioningGuide = read(".github/instructions/versioning.instructions.md");
```

- [ ] **Step 2: 添加失败的平台定位测试**

```ts
it("documents VS Code as primary and Desktop as legacy without removing historical access", () => {
  expect(rootReadme).toContain("VS Code 扩展（主要维护平台）");
  expect(rootReadme).toContain("Chrome / Edge 浏览器扩展（次要维护平台）");
  expect(rootReadme).toContain("Desktop / Tauri（Legacy / Deprecated）");
  expect(rootReadme).toContain("历史安装包");
  expect(rootReadme).toContain("严重兼容性或安全问题");
  expect(vscodeReadme).toContain("the primary maintained platform and the recommended way to use PindouVerse");
  expect(vscodeReadme).toContain("Desktop / Tauri client is now **Legacy / Deprecated**");
  expect(vscodeReadme).not.toContain("The desktop app (Windows/macOS/Linux) and mobile app are also available.");
});
```

- [ ] **Step 3: 添加失败的版本线和 workflow 测试**

加入规范中定义的三项合同：

- `keeps extension and legacy desktop version lines separate`
- `retains legacy desktop compilation after every test job`
- `keeps legacy desktop releases manual and requires explicit emergency confirmation`

测试中逐字断言：

```ts
expect(scripts.test).toBe("vitest run");
expect(claudeGuide).toContain("The root version system applies only to the **Legacy / Deprecated Desktop/Tauri client**");
expect(versioningGuide).toContain("exclusively for the Legacy / Deprecated Desktop/Tauri client");
expect(jobBlock(ci, "build")).toContain("name: Legacy Desktop build (compile validation only)");
expect(release).toMatch(/^name: Legacy Desktop Release$/m);
expect(release).toContain("confirm_emergency_release:");
expect(release).toContain('!= "RELEASE_LEGACY_DESKTOP"');
```

- [ ] **Step 4: 运行测试确认失败**

```bash
npm test -- tests/workflowContract.test.ts
```

Expected: FAIL，缺少新的平台措辞和 workflow 应急门槛。

### Task 2: 更新用户 README

- [ ] **Step 1: 更新 `README.md` 顶部状态和主要入口**

使用已批准规范中的平台状态块；将 VS Code 开发流程放在第一节，Chrome/Edge 放在第二节。

- [ ] **Step 2: 将现有 Tauri 内容改为 Legacy 维护章节**

保留命令和历史下载链接，但删除“推荐”措辞，并加入：

```md
> Desktop 客户端不再进行常规功能开发或发布。以下内容仅用于保留源码的编译验证，以及严重兼容性或安全问题的 best-effort 应急维护。
```

- [ ] **Step 3: 更新项目结构和功能概览**

将 Tauri 标为 Legacy，补充 VS Code 为主要维护平台，并将平台支持描述统一为批准的四级优先级。

- [ ] **Step 4: 更新 `platforms/vscode/README.md`**

加入：

```md
> **PindouVerse for VS Code is the primary maintained platform and the recommended way to use PindouVerse.**
```

将 About 段替换为规范中的 VS Code 主平台、浏览器扩展次级、Desktop Legacy 说明及历史下载链接。

- [ ] **Step 5: 运行平台定位合同**

```bash
npm test -- tests/workflowContract.test.ts
```

Expected: 文档定位测试通过；workflow 相关新测试仍失败。

- [ ] **Step 6: 提交用户文档**

```bash
git add README.md platforms/vscode/README.md tests/workflowContract.test.ts
git commit -m "docs: deprecate desktop client" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3: 更新开发者版本说明

- [ ] **Step 1: 更新 `CLAUDE.md` 版本章节**

将标题改为 `Legacy Desktop Versioning`，明确根 `VERSION` 和 `scripts/version.sh` 只服务 Legacy Desktop；VS Code 版本源为 `platforms/vscode/package.json`，lockfile 必须同步。

- [ ] **Step 2: 更新 `.github/instructions/versioning.instructions.md`**

采用设计中的 frontmatter、Legacy Desktop 标题、Key Files、Commands 和 Emergency Release 文案；明确扩展发布不得使用根版本脚本或 Desktop workflow。

- [ ] **Step 3: 运行版本线合同测试**

```bash
npm test -- tests/workflowContract.test.ts
```

Expected: 文档和版本线合同通过；workflow 门槛测试仍失败。

- [ ] **Step 4: 提交开发者说明**

```bash
git add CLAUDE.md .github/instructions/versioning.instructions.md
git commit -m "docs: separate legacy desktop versioning" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 4: 标记 Desktop CI 和应急发布流程

- [ ] **Step 1: 更新 `.github/workflows/ci.yml`**

保留 job ID `build`、矩阵、Rust、cache 和 Tauri build。添加两行注释，设置：

```yaml
name: Legacy Desktop build (compile validation only)
```

将构建步骤命名为：

```yaml
- name: Compile Legacy Desktop application
  run: npm run tauri build
```

- [ ] **Step 2: 更新 `.github/workflows/release.yml`**

设置：

```yaml
name: Legacy Desktop Release
```

保留 `workflow_dispatch`，以 `confirm_emergency_release` 替换未使用的 `bump_major`；要求输入 `RELEASE_LEGACY_DESKTOP`。

在 `compute-version` checkout 前加入：

```yaml
- name: Confirm emergency-only release
  env:
    CONFIRMATION: ${{ inputs.confirm_emergency_release }}
  run: |
    if [ "${CONFIRMATION}" != "RELEASE_LEGACY_DESKTOP" ]; then
      echo 'Legacy Desktop releases are emergency-only. Enter RELEASE_LEGACY_DESKTOP to continue.' >&2
      exit 1
    fi
```

将 build/finalize 的可见名称标记为 Legacy Desktop，不改变 job ID 或依赖关系。

- [ ] **Step 3: 运行 workflow 合同测试**

```bash
npm test -- tests/workflowContract.test.ts
```

Expected: 全部通过。

- [ ] **Step 4: 提交 workflow 标记**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: mark desktop workflows as legacy" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 5: 全量验证

- [ ] **Step 1: 运行根测试**

```bash
npm ci
npm test
```

Expected: 全部通过。

- [ ] **Step 2: 验证 VS Code 主平台**

```bash
npm --prefix platforms/vscode ci
npm --prefix platforms/vscode test
```

Expected: unit 与 webview 测试通过；Windows 本地 host smoke 按项目规则跳过。

- [ ] **Step 3: 搜索矛盾措辞**

```bash
git grep -nEi "desktop.*available|desktop.*推荐|tauri.*推荐|常规.*desktop.*发布" -- README.md platforms/vscode/README.md CLAUDE.md .github/instructions/versioning.instructions.md
```

Expected: 无把 Desktop 描述为推荐或常规发布目标的结果。

- [ ] **Step 4: 确认 Desktop 实现与验证仍保留**

```bash
git grep -nE "npm run tauri build|tauri-action|src-tauri" -- .github/workflows/ci.yml .github/workflows/release.yml package.json README.md
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: Tauri build/release 实现仍存在；diff 无格式错误；只有计划内文件变化。
