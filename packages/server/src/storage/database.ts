import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { z } from "zod";

// Tessera's own data lives in one SQLite file in the data folder (DATA-01, PLAT-04), reached
// through Node's built-in node:sqlite (ADR 0003). Only this module touches the driver, so a change
// of driver stays here.

export type SqlValue = SQLInputValue;

/** A transaction's work must be synchronous: an await would let its writes land after it ends. */
export type SyncResult<T> = T extends PromiseLike<unknown> ? never : T;

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
  transaction<T>(work: () => SyncResult<T>): T;
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

  // Set when the connection was closed to stop stray async work (see `transaction`).
  let closedBecause: string | null = null;
  const open = (): DatabaseSync => {
    if (closedBecause !== null) throw new Error(`The database was closed: ${closedBecause}`);
    return db;
  };

  const transaction = <T>(work: () => SyncResult<T>): T => {
    // An async function's work goes on after an await, outside the transaction: refuse it unrun.
    if (work.constructor.name === "AsyncFunction") {
      throw new Error("A transaction's work must be synchronous.");
    }
    if (open().isTransaction) {
      throw new Error(
        "A transaction can't start inside another one; do the work in the outer one.",
      );
    }
    db.exec("BEGIN IMMEDIATE");
    let result: unknown;
    try {
      result = work();
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    if (isThenable(result)) {
      // A plain function returned a promise: its work may still write once it resumes. Roll back,
      // then close this connection, so nothing it does later can land outside a transaction.
      db.exec("ROLLBACK");
      closedBecause = "a transaction's work returned a promise.";
      db.close();
      // Its outcome no longer matters; the refusal below is what the caller sees.
      result.then(undefined, () => {});
      throw new Error("A transaction's work must be synchronous.");
    }
    db.exec("COMMIT");
    return result as T;
  };

  return {
    exec: (sql) => open().exec(sql),
    run: (sql, ...params) =>
      Number(
        open()
          .prepare(sql)
          .run(...params).changes,
      ),
    all: (row, sql, ...params) =>
      open()
        .prepare(sql)
        .all(...params)
        .map((r) => row.parse(r)),
    get: (row, sql, ...params) => {
      const found = open()
        .prepare(sql)
        .get(...params);
      return found === undefined ? undefined : row.parse(found);
    },
    transaction,
    close: () => {
      if (closedBecause === null) db.close();
    },
  };
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { then?: unknown }).then === "function";
