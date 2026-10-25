import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { LOCK_FILE } from "../../packages/server/src/launcher/index.ts";
import { tryLockFile } from "../../packages/server/src/storage/index.ts";
import { devFolder } from "../dev-data.ts";

// The development data folder is never the real one (ENG-19, PLAT-04), however it is named or
// reached, and the seed refuses a folder that has work in it or a Tessera running on it. Every
// folder here, the "real" one included, is a new temporary one.

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function place() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-dev-data-"));
  temps.push(root);
  const real = path.join(root, "AppData", "Tessera");
  fs.mkdirSync(real, { recursive: true });
  return { root, real };
}
/** A junction on Windows, a symbolic link elsewhere: either way, another name for `target`. */
const link = (target: string, at: string) => fs.symlinkSync(target, at, "junction");

describe("ENG-19: the development folder is never the real data folder", () => {
  it("ENG-19: refuses the real folder, a folder inside it, and a folder that holds it", () => {
    const { root, real } = place();
    expect(() => devFolder(real, real)).toThrow(/is, or holds, the real Tessera data folder/);
    expect(() => devFolder(path.join(real, "dev"), real)).toThrow(/real Tessera data folder/);
    expect(() => devFolder(root, real)).toThrow(/real Tessera data folder/);
  });

  it("ENG-19: refuses the real folder reached through a junction or symbolic link", () => {
    const { root, real } = place();
    link(real, path.join(root, "dev-data"));
    expect(() => devFolder(path.join(root, "dev-data"), real)).toThrow(/real Tessera data folder/);
    // A folder that doesn't exist yet, inside the link, is still inside the real folder.
    expect(() => devFolder(path.join(root, "dev-data", "new"), real)).toThrow(/real/);
    // A link to a folder that holds the real one holds it too.
    link(path.join(root, "AppData"), path.join(root, "alias"));
    expect(() => devFolder(path.join(root, "alias"), real)).toThrow(/real/);
  });

  it("ENG-19: accepts a folder of its own, whether or not it exists yet", () => {
    const { root, real } = place();
    expect(devFolder(path.join(root, "dev"), real)).toBe(path.join(root, "dev"));
    fs.mkdirSync(path.join(root, "made"));
    expect(devFolder(path.join(root, "made"), real)).toBe(path.join(root, "made"));
  });
});

describe("ENG-19: pnpm seed", { timeout: 60_000 }, () => {
  const seed = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "seed.ts");
  /** Runs the seed command on `folder`; gives its exit code and what it said. */
  function run(folder: string) {
    try {
      const said = execFileSync(process.execPath, [seed, folder], {
        encoding: "utf8",
        stdio: "pipe",
      });
      return { code: 0, said };
    } catch (error) {
      const failed = error as { status: number; stderr: string };
      return { code: failed.status, said: failed.stderr };
    }
  }

  it("ENG-19: seeds an empty folder once, then refuses it while it has workspaces", () => {
    const folder = path.join(place().root, "dev");
    const first = run(folder);
    expect(first.code).toBe(0);
    expect(first.said).toContain("Seeded");
    const again = run(folder);
    expect(again.code).toBe(1);
    expect(again.said).toContain("already has workspaces");
  });

  it("ENG-19: refuses while Tessera runs on the folder, and opens nothing", () => {
    const folder = path.join(place().root, "dev");
    fs.mkdirSync(folder);
    const lock = tryLockFile(path.join(folder, LOCK_FILE))!;
    try {
      const refused = run(folder);
      expect(refused.code).toBe(1);
      expect(refused.said).toContain("Tessera is running on");
      // Tessera's database was never opened, so never made (only the lock's own journal is here).
      expect(fs.readdirSync(folder).filter((name) => name.startsWith("tessera.db"))).toEqual([]);
    } finally {
      lock.release();
    }
  });
});
