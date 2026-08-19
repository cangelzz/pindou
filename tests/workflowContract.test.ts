import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const ci = read(".github/workflows/ci.yml");
const release = read(".github/workflows/release.yml");
const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

function indentedBlock(source: string, header: string, indent: number) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `${" ".repeat(indent)}${header}`);
  expect(start, `missing ${header}`).toBeGreaterThanOrEqual(0);
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === "" || lines[end].search(/\S/) > indent)) end += 1;
  return lines.slice(start, end).join("\n");
}

const jobBlock = (workflow: string, job: string) => indentedBlock(workflow, `${job}:`, 2);
const namedStep = (job: string, name: string) => indentedBlock(job, `- name: ${name}`, 6);
const actionStep = (job: string, action: string) => indentedBlock(job, `- uses: ${action}`, 6);

function expectOrdered(job: string, values: string[]) {
  let previous = -1;
  for (const value of values) {
    const position = job.indexOf(value);
    expect(position, `missing ${value}`).toBeGreaterThan(previous);
    previous = position;
  }
}

function stepContaining(job: string, value: string) {
  const lines = job.split("\n");
  const match = lines.findIndex((line) => line.includes(value));
  expect(match, `missing ${value}`).toBeGreaterThanOrEqual(0);
  let start = match;
  while (start >= 0 && !/^ {6}- /.test(lines[start])) start -= 1;
  expect(start, `missing step for ${value}`).toBeGreaterThanOrEqual(0);
  let end = start + 1;
  while (end < lines.length && !/^ {6}- /.test(lines[end])) end += 1;
  return lines.slice(start, end).join("\n");
}

describe("browser extension workflow contract", () => {
  it("serializes release runs across refs", () => {
    const concurrency = indentedBlock(release, "concurrency:", 0);
    expect(concurrency).toContain("group: release");
    expect(concurrency).toContain("cancel-in-progress: false");
    expect(concurrency).not.toContain("github.ref");
  });

  it("keeps all extension commands backed by package scripts", () => {
    for (const name of [
      "ext:build:chrome",
      "ext:build:edge",
      "ext:validate",
      "ext:test:packaging",
      "ext:test:contract",
      "ext:test:e2e",
      "ext:package",
    ]) {
      expect(scripts[name], `missing package script ${name}`).toBeTypeOf("string");
    }
  });

  it("tests, validates, packages, and always uploads browser extension CI artifacts", () => {
    const job = jobBlock(ci, "test-extension");
    expect(job).toContain("runs-on: ubuntu-latest");
    const setup = actionStep(job, "actions/setup-node@v6");
    expect(setup).toContain("node-version: 22");
    expect(setup).toContain("cache: npm");
    const commands = [
      "run: npm ci",
      "run: npx playwright install --with-deps chromium",
      "run: npm run ext:build:chrome",
      "run: npm run ext:build:edge",
      "run: npm run ext:validate",
      "run: npm run ext:test:packaging",
      "run: npm run ext:test:contract",
      "run: xvfb-run -a npm run ext:test:e2e",
      "run: npm run ext:package",
    ];
    expectOrdered(job, commands);
    for (const command of commands) expect(stepContaining(job, command)).not.toContain("if:");
    const upload = actionStep(job, "actions/upload-artifact@v4");
    expect(upload).toContain("if: always()");
    expect(upload).toContain("if-no-files-found: warn");
    expect(upload).toContain("artifacts/*.zip");
    expect(upload).toMatch(/^\s+test-results\/$/m);
    expect(upload).toMatch(/^\s+playwright-report\/$/m);
  });

  it("gates desktop builds on every test job", () => {
    expect(jobBlock(ci, "build")).toMatch(/needs:\s*\[test, test-vscode, test-extension\]/);
  });

  it("serializes idempotent draft creation before parallel asset uploads", () => {
    const draft = jobBlock(release, "create-draft-release");
    expect(draft).toContain("needs: compute-version");
    expect(draft).toContain("permissions:");
    expect(draft).toContain("contents: write");
    expect(draft).toContain("TAG: ${{ needs.compute-version.outputs.tag }}");
    expect(draft).toContain("VERSION: ${{ needs.compute-version.outputs.version }}");
    expect(draft).toContain("gh release view");
    expect(draft).toContain("--json isDraft");
    expect(draft).toContain("gh release create");
    expect(draft).toContain("--draft");
    expect((release.match(/^  create-draft-release:$/gm) ?? [])).toHaveLength(1);
    expect(jobBlock(release, "build-and-upload")).toContain("needs: [compute-version, create-draft-release]");
  });

  it("builds and uploads version-matched Chrome and Edge assets before finalizing release", () => {
    const job = jobBlock(release, "build-browser-extensions");
    expect(job).toContain("needs: [compute-version, create-draft-release]");
    expect(actionStep(job, "actions/checkout@v6")).toContain("fetch-depth: 0");
    const setup = actionStep(job, "actions/setup-node@v6");
    expect(setup).toContain("node-version: 22");
    expect(setup).toContain("cache: npm");
    expectOrdered(job, [
      "run: npm ci",
      "run: npm run ext:build:chrome",
      "run: npm run ext:build:edge",
      "run: npm run ext:validate",
      "run: npm run ext:package",
      "- name: Assert versioned extension artifacts",
      "- name: Upload extension assets to draft release",
    ]);
    const assertion = namedStep(job, "Assert versioned extension artifacts");
    expect(assertion).toContain("VERSION: ${{ needs.compute-version.outputs.version }}");
    expect(assertion).toContain('test "$(node scripts/version.mjs)" = "${VERSION}"');
    expect(assertion).toContain('pindouverse-chrome-${VERSION}.zip');
    expect(assertion).toContain('pindouverse-edge-${VERSION}.zip');
    expect(assertion).not.toContain("if:");
    const upload = namedStep(job, "Upload extension assets to draft release");
    expect(upload).toContain("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(upload).toContain("TAG: ${{ needs.compute-version.outputs.tag }}");
    expect(upload).toContain("VERSION: ${{ needs.compute-version.outputs.version }}");
    expect(upload).toContain('gh release upload "${TAG}"');
    expect(upload).toContain('pindouverse-chrome-${VERSION}.zip');
    expect(upload).toContain('pindouverse-edge-${VERSION}.zip');
    expect(upload).toContain("--clobber");
    expect(upload).not.toContain("if:");
    expect(job).not.toMatch(/chrome web store|edge add-ons|webstore/i);
    expect(jobBlock(release, "finalize-release")).toMatch(/needs:\s*\[compute-version, create-draft-release, build-and-upload, build-browser-extensions\]/);
  });
});
