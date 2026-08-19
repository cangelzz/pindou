# Browser Extension Name Localization Design

**日期：** 2026-08-19  
**状态：** 已批准设计

## 目标

Chrome 与 Edge 扩展使用同一套国际化名称，不再显示浏览器品牌后缀。

- 默认及非中文浏览器语言：`PindouVerse`
- 简体中文：`PindouVerse - 拼豆宇宙`
- 繁体中文：`PindouVerse - 拼豆宇宙`

## 方案

使用 Manifest V3 原生本地化机制。

Manifest 增加 `default_locale: "en"`，并将 `name`、`short_name` 改为消息引用：

```json
{
  "default_locale": "en",
  "name": "__MSG_extensionName__",
  "short_name": "__MSG_extensionShortName__"
}
```

新增：

```text
platforms/extension/_locales/
├── en/messages.json
├── zh_CN/messages.json
└── zh_TW/messages.json
```

消息值：

| Locale | extensionName | extensionShortName |
|---|---|---|
| en | PindouVerse | PindouVerse |
| zh_CN | PindouVerse - 拼豆宇宙 | PindouVerse |
| zh_TW | PindouVerse - 拼豆宇宙 | PindouVerse |

Chrome 和 Edge store overlay 不再覆盖 `name` 或 `short_name`。此次保留各平台现有 description，不扩大到描述本地化。

## 构建与校验

- 构建时将 `_locales` 复制到每个品牌产物。
- Chrome/Edge ZIP 根目录包含 `_locales`。
- Manifest validator 验证 `default_locale`、消息引用和 locale 文件完整性。
- 校验英文名称严格为 `PindouVerse`。
- 校验简体/繁体中文名称严格为 `PindouVerse - 拼豆宇宙`。
- Overlay 白名单收紧为只允许 `description`，避免重新引入品牌化名称。

## 测试

- Manifest 和 overlay 负向测试。
- Chrome/Edge 构建产物 locale 文件测试。
- ZIP locale 目录测试。
- 现有扩展 E2E、打包测试和生产扫描继续通过。
