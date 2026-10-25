// Docs: docs/code/scripts/dev-data.md
// The development data folder (ENG-19): `pnpm seed` fills it and `pnpm dev` opens it. It is
// `dev-data/` in the repository unless a folder is given, and it is never the real user data
// folder (PLAT-04), however it is named.

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chooseDataFolder, DATA_FOLDER_VARIABLE } from "../packages/server/src/storage/index.ts";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `dev-data/` in the repository, ignored by git. */
export const DEFAULT_DEV_FOLDER = path.join(repository, "dev-data");

const inside = (folder: string, parent: string) => {
  const relative = path.relative(parent, folder);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * The development folder: `given`, or `dev-data/`. Throws a plain error if it is the real user
 * data folder, or inside it, or holds it: development never touches the person's own work.
 */
export function devFolder(given?: string): string {
  const folder = path.resolve(given ?? DEFAULT_DEV_FOLDER);
  // Where Tessera keeps a person's work when nothing chooses another folder.
  const real = chooseDataFolder(
    { ...process.env, [DATA_FOLDER_VARIABLE]: undefined },
    process.platform,
    os.homedir(),
  );
  if (inside(folder, real) || inside(real, folder)) {
    throw new Error(
      `${folder} is, or holds, the real Tessera data folder (${real}). Development uses its own folder; choose another.`,
    );
  }
  return folder;
}
