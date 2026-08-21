import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import yauzl from "yauzl";
import { readExtensionVersion } from "./extension-version.mjs";

const PERMISSIONS = ["storage", "contextMenus"];
const HOST_PERMISSIONS = [
  "https://github.com/login/*",
  "https://api.github.com/*",
  "https://gist.githubusercontent.com/*",
];
const OVERLAY_FIELDS = new Set(["description"]);
const MANIFEST_FIELDS = new Set([
  "manifest_version", "default_locale", "name", "short_name", "version", "description", "permissions",
  "host_permissions", "background", "action", "icons", "content_security_policy",
]);
const FORBIDDEN_ARCHIVE = /(^|\/)(src|tests?|e2e)(\/|$)|\.(?:map|ts|tsx)$|(?:\.spec|\.test)\.[^/]+$/i;

function exactArray(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label} must exactly equal ${JSON.stringify(expected)}`);
}

function validateRelativeFile(root, file, label, fileExists = (name) => existsSync(join(root, name))) {
  assert.equal(typeof file, "string", `${label} must be a file path`);
  assert.ok(!isAbsolute(file) && !normalize(file).startsWith(".."), `${label} must stay inside the extension`);
  assert.ok(fileExists(file), `${label} is missing: ${file}`);
}

export function validateOverlay(overlay) {
  assert.ok(overlay && typeof overlay === "object" && !Array.isArray(overlay), "store overlay must be an object");
  assert.deepEqual(new Set(Object.keys(overlay)), OVERLAY_FIELDS, "store overlay must contain exactly description");
  for (const key of OVERLAY_FIELDS) {
    assert.equal(typeof overlay[key], "string", `store overlay ${key} must be a string`);
    assert.ok(overlay[key].trim(), `store overlay ${key} must be non-empty`);
  }
}

export function validateChromeVersion(version) {
  assert.equal(typeof version, "string", "version must be a string");
  assert.match(version, /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/, "version must contain one to four Chrome-compatible integers without leading zeros");
  const components = version.split(".").map(Number);
  assert.ok(components.some((component) => component !== 0), "version cannot be all zero");
  assert.ok(components.every((component) => component <= 65535), "version components must be between 0 and 65535");
}

export function validateManifest(manifest, root, expectedVersion, fileExists) {
  assert.equal(manifest.manifest_version, 3, "manifest_version must be 3");
  assert.equal(manifest.default_locale, "en", "default_locale must be en");
  assert.equal(manifest.name, "__MSG_extensionName__", "manifest name must reference extensionName");
  assert.equal(manifest.short_name, "__MSG_extensionShortName__", "manifest short_name must reference extensionShortName");
  assert.equal(typeof manifest.description, "string", "manifest description must be a string");
  assert.ok(manifest.description.trim(), "manifest description must be non-empty");
  for (const field of Object.keys(manifest)) assert.ok(MANIFEST_FIELDS.has(field), `${field} is forbidden`);
  exactArray(manifest.permissions, PERMISSIONS, "permissions");
  exactArray(manifest.host_permissions, HOST_PERMISSIONS, "host_permissions");
  assert.deepEqual(manifest.background, { service_worker: "background.js", type: "module" }, "background must use background.js as a module service worker");
  assert.deepEqual(manifest.action, { default_title: "PindouVerse" }, "action must only declare the default title and cannot use a popup");
  assert.deepEqual(
    manifest.content_security_policy,
    { extension_pages: "script-src 'self'; object-src 'self'" },
    "content_security_policy must use the exact local-only CSP",
  );
  validateChromeVersion(manifest.version);
  assert.equal(manifest.version, expectedVersion, `manifest version must equal ${expectedVersion}`);
  validateRelativeFile(root, manifest.background.service_worker, "background service worker", fileExists);
  assert.ok(manifest.icons && Object.keys(manifest.icons).length > 0, "icons are required");
  for (const [size, file] of Object.entries(manifest.icons)) validateRelativeFile(root, file, `icon ${size}`, fileExists);
  validateRelativeFile(root, "index.html", "extension entry point", fileExists);
}

const EXPECTED_LOCALES = {
  en: { extensionName: "PindouVerse", extensionShortName: "PindouVerse", contextMenuConvertImage: "Convert with PindouVerse" },
  zh_CN: { extensionName: "PindouVerse - 拼豆宇宙", extensionShortName: "PindouVerse", contextMenuConvertImage: "在 PindouVerse 中转换" },
  zh_TW: { extensionName: "PindouVerse - 拼豆宇宙", extensionShortName: "PindouVerse", contextMenuConvertImage: "在 PindouVerse 中转换" },
};
const EXPECTED_LOCALE_NAMES = new Set(Object.keys(EXPECTED_LOCALES));
const EXPECTED_LOCALE_PATHS = new Set(Object.keys(EXPECTED_LOCALES).map((locale) => `_locales/${locale}/messages.json`));

function localeNamesFromPaths(paths) {
  const names = new Set();
  for (const path of paths) {
    if (!path.startsWith("_locales/")) continue;
    const locale = path.slice("_locales/".length).split("/", 1)[0];
    if (locale) names.add(locale);
  }
  return names;
}

function validateLocaleMessages(messages, locale) {
  assert.ok(messages && typeof messages === "object" && !Array.isArray(messages), `locale ${locale} messages must be an object`);
  assert.deepEqual(new Set(Object.keys(messages)), new Set(Object.keys(EXPECTED_LOCALES[locale])), `locale ${locale} messages must contain the exact message keys`);
  for (const [key, expected] of Object.entries(EXPECTED_LOCALES[locale])) {
    const value = messages[key];
    assert.ok(value && typeof value === "object" && !Array.isArray(value), `locale ${locale} ${key} must be an object`);
    assert.deepEqual(Object.keys(value), ["message"], `locale ${locale} ${key} must contain only message`);
    assert.equal(typeof value.message, "string", `locale ${locale} ${key} message must be a string`);
    assert.ok(value.message.trim(), `locale ${locale} ${key} message must be non-empty`);
    assert.equal(value.message, expected, `locale ${locale} ${key} message must equal ${expected}`);
  }
}

function openZip(file) {
  return new Promise((resolveZip, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => error ? reject(error) : resolveZip(zip));
  });
}

function readEntry(zip, entry) {
  return new Promise((resolveData, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolveData(Buffer.concat(chunks)));
    });
  });
}

function normalizeZipEntry(rawName) {
  assert.equal(typeof rawName, "string", "ZIP entry name must be a string");
  assert.ok(!rawName.includes("\\"), `unsafe ZIP entry uses backslashes: ${rawName}`);
  assert.ok(!rawName.startsWith("/") && !/^[A-Za-z]:/.test(rawName), `unsafe absolute ZIP entry: ${rawName}`);
  const parts = rawName.split("/");
  assert.ok(!parts.includes(".."), `unsafe traversal ZIP entry: ${rawName}`);
  return rawName;
}

export function validateZipEntries(rawNames) {
  const seen = new Set();
  for (const rawName of rawNames) {
    const name = normalizeZipEntry(rawName);
    assert.ok(!seen.has(name), `duplicate ZIP entry: ${name}`);
    seen.add(name);
    if (!name.endsWith("/")) assert.ok(!FORBIDDEN_ARCHIVE.test(name), `ZIP contains forbidden source or test artifact: ${name}`);
  }
  assert.ok(![...seen].some((name) => name.startsWith("dist/")), "ZIP cannot contain a dist wrapper");
  return seen;
}

export async function validateZip(zipPath, expectedVersion) {
  const zip = await openZip(zipPath);
  const entries = new Map();
  const rawNames = [];
  await new Promise((resolveEntries, reject) => {
    zip.on("error", reject);
    zip.on("entry", (entry) => {
      try {
        const name = normalizeZipEntry(entry.fileName);
        rawNames.push(name);
        if (!name.endsWith("/")) entries.set(name, entry);
        zip.readEntry();
      } catch (error) { reject(error); }
    });
    zip.on("end", resolveEntries);
    zip.readEntry();
  });
  try {
    validateZipEntries(rawNames);
    assert.deepEqual(localeNamesFromPaths(rawNames), EXPECTED_LOCALE_NAMES, "ZIP must contain exactly the expected locale directories");
    assert.ok(entries.has("manifest.json"), "ZIP root must contain manifest.json");
    assert.ok(entries.has("index.html"), "ZIP root must contain index.html");
    assert.ok(entries.has("background.js"), "ZIP root must contain background.js");
    const manifest = JSON.parse((await readEntry(zip, entries.get("manifest.json"))).toString("utf8"));
    validateManifest(manifest, "", expectedVersion, (file) => entries.has(file));
    const localePaths = new Set([...entries.keys()].filter((name) => name.startsWith("_locales/")));
    assert.deepEqual(localePaths, EXPECTED_LOCALE_PATHS, "ZIP must contain exactly the expected locale message files");
    for (const locale of Object.keys(EXPECTED_LOCALES)) {
      const localePath = `_locales/${locale}/messages.json`;
      assert.ok(entries.has(localePath), `ZIP locale messages are missing: ${localePath}`);
      validateLocaleMessages(JSON.parse((await readEntry(zip, entries.get(localePath))).toString("utf8")), locale);
    }
    return [...entries.keys()];
  } finally {
    zip.close();
  }
}

export function validateDirectory(root, expectedVersion) {
  const manifestPath = join(root, "manifest.json");
  assert.ok(existsSync(manifestPath), `manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateManifest(manifest, root, expectedVersion);
  const localesRoot = join(root, "_locales");
  assert.ok(existsSync(localesRoot), `locales directory is missing: ${localesRoot}`);
  const localeEntries = readdirSync(localesRoot, { withFileTypes: true });
  assert.deepEqual(new Set(localeEntries.map((entry) => entry.name)), EXPECTED_LOCALE_NAMES, "extension must contain exactly the expected locale directories");
  const localePaths = new Set(localeEntries.flatMap((localeEntry) => {
    assert.ok(localeEntry.isDirectory(), `locales directory may only contain locale directories: ${localeEntry.name}`);
    const localeDirectory = join(localesRoot, localeEntry.name);
    return readdirSync(localeDirectory, { withFileTypes: true }).map((fileEntry) => {
      assert.ok(fileEntry.isFile(), `locale directory may only contain messages.json: ${localeEntry.name}/${fileEntry.name}`);
      return `_locales/${localeEntry.name}/${fileEntry.name}`;
    });
  }));
  assert.deepEqual(localePaths, EXPECTED_LOCALE_PATHS, "extension must contain exactly the expected locale message files");
  for (const locale of Object.keys(EXPECTED_LOCALES)) {
    const localePath = join(root, "_locales", locale, "messages.json");
    assert.ok(existsSync(localePath), `locale messages are missing: ${localePath}`);
    validateLocaleMessages(JSON.parse(readFileSync(localePath, "utf8")), locale);
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, requestedVersion] = process.argv.slice(2);
  if (!root) throw new Error("Usage: validate-extension-manifest.mjs <dist-or-zip> [version]");
  const expectedVersion = requestedVersion ?? readExtensionVersion();
  if (root.toLowerCase().endsWith(".zip")) await validateZip(resolve(root), expectedVersion);
  else validateDirectory(resolve(root), expectedVersion);
  console.log(`Validated extension manifest: ${relative(process.cwd(), resolve(root))}`);
}
