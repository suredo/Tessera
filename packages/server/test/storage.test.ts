import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrate, openDatabase, readMigrations, tryLockFile } from "../src/storage/index.ts";

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

  it("enforces foreign keys, and refuses nested transactions", () => {
    const db = openDatabase(path.join(newFolder(), "tessera.db"));
    migrate(db, readMigrations(fixtures));
    expect(() => db.run("INSERT INTO note_tags (note_id, tag) VALUES (?, ?)", 99, "x")).toThrow(
      /FOREIGN KEY/,
    );
    expect(() => db.transaction(() => db.transaction(() => 1))).toThrow(/inside another/);
    // The refused transaction was rolled back, so a new one starts cleanly.
    expect(db.transaction(() => 2)).toBe(2);
    db.close();
  });

  // Codex's second review of #39: a failed COMMIT must roll back too, and free the connection.
  it("keeps nothing when the commit itself fails, as with a deferred foreign key", () => {
    const db = openDatabase(path.join(newFolder(), "tessera.db"));
    db.exec(
      "CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (pid INTEGER REFERENCES p (id) DEFERRABLE INITIALLY DEFERRED);",
    );
    expect(() => db.transaction(() => db.run("INSERT INTO c (pid) VALUES (?)", 99))).toThrow(
      /FOREIGN KEY/,
    );
    expect(db.get(count, "SELECT COUNT(*) AS n FROM c")).toEqual({ n: 0 });
    expect(db.transaction(() => db.run("INSERT INTO p (id) VALUES (?)", 1))).toBe(1);
    db.close();
  });

  // Codex's review of #39: async work that writes after an await must not land outside the
  // transaction it was refused from.
  it("refuses async work before it runs, so nothing it writes after an await is kept", async () => {
    const db = openDatabase(path.join(newFolder(), "tessera.db"));
    migrate(db, readMigrations(fixtures));
    let ran = false;
    const write = async () => {
      ran = true;
      await Promise.resolve();
      db.run("INSERT INTO notes (text, created_at) VALUES (?, ?)", "late", "2026-10-17T09:00:00Z");
    };
    // @ts-expect-error: the type refuses async work too.
    expect(() => db.transaction(write)).toThrow(/synchronous/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ran).toBe(false);
    expect(db.get(count, "SELECT COUNT(*) AS n FROM notes")).toEqual({ n: 0 });
    db.close();
  });

  it("closes the connection when plain work returns a promise, so its later writes fail", async () => {
    const file = path.join(newFolder(), "tessera.db");
    const db = openDatabase(file);
    migrate(db, readMigrations(fixtures));
    let lateWrite: unknown = null;
    const work = () =>
      Promise.resolve().then(() => {
        try {
          db.run("INSERT INTO notes (text, created_at) VALUES (?, ?)", "late", "2026-10-17T09:00Z");
        } catch (error) {
          lateWrite = error;
        }
      });
    // @ts-expect-error: the type refuses a returned promise.
    expect(() => db.transaction(work)).toThrow(/synchronous/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(String(lateWrite)).toMatch(/database was closed/);
    expect(() => db.get(count, "SELECT COUNT(*) AS n FROM notes")).toThrow(/database was closed/);
    db.close();

    const again = openDatabase(file);
    expect(again.get(count, "SELECT COUNT(*) AS n FROM notes")).toEqual({ n: 0 });
    again.close();
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

// A process that takes the lock, says so, and holds it until it is killed.
const fileLock = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "storage", "file-lock.ts"),
).href;
function holdInAnotherProcess(file: string) {
  const script = `import { tryLockFile } from ${JSON.stringify(fileLock)};
    console.log(tryLockFile(process.argv[1]) ? "held" : "busy"); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, file], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const said = new Promise<string>((resolve) =>
    child.stdout.setEncoding("utf8").once("data", (chunk: string) => resolve(chunk.trim())),
  );
  const exited = new Promise((resolve) => child.on("exit", resolve));
  return { child, said, exited };
}

describe("file locks (PLAT-02)", { timeout: 30_000 }, () => {
  it("lets one holder at a time take a lock, in this process or another", async () => {
    const file = path.join(newFolder(), "tessera.lock");
    const lock = tryLockFile(file);
    expect(lock).not.toBeNull();
    expect(tryLockFile(file)).toBeNull();
    const other = holdInAnotherProcess(file);
    expect(await other.said).toBe("busy");
    other.child.kill("SIGKILL");
    await other.exited;
    lock?.release();
    lock?.release();
    const again = tryLockFile(file);
    expect(again).not.toBeNull();
    again?.release();
  });

  it("is released by the system when its holder is killed", async () => {
    const file = path.join(newFolder(), "tessera.lock");
    const holder = holdInAnotherProcess(file);
    expect(await holder.said).toBe("held");
    expect(tryLockFile(file)).toBeNull();
    holder.child.kill("SIGKILL");
    await holder.exited;
    const lock = tryLockFile(file);
    expect(lock).not.toBeNull();
    lock?.release();
  });
});
