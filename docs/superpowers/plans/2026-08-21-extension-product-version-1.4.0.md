# Extension Product Version 1.4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release VS Code, Chrome, and Edge extensions as `1.4.0` without changing Desktop/Tauri, Android, iOS, or root package versions.

**Architecture:** Treat `platforms/vscode/package.json#version` as the extension-product version source. Browser build, validation, ZIP naming, and workflow contracts read the version through one Node helper, while the existing root `VERSION` and `version.mjs` remain the Desktop/Tauri product line.

**Tech Stack:** Node.js ESM scripts, npm, VSCE, Entra ID/Azure CLI, Vite, Manifest V3, Vitest/Node test, Playwright.

---

### Task 1: Establish the shared extension version source

**Files:**
- Create: `scripts/extension-version.mjs`
- Modify: `scripts/validate-extension-manifest.node-test.mjs`
- Create: `tests/extensionVersion.test.ts`

- [ ] **Step 1: Write failing helper tests**

Test a temporary package file and require exact Chrome-compatible three-component SemVer:

```js
assert.equal(readExtensionVersion({ readFile: () => '{"version":"1.4.0"}' }), "1.4.0");
for (const version of ["1.4", "1.4.0-beta.1", "01.4.0", "1.4.65536"]) {
  assert.throws(() => readExtensionVersion({ readFile: () => JSON.stringify({ version }) }), /extension version/i);
}
```

Add a contract test proving VS Code package and lockfile top-level versions match.

- [ ] **Step 2: Verify RED**

```bash
node --test scripts/validate-extension-manifest.node-test.mjs
npx vitest run tests/extensionVersion.test.ts
```

Expected: FAIL because `extension-version.mjs` does not exist and browser scripts still use root commit-count version.

- [ ] **Step 3: Implement the helper**

```js
export function readExtensionVersion({
  packagePath = resolve(repoRoot, "platforms/vscode/package.json"),
  readFile = readFileSync,
} = {}) {
  const version = JSON.parse(readFile(packagePath, "utf8")).version;
  validateChromeVersion(version);
  if (version.split(".").length !== 3) throw new Error("extension version must contain exactly three integer components");
  return version;
}
```

Keep `scripts/version.mjs` unchanged for Desktop/Tauri.

- [ ] **Step 4: Verify and commit**

```bash
node --test scripts/validate-extension-manifest.node-test.mjs
npx vitest run tests/extensionVersion.test.ts
git add scripts/extension-version.mjs scripts/validate-extension-manifest.node-test.mjs tests/extensionVersion.test.ts
git commit -m "build: add shared extension version source"
```

### Task 2: Set VS Code, Chrome, and Edge to 1.4.0

**Files:**
- Modify: `platforms/vscode/package.json`
- Modify: `platforms/vscode/package-lock.json`
- Modify: `platforms/vscode/CHANGELOG.md`
- Modify: `scripts/build-extension.mjs`
- Modify: `scripts/package-extension.mjs`
- Modify: `scripts/validate-extension-manifest.mjs`
- Modify: `scripts/validate-extension-manifest.node-test.mjs`
- Modify: `tests/workflowContract.test.ts`

- [ ] **Step 1: Add failing cross-product version tests**

Require:

```text
VS Code package version
= VS Code lockfile root/package version
= Chrome manifest version
= Edge manifest version
= Chrome ZIP filename/manifest version
= Edge ZIP filename/manifest version
= 1.4.0
```

Assert browser overlays cannot declare `version`, and `manifest.base.json` remains the `0.0.0` build placeholder.

- [ ] **Step 2: Verify RED**

```bash
npm run ext:test:packaging
npx vitest run tests/extensionVersion.test.ts tests/workflowContract.test.ts
```

Expected: FAIL because VS Code is `1.3.4` and browser builds use root Git-derived version.

- [ ] **Step 3: Update VS Code package and lockfile**

```bash
npm --prefix platforms/vscode version 1.4.0 --no-git-tag-version
```

Verify package and lockfile both contain `1.4.0` and no Git tag was created.

- [ ] **Step 4: Add changelog entry**

At the top of `platforms/vscode/CHANGELOG.md`, add `1.4.0` with:

- Shared English/Simplified-Chinese UI.
- Automatic detection and persistent language switching.
- Localized import, export, recovery, snapshots, GitHub/Gist, and voice UI.
- Browser-store screenshot/localization infrastructure where relevant to the shared editor.
- Existing editor correctness/recovery improvements included in this release.

- [ ] **Step 5: Switch browser scripts to the extension helper**

