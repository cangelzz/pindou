import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateStoreScreenshots } from "./store-screenshots.mjs";

export function publishStoreScreenshots(source, target, hooks = {}) {
  validateStoreScreenshots(source);
  const rename = hooks.rename ?? renameSync;
  const remove = hooks.remove ?? ((path) => rmSync(path, { recursive: true, force: true }));
  const copy = hooks.copy ?? ((from, to) => cpSync(from, to, { recursive: true }));
  const suffix = randomUUID();
  const staging = join(dirname(target), `.store-assets-new-${suffix}`);
  const backup = join(dirname(target), `.store-assets-backup-${suffix}`);
  let backedUp = false;
  try {
    copy(source, staging);
    validateStoreScreenshots(staging);
    if (existsSync(target)) { rename(target, backup); backedUp = true; }
    rename(staging, target);
    if (backedUp) remove(backup);
  } catch (error) {
    remove(staging);
    if (backedUp && !existsSync(target) && existsSync(backup)) rename(backup, target);
    throw error;
  }
}
