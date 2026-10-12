// Tests for the git hooks and the setup that turns them on (ENG-01, ENG-10, ENG-15, ENG-19).
// Each test works in a throwaway repository holding copies of the hooks. Fake secrets are put
// together at run time, so no text that looks like a secret is ever committed here.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOK_FILES = [
  "scripts/setup.mjs",
  "scripts/hooks/pre-commit.mjs",
  "scripts/hooks/pre-push.mjs",
  ".githooks/pre-commit",
  ".githooks/pre-push",
  ".secretlintrc.json",
];
const TIMEOUT = 60_000;
const temps = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-hooks-"));
  temps.push(dir);
  return dir;
};
const run = (cwd, cmd, ...args) => spawnSync(cmd, args, { cwd, encoding: "utf8" });
const git = (cwd, ...args) =>
  run(cwd, "git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args);
const fake = (length) =>
  Array.from({ length }, (_, i) => "AbCdEfGhJkMnPqRsTuVwXyZ23456789"[(i * 7 + 3) % 31]).join("");
const FAKE_ANTHROPIC_KEY = ["sk", "ant", "api03", fake(93) + "AA"].join("-");
const FAKE_GITHUB_TOKEN = ["gh", "p_", fake(36)].join("");

// A fresh checkout with the hooks copied in and the workspace's dependencies linked.
function makeRepo({ setup = true } = {}) {
  const dir = tempDir();
  for (const file of HOOK_FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
    if (file.startsWith(".githooks/")) fs.chmodSync(path.join(dir, file), 0o755);
  }
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "junction");
  git(dir, "init", "-q", "-b", "main");
  if (setup) expect(run(dir, process.execPath, "scripts/setup.mjs").status).toBe(0);
  return dir;
}
const commit = (dir, files) => {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  git(dir, "add", ...Object.keys(files));
  return git(dir, "commit", "-q", "-m", "test");
};

describe("setup", () => {
  it(
    "turns the hooks on, and running it twice changes nothing (ENG-01)",
    { timeout: TIMEOUT },
    () => {
      const dir = makeRepo();
      const again = run(dir, process.execPath, "scripts/setup.mjs");
      expect(again.status).toBe(0);
      expect(git(dir, "config", "core.hooksPath").stdout.trim()).toBe(".githooks");
    },
  );

  it("does nothing outside a git checkout", { timeout: TIMEOUT }, () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.copyFileSync(path.join(ROOT, "scripts/setup.mjs"), path.join(dir, "scripts/setup.mjs"));
    const result = run(dir, process.execPath, "scripts/setup.mjs");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/not a git checkout/);
  });
});

describe("pre-push", () => {
  it("refuses a push to main and allows other branches (ENG-15)", { timeout: TIMEOUT }, () => {
    const remote = tempDir();
    git(remote, "init", "-q", "--bare");
    const dir = makeRepo();
    expect(commit(dir, { "notes.txt": "first\n" }).status).toBe(0);
    git(dir, "remote", "add", "origin", remote);

    const toMain = git(dir, "push", "origin", "HEAD:main");
    expect(toMain.status).not.toBe(0);
    expect(toMain.stderr).toMatch(/Push refused: main changes only through pull requests/);
    expect(git(dir, "push", "origin", "HEAD:feature").status).toBe(0);
  });
});

describe("pre-commit", () => {
  it("refuses likely secrets and allows clean files (ENG-19)", { timeout: TIMEOUT }, () => {
    const dir = makeRepo();
    for (const secret of [FAKE_ANTHROPIC_KEY, FAKE_GITHUB_TOKEN]) {
      const refused = commit(dir, { "config.txt": `key: ${secret}\n` });
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toMatch(/likely secrets in the staged changes/);
      expect(refused.stderr).toMatch(/^config\.txt$/m);
      expect(refused.stderr).not.toMatch(/tessera-pre-commit-/);
    }
    expect(commit(dir, { "config.txt": "key: read it from the environment\n" }).status).toBe(0);
  });

  it("checks the staged content, not the working copy (ENG-19)", { timeout: TIMEOUT }, () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, "config.txt"), `key: ${FAKE_ANTHROPIC_KEY}\n`);
    git(dir, "add", "config.txt");
    fs.writeFileSync(path.join(dir, "config.txt"), "key: removed, but only in the working copy\n");
    expect(git(dir, "commit", "-q", "-m", "test").status).not.toBe(0);
  });

  it("refuses video files, whatever the common extension (ENG-10)", { timeout: TIMEOUT }, () => {
    const dir = makeRepo();
    for (const ext of ["mp4", "mpeg", "mov", "webm"]) {
      const refused = commit(dir, { [`demo/run.${ext}`]: Buffer.alloc(2048, 1) });
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toMatch(`demo/run.${ext}: videos never go in the repository`);
      git(dir, "reset", "-q");
    }
  });

  it(
    "handles large files: clean ones pass, a secret in one is refused (ENG-19)",
    { timeout: TIMEOUT },
    () => {
      const dir = makeRepo();
      const bigText = `${JSON.stringify({ rows: "x".repeat(2 * 1024 * 1024) })}\n`;
      const files = { "data.json": bigText, "fixture.bin": Buffer.alloc(2 * 1024 * 1024, 0) };
      expect(commit(dir, files).status).toBe(0);
      const refused = commit(dir, { "data.json": `${bigText}key: ${FAKE_GITHUB_TOKEN}\n` });
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toMatch(/likely secrets in the staged changes/);
    },
  );

  it("refuses images over 1 MB and allows smaller ones (ENG-10)", { timeout: TIMEOUT }, () => {
    const dir = makeRepo();
    const refused = commit(dir, { "big.png": Buffer.alloc(1024 * 1024 + 1, 1) });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/big\.png: a 1\.0 MB image; images over 1 MB stay out/);
    git(dir, "reset", "-q");
    expect(commit(dir, { "small.png": Buffer.alloc(10_000, 1) }).status).toBe(0);
  });
});
