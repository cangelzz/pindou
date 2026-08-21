# Shared UI Internationalization and Store Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one shared English/Simplified-Chinese UI across PindouVerse desktop, VS Code, browser extension, Android, and iOS, then generate five reproducible 1280×800 dinosaur-themed store screenshots in each language.

**Architecture:** Add one shared `i18next` instance and typed language lifecycle, initialized after platform services but before React mounts. Platform services supply system language and persistence; components translate presentation text while stores and algorithms return structured codes. A deterministic Playwright screenshot pipeline drives the real browser-extension bundle with fixed dinosaur scenarios.

**Tech Stack:** React 19, TypeScript, i18next, react-i18next, Zustand, Vite, Chrome Extension APIs, VS Code extension host RPC, Vitest, Playwright.

---

## Scope and constraints

- Shared UI platforms: Tauri/Desktop, VS Code webview, Chrome, Edge, Android, iOS.
- Excluded independent UIs: `platforms/h5`, `platforms/weapp`.
- Languages: `en`, `zh-CN`; all unsupported languages fall back to English.
- User/project values, color IDs, palette brands, paths, URLs, and file-format names are never translated.
- Every task follows RED → GREEN → focused regression → commit.
- Do not add screenshot-only production UI.
- Dinosaur samples are used at the user's direction; public-store rights remain the publisher's responsibility.

## Target file structure

```text
src/i18n/
├── index.ts
├── language.ts
├── bootstrap.ts
├── locales/en.json
├── locales/zh-CN.json
├── keys.test.ts
├── language.test.ts
└── bootstrap.test.ts

src/components/Language/
├── LanguageSwitch.tsx
└── LanguageSwitch.test.tsx

platforms/extension/e2e/
├── store-screenshots.spec.ts
└── storeScreenshotHelpers.ts

platforms/extension/store-assets/
├── global/en/01-editor.png ... 05-cloud-sync.png
└── localized/zh-CN/01-editor.png ... 05-cloud-sync.png

scripts/
├── generate-store-screenshots.mjs
├── validate-store-screenshots.mjs
└── validate-store-screenshots.node-test.mjs
```

---

### Task 1: Establish i18n resources and key parity

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/i18n/index.ts`
- Create: `src/i18n/locales/en.json`
- Create: `src/i18n/locales/zh-CN.json`
- Create: `src/i18n/keys.test.ts`

- [ ] **Step 1: Add dependencies**

Add exact compatible dependencies through npm:

```bash
npm install i18next react-i18next
```

- [ ] **Step 2: Write failing resource-contract tests**

Create recursive flattening tests that require identical key sets, non-empty string leaves, and the approved top-level domains:

```ts
const REQUIRED = ["menu","tools","canvas","palette","layers","project","import","export","history","snapshots","cloud","github","dialogs","status","errors","beta","language"];
expect(Object.keys(en).sort()).toEqual([...REQUIRED].sort());
expect(flatten(en)).toEqual(expect.objectContaining(Object.fromEntries(Object.keys(flatten(zh)).map(k => [k, expect.any(String)]))));
expect(Object.keys(flatten(en)).sort()).toEqual(Object.keys(flatten(zh)).sort());
```

- [ ] **Step 3: Verify RED**

```bash
npx vitest run src/i18n/keys.test.ts
```

Expected: FAIL because resources and i18n instance do not exist.

- [ ] **Step 4: Add initial resources and i18n instance**

Initialize synchronously with fallback English and interpolation escaping disabled for React:

```ts
export const i18n = createInstance();
export async function initializeI18n(language: UiLanguage) {
  await i18n.init({ resources: { en: { translation: en }, "zh-CN": { translation: zhCN } }, lng: language, fallbackLng: "en", interpolation: { escapeValue: false } });
  document.documentElement.lang = language;
}
```

Seed lifecycle/common/menu keys needed by Tasks 2–7; both files move together.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx vitest run src/i18n/keys.test.ts
npm run build
git add package.json package-lock.json src/i18n
git commit -m "feat: add shared UI translation resources"
```

### Task 2: Implement language normalization and selection

**Files:**
- Create: `src/i18n/language.ts`
- Test: `src/i18n/language.test.ts`

- [ ] **Step 1: Write failing normalization matrix**

