# 平滑滚轮缩放 VS Code 1.4.1 发布设计

## 目标

将已完成并经用户测试确认的平滑滚轮缩放功能通过 GitHub Pull Request 合并到 `main`，自动关闭 GitHub issue #5，并从合并后的 `main` 构建及通过 Entra ID 发布 VS Code 扩展 `1.4.1`。

## 范围

- 将 `platforms/vscode/package.json` 的扩展版本从 `1.4.0` 更新为 `1.4.1`。
- 保留已完成的平滑滚轮缩放实现及测试。
- 创建关联 issue #5 的 PR，正文使用 `Closes #5`。
- 等待 PR 验证通过后 squash merge。
- 确认 issue #5 已关闭。
- 从合并后的 `main` 重新运行发布前测试和构建。
- 使用 `npm run publish:entra` 发布 VS Code 扩展 `1.4.1`。

## 非目标

- 不发布 Chrome/Edge 扩展新版本。
- 不修改根项目 `VERSION`；`1.4.1` 是 VS Code 扩展自身版本。
- 不使用 PAT 发布。
- 不发布未经合并后的 `main` 重建的 VSIX。

## Git 与 PR 流程

1. 在隔离 worktree 的功能分支中提交 VS Code `1.4.1` 版本更新。
2. 获取最新 `origin/main`，将功能分支整理为基于最新 main 的单个提交，避免把设计过程中的多次中间提交直接带入主历史。
3. 推送远端功能分支。
4. 创建 PR，摘要描述平滑滚轮缩放、浮点视图精度和自动化测试；正文包含 `Closes #5`。
5. 检查 CI 状态；只有验证通过后才 squash merge。
6. 确认 PR 状态为 merged，issue #5 状态为 closed。

## 发布验证

合并后从最新 `origin/main` 创建干净发布工作区，依次运行：

- `npm run test:webview`
- `npm run build`
- 使用 `vsce package --no-dependencies` 生成测试 VSIX并检查包内容
- 确认 `platforms/vscode/package.json` 版本为 `1.4.1`

测试通过且包内容有效后，运行：

```bash
npm run publish:entra
```

发布脚本仍会执行自身构建和打包流程。若默认 `npm run package` 因 monorepo/worktree 依赖发现问题失败，应在合并后的干净 main 环境确认问题；不得改用 PAT 绕过。

## 成功标准

- PR 已 squash merge 到 `main`。
- GitHub issue #5 已关闭。
- 合并后的 main 上 webview 测试全部通过。
- VS Code 扩展构建和 VSIX 内容验证通过。
- Marketplace 发布命令成功报告 `1.4.1`。
- 用户根工作区原有未提交文件未被覆盖或提交。
