// Docs: docs/code/server/storage.md
// The user data folder and Tessera's SQLite database in it: opening them, transactions, numbered
// migrations and the backup before migrating (DATA-01, PLAT-04, ENG-18).
export { openDatabase, type Database, type SqlValue, type SyncResult } from "./database.ts";
export {
  chooseDataFolder,
  DATA_FOLDER_VARIABLE,
  dataFolderPaths,
  openDataFolder,
  syncedFolderOf,
  type Clock,
  type DataFolder,
  type DataFolderPaths,
  type OpenOptions,
} from "./data-folder.ts";
export { tryLockFile, type FileLock } from "./file-lock.ts";
export {
  migrate,
  readMigrations,
  schemaMigrations,
  schemaVersion,
  type Migration,
} from "./migrations.ts";
