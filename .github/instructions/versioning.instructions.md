---
description: "Use when: legacy desktop version, deprecated desktop, Tauri version, desktop release, emergency desktop release, VERSION, scripts/version.sh, scripts/version.mjs, VS Code extension version, platforms/vscode/package.json, platforms/vscode/package-lock.json, extension release, bump version, tag"
applyTo: "VERSION, scripts/version.sh, scripts/version.mjs, .github/workflows/release.yml, package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, platforms/vscode/package.json, platforms/vscode/package-lock.json"
---

# Legacy Desktop Versioning

This versioning system is exclusively for the Legacy / Deprecated Desktop/Tauri client. The root version system does not govern the VS Code extension.

## Format: `MAJOR.MINOR.COMMITS`

| Part | Meaning | How it changes |
|------|---------|----------------|
| MAJOR | Big Legacy Desktop release | `./scripts/version.sh --bump-major` (resets MINOR and COMMITS to 0) |
| MINOR | Approved emergency Legacy Desktop maintenance release | `./scripts/version.sh --bump-minor` (resets COMMITS to 0) |
| COMMITS | Auto-counted commits since last `vMAJOR.MINOR.0` tag | Automatic, no manual action |

Example progression: `1.0.0` → `1.0.1` → ... → `1.0.38` → (bump minor) → `1.1.0` → `1.1.1` → ... → (bump major) → `2.0.0`

## Key Files

### Legacy Desktop

- `VERSION` — stores the Legacy Desktop `MAJOR.MINOR` value (for example, `1.0`) and is the source of truth for that client only.
- `scripts/version.sh` — handles Legacy Desktop bumps, tags, and synchronization to `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
- `scripts/version.mjs` — computes the Legacy Desktop `MAJOR.MINOR.COMMITS` value used by `scripts/version.sh` for print and apply operations.

### VS Code Extension

- `platforms/vscode/package.json` — independent source of truth for the VS Code extension version.
- `platforms/vscode/package-lock.json` — must remain synchronized with the extension package version.

Routine extension releases must not use `scripts/version.sh` or the Legacy Desktop release workflow

## Legacy Desktop Commands

```bash
# Check the current Legacy Desktop version (no changes)
./scripts/version.sh

# Write the Legacy Desktop version to package.json, tauri.conf.json, and Cargo.toml
./scripts/version.sh --apply

# Approved emergency Legacy Desktop maintenance release: updates VERSION,
# creates the vMAJOR.MINOR.0 tag, then synchronizes the three legacy version files
./scripts/version.sh --bump-minor

# New major Legacy Desktop release: updates VERSION, creates the
# vMAJOR.MINOR.0 tag, then synchronizes the three legacy version files
./scripts/version.sh --bump-major
```

A bump command has already created the tag. Do not recreate it. Commit the modified version files first, then push the commit and the existing tag in this order:

```bash
git add VERSION package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump legacy desktop version"
git push
git push --tags
```

## Emergency Legacy Desktop Release

Legacy Desktop releases are emergency-only. Run Actions → Legacy Desktop Release → Run workflow only for a serious compatibility or security fix that a maintainer has explicitly approved. The workflow only prepares a draft; a maintainer must review its assets and notes, then manually click Publish. Do not use it as the routine VS Code extension release path.
