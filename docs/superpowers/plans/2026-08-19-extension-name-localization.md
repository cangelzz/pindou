# Browser Extension Name Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use Manifest V3 localization so Chrome and Edge display `PindouVerse` by default and `PindouVerse - 拼豆宇宙` for simplified and traditional Chinese browser locales.

**Architecture:** Keep a single localized manifest contract shared by Chrome and Edge. Store overlays retain only brand-specific descriptions, while `_locales` owns `name` and `short_name`; the build, directory validator, ZIP validator, and packaging tests enforce this structure.

**Tech Stack:** Manifest V3 localization, Node.js build scripts, Vite, Node test runner, Playwright.

---

## File map

```text
platforms/extension/manifest.base.json           # localized manifest message references
platforms/extension/_locales/en/messages.json    # international extension name
platforms/extension/_locales/zh_CN/messages.json # simplified Chinese bilingual name
platforms/extension/_locales/zh_TW/messages.json # traditional Chinese bilingual name
platforms/extension/store/chrome.json            # Chrome description only
platforms/extension/store/edge.json              # Edge description only
platforms/extension/vite.config.ts                # copies locale directory for direct/test builds
scripts/build-extension.mjs                       # copies locale directory for branded builds
scripts/validate-extension-manifest.mjs           # validates locale contract in directories and ZIPs
scripts/validate-extension-manifest.node-test.mjs # localization and packaging regression tests
```

### Task 1: Define and validate the localized manifest contract

**Files:**
- Create: `platforms/extension/_locales/en/messages.json`
- Create: `platforms/extension/_locales/zh_CN/messages.json`
- Create: `platforms/extension/_locales/zh_TW/messages.json`
- Modify: `platforms/extension/manifest.base.json`
- Modify: `platforms/extension/store/chrome.json`
- Modify: `platforms/extension/store/edge.json`
- Modify: `scripts/validate-extension-manifest.mjs`
- Test: `scripts/validate-extension-manifest.node-test.mjs`

- [ ] **Step 1: Add failing localization contract tests**

Update the valid manifest fixture to require:

```js
{
  default_locale: "en",
  name: "__MSG_extensionName__",
  short_name: "__MSG_extensionShortName__"
}
```

Add tests that assert:

```js
assert.throws(() => validateManifest({ ...validManifest(), default_locale: undefined }, root, version), /default_locale/);
assert.throws(() => validateManifest({ ...validManifest(), name: "PindouVerse" }, root, version), /__MSG_extensionName__/);
assert.throws(() => validateOverlay({ name: "PindouVerse", description: "Editor" }), /description/);
```

Also create locale fixture files and test missing `zh_CN`, missing message keys, wrong English name, and wrong Chinese bilingual name.

- [ ] **Step 2: Run tests and verify the expected red state**

Run:

```bash
node --test scripts/validate-extension-manifest.node-test.mjs
```

Expected: localization tests fail because the manifest has no `default_locale`, overlays still own names, and no locale files exist.

- [ ] **Step 3: Add the locale message files**

`platforms/extension/_locales/en/messages.json`:

```json
{
  "extensionName": { "message": "PindouVerse" },
  "extensionShortName": { "message": "PindouVerse" }
}
```

`zh_CN/messages.json` and `zh_TW/messages.json`:

```json
{
  "extensionName": { "message": "PindouVerse - 拼豆宇宙" },
  "extensionShortName": { "message": "PindouVerse" }
}
```

- [ ] **Step 4: Localize the base manifest and narrow overlays**

Change the base manifest to:

```json
{
  "default_locale": "en",
  "name": "__MSG_extensionName__",
  "short_name": "__MSG_extensionShortName__"
}
```

Change each store overlay to contain exactly:

```json
{ "description": "...existing brand description..." }
```

Update validator allowlists so `default_locale` is permitted and overlays allow only `description`.

- [ ] **Step 5: Implement locale validation**

Add a `validateLocales(root, manifest, fileExists, readJson)` helper that verifies:

