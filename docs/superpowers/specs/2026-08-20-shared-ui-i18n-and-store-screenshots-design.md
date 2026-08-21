# Shared UI Internationalization and Store Screenshots Design

**Date:** 2026-08-20  
**Status:** Approved design

## 1. Goal

Internationalize the shared PindouVerse React UI for English and Simplified Chinese across Desktop/Tauri, VS Code, Chrome, Edge, Android, and iOS. After the product UI is genuinely bilingual, generate two consistent sets of browser-store screenshots using the existing dinosaur sample series.

## 2. Language scope

Supported UI languages in the first release:

- `en`
- `zh-CN`

Fallback behavior:

- `zh-CN`, `zh-SG`, and `zh-Hans` normalize to `zh-CN`.
- All other languages, including `zh-TW` and `zh-HK`, fall back to English.

This UI-language scope is independent from the extension manifest localization. The Simplified Chinese screenshot set can be reused for the Traditional Chinese store listing, but the first product UI release does not claim a Traditional Chinese translation.

## 3. Technical approach

Use `i18next` and `react-i18next` with one shared i18n instance.

```text
src/i18n/
├── index.ts
├── language.ts
├── locales/
│   ├── en.json
│   └── zh-CN.json
└── keys.test.ts
```

Resource namespaces remain in one file per language for the first release, grouped by feature domain:

```text
menu, tools, canvas, palette, layers, project, import, export,
history, snapshots, cloud, github, dialogs, status, errors, beta, language
```

React components use `useTranslation()`. Core algorithms and stores do not receive a translation function; they return structured state or error codes, and presentation layers translate them. Non-React presentation code may use the shared i18n instance when it must create user-visible text.

## 4. Language lifecycle

### 4.1 Startup priority

1. Saved PindouVerse language preference.
2. Platform or system language.
3. English fallback.

Shared preference key:

```text
pindou.uiLanguage
```

Only `en` and `zh-CN` are valid saved values.

### 4.2 Platform detection and storage

- Browser extension: `chrome.i18n.getUILanguage()`, falling back to `navigator.language`; save through `chrome.storage.local`.
- VS Code: host sends `vscode.env.language` to the webview; save through extension `globalState`.
- Desktop/Tauri: detect through `navigator.language`; save through the available platform storage, with a local fallback if needed.
- Android/iOS WebViews: detect through `navigator.language`; use the shared storage abstraction.

Storage failures must not prevent startup. The app falls back to detected language and shows a localized error only when a manual language change cannot be persisted.

### 4.3 Manual switch

Add an independent language button on the right side of the top toolbar, near GitHub status and Feedback:

```text
… Version   [🌐 中文 / EN]   GitHub   Feedback
```

- English UI displays `🌐 中文`.
- Chinese UI displays `🌐 EN`.

Switching language:

1. Changes the i18next language.
2. Re-renders React UI immediately.
3. Persists the preference.
4. Updates `document.documentElement.lang`.
5. Does not reload the page or change project, dirty, history, selection, cloud, or recovery state.

## 5. Translation coverage

### 5.1 Translate

- Top menu, shortcuts, and tooltips.
- Drawing and canvas toolbars.
- Palette, layers, statistics, selection, and history panels.
- New project, project information, resize canvas, open/save flows.
- Image conversion and blueprint import workflows.
- Export preview and printable blueprint options.
- Recovery, autosave, snapshots, and comparison dialogs.
- GitHub login and Gist synchronization.
- Confirmation, success, loading, empty, and error states.
- Beta settings and web-image fallback dialogs.
- User-visible feedback text.

### 5.2 Preserve

- PindouVerse, GitHub, Gist.
- `.pindou`, PNG, JPEG, JSON.
- MARD and other palette brands.
- Color identifiers such as A1 and H1.
- Keyboard shortcuts such as `Ctrl+S`.
- User-entered project, layer, title, author, and file names.
- URLs and file paths.

## 6. Screenshot set

Create five pure application screenshots per language at `1280 × 800`.

```text
platforms/extension/store-assets/
├── global/en/
│   ├── 01-editor.png
│   ├── 02-image-conversion.png
│   ├── 03-layers-palettes.png
│   ├── 04-blueprint-export.png
│   └── 05-cloud-sync.png
└── localized/zh-CN/
    ├── 01-editor.png
    ├── 02-image-conversion.png
    ├── 03-layers-palettes.png
    ├── 04-blueprint-export.png
    └── 05-cloud-sync.png
```

Use the existing dinosaur sample family:

1. Complete editor — Tyrannosaurus Rex.
2. Image to beads — Triceratops.
3. Layers and palettes — Velociraptor.
4. Printable blueprints — Brachiosaurus.
5. Optional GitHub sync — a collection containing T. Rex, Pterosaur, and Ankylosaurus.

The English and Chinese sets use identical artwork, viewport, zoom, panel state, and composition. Only UI text changes. The images contain no external marketing frame or added caption; they are authentic application screenshots.

Existing dinosaur samples are used at the user's direction. Before public commercial listing submission, the publisher is responsible for confirming rights to use the selected sample artwork.

## 7. Migration strategy

Deliver one complete bilingual release through sequential, independently tested domains:

1. i18n initialization, detection, persistence, and language switch.
2. Top menu, status bar, and drawing tools.
3. Project operations and canvas dialogs.
4. Image and blueprint import.
5. Export.
6. Layers, palettes, statistics, history, and selection.
7. Recovery, snapshots, and comparison.
8. GitHub and cloud synchronization.
9. Beta, feedback, and all remaining user-visible states.
10. Hardcoded-string audit and screenshot generation.

English and Chinese keys must move together. A domain is not complete if only one language is translated.

## 8. Testing

### 8.1 Resource contract

- English and Chinese flattened key sets are identical.
- No empty values.
- No missing referenced keys.
- No unused keys at completion.
- English resources do not contain unintended Chinese UI text.

### 8.2 Language lifecycle

- Saved preference overrides detected language.
- Normalization and fallback rules are exact.
- Storage failure does not block startup.
- Switching changes DOM and `<html lang>` immediately.
- Switching does not alter editor state.

### 8.3 Platform contract

- Browser uses actual `chrome.i18n` and `chrome.storage.local`.
- VS Code host forwards language and persists preference through `globalState`.
- Tauri and mobile fall back to navigator and shared storage.

### 8.4 UI contract

Parameterize critical Playwright flows for English and Chinese:

- Menu order.
- Dirty new/open protection.
- Image conversion.
- Export.
- Snapshot recovery.
- GitHub login.
- Cloud projects.
- Errors and confirmations.

### 8.5 Screenshot verification

- Exactly five images in each screenshot set.
- Every image is `1280 × 800` PNG.
- Matching English/Chinese files use the same sample and layout.
- English screenshots contain no untranslated Chinese functional UI.
- Chinese screenshots contain the intended translated UI.

## 9. Completion criteria

- Shared UI is consistently English or Simplified Chinese, without mixed functional text.
- All supported platforms consume the same resources.
- Language preference persists and can be changed without reloading.
- Existing functional tests remain green.
- Critical UI tests run in both languages.
- Five English and five Simplified Chinese store screenshots are generated at the required dimensions.
