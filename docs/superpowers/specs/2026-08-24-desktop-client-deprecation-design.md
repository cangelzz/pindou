# Desktop Client Deprecation Design

## 决策

PindouVerse 不再将 Desktop/Tauri 客户端作为主要产品来源，也停止其常规功能开发和发布。

平台优先级调整为：

1. VS Code 扩展：主平台、首选安装方式、主要功能开发与发布目标。
2. Chrome / Edge 浏览器扩展：第二优先级的维护平台。
3. Desktop / Tauri：Legacy / Deprecated，仅保留源码、历史安装包、编译验证以及严重兼容性或安全问题的应急修复与发布。
4. 移动端：维持现有状态，不在本次变更中重新定位。

## 用户文档

### 根 README

- 顶部增加醒目的中英文平台状态说明。
- 不再用笼统的“跨平台”将 Desktop 与当前维护平台并列。
- 将 VS Code 扩展作为首选安装和开发入口。
- 将 Chrome / Edge 扩展列为第二优先级。
- 保留历史 Desktop 下载入口，但明确：
  - 已弃用；
  - 不再主动开发新功能；
  - 不再常规发布；
  - 历史版本仍可下载；
  - 源码仍保留；
  - 仅对严重兼容性或安全问题提供 best-effort 应急维护。
- 将 Tauri/Rust 环境和命令移至 `Legacy Desktop` 维护章节，不再标记为推荐。
- 不删除任何现有 Desktop 构建命令。

### VS Code Marketplace README

- 删除 Desktop/Mobile “also available”的现行承诺。
- 明确 VS Code 扩展是主要维护平台。
- 简要说明 Desktop/Tauri 已进入 legacy 状态，源码及历史发行仍保留。

## 开发者说明

### CLAUDE.md

- 将根 `VERSION`、Tauri 版本同步和 GitHub Release workflow 明确限定为 legacy desktop 版本线。
- 明确 VS Code 扩展版本由 `platforms/vscode/package.json` 管理。
- 保留现有 VS Code 测试和发布要求。

### Versioning instructions

- 将根版本规则标注为 legacy Desktop/Tauri 专用。
- 明确常规扩展发布不得使用桌面版本命令或 Desktop Release workflow。
- Desktop 发布只允许维护者针对严重兼容性或安全问题显式决定。

## CI 与发布工作流

### Desktop CI

继续保留 Windows/macOS Tauri 编译验证，以保护共享前端、适配层和现存源码的可构建性。将 job 或步骤命名改为 `Legacy Desktop`，并添加注释说明它不是活跃产品发布承诺。

### Desktop Release

保留手动 workflow 供应急发布，不删除实现。将 workflow 名称改为 `Legacy Desktop Release`，并在 workflow 中增加清晰注释或输入确认，声明只用于严重兼容性或安全修复，避免被误认为默认发布流程。

不自动触发、不改为常规扩展发布入口。

## 不修改的内容

- 不删除 `src-tauri/`、Tauri adapters、依赖、配置或命令。
- 不删除 Desktop 编译 CI。
- 不回写历史 plans/specs/changelog；这些文件记录当时事实。
- 不修改扩展 manifest、扩展商店描述或产品名，使用户误认为扩展本身也被弃用。
- 不改变许可证和历史桌面授权说明。

## 验证

- 文档搜索确认当前 README 与开发指南不存在把 Desktop 描述为推荐或主要平台的矛盾措辞。
- workflow YAML 可解析，现有 workflow contract 测试通过。
- 根测试通过。
- Desktop CI 仍存在并执行编译验证。
- Desktop Release workflow 仍可手动触发，但名称与说明明确标记 legacy/emergency-only。

## 验收标准

- 新用户从 README 能明确得知 VS Code 是主平台、浏览器扩展是次要平台。
- Desktop 历史下载仍可找到，但不会被误解为当前推荐版本。
- 贡献者不会将 Tauri 视为默认开发入口或常规发布目标。
- Desktop 源码和应急发布能力完整保留。