- `default_locale === "en"`
- exact manifest message references
- locale directories `en`, `zh_CN`, `zh_TW`
- both required message keys in every locale
- exact international and Chinese values

Call it from directory and ZIP validation. For ZIP validation, parse locale JSON through existing entry streams before validating the manifest.

- [ ] **Step 6: Run localization tests**

```bash
node --test scripts/validate-extension-manifest.node-test.mjs
```

Expected: all manifest/overlay/locale tests pass.

- [ ] **Step 7: Commit the localized manifest contract**

```bash
git add platforms/extension/manifest.base.json platforms/extension/store \
  platforms/extension/_locales scripts/validate-extension-manifest.mjs \
  scripts/validate-extension-manifest.node-test.mjs
git commit -m "feat: localize browser extension name"
```

### Task 2: Copy locales into every build and ZIP

**Files:**
- Modify: `platforms/extension/vite.config.ts`
- Modify: `scripts/build-extension.mjs`
- Test: `scripts/validate-extension-manifest.node-test.mjs`

- [ ] **Step 1: Add failing build and ZIP tests**

Extend the branded-build test to assert:

```js
for (const brand of ["chrome", "edge"]) {
  for (const locale of ["en", "zh_CN", "zh_TW"]) {
    assert.ok(existsSync(join(distRoot, brand, "_locales", locale, "messages.json")));
  }
}
```

Extend ZIP validation tests to require all three `_locales/.../messages.json` entries and reject a ZIP missing one locale.

- [ ] **Step 2: Verify the build test fails**

```bash
node --test --test-name-pattern="build emits|packages deterministic" scripts/validate-extension-manifest.node-test.mjs
```

Expected: FAIL because `_locales` is not copied into dist or ZIP.

- [ ] **Step 3: Copy locales in Vite and branded builds**

In the Vite copy plugin, copy `platforms/extension/_locales` recursively into `outDir/_locales` for direct and test builds.

In `scripts/build-extension.mjs`, ensure the staging directory receives the same `_locales` tree before `validateDirectory`. Use `cpSync(localesSource, localesTarget, { recursive: true })`.

- [ ] **Step 4: Verify branded output and ZIPs**

```bash
npm run ext:build:chrome
npm run ext:build:edge
npm run ext:validate
npm run ext:package
node --test scripts/validate-extension-manifest.node-test.mjs
```

Expected: locale files are present and validated in Chrome/Edge dist and ZIP roots.

- [ ] **Step 5: Run extension regression tests**

```bash
npm run ext:test:contract
npm run ext:test:e2e
npm test
```

Expected: contract, E2E, and root tests all pass.

- [ ] **Step 6: Commit build integration**

```bash
git add platforms/extension/vite.config.ts scripts/build-extension.mjs \
  scripts/validate-extension-manifest.node-test.mjs
git commit -m "build: package extension locales"
```

### Task 3: Final localization verification

**Files:**
- Modify only if verification exposes a tested defect.

- [ ] **Step 1: Verify generated manifests**

```bash
node -e "for (const b of ['chrome','edge']) { const m=require('./platforms/extension/dist/'+b+'/manifest.json'); console.log(b,m.name,m.default_locale) }"
```

Expected for both brands:

```text
__MSG_extensionName__ en
```

- [ ] **Step 2: Verify locale values and package structure**

```bash
unzip -l artifacts/pindouverse-chrome-*.zip
unzip -l artifacts/pindouverse-edge-*.zip
```

Expected: both archives contain `en`, `zh_CN`, and `zh_TW` message files at ZIP root `_locales/`.

- [ ] **Step 3: Run complete verification**

```bash
npm test
npm run build
npm run ext:test:packaging
npm run ext:test:contract
npm run ext:test:e2e
npm --prefix platforms/vscode run test:webview
```

Expected: all commands pass.

- [ ] **Step 4: Manual browser smoke**

- English Edge/Chrome UI language displays `PindouVerse`.
- Simplified Chinese UI displays `PindouVerse - 拼豆宇宙`.
- Traditional Chinese UI displays `PindouVerse - 拼豆宇宙`.
- No browser-specific suffix appears.
