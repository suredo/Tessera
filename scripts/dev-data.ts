// Docs: docs/code/scripts/dev-data.md
// The development data folder (ENG-19): `pnpm seed` fills it and `pnpm dev` opens it. It is
// `dev-data/` in the repository unless a folder is given, and it is never the real user data
// folder (PLAT-04), however it is named or reached.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chooseDataFolder, DATA_FOLDER_VARIABLE } from "../packages/server/src/storage/index.ts";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `dev-data/` in the repository, ignored by git. */
export const DEFAULT_DEV_FOLDER = path.join(repository, "dev-data");

/** Where Tessera keeps a person's work when nothing chooses another folder. */
export const realDataFolder = (): string =>
  chooseDataFolder(
    { ...process.env, [DATA_FOLDER_VARIABLE]: undefined },
    process.platform,
    os.homedir(),
  );

/**
 * The folder as the file system reaches it: every junction and symbolic link on the way resolved.
 * A folder that doesn't exist yet is its deepest existing parent, resolved, with the rest after.
 */
function canonical(folder: string): string {
  const rest: string[] = [];
  let at = path.resolve(folder);
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(at), ...rest);
    } catch {
      const parent = path.dirname(at);
      if (parent === at) return path.join(at, ...rest);
      rest.unshift(path.basename(at));
      at = parent;
    }
  }
}

const inside = (folder: string, parent: string) => {
  const relative = path.relative(parent, folder);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * The development folder: `given`, or `dev-data/`. Throws a plain error if it is the real user
 * data folder, or inside it, or holds it, once links are followed: a junction or symbolic link
 * to the real folder is the real folder. Development never touches the person's own work.
 */
export function devFolder(given?: string, real: string = realDataFolder()): string {
  const folder = path.resolve(given ?? DEFAULT_DEV_FOLDER);
  const [reached, realReached] = [canonical(folder), canonical(real)];
  if (inside(reached, realReached) || inside(realReached, reached)) {
    throw new Error(
      `${folder} is, or holds, the real Tessera data folder (${real}). Development uses its own folder; choose another.`,
    );
  }
  return folder;
}
