import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { z } from "zod";

// Tessera's own data lives in one SQLite file in the data folder (DATA-01, PLAT-04), reached
// through Node's built-in node:sqlite (ADR 0003). Only this module touches the driver, so a change
// of driver stays here.

export type SqlValue = SQLInputValue;

export type Database = {
  /** Runs SQL with no parameters and no result, such as a migration. */
  exec(sql: string): void;
  /** Runs one statement and returns how many rows it changed. */
  run(sql: string, ...params: SqlValue[]): number;
  /** Every row of a query, each checked against its contract (CON-01). */
  all<T>(row: z.ZodType<T>, sql: string, ...params: SqlValue[]): T[];
  /** The first row of a query, checked against its contract, or undefined. */
  get<T>(row: z.ZodType<T>, sql: string, ...params: SqlValue[]): T | undefined;
  /** Runs `work` in one transaction: everything it wrote is kept, or nothing if it throws. */
  transaction<T>(work: () => T): T;
  close(): void;
};

/** How long a write waits for another connection's lock before it fails. */
const BUSY_TIMEOUT_MS = 5000;

/** Opens (or creates) the database file, with foreign keys enforced and write-ahead logging. */
export function openDatabase(file: string): Database {
  const db = new DatabaseSync(file, {
    enableForeignKeyConstraints: true,
    timeout: BUSY_TIMEOUT_MS,
  });
  // Write-ahead logging: a crash mid-write leaves the last committed state, and reads don't wait.
  db.exec("PRAGMA journal_mode = WAL");

  const transaction = <T>(work: () => T): T => {
    if (db.isTransaction) {
      throw new Error(
        "A transaction can't start inside another one; do the work in the outer one.",
      );
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      // An async function would commit before its work is done.
      if (result instanceof Promise) {
        throw new Error("A transaction's work must be synchronous.");
      }
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  return {
    exec: (sql) => db.exec(sql),
    run: (sql, ...params) => Number(db.prepare(sql).run(...params).changes),
    all: (row, sql, ...params) =>
      db
        .prepare(sql)
        .all(...params)
        .map((r) => row.parse(r)),
    get: (row, sql, ...params) => {
      const found = db.prepare(sql).get(...params);
      return found === undefined ? undefined : row.parse(found);
    },
    transaction,
    close: () => db.close(),
  };
}
