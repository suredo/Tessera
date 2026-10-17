// Docs: docs/code/server/storage.md
// Tessera's SQLite database: opening it, transactions, and numbered migrations (DATA-01, ENG-18).
export { openDatabase, type Database, type SqlValue } from "./database.ts";
export { migrate, readMigrations, type Migration } from "./migrations.ts";