Replace browser-extension uses of `computeVersion()` with `readExtensionVersion()` in build, validation CLI, packaging, and packaging tests. Do not alter root/Tauri release version code.

Update workflow contracts so browser artifact names use an extension version output when relevant; the Desktop/Tauri release continues using root version.

- [ ] **Step 6: Verify and commit**

```bash
npm run ext:test:packaging
npm run ext:build:chrome
npm run ext:build:edge
npm run ext:validate
npm run ext:package
npx vitest run tests/extensionVersion.test.ts tests/workflowContract.test.ts
```

Expected artifacts:

```text
artifacts/pindouverse-chrome-1.4.0.zip
artifacts/pindouverse-edge-1.4.0.zip
```

Commit:

```bash
git add platforms/vscode/package.json platforms/vscode/package-lock.json platforms/vscode/CHANGELOG.md \
  scripts/build-extension.mjs scripts/package-extension.mjs scripts/validate-extension-manifest.mjs \
  scripts/validate-extension-manifest.node-test.mjs tests
git commit -m "release: set extension products to 1.4.0"
```

### Task 3: Complete release verification and build artifacts

**Files:**
- Modify only if a verified defect is found.

- [ ] **Step 1: Clean-install and root verification**

```bash
npm ci
npm test
npm run build
```

Expected: all root tests and build pass; root `package.json` remains `1.3.4` and `VERSION` remains `1.3`.

- [ ] **Step 2: VS Code verification and VSIX**

```bash
npm --prefix platforms/vscode ci
npm --prefix platforms/vscode run test:unit
npm --prefix platforms/vscode run test:webview
npm --prefix platforms/vscode run test:e2e
npm --prefix platforms/vscode run package
```

Expected on Windows: unit/webview pass, host E2E reports the documented skip, and this file exists:

```text
platforms/vscode/pindouverse-1.4.0.vsix
```

- [ ] **Step 3: Browser extension verification**

```bash
npm run ext:test:packaging
npm run ext:test:e2e
npm run test:screenshots
npm run ext:screenshots:check
npm run ext:package
```

Validate ZIP manifests and names at version `1.4.0`.

- [ ] **Step 4: Rust/Desktop non-change check**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Verify root/Tauri version files remain unchanged.

- [ ] **Step 5: Record artifact hashes**

```bash
sha256sum \
  platforms/vscode/pindouverse-1.4.0.vsix \
  artifacts/pindouverse-chrome-1.4.0.zip \
  artifacts/pindouverse-edge-1.4.0.zip
```

### Task 4: Publish VS Code 1.4.0 through Entra ID

**External operation:** User has explicitly confirmed testing and requested publication.

- [ ] **Step 1: Verify Entra prerequisites**

```bash
az account show
tfx --version
```

If interactive authentication is required, ask the user to run the login command in-session.

- [ ] **Step 2: Publish with the approved script**

```bash
npm --prefix platforms/vscode run publish:entra
```

This script rebuilds/packages and publishes `pindouverse-1.4.0.vsix` using an Entra token. Do not use PAT publishing.

- [ ] **Step 3: Confirm publication result**

Require a successful Marketplace response from the command. Record the published extension/version URL or identifier. If publication fails, do not merge until the failure is understood or the user explicitly changes the requested order.

### Task 5: Squash merge to main and push

**External operation:** User explicitly requested merge and push after publication.

- [ ] **Step 1: Confirm clean feature branch**

```bash
git status --short
git diff --check
```

- [ ] **Step 2: Update main safely**

Use an isolated main worktree so unrelated changes in the original checkout are untouched:

```bash
git worktree add <temporary-main-worktree> main
git -C <temporary-main-worktree> pull --ff-only origin main
```

- [ ] **Step 3: Squash merge and commit**

```bash
git -C <temporary-main-worktree> merge --squash feature/shared-ui-i18n-implementation
git -C <temporary-main-worktree> commit -m "feat: add shared English and Chinese UI"
```

- [ ] **Step 4: Verify merged result**

```bash
npm --prefix <temporary-main-worktree> ci
npm --prefix <temporary-main-worktree> test
npm --prefix <temporary-main-worktree> run build
```

- [ ] **Step 5: Push and clean up**

```bash
git -C <temporary-main-worktree> push origin main
git worktree remove <temporary-main-worktree>
git branch -D feature/shared-ui-i18n-implementation
```

Do not publish Chrome/Edge stores automatically; leave the validated `1.4.0` ZIPs for manual store submission or a later explicit API update request.