```ts
expect(normalizeUiLanguage("zh-CN")).toBe("zh-CN");
expect(normalizeUiLanguage("zh_SG")).toBe("zh-CN");
expect(normalizeUiLanguage("zh-Hans-CN")).toBe("zh-CN");
for (const value of ["zh-TW","zh-HK","zh-Hant","fr","",undefined]) expect(normalizeUiLanguage(value)).toBe("en");
expect(selectUiLanguage("en", "zh-CN")).toBe("en");
expect(selectUiLanguage("invalid", "zh-CN")).toBe("zh-CN");
```

- [ ] **Step 2: Verify RED, implement, and verify GREEN**

```ts
export type UiLanguage = "en" | "zh-CN";
export const UI_LANGUAGE_KEY = "pindou.uiLanguage";
export function isUiLanguage(value: unknown): value is UiLanguage { return value === "en" || value === "zh-CN"; }
export function normalizeUiLanguage(value: unknown): UiLanguage { /* exact matrix above */ }
export function selectUiLanguage(saved: unknown, detected: unknown): UiLanguage { return isUiLanguage(saved) ? saved : normalizeUiLanguage(detected); }
```

```bash
npx vitest run src/i18n/language.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/language.ts src/i18n/language.test.ts
git commit -m "feat: select supported UI languages"
```

### Task 3: Add locale and fallback storage services

**Files:**
- Modify: `src/platform/services.ts`
- Create: `src/platform/navigatorLocaleService.ts`
- Create: `src/platform/navigatorLocaleService.test.ts`
- Create: `src/platform/webStorageService.ts`
- Create: `src/platform/webStorageService.test.ts`

- [ ] **Step 1: Write failing service tests**

Test navigator fallback, localStorage success, and SecurityError mapping to `PlatformResult` without throwing.

- [ ] **Step 2: Add interfaces**

```ts
export interface LocaleService { getSystemLanguage(): Promise<PlatformResult<string>>; }
export interface PlatformServices { /* existing */ readonly locale: LocaleService; }
```

Implement `NavigatorLocaleService` and `WebStorageService`; extend legacy factory with available web services where appropriate.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run src/platform/navigatorLocaleService.test.ts src/platform/webStorageService.test.ts
npx tsc --noEmit
git add src/platform
git commit -m "feat: add locale and preference services"
```

### Task 4: Integrate browser locale and persistence

**Files:**
- Modify: `platforms/extension/browserApi.ts`
- Modify: `platforms/extension/main.tsx`
- Create: `platforms/extension/tests/browserLocale.test.ts`
- Modify: `platforms/extension/tests/browserApi.test.ts`

- [ ] **Step 1: Write failing tests**

Assert `chrome.i18n.getUILanguage()` receiver binding, navigator fallback only for empty/error, and `pindou.uiLanguage` reads/writes only through `chrome.storage.local`.

- [ ] **Step 2: Implement Browser locale service**

Extend `BrowserApi` with bound `i18n.getUILanguage`; register locale and existing BrowserStorage in services.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run platforms/extension/tests/browserApi.test.ts platforms/extension/tests/browserLocale.test.ts
npm run ext:build:chrome
git add platforms/extension
git commit -m "feat: detect browser extension UI language"
```

### Task 5: Add VS Code locale/globalState RPC

**Files:**
- Modify: `platforms/vscode/src/extension.ts`
- Modify: `platforms/vscode/src/vscodeAdapter.ts`
- Modify: `platforms/vscode/webview/main.tsx`
- Modify: `platforms/vscode/tests/helpers.ts`
- Create: `platforms/vscode/tests/language-lifecycle.spec.ts`
- Create: `platforms/vscode/tests/uiEnvironmentHost.test.ts`

- [ ] **Step 1: Write failing host/webview tests**

Cover `vscode.env.language`, globalState get/update/remove, requestId matching, and bootstrap requests before webview `ready`.

- [ ] **Step 2: Implement RPC**

Add `getUiEnvironment`, `storageGet`, `storageSet`, and `storageRemove` requests. Keep handlers available immediately after panel setup; never wait for `ready`.

- [ ] **Step 3: Register VS Code services and verify**

```bash
npm --prefix platforms/vscode run build
npm --prefix platforms/vscode run test:webview -- tests/language-lifecycle.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add platforms/vscode
git commit -m "feat: persist VS Code UI language"
```

### Task 6: Bootstrap i18n before rendering on every shared platform

