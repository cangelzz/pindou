# PindouVerse Chrome / Edge 浏览器扩展设计

**日期：** 2026-08-18  
**状态：** 已批准设计  
**目标平台：** Chrome Web Store、Microsoft Edge Add-ons

## 1. 目标

将现有 PindouVerse 编辑器作为完整、独立的 Manifest V3 浏览器扩展发布到 Chrome 与 Edge。浏览器版不是 VS Code 扩展的轻量伴侣；用户无需安装 VS Code，也能完成绘图、图片转拼豆、`.pindou` 文件操作、图片导出、GitHub 登录与 Gist 云同步。

第一版采用完整的独立编辑器标签页，不提供 popup 或 Side Panel 编辑器。

## 2. 已确认的产品范围

### 2.1 包含

- 点击扩展图标后打开或聚焦完整编辑器标签页。
- 复用现有共享 React 编辑器、Zustand store、转换算法、色板、导入与导出能力。
- 顶部横向项目菜单及编辑器布局与 VS Code webview 保持一致。
- 本地文件优先的 `.pindou` 打开、保存和另存为。
- 网页图片右键菜单“在 PindouVerse 中转换”。
- 右键图片成功读取后直接进入现有图片转拼豆向导。
- GitHub Device Flow 登录。
- GitHub Gist 项目上传、下载、删除与同步状态。
- 同一套代码支持 Chrome 和 Edge，并分别生成商店发布包。

### 2.2 不包含

- AI 或 GitHub Models 功能。
- Side Panel 编辑器。
- 读取所有网站数据的权限或 `<all_urls>`。
- content script。
- OAuth code exchange 后端。
- 将 GitHub `client_secret` 打包到扩展中。
- 将浏览器内部项目库作为正式项目的默认存储。
- 全面 npm workspace / monorepo 重构。

## 3. 实现路线

完善现有 `platforms/extension` Manifest V3 原型，而不是先重构整个仓库或另建 Web/PWA 产品。

根目录 `src/` 继续作为共享编辑器源码。浏览器平台增加清晰的服务边界，并进行三项必要改善：

1. GitHub 认证和 Gist 操作通过平台服务提供，消除浏览器路径对 Tauri `invoke` 的依赖。
2. AI 能力由平台 feature flag 明确关闭，不只是在 UI 中用 CSS 隐藏。
3. 浏览器与 VS Code 重复的 Canvas 导出逻辑抽成共享工具，以统一输出结果。

第一版不因工程整洁而进行无关的大规模目录迁移。

## 4. 总体架构

```text
Chrome / Edge Extension
├── MV3 Service Worker
│   ├── 点击扩展图标 → 打开或聚焦编辑器标签页
│   ├── 注册网页图片右键菜单
│   └── 创建并传递一次性图片导入任务
│
├── Editor Tab
│   ├── 复用 src/App.tsx 和共享组件
│   ├── 复用 Zustand editorStore
│   ├── 复用图片转换、色板、绘图与导出算法
│   └── 注入 Browser Platform Services
│
└── Browser Platform Services
    ├── ProjectFileService
    ├── ImageImportService
    ├── GitHubService
    ├── BrowserStorage
    ├── ExternalLinkService
    └── FeatureFlags
```

### 4.1 组件职责

#### MV3 Service Worker

只负责浏览器扩展生命周期和跨页面入口：

- 注册工具栏 action 和图片 context menu。
- 打开或聚焦唯一的编辑器标签页。
- 将网页图片 URL、来源页面与短期任务 ID 存入扩展存储。
- 不保存编辑器业务状态，不执行绘图、转换或项目序列化。

#### Editor Tab

承载完整编辑器。它直接复用共享 `App` 和 store，不建立浏览器专属 UI 分叉。

#### ProjectFileService

封装 `.pindou` 打开、保存、另存为、文件句柄、权限检查与上传/下载回退。

#### ImageImportService

处理本地图片选择和网页图片任务。它向共享图片转换向导提供 `Blob`/`File`，不复制转换算法。

#### GitHubService

封装 Device Flow、token 生命周期和 Gist API。未来可增加 OAuth 实现，但第一版只启用 Device Flow。

#### BrowserStorage

使用扩展存储保存 token、设置、任务元数据和可恢复状态；使用 IndexedDB 保存较大的自动恢复数据与快照。

#### FeatureFlags

浏览器平台启用 GitHub/Gist，关闭 AI。共享 UI 根据能力决定是否渲染功能，不能因为“非 VS Code”而默认按 Tauri 处理。

## 5. 与 VS Code 的界面一致性

浏览器版直接复用当前 VS Code webview 使用的共享 `App`。顶部横向菜单以当前源码为合同，顺序为：

`新建 → 调整画布 → 打开 → 保存 → 另存为 → 项目信息 → 导入图片 → 导入图纸 BETA → 导出 → 历史记录 → 对比（条件显示）→ 云端（登录后显示）→ 版本 → GitHub 登录状态 → 反馈`

验收要求：

