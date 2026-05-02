# Testing the VS Code Extension

Two test layers, run from `platforms/vscode/`.

## Quick reference

| Command | What it does | When to run |
|---|---|---|
| `npm run test:webview` | Playwright tests against the webview bundle (~30s, headless Chromium with mocked extension host) | Before every publish; whenever you change webview/store code |
| `npm run test:e2e` | `@vscode/test-electron` smoke tests against a real VS Code instance (~30–60s) | CI; locally on Linux/macOS only (Windows skips automatically — see below) |
| `npm test` | Both | Full check |

All commands automatically build the extension first.

## Layer A — Webview tests (Playwright)

Files in `tests/`:

| File | Coverage |
|---|---|
| `webview.integration.test.ts` | Critical-path smoke (load file, render pixels, save, projectInfo title) |
| `file-ops.spec.ts` | New / Open / Save / Save As / Auto-save / dirty tracking. Includes regression coverage for the 0.8.4 (image import), 0.8.5 (Save As), and 0.8.6 (untitled overwrite) bugs |
| `drawing.spec.ts` | `setCell`, `batchSetCells`, eraser, `setTool`, `replaceColor`, toolbar button wiring |
| `edit-ops.spec.ts` | Undo / Redo (including Ctrl+Z), selection, clipboard, paste, deleteSelection |
| `import.spec.ts` | Image import dialog: file picker → preview → auto-detect → 预览 → 对比 → 确认导入 |
| `export.spec.ts` | Blueprint PNG, preview JPG, mirror export, cancel-dialog handling |

### How it works

The harness (`tests/helpers.ts → createTestHtml`) loads the built webview bundle and stubs `acquireVsCodeApi`. Every postMessage from the webview is captured, and any request with a `requestId` is auto-replied (`showSaveDialog`, `showOpenDialog`, `readFile`, `writeFile`, `saveAs`, `getAutosaveDir`). Use `stageReply()` to queue specific responses before triggering an action.

### Helper API

```ts
import {
  setupPage,        // boot the harness HTML (call once per test)
  loadProject,      // simulate the host opening a .pindou file
  cleanupHarness,   // afterAll cleanup
  callAction,       // dispatch a Zustand store action: callAction(page, 'setCell', [0, 0, 5])
  setStoreState,    // setState shortcut
  getStoreState,    // read a single store field
  stageReply,       // queue a fake host response: stageReply(page, 'showSaveDialog', '/foo.pindou')
  getMessages,      // all postMessage payloads sent by the webview
  getWrites,        // captured writeFile / save / saveAs payloads
  clearMessages,
  clickButton,      // page.getByRole('button', { name }).click()
  countRenderedPixels,
} from "./helpers";
```

### Adding a new test

```ts
import { test, expect } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, getStoreState, stageReply } from "./helpers";

test.describe("My new feature", () => {
  test.afterAll(() => cleanupHarness());

  test("does the thing", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);              // loads samples/asuka71x100.pindou
    await stageReply(page, "showSaveDialog", "/picked/file.pindou");
    await callAction(page, "saveProjectAs");
    expect(await getStoreState(page, "projectPath")).toBe("/picked/file.pindou");
  });
});
```

### Conventions

- **Prefer store actions** (`callAction(page, 'setCell', [r, c, color])`) over synthetic canvas pointer events. The canvas mouse handler ultimately calls the same store actions, and pointer events are flaky across zoom/offset/DPI.
- **Always stage replies before triggering actions** that go through the adapter. Otherwise the request hangs and the test times out.
- **Use Chinese button labels with regex** when possible: `page.getByRole('button', { name: /^预览$/ })` because the dialog has multiple buttons containing "预览".

## Layer B — Host smoke tests (`@vscode/test-electron`)

Files in `tests-e2e/`:

| File | Purpose |
|---|---|
| `runner.ts` | Downloads VS Code and launches it with the extension under development |
| `suite/index.ts` | Mocha entry point |
| `suite/extension.test.ts` | The actual tests |
| `fixtures/sample.pindou` | Test project |

These verify behavior that **only happens in real VS Code**: command registration, custom editor view-type binding, `vscode.openWith` after Save As switching the active editor.

### Windows local skip

`Code.exe` on modern VS Code releases is a thin launcher that rejects the CLI flags `@vscode/test-electron` passes (e.g. `--extensionTestsPath=...`). The test runner detects Windows and prints:

```
[e2e] Skipping on Windows (set PINDOU_FORCE_E2E=1 to run anyway).
```

Set `PINDOU_FORCE_E2E=1` to attempt anyway. CI runs this suite on Linux with `xvfb-run`, where it works fine.

## CI

Both layers run in `.github/workflows/ci.yml` → `test-vscode` job on every PR and push to main:

```yaml
- name: Run VS Code webview tests
  run: cd platforms/vscode && npm run test:webview
- name: Run VS Code host smoke tests
  run: cd platforms/vscode && xvfb-run -a npm run test:e2e
```

On failure, `test-results/` is uploaded as an artifact.

## Pre-publish checklist

Before `npm run publish:entra` (or any publish):

1. `npm run build` — make sure the bundle compiles
2. `npm run test:webview` — must be green
3. Bump `package.json` version + add CHANGELOG entry
4. Commit + push
5. `npm run publish:entra`

The webview suite caught all three of the bugs shipped in 0.8.4–0.8.6 — running it as step 2 would have prevented every one of them.