**Files:**
- Create: `src/i18n/bootstrap.ts`
- Test: `src/i18n/bootstrap.test.ts`
- Modify: `src/main.tsx`
- Modify: `platforms/extension/main.tsx`
- Modify: `platforms/vscode/webview/main.tsx`
- Modify: `platforms/android/main.tsx`
- Modify: `platforms/ios/main.tsx`

- [ ] **Step 1: Write failing lifecycle tests**

Assert saved preference priority, detection fallback, storage failure resilience, mount-after-init ordering, and correct `<html lang>`.

- [ ] **Step 2: Implement shared bootstrap**

```ts
export async function bootstrapUiLanguage(services: PlatformServices): Promise<UiLanguage> {
  const [saved, detected] = await Promise.all([services.storage.get(UI_LANGUAGE_KEY), services.locale.getSystemLanguage()]);
  const language = selectUiLanguage(saved.ok ? saved.value : undefined, detected.ok ? detected.value : "en");
  await initializeI18n(language);
  return language;
}
```

All entries set services, await bootstrap, then render.

- [ ] **Step 3: Verify all builds and commit**

```bash
npm run build
npm run ext:build:chrome
npm --prefix platforms/vscode run build
git add src/main.tsx src/i18n platforms/extension/main.tsx platforms/vscode/webview/main.tsx platforms/android/main.tsx platforms/ios/main.tsx
git commit -m "feat: initialize UI language before rendering"
```

### Task 7: Add the persistent language switch

**Files:**
- Create: `src/components/Language/LanguageSwitch.tsx`
- Create: `src/components/Language/LanguageSwitch.test.tsx`
- Modify: `src/App.tsx`
- Modify: `platforms/vscode/tests/menu-contract.spec.ts`
- Modify: `platforms/extension/e2e/contract.spec.ts`

- [ ] **Step 1: Write failing component and state-invariance tests**

Test labels `🌐 中文`/`🌐 EN`, exact menu position after Version and before GitHub, persistence failure alert, immediate DOM/lang update, and unchanged editor state snapshot.

- [ ] **Step 2: Implement change API and button**

Change i18n first, update `<html lang>`, persist through storage, and show a translated error if persistence fails; do not roll the UI back.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run src/components/Language/LanguageSwitch.test.tsx
npm --prefix platforms/vscode run test:webview -- tests/menu-contract.spec.ts
npm run ext:test:contract
git add src/App.tsx src/components/Language src/i18n platforms/vscode/tests/menu-contract.spec.ts platforms/extension/e2e/contract.spec.ts
git commit -m "feat: add UI language switch"
```

### Task 8: Translate shell, menus, canvas tools, status, and common dialogs

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Dialog/AppDialog.tsx`
- Modify: `src/components/Canvas/CanvasToolbar.tsx`
- Modify: `src/components/Canvas/PixelCanvas.tsx`
- Modify: `src/components/Canvas/PreviewThumbnail.tsx`
- Modify: `src/components/Stats/BeadCounter.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Parameterize: `platforms/vscode/tests/menu-contract.spec.ts`

- [ ] **Step 1: Add failing bilingual menu/tool tests**

Run the same DOM contract with saved language `en` and `zh-CN`; assert ordered labels, tooltips, ARIA, status, alert buttons, and no project-state changes.

- [ ] **Step 2: Replace hardcoded presentation strings with keys**

Use `useTranslation()` in React; preserve shortcuts and brand/data names.

- [ ] **Step 3: Verify and commit**

```bash
npm --prefix platforms/vscode run test:webview -- tests/menu-contract.spec.ts
npm test
git add src/App.tsx src/components/Dialog src/components/Canvas src/components/Stats src/i18n/locales platforms/vscode/tests
git commit -m "feat: translate editor shell and canvas tools"
```

### Task 9: Translate project flows and structure persisted status

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ProjectInfo/ProjectInfoDialog.tsx`
- Modify: `src/store/editorStore.ts`
- Modify: `src/utils/projectSerialization.ts`
- Modify: `src/store/projectIntegrity.test.ts`
- Parameterize: `platforms/extension/e2e/extension.spec.ts`

- [ ] **Step 1: Write failing bilingual new/open/save tests**

Cover dirty confirmations, project dialogs, save states, validation errors, and invariant file output.

- [ ] **Step 2: Replace language-bearing store state**

Replace localized `lastSavedAt` semantics with structured save status; stop parsing Chinese prefixes. Return error codes from store paths. Keep user layer/project data unchanged.

