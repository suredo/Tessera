---
type: Code Module
title: "Storage"
description: "Tessera's SQLite database through Node's built-in node:sqlite: opening it, rows checked by their contracts, transactions, and numbered migrations."
resource: ../../../packages/server/src/storage/
implements: [DATA-01, ENG-18, CON-01, CON-04, PLAT-01]
tests: [../../../packages/server/test/storage.test.ts]
tags: [code, server, storage, data]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T02:55:21Z }
---

# Purpose

The one way the local server reads and writes its SQLite database (`DATA-01`), chosen in [ADR 0003](../../decisions/adr/0003-sqlite-access-layer.md): Node's built-in `node:sqlite`, plain SQL, rows checked against the zod contracts (`CON-01`), and numbered migration files (`ENG-18`). Tessera's own schema is the numbered migrations in `src/storage/schema/`; the first, `0001-tool-versions.sql`, holds [tool versions](versions.md). The rest of the data model comes with M1's data issues.

# Entry points

- `src/storage/database.ts`: `openDatabase` returns a `Database`: it runs SQL, returns rows each checked against a zod schema, runs a transaction and closes. `SqlValue` is what a parameter can be, and `SyncResult` keeps a transaction's work synchronous in the types.
- `src/storage/file-lock.ts`: `tryLockFile` takes an exclusive lock on a file without waiting, or returns null when someone else holds it; the `FileLock` it returns releases it. The [launcher](launcher.md) holds one for as long as Tessera runs (`PLAT-02`).
- `src/storage/migrations.ts`: `readMigrations` reads the numbered `.sql` files of a folder, and `migrate` applies the ones the database doesn't have yet; `schemaMigrations` reads Tessera's own, in `src/storage/schema/`.

# Invariants

- **Only this module touches the driver.** Nothing else imports `node:sqlite`, so a change of driver stays here (ADR 0003).
- **Rows are checked when read.** `all` and `get` take the row's zod schema and parse every row, so a query can't hand back a shape its contract doesn't allow.
- **A transaction is all or nothing.** `transaction` keeps everything its work wrote, or nothing if the work throws or the commit fails (as when a deferred foreign key is checked at commit); either way the connection is free for the next transaction. It rolls back only while SQLite still has the transaction open, so an error after which SQLite rolled back on its own isn't hidden by a second rollback. It starts with `BEGIN IMMEDIATE`, so two writers can't both start and then collide. It can't start inside another transaction.
- **A transaction's work is synchronous, or nothing it writes is kept.** Async work would go on after an `await`, outside the transaction. The type refuses work that returns a promise; an async function is refused before it runs; and if a plain function returns a promise anyway, the transaction rolls back and the connection is closed, so the work's later writes fail instead of landing outside it. Every later call on that connection says why it was closed.
- **Every connection** has foreign keys enforced, write-ahead logging (a crash keeps the last committed state) and a 5 s busy timeout.
- **A file lock is the operating system's**, taken through SQLite (`LockFileEx` on Windows, `fcntl` elsewhere) with an exclusive transaction that never ends. It excludes other connections in this process and in others, and the system releases it when its holder ends, even when killed.
- **Migrations are numbered from 0001 with no gaps**, named like `0001-what-it-does.sql`. Each is applied in its own transaction and recorded in `schema_migrations`; running `migrate` again applies nothing. A database whose schema is newer than the migrations this code knows is refused, so an older Tessera never writes to data it doesn't understand (`CON-04`).

# Depends on / used by

Depends on Node's `node:sqlite`, `fs`, `path` and zod. M1's data layer will use it for workspaces, versions, saved tools, the trash and the ledger.

# Pitfalls

- **Node 22 prints an experimental warning** when `node:sqlite` loads. It is expected (ADR 0003); don't silence warnings globally to hide it.
- **Write-ahead logging adds `-wal` and `-shm` files** beside the database while it is open. A backup must use SQLite's backup (`node:sqlite`'s `backup()`, M1), never a file copy of a database in use.
- **Do async work before the transaction, then write in one synchronous transaction.** Checking only the returned promise isn't enough: Codex's review found the first version rolled back and reported failure while the work, resumed after its `await`, still wrote a row.
- **Keep a reference to a `FileLock`** for as long as it must hold: the connection behind it closes, and the lock goes, when it's released or collected.
- **A closed connection stays closed.** After a transaction's work returned a promise, open a new connection; the misuse is a bug to fix, not a state to recover from.
- **Tests use their own temporary folder** (`ENG-19`). The real data folder (`PLAT-04`) arrives in M1.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `database.ts`: `SqlValue` (type), `SyncResult` (type), `Database` (type), `openDatabase`
- `file-lock.ts`: `FileLock` (type), `tryLockFile`
- `index.ts`: `openDatabase`, `Database` (type), `SqlValue` (type), `SyncResult` (type), `tryLockFile`, `FileLock` (type), `migrate`, `readMigrations`, `schemaMigrations`, `Migration` (type)
- `migrations.ts`: `Migration` (type), `schemaMigrations`, `readMigrations`, `migrate`
