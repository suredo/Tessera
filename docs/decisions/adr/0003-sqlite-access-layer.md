---
type: Decision
title: "ADR 0003. The SQLite access layer"
description: "Tessera reaches its SQLite database through Node's built-in node:sqlite, with plain SQL, rows checked by the zod contracts, and numbered migration files."
tags: [decisions, data, storage]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T06:32:39Z }
---
# ADR 0003. The SQLite access layer

Decided by the owner on 2026-10-17 ([issue 16](https://github.com/suredo/Tessera/issues/16)). It settles how `DATA-01`'s SQLite database is reached, before M1 builds the data model on it. Code: the [storage module](../../code/server/storage.md).

## Context

The local server keeps workspaces, versions, data, saved tools, the trash and the call ledger in one SQLite file in the data folder (`DATA-01`, A9, `PLAT-04`). Tessera is Windows-first (`PLAT-01`), and from M6 other people install it, so installing must not need build tools. Every stored shape is defined once in `@tessera/contracts` (`CON-01`), and schema changes are numbered migrations (`ENG-18`).

## Options

| | `node:sqlite` (built into Node) | `better-sqlite3` (npm package) | An ORM or query builder on top |
| --- | --- | --- | --- |
| Install on Windows | Nothing to install or build | Native: a prebuilt download, or a compile that needs Visual Studio build tools when no prebuilt matches the Node version; pnpm must also allow its install script | Adds to whichever driver |
| Node 22 | Works on the pinned 22.23.3 (SQLite 3.51.3) without a flag, but marked experimental: Node prints a warning, and the API may still change | Mature and widely used | |
| Transactions | `BEGIN`/`COMMIT`, wrapped in a small helper here | A built-in helper | Built in |
| Migrations | Numbered `.sql` files and a small runner (`ENG-18` asks for that anyway) | The same | Drizzle generates them from its own schema; Kysely has a runner |
| Typing with the contracts | Plain SQL; each row checked against its zod contract | The same | Drizzle's tables or Kysely's table types become a second definition of each shape, or the source of the contracts, the reverse of `CON-01` |
| Later installer (M6) | Nothing native to ship | A native file per platform | |

## Decision

1. **`node:sqlite`, Node's built-in module**, reached only through one storage module in `@tessera/server` (`openDatabase`). Nothing else imports the driver.
2. **Plain SQL, with every row checked against its zod contract** when it is read. No ORM and no query builder.
3. **Numbered migration files**, `0001-what-it-does.sql`, applied in order, each in its own transaction, and recorded in the database (`ENG-18`). A database written by a newer Tessera is refused (`CON-04`).
4. **Foreign keys on, write-ahead logging, and a 5 s busy timeout** for every connection.

Install risk decided it: a native module is the setup step most likely to fail on a person's Windows machine, and `node:sqlite` removes it. The experimental status is the price. It is contained: the module uses a handful of calls, all behind `openDatabase`, and the smoke test runs on Linux and Windows CI, so a Node change that breaks it fails a test, not someone's data.

## Consequences

- Node prints an experimental warning once when the server starts; it is expected until `node:sqlite` is stable.
- A transaction's work must be synchronous, and transactions don't nest. Async work would go on after an `await`, outside the transaction, so the type refuses it, an async function is refused before it runs, and a plain function that returns a promise anyway gets its transaction rolled back and its connection closed.
- **When to revisit:** if `node:sqlite` shows a bug or lacks something Tessera needs (backups, concurrent access), or the next Node LTS changes its API in a way that is costly to follow. Moving to `better-sqlite3` then changes only the storage module.
- M1 adds Tessera's real tables and migrations, the backup before migrating real data (`node:sqlite` has `backup()`), and tests on fixture databases from earlier versions (`ENG-18`).