- [ ] **Step 3: Translate project UI and verify**

```bash
npx vitest run src/store/projectIntegrity.test.ts
npm run ext:test:e2e -- --grep "New|File System"
git add src/App.tsx src/components/ProjectInfo src/store/editorStore.ts src/utils/projectSerialization.ts src/i18n platforms/extension/e2e
git commit -m "feat: translate project workflows"
```

### Task 10: Translate image conversion and color adjustment

**Files:**
- Modify: `src/components/Import/ImageImportDialog.tsx`
- Modify: `src/components/Import/WebImageImportErrorDialog.tsx`
- Modify: `src/components/ColorAdjust/ColorAdjustPanel.tsx`
- Modify: `src/i18n/locales/*.json`
- Parameterize relevant Playwright tests

- [ ] **Step 1: Add bilingual wizard tests**

Test selection, preview, processing, confirmation, local fallback, and preservation of chosen file/settings during language switch.

- [ ] **Step 2: Translate UI without touching conversion values**

- [ ] **Step 3: Verify and commit**

```bash
npm --prefix platforms/vscode run test:webview -- tests/image-import.spec.ts
npm run ext:test:e2e -- --grep "image"
git add src/components/Import src/components/ColorAdjust src/i18n platforms
git commit -m "feat: translate image conversion workflows"
```

### Task 11: Structure and translate blueprint import progress

**Files:**
- Modify: `src/utils/blueprintImportTS.ts`
- Modify: `src/components/Import/BlueprintDimsConfirmDialog.tsx`
- Modify: `src/components/Import/BlueprintImportDialog.tsx`
- Modify: `src/App.tsx`
- Modify blueprint tests and resources

- [ ] **Step 1: Add failing stage-code tests**

Require core stages (`loading-image`, `detecting-grid`, `sampling-colors`, `matching-colors`, `finalizing`) instead of display strings.

- [ ] **Step 2: Emit codes and translate in React**

- [ ] **Step 3: Verify identical imported canvas in both languages and commit**

```bash
npm test -- --run blueprint
npm --prefix platforms/vscode run test:webview -- tests/blueprint-import.spec.ts
git add src/utils/blueprintImportTS.ts src/components/Import src/App.tsx src/i18n
git commit -m "feat: translate blueprint import"
```

### Task 12: Translate export and blueprint output labels

**Files:**
- Modify: `src/components/Export/ExportDialog.tsx`
- Modify: `src/utils/blueprintLegend.ts`
- Modify: `src/utils/blueprintDecorations.ts`
- Modify tests/resources

- [ ] **Step 1: Add bilingual export tests**

Assert UI labels, preserved project title/author, unmodified PNG/JPEG names, and explicit output-label language.

- [ ] **Step 2: Translate React UI and inject label bundle into non-React rendering**

Do not let renderer implicitly read mutable global language mid-export; capture labels at request creation.

- [ ] **Step 3: Verify output and commit**

```bash
npx vitest run src/utils/canvasExport.test.ts
npm --prefix platforms/vscode run test:webview -- tests/export.spec.ts
git add src/components/Export src/utils/blueprintLegend.ts src/utils/blueprintDecorations.ts src/i18n
git commit -m "feat: translate export workflows"
```

### Task 13: Translate layers, palette, statistics, selection, and history

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Palette/ColorPalette.tsx`
- Modify: `src/components/Stats/BeadCounter.tsx`
- Modify: `src/components/Canvas/Selection*.tsx`
- Modify: `src/data/mard221.ts`
- Modify resources/tests

- [ ] **Step 1: Add bilingual panel and history tests**

Use stable color-group IDs; assert user layer names/history payloads remain unchanged when switching.

- [ ] **Step 2: Translate display labels and keep brand data**

- [ ] **Step 3: Verify and commit**

```bash
npm --prefix platforms/vscode run test:webview -- tests/layers.spec.ts tests/selection*.spec.ts tests/history*.spec.ts
npm test
git add src/App.tsx src/components/Palette src/components/Stats src/components/Canvas src/data/mard221.ts src/i18n
git commit -m "feat: translate editor panels and history"
```

### Task 14: Translate recovery, cloud, Beta, feedback, and voice UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Canvas/ChangesCompareDialog.tsx`
- Modify: `src/components/Cloud/CloudDialog.tsx`
- Modify: `src/components/Cloud/CloudComparePreview.tsx`
- Modify: `src/hooks/useVoiceControl.ts`
- Modify: `src/utils/audioFeedback.ts`
- Modify: `src/utils/voiceEnhancement.ts`
- Modify: `src/platform/tauriRuntimeServices.ts`
- Modify resources/tests

