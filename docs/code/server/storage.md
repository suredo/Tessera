---
type: Code Module
title: "Storage"
description: "The user data folder and Tessera's SQLite database in it, through Node's built-in node:sqlite: rows checked by their contracts, transactions, numbered migrations and the backup before migrating."
resource: ../../../packages/server/src/storage/
implements: [DATA-01, PLAT-04, ENG-18, ENG-19, CON-01, CON-04, PLAT-01]
tests: [../../../packages/server/test/storage.test.ts, ../../../packages/server/test/data-folder.test.ts]
tags: [code, server, storage, data]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-24T00:03:35Z }
---

# Purpose

The one way the local server reads and writes its SQLite database (`DATA-01`), chosen in [ADR 0003](../../decisions/adr/0003-sqlite-access-layer.md): Node's built-in `node:sqlite`, plain SQL, rows checked against the zod contracts (`CON-01`), and numbered migration files (`ENG-18`). The database lives in the user data folder with assets, exports, logs and the backups made before migrating (`PLAT-04`). Tessera's own schema is the numbered migrations in `src/storage/schema/`: `0001-tool-versions.sql` holds [tool versions](versions.md), `0002-workspaces.sql` holds [workspaces and saved tools](workspaces.md), `0003-trash.sql` marks what is in the [trash](trash.md), and `0004-record-revisions.sql` keeps each record's revision count with a [workspace's](workspaces.md) data. The rest of the data model comes with M1's data issues.

# Entry points

- `src/storage/data-folder.ts`: `chooseDataFolder` picks the data folder, `syncedFolderOf` names the cloud service that syncs a folder, if any, and `dataFolderPaths` lays out what is in it. `openDataFolder` opens it: it creates what is missing, backs the database up if it must migrate existing data, migrates it, and returns a `DataFolder` with the database, the clock (`Clock`), and a call the [launcher](launcher.md) makes once Tessera has started, which removes older backups.
- `src/storage/database.ts`: `openDatabase` returns a `Database`: it runs SQL, returns rows each checked against a zod schema, runs a transaction, backs itself up to a file and closes. `SqlValue` is what a parameter can be, and `SyncResult` keeps a transaction's work synchronous in the types.
- `src/storage/file-lock.ts`: `tryLockFile` takes an exclusive lock on a file without waiting, or returns null when someone else holds it; the `FileLock` it returns releases it. The [launcher](launcher.md) holds one for as long as Tessera runs (`PLAT-02`).
- `src/storage/migrations.ts`: `readMigrations` reads the numbered `.sql` files of a folder, and `migrate` applies the ones the database doesn't have yet; `schemaMigrations` reads Tessera's own, in `src/storage/schema/`; `schemaVersion` is the last migration a database has.

# Invariants

