import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

// __dirname at runtime is `out-e2e/suite/`. Fixtures live in tests-e2e/fixtures
// (sources). Resolve back to the project root then into the source path.
const FIXTURE_PINDOU = path.resolve(__dirname, "../../tests-e2e/fixtures/sample.pindou");

suite("PindouVerse extension — host smoke", () => {
  test("extension is present and activates", async () => {
    const ext = vscode.extensions.getExtension("PindouVerse.pindouverse");
    assert.ok(ext, "Extension PindouVerse.pindouverse not found");
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  test("commands are registered", async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes("pindouverse.newProject"), "newProject command missing");
    assert.ok(cmds.includes("pindouverse.openProject"), "openProject command missing");
  });

  test("opening a .pindou file uses the custom editor", async () => {
    const uri = vscode.Uri.file(FIXTURE_PINDOU);
    await vscode.commands.executeCommand("vscode.openWith", uri, "pindouverse.editor");

    // Wait for the tab to register
    let attempts = 0;
    let activeTab: vscode.Tab | undefined;
    while (attempts < 30) {
      activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
      if (activeTab?.input instanceof vscode.TabInputCustom) break;
      await new Promise((r) => setTimeout(r, 200));
      attempts++;
    }

    assert.ok(activeTab, "no active tab after openWith");
    assert.ok(
      activeTab!.input instanceof vscode.TabInputCustom,
      `expected TabInputCustom, got ${activeTab!.input?.constructor.name}`
    );
    const input = activeTab!.input as vscode.TabInputCustom;
    assert.strictEqual(input.viewType, "pindouverse.editor");
    assert.strictEqual(input.uri.fsPath, FIXTURE_PINDOU);

    // Cleanup
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("newProject command opens an untitled doc in the custom editor", async () => {
    await vscode.commands.executeCommand("pindouverse.newProject");

    let attempts = 0;
    let activeTab: vscode.Tab | undefined;
    while (attempts < 30) {
      activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
      if (activeTab?.input instanceof vscode.TabInputCustom) break;
      await new Promise((r) => setTimeout(r, 200));
      attempts++;
    }

    assert.ok(activeTab, "no active tab after newProject");
    const input = activeTab!.input as vscode.TabInputCustom;
    assert.strictEqual(input.viewType, "pindouverse.editor");
    // The temp file should live under globalStorage and be named untitled_<ts>.pindou
    assert.match(
      input.uri.fsPath.replace(/\\/g, "/"),
      /\/untitled_\d+\.pindou$/i,
      `expected untitled temp path, got ${input.uri.fsPath}`
    );

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });
});
