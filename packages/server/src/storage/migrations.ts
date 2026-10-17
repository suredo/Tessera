import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Database } from "./database.ts";

// Changes to Tessera's own SQLite schema are numbered migration files, applied in order, each in
// its own transaction (ENG-18). The database records which ones it has.

export type Migration = { version: number; name: string; sql: string };

const FILE_NAME = /^(\d{4})-[a-z0-9-]+\.sql$/;

/** The migration files in a folder, in order. Numbers start at 0001 and have no gaps. */
export function readMigrations(folder: string): Migration[] {
  const files = fs.readdirSync(folder).filter((file) => file.endsWith(".sql"));
  const migrations = files
    .map((file) => {
      const match = FILE_NAME.exec(file);
      if (!match) {
        throw new Error(`Name the migration "${file}" like 0001-what-it-does.sql.`);
      }
      return {
        version: Number(match[1]),
        name: file,
        sql: fs.readFileSync(path.join(folder, file), "utf8"),
      };
    })
    .sort((a, b) => a.version - b.version);
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Migration ${migration.name} should be number ${index + 1}.`);
    }
  });
  return migrations;
}

const versionRow = z.object({ version: z.number().nullable() });

/** Applies the migrations the database doesn't have yet, and returns their numbers. */
export function migrate(db: Database, migrations: readonly Migration[]): number[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const current =
    db.get(versionRow, "SELECT MAX(version) AS version FROM schema_migrations")?.version ?? 0;
  const latest = migrations.at(-1)?.version ?? 0;
  if (current > latest) {
    // An older Tessera must not write to data it doesn't understand (CON-04).
    throw new Error(
      `This data was written by a newer version of Tessera (schema ${current}; this version knows up to ${latest}).`,
    );
  }
  const pending = migrations.filter((migration) => migration.version > current);
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.run(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });
  }
  return pending.map((migration) => migration.version);
}