- **One data folder holds everything** (`PLAT-04`): `tessera.db`, `assets/`, `exports/` (where [archives](archives.md) are saved), `logs/` and `backups/`, with the launcher's `tessera.lock` and `tessera.address`. `TESSERA_DATA_DIR` chooses it; otherwise it is `%LOCALAPPDATA%\Tessera` on Windows, `~/Library/Application Support/Tessera` on macOS and `$XDG_DATA_HOME/tessera` (or `~/.local/share/tessera`) elsewhere: per-computer folders that cloud services don't sync (L-02). A folder inside OneDrive, Dropbox, Google Drive or iCloud Drive is named, so the launcher can warn.
- **Existing data is backed up before it is migrated** (`ENG-18`). When the database has data from an earlier schema, `openDataFolder` first copies it with SQLite's online backup to `backups/tessera-schema-<from>-<time>.db`. A backup stays until the next successful start, when `started` removes the ones earlier starts made; a start whose migration fails leaves its backup. Files in `backups/` with other names are left alone. A new, empty database has nothing to back up.
- **Migrations are tested on fixture databases from earlier versions** (`ENG-18`): each file in `test/fixtures/databases/` is a database as one schema left it (`schema-1.sql` with a tool version, `schema-2.sql` with a workspace, its data and a saved tool), and is never edited to match a newer schema. A migration that changes existing tables adds the fixture for the schema before it.
- **Only this module touches the driver.** Nothing else imports `node:sqlite`, so a change of driver stays here (ADR 0003).
- **Rows are checked when read.** `all` and `get` take the row's zod schema and parse every row, so a query can't hand back a shape its contract doesn't allow.
- **A transaction is all or nothing.** `transaction` keeps everything its work wrote, or nothing if the work throws or the commit fails (as when a deferred foreign key is checked at commit); either way the connection is free for the next transaction. It rolls back only while SQLite still has the transaction open, so an error after which SQLite rolled back on its own isn't hidden by a second rollback. It starts with `BEGIN IMMEDIATE`, so two writers can't both start and then collide. It can't start inside another transaction.
- **A transaction's work is synchronous, or nothing it writes is kept.** Async work would go on after an `await`, outside the transaction. The type refuses work that returns a promise; an async function is refused before it runs; and if a plain function returns a promise anyway, the transaction rolls back and the connection is closed, so the work's later writes fail instead of landing outside it. Every later call on that connection says why it was closed.
- **Every connection** has foreign keys enforced, write-ahead logging (a crash keeps the last committed state) and a 5 s busy timeout.
- **A file lock is the operating system's**, taken through SQLite (`LockFileEx` on Windows, `fcntl` elsewhere) with an exclusive transaction that never ends. It excludes other connections in this process and in others, and the system releases it when its holder ends, even when killed.
- **Migrations are numbered from 0001 with no gaps**, named like `0001-what-it-does.sql`. Each is applied in its own transaction and recorded in `schema_migrations`; running `migrate` again applies nothing. A database whose schema is newer than the migrations this code knows is refused, so an older Tessera never writes to data it doesn't understand (`CON-04`).

# Depends on / used by

Depends on Node's `node:sqlite`, `fs`, `path` and zod. [Tool versions](versions.md), [workspaces and saved tools](workspaces.md) and the [trash](trash.md) use it; the ledger and the rest of M1's data layer will.

# Pitfalls

- **Node 22 prints an experimental warning** when `node:sqlite` loads. It is expected (ADR 0003); don't silence warnings globally to hide it.
- **Write-ahead logging adds `-wal` and `-shm` files** beside the database while it is open. A backup must use SQLite's backup (`Database.backup`, through `node:sqlite`'s `backup()`), never a file copy of a database in use.
- **Do async work before the transaction, then write in one synchronous transaction.** Checking only the returned promise isn't enough: Codex's review found the first version rolled back and reported failure while the work, resumed after its `await`, still wrote a row.
- **Keep a reference to a `FileLock`** for as long as it must hold: the connection behind it closes, and the lock goes, when it's released or collected.
- **A closed connection stays closed.** After a transaction's work returned a promise, open a new connection; the misuse is a bug to fix, not a state to recover from.
- **Tests use their own temporary folder** (`ENG-19`), passed to `openDataFolder` or `launch`; no test calls `chooseDataFolder` without its own environment.
- **Only the launcher's lock holder opens the data folder,** so two copies never migrate one database at once. Open it any other way only in tests.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `data-folder.ts`: `DATA_FOLDER_VARIABLE`, `Clock` (type), `DataFolderPaths` (type), `dataFolderPaths`, `chooseDataFolder`, `syncedFolderOf`, `DataFolder` (type), `OpenOptions` (type), `openDataFolder`
- `database.ts`: `SqlValue` (type), `SyncResult` (type), `Database` (type), `openDatabase`
- `file-lock.ts`: `FileLock` (type), `tryLockFile`
- `index.ts`: `openDatabase`, `Database` (type), `SqlValue` (type), `SyncResult` (type), `chooseDataFolder`, `DATA_FOLDER_VARIABLE`, `dataFolderPaths`, `openDataFolder`, `syncedFolderOf`, `Clock` (type), `DataFolder` (type), `DataFolderPaths` (type), `OpenOptions` (type), `tryLockFile`, `FileLock` (type), `migrate`, `readMigrations`, `schemaMigrations`, `schemaVersion`, `Migration` (type)
- `migrations.ts`: `Migration` (type), `schemaMigrations`, `readMigrations`, `schemaVersion`, `migrate`
