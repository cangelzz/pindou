# Smooth Wheel Zoom VS Code 1.4.1 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已测试的平滑滚轮缩放功能通过关联 issue #5 的 squash PR 合并到 `main`，并从合并后的 main 构建、测试及使用 Entra ID 发布 VS Code 扩展 `1.4.1`。

**Architecture:** 功能和 VS Code 版本更新先在现有隔离 worktree 中验证，再基于最新 `origin/main` 整理成一个发布候选提交并推送 PR。PR 合并后创建新的干净发布 worktree，从已合并的 main 重新测试、构建、检查 VSIX，最后运行仓库既有的 Entra 发布脚本。

**Tech Stack:** Git/GitHub CLI、GitHub Actions、Node.js/npm、TypeScript、Vite、Playwright、VSCE、Microsoft Entra ID

---

### Task 1: 更新 VS Code 扩展版本到 1.4.1

**Files:**
- Modify: `platforms/vscode/package.json:5`

- [ ] **Step 1: 确认当前版本为 1.4.0**

```bash
node -e "const p=require('./platforms/vscode/package.json'); if(p.version!=='1.4.0') process.exit(1); console.log(p.version)"
```

Expected: 输出 `1.4.0`。

- [ ] **Step 2: 更新扩展版本**

将 `platforms/vscode/package.json` 中：

```json
"version": "1.4.0"
```

改为：

```json
"version": "1.4.1"
```

该目录没有独立 `package-lock.json`，不要修改根 `VERSION` 或根 `package.json`。

- [ ] **Step 3: 验证版本和发布前测试**

```bash
node -e "const p=require('./platforms/vscode/package.json'); if(p.version!=='1.4.1') process.exit(1); console.log(p.version)"
npm --prefix platforms/vscode run test:webview
```

Expected: 输出 `1.4.1`，Playwright webview suite 全部通过。

- [ ] **Step 4: 构建并检查测试 VSIX**

```bash
npm --prefix platforms/vscode run build
npm --prefix platforms/vscode exec -- vsce package --no-dependencies --out ../../temp/pindouverse-1.4.1-pr.vsix
```

Expected: `temp/pindouverse-1.4.1-pr.vsix`存在，版本为 `1.4.1`。用 Python `zipfile` 检查 CRC、必需文件和禁止项：

```bash
python - <<'PY'
import zipfile
p = 'temp/pindouverse-1.4.1-pr.vsix'
with zipfile.ZipFile(p) as z:
    assert z.testzip() is None
    names = z.namelist()
    for required in (
        'extension/package.json',
        'extension/dist/extension.js',
        'extension/dist/webview/index.html',
        'extension/dist/webview/assets/index.js',
        'extension/dist/webview/assets/style.css',
    ):
        assert required in names, required
    assert not any('node_modules' in name or '.worktrees' in name or '../' in name for name in names)
print('VSIX OK')
PY
```

- [ ] **Step 5: 提交版本更新**

```bash
git add platforms/vscode/package.json
git commit -m "chore: bump VS Code extension to 1.4.1" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 整理单提交 PR 分支

**Files:**
- Preserve: root worktree user changes
- Include: all committed changes from `main..feature/smooth-wheel-zoom-impl`

- [ ] **Step 1: 获取最新远端 main 并检查工作树**

```bash
git fetch origin main
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: 实现 worktree 干净；提交列表仅包含设计、计划、功能、测试、基线测试稳定和版本更新。

- [ ] **Step 2: 创建基于最新 main 的 PR 分支**

从仓库外或另一个隔离 worktree 执行：

```bash
git worktree add .worktrees/smooth-wheel-zoom-pr -b feature/smooth-wheel-zoom-pr origin/main
```

Expected: 新 worktree 位于 `.worktrees/smooth-wheel-zoom-pr`，分支基于最新 `origin/main`。

- [ ] **Step 3: squash 导入完整变更**

在 PR worktree 中运行：

```bash
git merge --squash feature/smooth-wheel-zoom-impl
git status --short
git diff --check
```

Expected: staged/unstaged diff 只包含平滑缩放实现、测试、设计/计划、export contract 测试稳定修复及 VS Code `1.4.1`。

- [ ] **Step 4: 创建单一功能提交**

```bash
git commit -m "feat: add smooth canvas wheel zoom" -m "Closes #5" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: 在 PR worktree 运行完整验证**

```bash
npm ci
npm test
npm run build
npm --prefix platforms/vscode run test:webview
npm run ext:build:chrome
npm run ext:build:edge
npm run ext:validate
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: 所有命令成功，工作树干净。

---

### Task 3: 推送并创建关联 issue #5 的 PR

**Files:**
- External: GitHub PR

- [ ] **Step 1: 推送 PR 分支**

```bash
git push -u origin feature/smooth-wheel-zoom-pr
```

Expected: 推送成功并设置 upstream。

- [ ] **Step 2: 创建 PR**

