# 拼豆像素编辑器 (PinDou Pixel Editor)

跨平台（Windows / macOS）拼豆像素艺术编辑器，内置 MARD 221 色预定义色板。

**技术栈**: Tauri v2 + React 19 + TypeScript + Vite + Zustand + Tailwind CSS 4

---

## 1. 开发环境初始化

### 前置要求

| 工具 | 版本 | 安装方式 |
|------|------|----------|
| **Node.js** | ≥ 18 | https://nodejs.org |
| **Rust** | ≥ 1.77 | https://rustup.rs |
| **系统依赖** (仅 Linux) | — | 见下方说明 |

**Windows 额外要求**：
- Visual Studio Build Tools (C++ 桌面开发工作负载)
- WebView2 (Windows 10/11 通常已自带)

**macOS 额外要求**：
- Xcode Command Line Tools: `xcode-select --install`
- CLang (随 Xcode 附带)

### 初始化步骤

```bash
# 1. 克隆仓库
git clone <repo-url>
cd pindou

# 2. 安装前端依赖
npm install

# 3. 确认 Rust 工具链可用
rustc --version   # 应输出 ≥ 1.77
cargo --version

# 4. 启动开发模式（自动编译 Rust + 启动 Vite + 打开应用窗口）
npm run tauri dev
```

> **Windows 注意**：如果 `cargo` 未在 PATH 中，先执行：
> ```powershell
> $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
> ```
> 或永久添加到系统 PATH：
> ```powershell
> [Environment]::SetEnvironmentVariable("PATH", "$env:USERPROFILE\.cargo\bin;" + [Environment]::GetEnvironmentVariable("PATH", "User"), "User")
> ```

首次 `tauri dev` 会下载并编译 Rust 依赖（约 500+ crate），耗时 3-10 分钟。后续增量编译约 10-20 秒。

### 常用开发命令

```bash
npm run dev          # 仅启动 Vite 前端 (http://localhost:1420)
npm run tauri dev    # 启动完整 Tauri 应用（推荐）
npx tsc --noEmit     # TypeScript 类型检查
npm run build        # 仅构建前端
```

---

## 2. 打包发布

### 构建安装包

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`：

| 平台 | 产物路径 | 格式 |
|------|----------|------|
| **Windows** | `bundle/nsis/PinDou Editor_0.1.0_x64-setup.exe` | NSIS 安装包 |
| **Windows** | `bundle/msi/PinDou Editor_0.1.0_x64_en-US.msi` | MSI 安装包 |
| **macOS** | `bundle/dmg/PinDou Editor_0.1.0_aarch64.dmg` | DMG 磁盘映像 |
| **macOS** | `bundle/macos/PinDou Editor.app` | App Bundle |

### 仅构建特定格式

```bash
# Windows — 仅 NSIS 安装包
npm run tauri build -- --bundles nsis

# Windows — 仅 MSI
npm run tauri build -- --bundles msi

# macOS — 仅 DMG
npm run tauri build -- --bundles dmg

# macOS — 仅 App Bundle
npm run tauri build -- --bundles app
```

### 准备 macOS 图标

在 macOS 上打包前，需要生成 `.icns` 图标文件：

```bash
# 准备一张 1024x1024 的 PNG 图标，命名为 app-icon.png，放在项目根目录
npx tauri icon app-icon.png
```

这会自动在 `src-tauri/icons/` 下生成所有平台需要的图标格式（包括 `icon.icns`）。

生成后，在 `src-tauri/tauri.conf.json` 的 `bundle.icon` 中加入：

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.ico",
  "icons/icon.icns"
]
```

---

## 3. 迁移与安装到其他系统

### 方式 A：直接发送安装包（推荐）

在当前机器上打包后，将安装包文件发送到目标系统即可。

**发送到 Windows**：
1. 将 `.exe` 或 `.msi` 文件拷贝到目标 Windows 电脑
2. 双击运行安装，按提示完成

**发送到 macOS**：
1. 将 `.dmg` 文件拷贝到目标 Mac
2. 双击打开 DMG，将 `PinDou Editor.app` 拖入 `Applications` 文件夹
3. 首次打开时，右键点击 App → 选择"打开"（绕过 Gatekeeper 未签名提示）

> **跨平台构建限制**：Tauri 不支持在 Windows 上构建 macOS 安装包，反之亦然。需要在目标平台上构建对应的安装包。

### 方式 B：在目标 Mac 上从源码构建

```bash
# 1. 安装前置工具
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 2. 安装 Node.js (推荐用 nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22

# 3. 克隆并构建
git clone <repo-url>
cd pindou
npm install
npm run tauri build

# 4. 安装
open src-tauri/target/release/bundle/dmg/*.dmg
```

### 方式 C：GitHub Actions 自动化 CI/CD（可选）

在 `.github/workflows/release.yml` 中配置跨平台构建矩阵，实现一次提交自动出 Windows + macOS 安装包。示例配置可参考 [Tauri 官方 CI 文档](https://v2.tauri.app/distribute/ci-cd/)。

---

## 项目结构

```
pindou/
├── src/                          # React 前端
│   ├── components/
│   │   ├── Canvas/               # 画布 + 工具栏
│   │   ├── Palette/              # MARD 221 色板
│   │   ├── Import/               # 图片导入
│   │   ├── Export/               # 高分辨率导出
│   │   └── Stats/                # 拼豆用量统计
│   ├── data/mard221.ts           # MARD 221色定义
│   ├── store/editorStore.ts      # Zustand 状态管理
│   ├── utils/                    # 颜色转换/匹配算法
│   └── types/index.ts            # TypeScript 类型
├── src-tauri/                    # Rust 后端
│   ├── src/commands/             # IPC 命令 (导入/导出)
│   ├── src/color/                # CIELAB 颜色匹配
│   ├── fonts/                    # 导出用字体
│   └── tauri.conf.json           # Tauri 配置
├── package.json
├── vite.config.ts
└── tsconfig.json
```
