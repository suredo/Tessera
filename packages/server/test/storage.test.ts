import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrate, openDatabase, readMigrations } from "../src/storage/index.ts";

// Runs on Linux and on Windows in CI. Every database is in a new temporary folder, never in a
// real data folder (ENG-19).
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-storage-"));
  temps.push(dir);
  return dir;
};
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "migrations");
const note = z.object({ id: z.number(), text: z.string(), created_at: z.string() });
const count = z.object({ n: z.number() });

describe("storage (DATA-01, ENG-18)", () => {
  it("opens a database, migrates it, writes and reads in a transaction, and keeps it on reopen", () => {
    const file = path.join(newFolder(), "tessera.db");
    const db = openDatabase(file);
    expect(migrate(db, readMigrations(fixtures))).toEqual([1, 2]);
    db.transaction(() => {
      db.run("INSERT INTO notes (text, created_at) VALUES (?, ?)", "milk", "2026-10-17T09:00:00Z");
      db.run("INSERT INTO note_tags (note_id, tag) VALUES (?, ?)", 1, "shopping");
    });
    expect(db.all(note, "SELECT * FROM notes")).toEqual([
      { id: 1, text: "milk", created_at: "2026-10-17T09:00:00Z" },
    ]);
    db.close();

    const again = openDatabase(file);
    expect(migrate(again, readMigrations(fixtures))).toEqual([]);
    expect(again.get(count, "SELECT COUNT(*) AS n FROM note_tags")).toEqual({ n: 1 });
    again.close();
  });

  it("keeps nothing a failed transaction wrote", () => {
    const db = openDatabase(path.join(newFolder(), "tessera.db"));
    migrate(db, readMigrations(fixtures));
    expect(() =>
      db.transaction(() => {
        db.run(
          "INSERT INTO notes (text, created_at) VALUES (?, ?)",
          "eggs",
          "2026-10-17T09:00:00Z",
        );
        throw new Error("stop");
      }),
    ).toThrow("stop");
    expect(db.get(count, "SELECT COUNT(*) AS n FROM notes")).toEqual({ n: 0 });
    db.close();
  });

  it("enforces foreign keys, and refuses async or nested transactions", () => {
    const db = openDatabase(path.join(newFolder(), "tessera.db"));
    migrate(db, readMigrations(fixtures));
    expect(() => db.run("INSERT INTO note_tags (note_id, tag) VALUES (?, ?)", 99, "x")).toThrow(
      /FOREIGN KEY/,
    );
    expect(() => db.transaction(async () => {})).toThrow(/synchronous/);
    expect(() => db.transaction(() => db.transaction(() => 1))).toThrow(/inside another/);
    // Each refused transaction was rolled back, so a new one starts cleanly.
    expect(db.transaction(() => 2)).toBe(2);
    db.close();
  });

  it("checks every row against its contract (CON-01)", () => {
    const db = openDatabase(path.join(newFolder(), "tessera.db"));
    migrate(db, readMigrations(fixtures));
    db.run("INSERT INTO notes (text, created_at) VALUES (?, ?)", "bread", "2026-10-17T09:00:00Z");
    const wrong = z.object({ id: z.string() });
    expect(() => db.all(wrong, "SELECT id FROM notes")).toThrow();
    db.close();
  });

  it("refuses migration files out of order or badly named, and data from a newer version", () => {
    const gap = newFolder();
    fs.copyFileSync(path.join(fixtures, "0001-notes.sql"), path.join(gap, "0001-notes.sql"));
    fs.writeFileSync(path.join(gap, "0003-later.sql"), "SELECT 1;");
    expect(() => readMigrations(gap)).toThrow(/should be number 2/);

    const badName = newFolder();
    fs.writeFileSync(path.join(badName, "first.sql"), "SELECT 1;");
    expect(() => readMigrations(badName)).toThrow(/0001-what-it-does.sql/);

    const db = openDatabase(path.join(newFolder(), "tessera.db"));
    migrate(db, readMigrations(fixtures));
    expect(() => migrate(db, readMigrations(fixtures).slice(0, 1))).toThrow(/newer version/);
    db.close();
  });
});
