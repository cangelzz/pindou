# PindouVerse — Project Guidelines

## Legacy Desktop Versioning

The root version system applies only to the **Legacy / Deprecated Desktop/Tauri client**.

Format: `MAJOR.MINOR.COMMITS`

- **MAJOR** — Big Legacy Desktop release, bump with `./scripts/version.sh --bump-major` (resets MINOR and COMMITS to 0)
- **MINOR** — Approved emergency Legacy Desktop maintenance release, bump with `./scripts/version.sh --bump-minor` (resets COMMITS to 0)
- **COMMITS** — Auto-counted commits since last `vMAJOR.MINOR.0` tag

Example: `1.0.0` → `1.0.38` → (bump minor) → `1.1.0` → (bump major) → `2.0.0`

The root `VERSION`, `scripts/version.sh`, and `scripts/version.mjs` version system applies only to the legacy files `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.

The VS Code extension has an independent version in `platforms/vscode/package.json`; keep `platforms/vscode/package-lock.json` synchronized when changing it. Routine extension releases must not use `scripts/version.sh` or the Legacy Desktop release workflow.

Legacy Desktop commands:
- `./scripts/version.sh` — print the current Legacy Desktop version
- `./scripts/version.sh --apply` — write the Legacy Desktop version to `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
- `./scripts/version.sh --bump-minor` — update `VERSION`, create the new `vMAJOR.MINOR.0` tag, then synchronize the three legacy version files
- `./scripts/version.sh --bump-major` — update `VERSION`, create the new `vMAJOR.MINOR.0` tag, then synchronize the three legacy version files
- After bumping, do not recreate the tag. Commit the updated version files first, then push the commit and the existing tag:
  ```bash
  git add VERSION package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
  git commit -m "chore: bump legacy desktop version"
  git push
  git push --tags
  ```

Legacy Desktop releases are emergency-only, for serious compatibility or security fixes approved by a maintainer. Use GitHub Actions → Legacy Desktop Release → Run workflow only for those approved emergencies. The workflow only prepares a draft; a maintainer must review its assets and notes, then manually click Publish.

## Git Workflow

**NEVER commit directly to main.** Always:

1. Create a feature/fix branch: `git checkout -b fix/description` or `feature/description`
2. Make as many commits as needed on the branch during development
3. When done, squash merge to main: `git checkout main && git merge --squash branch-name && git commit -m "concise summary"`
4. Delete the branch: `git branch -d branch-name`

This keeps main history clean with one commit per feature/fix.

## VS Code Extension Tests

Located in `platforms/vscode/`. Two layers:

- **Webview tests** (Playwright, ~30s) — `tests/*.spec.ts` and `tests/webview.integration.test.ts`. Runs the built webview bundle in headless Chromium with a mock `acquireVsCodeApi`. Covers file ops, drawing/store actions, selection/clipboard/undo/redo, image import, export. 42 tests.
- **Host smoke tests** (`@vscode/test-electron`, ~30-60s) — `tests-e2e/suite/*.test.ts`. Boots a real VS Code, verifies the extension activates, commands register, custom editor binds to `*.pindou`, `newProject` opens an untitled temp file. 4 tests. **Skipped on local Windows** (Code.exe launcher rejects test-electron's CLI flags); runs on Linux CI with xvfb. Set `PINDOU_FORCE_E2E=1` to attempt locally on Windows.

Commands (run from `platforms/vscode/`):

```
npm run test:webview   # Playwright suite
npm run test:e2e       # @vscode/test-electron suite (no-op on Windows)
npm test               # both
```

CI runs both layers via the `test-vscode` job in `.github/workflows/ci.yml` on every PR and push to main.

**Before publishing a new VS Code extension version**, always run `npm run test:webview` locally first. The webview suite caught all three of the bugs shipped in 0.8.4–0.8.6, so it's the cheapest pre-publish check.

When adding a new feature to the extension:
1. Add a Playwright test in the relevant `tests/*.spec.ts` (extend an existing describe or create a new spec file)
2. Use store actions via `callAction(page, 'actionName', [args])` for setup/assertions — don't synthesize canvas pointer events unless absolutely necessary
3. For dialog-driven UI, use `stageReply(page, 'showSaveDialog', '/path')` to mock host responses before triggering the action
4. See `tests/helpers.ts` for the full helper API

