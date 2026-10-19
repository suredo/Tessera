import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInsideFolder } from "../platform/index.ts";
import { openDatabase, type Database } from "./database.ts";
import { migrate, schemaMigrations, schemaVersion, type Migration } from "./migrations.ts";

// The user data folder (PLAT-04): the database, assets, exports, logs and the backups made before
// migrating, all in one place that is easy to back up. Configuration chooses it, so development,
// tests and evaluations each use their own (ENG-19).

/** Chooses another data folder than the default; development and tests must set it (ENG-19). */
export const DATA_FOLDER_VARIABLE = "TESSERA_DATA_DIR";

/** What time it is; tests pass a clock they can move (DATA-09). */
export type Clock = () => Date;

export type DataFolderPaths = {
  root: string;
  database: string;
  /** Binary assets (DATA-11). */
  assets: string;
  /** Archives the person exported (DATA-05). */
  exports: string;
  logs: string;
  /** Copies of the database made before migrating it (ENG-18). */
  backups: string;
};

export const dataFolderPaths = (root: string): DataFolderPaths => ({
  root,
  database: path.join(root, "tessera.db"),
  assets: path.join(root, "assets"),
  exports: path.join(root, "exports"),
  logs: path.join(root, "logs"),
  backups: path.join(root, "backups"),
});

type Environment = Record<string, string | undefined>;

const pathsOf = (platform: NodeJS.Platform) => (platform === "win32" ? path.win32 : path.posix);

/**
 * The data folder: the one the variable names, or else a per-computer folder that cloud services
 * don't sync (L-02): %LOCALAPPDATA% on Windows, Application Support on macOS, XDG data elsewhere.
 */
export function chooseDataFolder(
  env: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const p = pathsOf(platform);
  const chosen = env[DATA_FOLDER_VARIABLE];
  if (chosen) return p.resolve(chosen);
  if (platform === "win32") {
    return p.join(env["LOCALAPPDATA"] ?? p.join(home, "AppData", "Local"), "Tessera");
  }
  if (platform === "darwin") return p.join(home, "Library", "Application Support", "Tessera");
  return p.join(env["XDG_DATA_HOME"] ?? p.join(home, ".local", "share"), "tessera");
}

/**
 * The cloud service that syncs `folder`, if it is inside a folder one is known to sync. Sync can
 * lock or replace the database mid-write (L-02).
 */
export function syncedFolderOf(
  folder: string,
  env: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string | undefined {
  const p = pathsOf(platform);
  const synced: [string, string | undefined][] = [
    ["OneDrive", env["OneDrive"]],
    ["OneDrive", env["OneDriveConsumer"]],
    ["OneDrive", env["OneDriveCommercial"]],
    ["Dropbox", p.join(home, "Dropbox")],
    ["Google Drive", p.join(home, "Google Drive")],
    ["iCloud Drive", p.join(home, "iCloudDrive")],
    ["iCloud Drive", p.join(home, "Library", "Mobile Documents")],
    // Where macOS keeps OneDrive, Dropbox and Google Drive today.
    ["a cloud service", p.join(home, "Library", "CloudStorage")],
  ];
  return synced.find(([, root]) => root && isInsideFolder(root, folder, platform))?.[0];
}

export type DataFolder = {
  paths: DataFolderPaths;
  db: Database;
  now: Clock;
  /** The migrations this start applied. */
  migrated: number[];
  /** The backup made before migrating, if this start migrated existing data. */
  backup: string | undefined;
  /** Call once Tessera has started: removes the backups earlier starts made (ENG-18). */
  started(): void;
  close(): void;
};

export type OpenOptions = {
  now?: Clock;
  /** Tessera's own schema unless a test passes fixture migrations. */
  migrations?: readonly Migration[];
};

const BACKUP_NAME = /^tessera-schema-\d+-[0-9TZ-]+\.db$/;

/**
 * Opens the data folder, creating what is missing, and brings the database to the current schema.
 * Before migrating existing data it backs the database up in the folder (ENG-18).
 */
export async function openDataFolder(root: string, options: OpenOptions = {}): Promise<DataFolder> {
  const now = options.now ?? (() => new Date());
  const migrations = options.migrations ?? schemaMigrations();
  const paths = dataFolderPaths(path.resolve(root));
  for (const folder of [paths.root, paths.assets, paths.exports, paths.logs, paths.backups]) {
    fs.mkdirSync(folder, { recursive: true });
  }
  const db = openDatabase(paths.database);
  try {
    const current = schemaVersion(db);
    const latest = migrations.at(-1)?.version ?? 0;
    let backup: string | undefined;
    if (current > 0 && current < latest) {
      const stamp = now().toISOString().replace(/[:.]/g, "-");
      backup = path.join(paths.backups, `tessera-schema-${current}-${stamp}.db`);
      await db.backup(backup);
    }
    const migrated = migrate(db, migrations);
    return {
      paths,
      db,
      now,
      migrated,
      backup,
      started: () => {
        for (const file of fs.readdirSync(paths.backups)) {
          const full = path.join(paths.backups, file);
          if (BACKUP_NAME.test(file) && full !== backup) fs.rmSync(full, { force: true });
        }
      },
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
