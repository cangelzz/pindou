# PindouVerse — Project Guidelines

## Versioning

Format: `MAJOR.MINOR.COMMITS`

- **MAJOR** — Big release, bump with `./scripts/version.sh --bump-major` (resets MINOR and COMMITS to 0)
- **MINOR** — Feature release, bump with `./scripts/version.sh --bump-minor` (resets COMMITS to 0)
- **COMMITS** — Auto-counted commits since last `vMAJOR.MINOR.0` tag

Example: `1.0.0` → `1.0.38` → (bump minor) → `1.1.0` → (bump major) → `2.0.0`

Source of truth: `VERSION` file (stores `MAJOR.MINOR`).

Commands:
- `./scripts/version.sh` — print current version
- `./scripts/version.sh --apply` — write to package.json, tauri.conf.json, Cargo.toml
- `./scripts/version.sh --bump-minor` — new feature release
- `./scripts/version.sh --bump-major` — new big release
- After bumping: `git push --tags`

Release: GitHub Actions → Release → Run workflow (version auto-computed).