```bash
gh pr create \
  --repo cangelzz/pindouverse \
  --base main \
  --head feature/smooth-wheel-zoom-pr \
  --title "feat: add smooth canvas wheel zoom" \
  --body "$(cat <<'EOF'
## Summary
- add smooth real-time wheel zoom centered on the pointer
- support ordinary, Ctrl, and Cmd wheel input without browser page zoom
- preserve fractional canvas scale and add VS Code webview regression coverage
- bump the VS Code extension to 1.4.1

Closes #5

## Test plan
- `npm test`
- `npm run build`
- `npm --prefix platforms/vscode run test:webview`
- Chrome and Edge extension builds and validation
- user-installed VSIX verification
EOF
)"
```

Expected: 返回新 PR URL。

- [ ] **Step 3: 检查 PR 元数据与 issue 关联**

```bash
gh pr view --repo cangelzz/pindouverse --json number,url,state,mergeStateStatus,statusCheckRollup,body
```

Expected: PR 为 OPEN，body 包含 `Closes #5`。

- [ ] **Step 4: 等待 CI 完成**

```bash
gh pr checks --repo cangelzz/pindouverse --watch --fail-fast
```

Expected: 所有 required checks 成功。若失败，停止合并并调查失败原因。

---

### Task 4: Squash merge 并确认 issue 关闭

**Files:**
- External: GitHub PR and issue #5

- [ ] **Step 1: 合并 PR**

```bash
gh pr merge --repo cangelzz/pindouverse --squash --delete-branch
```

Expected: PR 成功 squash merge，远端功能分支删除。

- [ ] **Step 2: 确认 PR 和 issue 状态**

```bash
gh pr view --repo cangelzz/pindouverse --json state,mergedAt,mergeCommit,url
gh issue view 5 --repo cangelzz/pindouverse --json state,closedAt,url
```

Expected: PR state 为 `MERGED`，issue #5 state 为 `CLOSED`。

---

### Task 5: 从合并后的 main 重建发布候选

**Files:**
- Create worktree: `.worktrees/vscode-1.4.1-release`
- Output: `temp/pindouverse-1.4.1.vsix`

- [ ] **Step 1: 获取合并后的 main 并创建干净发布 worktree**

```bash
git fetch origin main
git worktree add --detach .worktrees/vscode-1.4.1-release origin/main
```

Expected: 新 worktree 指向合并后的 `origin/main`。

- [ ] **Step 2: 安装依赖并确认版本**

```bash
npm --prefix .worktrees/vscode-1.4.1-release ci
node -e "const p=require('./.worktrees/vscode-1.4.1-release/platforms/vscode/package.json'); if(p.version!=='1.4.1') process.exit(1); console.log(p.version)"
```

Expected: 输出 `1.4.1`。

- [ ] **Step 3: 运行发布前必需测试和构建**

```bash
npm --prefix .worktrees/vscode-1.4.1-release/platforms/vscode run test:webview
npm --prefix .worktrees/vscode-1.4.1-release run build
```

Expected: webview suite 全部通过；根项目构建通过。

- [ ] **Step 4: 生成并检查合并后 VSIX**

```bash
npm --prefix .worktrees/vscode-1.4.1-release/platforms/vscode exec -- vsce package --no-dependencies --out ../../../temp/pindouverse-1.4.1.vsix
```

使用 Task 1 的 ZIP 检查逻辑验证 CRC、必需文件以及无 `node_modules`、`.worktrees`、父级路径。

Expected: `temp/pindouverse-1.4.1.vsix`有效。

---

### Task 6: 使用 Entra ID 发布 1.4.1

**Files:**
- External: VS Code Marketplace
- Script: `platforms/vscode/scripts/publish-entra.js`

- [ ] **Step 1: 确认用户测试授权**

用户已明确说明 `tested` 并要求发布。记录该授权，不再次要求安装确认。

- [ ] **Step 2: 从合并后的发布 worktree运行 Entra 发布**

```bash
npm --prefix .worktrees/vscode-1.4.1-release/platforms/vscode run publish:entra
```

Expected: 构建、打包和 Entra 发布流程成功；不得使用 `publish:pat`。

若 `publish:entra` 内部默认 `npm run package` 因依赖发现问题失败，应先在该干净发布 worktree 调查。不得跳过构建或改用 PAT。

- [ ] **Step 3: 验证发布版本**

检查发布命令输出，确认 publisher 为 `PindouVerse`、版本为 `1.4.1`。如 Marketplace API/页面可用，再验证最新版本；如传播延迟，明确报告发布命令成功但页面尚待同步。

- [ ] **Step 4: 报告最终状态**

报告：

- PR URL 和 merge commit
- issue #5 已关闭
- 合并后 webview 测试结果
- 最终 VSIX 路径
- Entra 发布结果和版本 `1.4.1`
- 根工作区原有未提交内容未被触碰
