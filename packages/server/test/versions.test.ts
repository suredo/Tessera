import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Artifact } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrate, openDatabase, schemaMigrations } from "../src/storage/index.ts";
import { hashArtifact, loadVersion, saveVersion } from "../src/versions/index.ts";

// Every database is in a new temporary folder, never in a real data folder (ENG-19).
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newDatabase = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-versions-"));
  temps.push(dir);
  const db = openDatabase(path.join(dir, "tessera.db"));
  migrate(db, schemaMigrations());
  return db;
};
const count = z.object({ n: z.number() });

const artifact: Artifact = {
  contractVersion: 1,
  code: { html: "<ul></ul>", css: "", js: "" },
  data: { schemaVersion: 1, schema: { type: "object" }, defaults: { items: [] } },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
};

describe("tool versions (DATA-04, CON-04)", () => {
  it("stores a version under its hash and reads it back", () => {
    const db = newDatabase();
    const hash = saveVersion(db, artifact);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashArtifact(artifact));
    expect(loadVersion(db, hash)).toEqual({ kind: "ok", artifact, upgradedFromVersion: null });
    expect(loadVersion(db, "0".repeat(64))).toBeUndefined();
    db.close();
  });

  it("keeps one copy of the same content, and a new hash for any change", () => {
    const db = newDatabase();
    const first = saveVersion(db, artifact);
    // The same content with its keys in another order is the same version.
    const reordered = { ...artifact, ui: { mode: "standard", standardVersion: 1 } } as Artifact;
    expect(saveVersion(db, reordered)).toBe(first);
    const changed = saveVersion(db, { ...artifact, code: { ...artifact.code, css: "ul{}" } });
    expect(changed).not.toBe(first);
    expect(db.get(count, "SELECT COUNT(*) AS n FROM tool_versions")).toEqual({ n: 2 });
    db.close();
  });

  it("can't change a stored version in place", () => {
    const db = newDatabase();
    const hash = saveVersion(db, artifact);
    expect(() => db.run("UPDATE tool_versions SET body = '{}' WHERE hash = ?", hash)).toThrow(
      /immutable/,
    );
    expect(loadVersion(db, hash)).toMatchObject({ kind: "ok" });
    db.close();
  });

  it("never stores a version that doesn't fit the contract", () => {
    const db = newDatabase();
    const broken = {
      ...artifact,
      ui: { standardVersion: 1, mode: "legacy" },
    } as unknown as Artifact;
    expect(() => saveVersion(db, broken)).toThrow();
    expect(db.get(count, "SELECT COUNT(*) AS n FROM tool_versions")).toEqual({ n: 0 });
    db.close();
  });

  it("marks a version incompatible, never silently, when its stored body is wrong (CON-04)", () => {
    const db = newDatabase();
    const insert = (hash: string, version: number, body: string) =>
      db.run(
        "INSERT INTO tool_versions (hash, contract_version, body, created_at) VALUES (?, ?, ?, ?)",
        hash,
        version,
        body,
        "2026-10-18T00:00:00Z",
      );
    // A body that no longer matches its name.
    insert("a".repeat(64), 1, JSON.stringify(artifact));
    expect(loadVersion(db, "a".repeat(64))).toEqual({
      kind: "incompatible",
      reason: "It was changed after it was saved.",
    });
    // A body from a newer Tessera, correctly named.
    const newer = JSON.stringify({ ...artifact, contractVersion: 5 });
    const newerHash = createHash("sha256").update(newer).digest("hex");
    insert(newerHash, 5, newer);
    const reading = loadVersion(db, newerHash);
    expect(reading?.kind).toBe("incompatible");
    expect(reading?.kind === "incompatible" ? reading.reason : "").toMatch(
      /newer version of Tessera/,
    );
    db.close();
  });
});