- 菜单名称、图标、顺序、分隔线、位置和对话框与 VS Code 一致。
- `对比`仅在存在保存基线时显示。
- `云端`仅在 GitHub 登录成功后显示。
- 云状态仅在项目关联云端 Gist 时显示。
- “登录 GitHub”与“✓ GitHub 已登录”互斥。
- `导入图纸 BETA`按当前 VS Code 实现始终显示，导入期间 disabled；本项目不顺带修改其 Beta flag 语义。
- 绘图工具、画布、色板、图层、统计与属性布局不因浏览器平台重新设计。
- 浏览器版不额外增加右侧“项目”面板。
- AI Beta 设置、AI 工具栏入口与状态在浏览器构建中不出现。

平台差异只体现在行为实现，例如文件 API、GitHub 登录和运行环境标识。

## 6. 编辑器入口

### 6.1 工具栏 action

- 点击扩展图标时查找现有 PindouVerse 编辑器标签页。
- 若存在则聚焦该标签和窗口。
- 若不存在则创建新的扩展编辑器标签页。
- 第一版不配置 Side Panel 入口。

### 6.2 网页图片右键入口

1. Service worker 注册只对图片显示的 context menu。
2. 用户选择“在 PindouVerse 中转换”。
3. Service worker 创建一次性任务，记录图片 URL、来源页面和过期时间。
4. 打开或聚焦编辑器标签页，并传递任务 ID。
5. 编辑器尝试读取图片并转换为 `Blob`。
6. 成功后打开现有图片转拼豆向导。
7. 任务消费后立即删除；未消费任务到期后自动删除。

### 6.3 无站点权限策略

第一版不请求主机权限，也不注入 content script。若 CORS、防盗链、登录状态或 URL 类型导致图片读取失败：

- 不请求升级为全站权限；
- 不静默失败；
- 说明常见原因；
- 提供“选择本地图片”按钮；
- 引导用户先下载图片再导入。

商店描述必须明确：右键导入只支持扩展能够直接读取的公开图片，不能保证所有网站成功。

## 7. 项目文件语义

正式项目以用户可取得的 `.pindou` 文件为准。IndexedDB 不充当文件名到项目内容的伪文件系统。

### 7.1 打开

- 优先使用 File System Access API 选择 `.pindou`。
- 读取真实文件内容并调用共享反序列化逻辑。
- 成功后保留文件句柄，供后续保存写回。
- 不支持 File System Access API 时，使用 `<input type="file">` 读取内容，但不假装拥有可写路径。
- 解析失败时不得替换当前项目。

### 7.2 保存

- 有可写文件句柄时，检查/请求权限并写回原文件。
- 无文件句柄时转入另存为流程。
- 不支持可写文件句柄时，以下载 `.pindou` 作为回退。
- 只有写入或下载创建成功后，才更新保存时间、baseline 与 `isDirty`。
- 用户取消、权限拒绝或写入失败时保留 dirty 状态和全部编辑内容。

### 7.3 另存为

- 支持 File System Access API 时，用户选择新目标文件，成功后当前编辑器关联新句柄。
- 回退模式下载新文件并记录建议文件名；由于浏览器无法得知下载目标路径，后续保存可以再次下载。
- 另存为不能覆盖原项目身份或在失败时误切换当前项目。

### 7.4 新建

浏览器独立标签页采用与 VS Code“新文档上下文”行为等价的安全方案：

1. 当前项目 dirty 时先确认。
2. 确认后在当前标签页创建新画布。
3. 清除旧文件句柄、项目路径和云端关联。
4. 首次保存要求用户选择文件名。
5. 取消确认则完整保留当前项目。

### 7.5 自动恢复与快照

- IndexedDB 仅保存自动恢复数据、快照和较大的本地恢复状态。
- 自动备份不清除 dirty，不冒充正式保存。
- UI 明确说明：清理浏览器数据或卸载扩展可能删除本地备份和快照。
- 快照继续支持创建、排序、对比、恢复和删除。
- “快照另存为”必须生成用户可取得的 `.pindou` 文件。

## 8. GitHub 登录和 Gist

### 8.1 Device Flow

1. 用户点击顶部“登录 GitHub”。
2. `GitHubService` 请求 device code。
3. 共享登录对话框显示验证码和验证地址。
4. 扩展打开 GitHub 验证页面，并按 GitHub 返回间隔轮询。
5. 登录成功后立即显示“✓ GitHub 已登录”和“云端”。
6. 登录取消、过期或失败时停止轮询，不保留半登录状态。
7. 登出后立即清除 token、隐藏云端菜单并更新 UI。

未来可以在同一接口下添加 OAuth，但必须通过安全后端交换 code。第一版不实现 OAuth，也不包含 `client_secret`。

### 8.2 Token 存储

- token 存入 `chrome.storage.local` 或兼容层对应的扩展本地存储。
- 不使用普通网页 `localStorage`。
- 不使用同步存储，避免 token 跨设备同步。
- 不注入 content script，网页不能访问扩展 token。
- token 失效或授权被撤销时清除本地登录状态并提示重新登录。

