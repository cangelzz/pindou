import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ZipArchive } from "archiver";

import { validateChromeVersion, validateDirectory, validateManifest, validateOverlay, validateZip, validateZipEntries } from "./validate-extension-manifest.mjs";
import { packageExtension, publishArtifact } from "./package-extension.mjs";
import { readExtensionVersion } from "./extension-version.mjs";
import { computeVersion, readBaseVersion } from "./version.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const expectedVersion = readExtensionVersion({ packagePath: join(repoRoot, "platforms/vscode/package.json") });

function validManifest(version = expectedVersion) {
  return {
    manifest_version: 3,
    default_locale: "en",
    name: "__MSG_extensionName__",
    short_name: "__MSG_extensionShortName__",
    version,
    description: "Editor",
    permissions: ["storage", "contextMenus"],
    host_permissions: ["https://github.com/login/*", "https://api.github.com/*", "https://gist.githubusercontent.com/*"],
    background: { service_worker: "background.js", type: "module" },
    action: { default_title: "PindouVerse" },
    icons: { 32: "icons/32x32.png", 128: "icons/128x128.png" },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  };
}

const localeMessages = {
  en: {
    extensionName: { message: "PindouVerse" },
    extensionShortName: { message: "PindouVerse" },
    contextMenuConvertImage: { message: "Convert with PindouVerse" },
  },
  zh_CN: {
    extensionName: { message: "PindouVerse - 拼豆宇宙" },
    extensionShortName: { message: "PindouVerse" },
    contextMenuConvertImage: { message: "在 PindouVerse 中转换" },
  },
  zh_TW: {
    extensionName: { message: "PindouVerse - 拼豆宇宙" },
    extensionShortName: { message: "PindouVerse" },
    contextMenuConvertImage: { message: "在 PindouVerse 中转换" },
  },
};

function fixture(manifest = validManifest()) {
  const root = mkdtempSync(join(tmpdir(), "pindou-manifest-"));
  mkdirSync(join(root, "icons"), { recursive: true });
  for (const [locale, messages] of Object.entries(localeMessages)) {
    mkdirSync(join(root, "_locales", locale), { recursive: true });
    writeFileSync(join(root, "_locales", locale, "messages.json"), JSON.stringify(messages));
  }
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(root, "index.html"), "<!doctype html>");
  writeFileSync(join(root, "background.js"), "export {};");
  writeFileSync(join(root, "icons/32x32.png"), "png");
  writeFileSync(join(root, "icons/128x128.png"), "png");
  return root;
}

async function writeZip(zipPath, root, omitted = new Set(), extraDirectories = []) {
  const inputFiles = [];
  const collect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else inputFiles.push(path);
    }
  };
  collect(root);
  await new Promise((resolveArchive, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on("close", resolveArchive);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const file of inputFiles) {
      const name = file.slice(root.length + 1).replaceAll("\\", "/");
      if (!omitted.has(name)) archive.append(readFileSync(file), { name });
    }
    for (const directory of extraDirectories) archive.append(Buffer.alloc(0), { name: directory.endsWith("/") ? directory : `${directory}/` });
    archive.finalize().catch(reject);
  });
}

