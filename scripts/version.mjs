import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultRepoRoot = resolve(import.meta.dirname, "..");

export function readBaseVersion({ repoRoot = defaultRepoRoot, readFile = (path) => readFileSync(path, "utf8") } = {}) {
  const value = readFile(join(repoRoot, "VERSION")).trim();
  assert.match(value, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/, "VERSION must contain MAJOR.MINOR");
  const [major, minor] = value.split(".").map(Number);
  return { major, minor };
}

export function computeVersion({
  repoRoot = defaultRepoRoot,
  readFile,
  execFile = (command, args) => execFileSync(command, args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
} = {}) {
  const { major, minor } = readBaseVersion({ repoRoot, readFile });
  const tag = `v${major}.${minor}.0`;
  let revision = "HEAD";
  try {
    execFile("git", ["rev-parse", tag]);
    revision = `${tag}..HEAD`;
  } catch { /* no release tag yet */ }
  const commits = Number.parseInt(execFile("git", ["rev-list", revision, "--count"]).trim(), 10);
  assert.ok(Number.isSafeInteger(commits) && commits >= 0, "git commit count must be a non-negative integer");
  return `${major}.${minor}.${commits}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] && process.argv[2] !== "--print") throw new Error("Usage: version.mjs [--print]");
  console.log(computeVersion());
}
