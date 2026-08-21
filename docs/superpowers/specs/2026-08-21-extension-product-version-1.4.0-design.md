# Extension Product Version 1.4.0 Design

**Date:** 2026-08-21  
**Status:** Approved design

## Goal

Release VS Code, Chrome, and Edge extensions as version `1.4.0`, while keeping Desktop/Tauri, Android, iOS, and the root web package on the existing root version line.

## Version boundary

The three extension products share one source of truth:

```text
platforms/vscode/package.json#version
```

Target:

```text
VS Code  1.4.0
Chrome   1.4.0
Edge     1.4.0
```

Unchanged:

```text
VERSION
package.json
package-lock.json
src-tauri/tauri.conf.json
src-tauri/Cargo.toml
src-tauri/Cargo.lock
```

## Implementation

- Set `platforms/vscode/package.json` and its lockfile to `1.4.0`.
- Add a `1.4.0` entry to `platforms/vscode/CHANGELOG.md` describing shared English/Simplified-Chinese UI, language persistence/switching, and browser store screenshot work.
- Add `scripts/extension-version.mjs` to read and validate the VS Code package version as Chrome-compatible three-component SemVer.
- Make Chrome/Edge build, manifest validation, packaging, and artifact naming use this extension version.
- Keep root `scripts/version.mjs` and `version.sh` for the Desktop/Tauri product line.
- Add tests proving VS Code package/lock, Chrome manifest, Edge manifest, ZIP names, and ZIP manifests use one extension version.

## Release process

1. Run complete automated verification.
2. Build `pindouverse-1.4.0.vsix`.
3. Build `pindouverse-chrome-1.4.0.zip` and `pindouverse-edge-1.4.0.zip`.
4. Publish VS Code through the existing Entra ID script.
5. Confirm Marketplace publication.
6. Squash merge the feature branch to `main` and push.
7. Do not automatically submit Chrome/Edge store updates.

The existing root GitHub Release workflow remains the Desktop/Tauri release workflow and does not define the extension-product version.