扩展本地存储不是操作系统级秘密保险库；它不承诺抵御已完全控制设备或浏览器配置文件的攻击者。

### 8.3 Gist 同步

保留现有云端 UI 与功能：

- 上传当前项目；
- 列出云端项目；
- 下载并打开；
- 删除；
- 显示同步状态；
- 处理 API 错误、限流与列表最终一致性延迟。

从 Gist 下载的项目起初不关联本地文件。用户首次保存时选择 `.pindou` 文件，避免覆盖其他项目。

## 9. AI 与运行环境

浏览器构建中 AI 明确不可用：

- 不显示 AI Beta 设置。
- 不显示 AI 工具栏入口、开关或状态。
- 不打包浏览器无需的 GitHub Models/Tauri AI 调用路径。
- GitHub token 只用于 Gist 范围内的功能。

反馈链接中的环境标识必须为 `Browser Extension (Chrome)` 或 `Browser Extension (Edge)`，不得落入 `Desktop (Tauri)` 分支。

## 10. 错误处理

平台服务使用统一结果模型，至少区分：成功、用户取消、权限拒绝、数据无效、网络失败、认证失败、限流和不支持。

- 用户取消：不显示错误，不改变项目状态。
- 文件权限拒绝：保留内容，提示重新授权或使用另存为。
- 损坏/不兼容项目：保持当前项目，显示解析错误。
- 网页图片失败：说明限制并提供本地图片入口。
- Device Flow 超时/取消：停止轮询并清理临时状态。
- Gist 失败/限流：保留本地编辑，显示可操作信息。
- 外部链接失败：提供可复制的 URL。

错误使用现有应用内 dialog/toast，不使用网页 `alert()`。

## 11. Chrome 与 Edge 兼容

- 使用 Chromium 共同支持的 Manifest V3 API。
- 浏览器 API 通过薄兼容层访问，业务代码不散布浏览器品牌判断。
- Chrome 和 Edge 使用同一主体代码与基础 manifest。
- 构建分别输出商店 zip，并允许必要的商店元数据差异。
- File System Access API 不可用时回退到上传/下载。
- manifest 仅保留必要权限，例如 `contextMenus`、`storage`；具体列表以实现时最小权限审查为准。

## 12. 测试策略

### 12.1 共享单元测试

继续使用根目录 Vitest，覆盖：

- `.pindou` 序列化与反序列化；
- 文件服务状态转换与取消/失败处理；
- feature flags；
- GitHub 登录状态和轮询；
- 网页图片任务创建、消费和过期；
- 错误归一化。

### 12.2 跨平台 UI 合同测试

以 VS Code webview 为 UI 基准，断言：

- 顶部按钮名称和顺序；
- 分隔线与条件项状态矩阵；
- 每个按钮打开对应共享 dialog；
- 对比、云端和登录状态的显示条件；
- 浏览器构建不出现 AI 入口。

### 12.3 浏览器扩展 E2E

使用 Playwright persistent Chromium context 加载 unpacked extension，验证：

- action 打开或聚焦唯一编辑器标签页；
- dirty 项目新建保护；
- 打开、保存和另存为 round trip；
- 不支持文件句柄时的下载回退；
- 网页图片任务进入转换向导；
- 图片读取失败后的本地导入回退；
- mock GitHub API 下的 Device Flow 状态转换；
- Gist 上传、下载和删除；
- 扩展重启后的设置与登录状态恢复。

### 12.4 导出一致性

浏览器与 VS Code 使用相同 fixtures，比较：

- 文件格式、命名和图片尺寸；
- 图纸边距、网格、坐标轴和水印；
- 适合稳定比较的输出执行像素快照或结构级比较。

Canvas/Blob 渲染必须共享；平台 adapter 只负责最终写文件或下载。

## 13. CI 与发布验收

每次 PR 至少运行：

1. 根 Vitest；
2. VS Code webview tests；
3. 浏览器扩展 build；
4. Manifest V3 校验；
5. 浏览器扩展 Playwright E2E；
6. Chrome/Edge zip 产物生成检查。

正式发布前：

1. 在 Chrome 开发者模式安装并执行 smoke test；
2. 在 Edge 开发者模式安装并执行 smoke test；
3. 检查实际权限提示和商店说明；
4. 分别提交 Chrome Web Store 与 Microsoft Edge Add-ons。

## 14. 完成标准

只有同时满足以下条件，浏览器版才视为达到第一版目标：

- 用户无需 VS Code 即可完成核心编辑工作流。
- UI 菜单合同与当前 VS Code webview 一致。
- `.pindou` 本地文件打开、保存、另存为和失败保护真实可用。
- 网页图片右键导入在允许读取时进入转换向导，失败时有明确回退。
- GitHub Device Flow 和 Gist 同步可用，token 不存入网页 `localStorage`。
- 浏览器构建完全不暴露 AI 功能。
- Chrome 与 Edge 开发者模式验证通过。
- 自动化测试覆盖平台关键路径，且现有 VS Code 测试不回归。
