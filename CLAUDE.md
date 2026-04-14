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

## Git Workflow

**NEVER commit directly to main.** Always:

1. Create a feature/fix branch: `git checkout -b fix/description` or `feature/description`
2. Make as many commits as needed on the branch during development
3. When done, squash merge to main: `git checkout main && git merge --squash branch-name && git commit -m "concise summary"`
4. Delete the branch: `git branch -d branch-name`

This keeps main history clean with one commit per feature/fix.