function rejectsMutation(name, mutate, pattern) {
  test(name, () => {
    const manifest = validManifest();
    mutate(manifest);
    const root = fixture(manifest);
    try { assert.throws(() => validateManifest(manifest, root, expectedVersion), pattern); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("computes project versions through git without invoking bash", () => {
  const calls = [];
  const git = (command, args) => {
    calls.push([command, args]);
    if (args[0] === "rev-parse") throw new Error("tag absent");
    return "42\n";
  };
  assert.deepEqual(readBaseVersion({ readFile: () => "3.7\n" }), { major: 3, minor: 7 });
  assert.equal(computeVersion({ repoRoot: "C:\\repo with spaces", readFile: () => "3.7", execFile: git }), "3.7.42");
  assert.deepEqual(calls, [["git", ["rev-parse", "v3.7.0"]], ["git", ["rev-list", "HEAD", "--count"]]]);
});

test("reads the extension product version from the VS Code package", () => {
  const calls = [];
  assert.equal(readExtensionVersion({
    packagePath: "C:\\repo with spaces\\platforms\\vscode\\package.json",
    readFile: (path) => {
      calls.push(path);
      return JSON.stringify({ version: "1.4.0" });
    },
  }), "1.4.0");
  assert.deepEqual(calls, ["C:\\repo with spaces\\platforms\\vscode\\package.json"]);
});

test("extension versions require exactly three bounded non-zero integers", () => {
  for (const version of [
    "0.0.0", "1", "1.2", "1.2.3.4", "01.2.3", "1.02.3", "1.2.03",
    "1.2.3-beta.1", "1.2.65536", "65536.1.1", "1.-2.3",
  ]) {
    assert.throws(() => readExtensionVersion({ readFile: () => JSON.stringify({ version }) }), /version/i);
  }
  assert.equal(readExtensionVersion({ readFile: () => '{"version":"65535.65535.65535"}' }), "65535.65535.65535");
  assert.equal(readExtensionVersion({ readFile: () => '{"version":"1.4.0"}' }), "1.4.0");
});

test("extension version reader rejects malformed package metadata", () => {
  for (const contents of ["not json", "{}", '{"version": 140}']) {
    assert.throws(() => readExtensionVersion({ readFile: () => contents }), /JSON|version/i);
  }
});

test("store overlays require exactly one non-empty description", () => {
  for (const overlay of [{}, { description: "" }, { description: 1 }, { name: "Brand", description: "Desc" }]) {
    assert.throws(() => validateOverlay(overlay), /name|description|non-empty|string/i);
  }
  assert.doesNotThrow(() => validateOverlay({ description: "Desc" }));
});

test("accepts the exact MV3 extension contract", () => {
  const root = fixture();
  try { assert.doesNotThrow(() => validateManifest(validManifest(), root, expectedVersion)); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

rejectsMutation("rejects non-MV3 manifests", (m) => { m.manifest_version = 2; }, /manifest_version/);
rejectsMutation("rejects missing default locale", (m) => { delete m.default_locale; }, /default_locale/);
rejectsMutation("rejects a non-English default locale", (m) => { m.default_locale = "zh_CN"; }, /default_locale/);
rejectsMutation("rejects a literal extension name", (m) => { m.name = "PindouVerse"; }, /name/);
rejectsMutation("rejects a literal extension short name", (m) => { m.short_name = "PindouVerse"; }, /short_name/);
rejectsMutation("rejects an empty merged description", (m) => { m.description = ""; }, /description/);
rejectsMutation("rejects permission changes", (m) => { m.permissions.push("tabs"); }, /permissions/);
rejectsMutation("rejects host permission changes", (m) => { m.host_permissions.push("<all_urls>"); }, /host_permissions/);
rejectsMutation("rejects content scripts", (m) => { m.content_scripts = []; }, /content_scripts/);
rejectsMutation("rejects side panels", (m) => { m.side_panel = {}; }, /side_panel/);
rejectsMutation("rejects action popups", (m) => { m.action.default_popup = "popup.html"; }, /popup/);
rejectsMutation("rejects externally connectable declarations", (m) => { m.externally_connectable = {}; }, /externally_connectable/);
rejectsMutation("rejects a non-module background", (m) => { delete m.background.type; }, /background/);
rejectsMutation("rejects remote CSP scripts", (m) => { m.content_security_policy.extension_pages = "script-src 'self' https://cdn.example.com"; }, /CSP|content_security_policy/i);
rejectsMutation("rejects unsafe CSP directives", (m) => { m.content_security_policy.extension_pages = "script-src 'self' 'unsafe-eval'; object-src *"; }, /CSP|content_security_policy/i);
for (const field of ["optional_permissions", "optional_host_permissions", "web_accessible_resources", "commands", "devtools_page", "oauth2"]) {
  rejectsMutation(`rejects undeclared manifest field ${field}`, (m) => { m[field] = []; }, new RegExp(field));
}
rejectsMutation("rejects action capability expansion", (m) => { m.action.default_icon = "icons/32x32.png"; }, /action/);
rejectsMutation("rejects mismatched versions", (m) => { m.version = "9.9.9"; }, /version/);
rejectsMutation("rejects invalid Chrome versions", (m) => { m.version = "1.2.beta"; }, /version/);
test("enforces Chrome version component bounds and spelling", () => {
  for (const version of ["0.0.0", "1.65536.0", "01.2.3", "1.02.3"]) assert.throws(() => validateChromeVersion(version), /version/i);
  assert.doesNotThrow(() => validateChromeVersion("65535.65535.65535.65535"));
});
rejectsMutation("rejects missing icon files", (m) => { m.icons[48] = "icons/missing.png"; }, /missing/);

for (const field of ["name", "short_name", "permissions", "host_permissions", "background", "content_scripts", "side_panel", "action", "externally_connectable"]) {
  test(`store overlay cannot override ${field}`, () => {
    assert.throws(() => validateOverlay({ description: "Description", [field]: {} }), new RegExp(field));
  });
}

test("store overlays may only contain description", () => {
  assert.doesNotThrow(() => validateOverlay({ description: "Description" }));
  assert.throws(() => validateOverlay({ description: "Description", version: "1.2.3" }), /version/);
});

test("committed browser manifest sources keep the neutral base and versionless overlays", () => {
  const base = JSON.parse(readFileSync(join(repoRoot, "platforms/extension/manifest.base.json"), "utf8"));
  assert.equal(base.version, "0.0.0");
  for (const brand of ["chrome", "edge"]) {
    const overlay = JSON.parse(readFileSync(join(repoRoot, `platforms/extension/store/${brand}.json`), "utf8"));
    assert.equal(Object.hasOwn(overlay, "version"), false);
    validateOverlay(overlay);
  }
});

test("directory validation requires exact localized messages", () => {
  for (const mutate of [
    (root) => rmSync(join(root, "_locales", "zh_TW", "messages.json")),
    (root) => writeFileSync(join(root, "_locales", "en", "messages.json"), JSON.stringify({ ...localeMessages.en, extra: { message: "drift" } })),
    (root) => writeFileSync(join(root, "_locales", "zh_CN", "messages.json"), JSON.stringify({ ...localeMessages.zh_CN, extensionName: { message: "PindouVerse" } })),
    (root) => writeFileSync(join(root, "_locales", "zh_TW", "messages.json"), JSON.stringify({ ...localeMessages.zh_TW, extensionShortName: { message: "" } })),
  ]) {
    const root = fixture();
    try {
      mutate(root);
      assert.throws(() => validateDirectory(root, expectedVersion), /locale|messages|extensionName|extensionShortName|missing/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("build emits separately validated Chrome and Edge bundles plus legacy and test paths", () => {
  execFileSync(process.execPath, [join(repoRoot, "scripts/build-extension.mjs"), "chrome"], { cwd: repoRoot, stdio: "pipe" });
  execFileSync(process.execPath, [join(repoRoot, "scripts/build-extension.mjs"), "edge"], { cwd: repoRoot, stdio: "pipe" });
  execFileSync(process.execPath, [join(repoRoot, "scripts/build-extension.mjs"), "chrome", "test"], { cwd: repoRoot, stdio: "pipe" });
  const chrome = JSON.parse(readFileSync(join(repoRoot, "platforms/extension/dist/chrome/manifest.json"), "utf8"));
  const edge = JSON.parse(readFileSync(join(repoRoot, "platforms/extension/dist/edge/manifest.json"), "utf8"));
  assert.equal(chrome.version, expectedVersion);
  assert.equal(edge.version, expectedVersion);
  assert.deepEqual(chrome.permissions, edge.permissions);
  assert.deepEqual(chrome.host_permissions, edge.host_permissions);
  assert.equal(chrome.name, "__MSG_extensionName__");
  assert.equal(edge.name, "__MSG_extensionName__");
  assert.equal(chrome.short_name, "__MSG_extensionShortName__");
  assert.equal(edge.short_name, "__MSG_extensionShortName__");
  assert.notEqual(chrome.description, edge.description);
  for (const output of ["dist/chrome", "dist/edge", "dist", "dist-test"]) {
    const outputRoot = join(repoRoot, "platforms/extension", output);
    assert.equal(JSON.parse(readFileSync(join(outputRoot, "manifest.json"), "utf8")).version, expectedVersion);
    for (const [locale, messages] of Object.entries(localeMessages)) {
      assert.deepEqual(JSON.parse(readFileSync(join(outputRoot, "_locales", locale, "messages.json"), "utf8")), messages);
    }
  }
  const builtText = [chrome, edge, ...Object.values(localeMessages)].map(JSON.stringify).join("\n");
  assert.doesNotMatch(builtText, /for Microsoft Edge/);
  assert.equal((builtText.match(/PindouVerse - 拼豆宇宙/g) ?? []).length, 2);
});

test("directory validation rejects extra locales and locale files", () => {
  for (const mutate of [
    (root) => mkdirSync(join(root, "_locales", "zh_HK"), { recursive: true }),
    (root) => {
      mkdirSync(join(root, "_locales", "zh_HK"), { recursive: true });
      writeFileSync(join(root, "_locales", "zh_HK", "messages.json"), JSON.stringify({ ...localeMessages.en, extensionName: { message: "PindouVerse for Microsoft Edge" } }));
    },
    (root) => writeFileSync(join(root, "_locales", "en", "extra.json"), "{}"),
  ]) {
    const root = fixture();
    try {
      mutate(root);
      assert.throws(() => validateDirectory(root, expectedVersion), /locale|exact|file/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("ZIP validation rejects missing and extra locales", async () => {
  const root = fixture();
  const temporary = mkdtempSync(join(tmpdir(), "pindou-zip-locales-"));
  try {
    const missingZip = join(temporary, "missing.zip");
    await writeZip(missingZip, root, new Set(["_locales/zh_TW/messages.json"]));
    await assert.rejects(validateZip(missingZip, expectedVersion), /locale|zh_TW|missing/i);

    mkdirSync(join(root, "_locales", "zh_HK"), { recursive: true });
    writeFileSync(join(root, "_locales", "zh_HK", "messages.json"), JSON.stringify({ ...localeMessages.en, extensionName: { message: "PindouVerse for Microsoft Edge" } }));
    const extraZip = join(temporary, "extra.zip");
    await writeZip(extraZip, root);
    await assert.rejects(validateZip(extraZip, expectedVersion), /locale|zh_HK|exact/i);

    rmSync(join(root, "_locales", "zh_HK"), { recursive: true, force: true });
    const emptyExtraZip = join(temporary, "empty-extra.zip");
    await writeZip(emptyExtraZip, root, new Set(), ["_locales/zh_HK/"]);
    await assert.rejects(validateZip(emptyExtraZip, expectedVersion), /locale|zh_HK|exact/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("packages deterministic root-level ZIPs and validates their contents", async () => {
  const dist = fixture();
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "assets/app.js"), "console.log('ok')");
  const artifacts = mkdtempSync(join(tmpdir(), "pindou-artifacts-"));
  try {
    const first = await packageExtension({ brand: "chrome", distDir: dist, artifactsDir: artifacts, version: expectedVersion });
    assert.equal(first, join(artifacts, `pindouverse-chrome-${expectedVersion}.zip`));
    const firstHash = createHash("sha256").update(readFileSync(first)).digest("hex");
    const second = await packageExtension({ brand: "chrome", distDir: dist, artifactsDir: artifacts, version: expectedVersion });
    const secondHash = createHash("sha256").update(readFileSync(second)).digest("hex");
    assert.equal(firstHash, secondHash);
    const entries = await validateZip(second, expectedVersion);
    assert.deepEqual(entries, [...entries].sort((a, b) => a.localeCompare(b, "en")));
    for (const locale of Object.keys(localeMessages)) assert.ok(entries.includes(`_locales/${locale}/messages.json`));
  } finally {
    rmSync(dist, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  }
});

test("synthetic ZIP entries reject duplicate, traversal, absolute, drive and forbidden paths", () => {
  for (const entries of [
    ["manifest.json", "manifest.json"],
    ["manifest.json", "../escape.js"],
    ["manifest.json", "/absolute.js"],
    ["manifest.json", "C:\\drive.js"],
    ["manifest.json", "folder\\..\\escape.js"],
    ["manifest.json", "dist/manifest.json"],
    ["manifest.json", "src/source.ts"],
    ["manifest.json", "assets/app.js.map"],
    ["manifest.json", "tests/app.test.js"],
  ]) assert.throws(() => validateZipEntries(entries), /ZIP|unsafe|forbidden|duplicate/i);
});

test("artifact publication atomically claims an absent target using a hard link", () => {
  const calls = [];
  publishArtifact("temporary", "target", {
    linkSync: (...args) => calls.push(["link", ...args]),
    readFileSync,
    unlinkSync: (path) => calls.push(["unlink", path]),
  });
  assert.deepEqual(calls, [["link", "temporary", "target"], ["unlink", "temporary"]]);
});

test("concurrent identical candidate accepts EEXIST winner without an existence check", () => {
  const calls = [];
  publishArtifact("temporary", "target", {
    linkSync: () => { calls.push("link"); throw Object.assign(new Error("exists"), { code: "EEXIST" }); },
    readFileSync: () => Buffer.from("same"),
    unlinkSync: (path) => calls.push(`unlink:${path}`),
    existsSync: () => assert.fail("publish must not use a racy existence check"),
  });
  assert.deepEqual(calls, ["link", "unlink:temporary"]);
});

test("concurrent different candidate keeps winner and rejects EEXIST loser", () => {
  const removed = [];
  assert.throws(() => publishArtifact("temporary", "target", {
    linkSync: () => { throw Object.assign(new Error("exists"), { code: "EEXIST" }); },
    readFileSync: (path) => Buffer.from(path === "target" ? "winner" : "loser"),
    unlinkSync: (path) => removed.push(path),
  }), /different content/i);
  assert.deepEqual(removed, ["temporary"]);
});

test("unsupported hard links fail clearly without touching target", () => {
  for (const code of ["EXDEV", "EPERM", "ENOTSUP"]) {
    const removed = [];
    assert.throws(() => publishArtifact("temporary", "target", {
      linkSync: () => { throw Object.assign(new Error(code), { code }); },
      readFileSync,
      unlinkSync: (path) => removed.push(path),
    }), /atomically claim/i);
    assert.deepEqual(removed, ["temporary"]);
  }
});

test("failed packaging preserves an existing valid target", async () => {
  const dist = fixture();
  writeFileSync(join(dist, "source.ts"), "source");
  const artifacts = mkdtempSync(join(tmpdir(), "pindou-artifacts-"));
  const target = join(artifacts, `pindouverse-chrome-${expectedVersion}.zip`);
  writeFileSync(target, "existing valid artifact");
  try {
    await assert.rejects(
      packageExtension({ brand: "chrome", distDir: dist, artifactsDir: artifacts, version: expectedVersion }),
      /source|forbidden/i,
    );
    assert.equal(readFileSync(target, "utf8"), "existing valid artifact");
  } finally {
    rmSync(dist, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  }
});

test("extension page does not preload chunks shared with the service worker", () => {
  execFileSync(process.execPath, [join(repoRoot, "scripts/build-extension.mjs"), "chrome"], { cwd: repoRoot, stdio: "pipe" });
  const html = readFileSync(join(repoRoot, "platforms/extension/dist/chrome/index.html"), "utf8");
  assert.doesNotMatch(html, /rel=["']modulepreload["']/i);
});

test("extension build includes shared editor layout utilities", () => {
  execFileSync(process.execPath, [join(repoRoot, "scripts/build-extension.mjs"), "chrome"], { cwd: repoRoot, stdio: "pipe" });
  const chromeDist = join(repoRoot, "platforms/extension/dist/chrome");
  const cssFiles = readdirSync(join(chromeDist, "assets")).filter((name) => name.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "expected a generated extension stylesheet");
  const css = cssFiles.map((name) => readFileSync(join(chromeDist, "assets", name), "utf8")).join("\n");
  for (const utility of [".flex", ".h-screen", ".min-h-0", ".overflow-hidden"]) {
    assert.match(css, new RegExp(`\\${utility.replaceAll("-", "\\-")}([,{])`), `missing shared layout utility ${utility}`);
  }
});

test("Chrome compatibility build removes stale legacy artifacts", () => {
  const legacy = join(repoRoot, "platforms/extension/dist");
  writeFileSync(join(legacy, "stale.js.map"), "source map");
  writeFileSync(join(legacy, "stale.ts"), "source");
  execFileSync(process.execPath, [join(repoRoot, "scripts/build-extension.mjs"), "chrome"], { cwd: repoRoot, stdio: "pipe" });
  assert.equal(existsSync(join(legacy, "stale.js.map")), false);
  assert.equal(existsSync(join(legacy, "stale.ts")), false);
});

test("extension TypeScript gate fails for a temporary production type error", () => {
  const fixturePath = join(repoRoot, "platforms/extension/type-error-fixture.ts");
  writeFileSync(fixturePath, "const task12TypeError: string = 42;\n");
  try {
    assert.throws(
      () => execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", "platforms/extension/tsconfig.json", "--noEmit"], { cwd: repoRoot, stdio: "pipe", shell: process.platform === "win32" }),
      /Command failed/,
    );
  } finally { rmSync(fixturePath, { force: true }); }
});

test("ZIP validation rejects dist wrappers and forbidden source artifacts", async () => {
  const dist = fixture();
  writeFileSync(join(dist, "source.ts"), "source");
  const artifacts = mkdtempSync(join(tmpdir(), "pindou-artifacts-"));
  try {
    await assert.rejects(
      packageExtension({ brand: "edge", distDir: dist, artifactsDir: artifacts, version: expectedVersion }),
      /source|forbidden/i,
    );
  } finally {
    rmSync(dist, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  }
});
