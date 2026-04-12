---
description: "Use when: version, release, bump version, tag, version number, what version, bump major, bump minor, versioning, make a release, ship, publish"
applyTo: ["VERSION", "scripts/version.sh", ".github/workflows/release.yml", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"]
---

# Versioning System

## Format: `MAJOR.MINOR.COMMITS`

| Part | Meaning | How it changes |
|------|---------|----------------|
| MAJOR | Big release | `./scripts/version.sh --bump-major` (resets MINOR and COMMITS to 0) |
| MINOR | Feature release | `./scripts/version.sh --bump-minor` (resets COMMITS to 0) |
| COMMITS | Auto-counted commits since last `vMAJOR.MINOR.0` tag | Automatic, no manual action |

Example progression: `1.0.0` → `1.0.1` → ... → `1.0.38` → (bump minor) → `1.1.0` → `1.1.1` → ... → (bump major) → `2.0.0`

## Key Files

- `VERSION` — stores `MAJOR.MINOR` (e.g. `1.0`). This is the source of truth.
- `scripts/version.sh` — computes full version and syncs to project files.

## Commands

```bash
# Check current version (no changes)
./scripts/version.sh

# Write version to package.json, tauri.conf.json, Cargo.toml
./scripts/version.sh --apply

# New feature release: 1.0.x → 1.1.0
./scripts/version.sh --bump-minor

# New big release: 1.x.x → 2.0.0
./scripts/version.sh --bump-major
```

## After bumping, push the tag

```bash
git push --tags
```

## Release via GitHub Actions

Go to Actions → Release → Run workflow. Version is computed automatically.
