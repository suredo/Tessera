---
type: Code Module
title: "Storage"
description: "Tessera's SQLite database through Node's built-in node:sqlite: opening it, rows checked by their contracts, transactions, and numbered migrations."
resource: ../../../packages/server/src/storage/
implements: [DATA-01, ENG-18, CON-01, CON-04, PLAT-01]
tests: [../../../packages/server/test/storage.test.ts]
tags: [code, server, storage, data]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T06:21:53Z }
---

# Purpose

The one way the local server reads and writes its SQLite database (`DATA-01`), chosen in [ADR 0003](../../decisions/adr/0003-sqlite-access-layer.md): Node's built-in `node:sqlite`, plain SQL, rows checked against the zod contracts (`CON-01`), and numbered migration files (`ENG-18`). So far it has no tables of its own: Tessera's data model and its migrations come in M1.

# Entry points

- `src/storage/database.ts`: `openDatabase` returns a `Database`: it runs SQL, returns rows each checked against a zod schema, runs a transaction and closes. `SqlValue` is what a parameter can be.
- `src/storage/migrations.ts`: `readMigrations` reads the numbered `.sql` files of a folder, and `migrate` applies the ones the database doesn't have yet.

# Invariants

- **Only this module touches the driver.** Nothing else imports `node:sqlite`, so a change of driver stays here (ADR 0003).
- **Rows are checked when read.** `all` and `get` take the row's zod schema and parse every row, so a query can't hand back a shape its contract doesn't allow.
- **A transaction is all or nothing.** `transaction` keeps everything its work wrote, or nothing if the work throws. It starts with `BEGIN IMMEDIATE`, so two writers can't both start and then collide. Its work must be synchronous, and it can't start inside another transaction: the helper refuses both, and rolls back.
- **Every connection** has foreign keys enforced, write-ahead logging (a crash keeps the last committed state) and a 5 s busy timeout.
- **Migrations are numbered from 0001 with no gaps**, named like `0001-what-it-does.sql`. Each is applied in its own transaction and recorded in `schema_migrations`; running `migrate` again applies nothing. A database whose schema is newer than the migrations this code knows is refused, so an older Tessera never writes to data it doesn't understand (`CON-04`).

# Depends on / used by

Depends on Node's `node:sqlite`, `fs`, `path` and zod. M1's data layer will use it for workspaces, versions, saved tools, the trash and the ledger.

# Pitfalls

- **Node 22 prints an experimental warning** when `node:sqlite` loads. It is expected (ADR 0003); don't silence warnings globally to hide it.
- **Write-ahead logging adds `-wal` and `-shm` files** beside the database while it is open. A backup must use SQLite's backup (`node:sqlite`'s `backup()`, M1), never a file copy of a database in use.
- **An async step in a transaction would commit early,** which is why `transaction` refuses a function that returns a promise. Do the async work first, then write in one synchronous transaction.
- **Tests use their own temporary folder** (`ENG-19`). The real data folder (`PLAT-04`) arrives in M1.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `database.ts`: `SqlValue` (type), `Database` (type), `openDatabase`
- `index.ts`: `openDatabase`, `Database` (type), `SqlValue` (type), `migrate`, `readMigrations`, `Migration` (type)
- `migrations.ts`: `Migration` (type), `readMigrations`, `migrate`
