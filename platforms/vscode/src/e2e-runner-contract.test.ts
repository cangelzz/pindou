import * as fs from "fs";
import * as path from "path";
import Mocha from "mocha";
import { describe, expect, test } from "vitest";

const E2E_SUITE_DIR = path.resolve(__dirname, "../tests-e2e/suite");

describe("VS Code E2E runner contract", () => {
  test("the configured Mocha UI provides the globals used by host smoke tests", () => {
    const runnerSource = fs.readFileSync(path.join(E2E_SUITE_DIR, "index.ts"), "utf8");
    const testSource = fs.readFileSync(path.join(E2E_SUITE_DIR, "extension.test.ts"), "utf8");
    const configuredUi = runnerSource.match(/ui:\s*["'](\w+)["']/)?.[1];

    expect(configuredUi, "tests-e2e/suite/index.ts must configure a Mocha UI").toBeTruthy();

    const mocha = new Mocha({ ui: configuredUi as Mocha.Interface });
    const testGlobals: Record<string, unknown> = {};
    mocha.suite.emit("pre-require", testGlobals, "extension.test.js", mocha);

    for (const globalName of ["suite", "test"] as const) {
      if (new RegExp(`\\b${globalName}\\s*\\(`).test(testSource)) {
        expect(
          testGlobals[globalName],
          `Mocha UI '${configuredUi}' must provide ${globalName}()`,
        ).toBeTypeOf("function");
      }
    }
  });
});