- [ ] **Step 1: Add failing bilingual recovery/login/cloud tests**

Cover error-code translation, close guard reading current language, GitHub/Gist preservation, bilingual voice command dictionaries, and recognition/synthesis locale.

- [ ] **Step 2: Translate presentation and remove service labels**

Services expose capability/data, not Chinese labels. Native close callback calls `i18n.t()` at event time.

- [ ] **Step 3: Verify and commit**

```bash
npm --prefix platforms/vscode run test:webview -- tests/snapshot*.spec.ts tests/cloud-contract.spec.ts
npm run ext:test:e2e -- --grep "GitHub|cloud|restart"
npm test
git add src/App.tsx src/components/Cloud src/components/Canvas src/hooks src/utils src/platform src/i18n
git commit -m "feat: translate recovery and cloud workflows"
```

### Task 15: Audit hardcoded UI and generate bilingual store screenshots

**Files:**
- Create: `src/i18n/hardcodedUi.test.ts`
- Create: `platforms/extension/e2e/store-screenshots.spec.ts`
- Create: `platforms/extension/e2e/storeScreenshotHelpers.ts`
- Create: `scripts/generate-store-screenshots.mjs`
- Create: `scripts/validate-store-screenshots.mjs`
- Create: `scripts/validate-store-screenshots.node-test.mjs`
- Modify: `package.json`, `package-lock.json`
- Create: ten PNG files under `platforms/extension/store-assets/`

- [ ] **Step 1: Add failing hardcoded-UI audit**

Scan JSX text, `title`, `aria-label`, `placeholder`, and dialog calls. Maintain a narrow allowlist for comments, tests, MARD brand data, voice dictionaries, sample/user data, manifest locales, and LLM examples.

- [ ] **Step 2: Remove all unapproved hardcoded UI**

Run until the audit passes without broad directory exemptions.

- [ ] **Step 3: Add failing screenshot-validator tests**

Validate exact five-file sets, PNG signature, width 1280, height 800, matching filenames, and no extras.

- [ ] **Step 4: Implement deterministic screenshot harness**

Use fresh persistent extension contexts with viewport 1280×800, DPR 1, UTC, light mode, reduced motion, fixed timestamps, no external network, animation/caret suppression, `document.fonts.ready`, and condition-based waits.

Implement exact scenarios:

```text
01 dinosaur-rex / palette
02 dinosaur-triceratops / image conversion
03 dinosaur-raptor / layers
04 dinosaur-brachiosaurus / export dialog
05 dinosaur-rex background + pterosaur/ankylosaur cloud list
```

Generate English and Chinese from identical scenario manifests.

- [ ] **Step 5: Generate and validate assets**

```bash
npm run ext:screenshots:update
npm run ext:screenshots:validate
node --test scripts/validate-store-screenshots.node-test.mjs
```

- [ ] **Step 6: Full verification**

```bash
npm test
npm run build
npm run ext:test:packaging
npm run ext:test:e2e
npm --prefix platforms/vscode run test:webview
npm --prefix platforms/vscode run test:e2e
npm run ext:screenshots:validate
```

- [ ] **Step 7: Commit**

```bash
git add src/i18n platforms/extension/e2e platforms/extension/store-assets scripts package.json package-lock.json
git commit -m "test: add bilingual browser store screenshots"
```

## Stage verification gate

After every task, run at minimum:

```bash
npx vitest run src/i18n
npm run build
npm run ext:build:chrome
npm --prefix platforms/vscode run build
```

After Tasks 8–14, also run the touched Playwright specs in both languages. Do not begin screenshots while the hardcoded-UI audit has failures.

## Final manual review

- Toggle `🌐 中文 / EN` in Desktop, VS Code, Chrome/Edge, Android, and iOS where available.
- Confirm no project/history/dirty changes when switching.
- Review every screenshot at 100% for clipping, cursor/hover artifacts, transient messages, and mixed UI language.
- Confirm English and Chinese pairs use identical dinosaur artwork and layout.
- Confirm rights to use the selected dinosaur samples in public commercial listings before submission.
