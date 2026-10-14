import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  findExecutable,
  isInsideFolder,
  normalizeNewlines,
  runProcess,
  toPosixPath,
} from "../src/platform/index.ts";

// Runs on Linux and on Windows in CI (PLAT-01), so each case is checked on both.
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const folderWithSpaces = () => {
  const dir = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "tessera-platform-")),
    "a folder with spaces",
  );
  fs.mkdirSync(dir);
  temps.push(path.dirname(dir));
  return dir;
};
const node = process.execPath;
const echoArgs =
  "process.stdout.write(JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd() }))";

describe("paths (PLAT-01)", () => {
  it("writes paths with forward slashes for logs and keys", () => {
    expect(toPosixPath(path.join("data", "tools", "notes.json"))).toBe("data/tools/notes.json");
  });

  it("normalizes Windows and old Mac line endings", () => {
    expect(normalizeNewlines("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });

  it("knows whether a path is inside a folder, ignoring case on Windows only", () => {
    expect(isInsideFolder("C:\\Data", "c:\\data\\Tools\\x.db", "win32")).toBe(true);
    expect(isInsideFolder("C:\\Data", "C:\\Database\\x.db", "win32")).toBe(false);
    expect(isInsideFolder("C:\\Data", "C:\\Data\\..\\Other", "win32")).toBe(false);
    expect(isInsideFolder("/data", "/Data/x.db", "linux")).toBe(false);
    expect(isInsideFolder("/data", "/data/a folder with spaces/x.db", "linux")).toBe(true);
    expect(isInsideFolder("/data", "/data", "linux")).toBe(true);
  });

  it("counts a name that starts with two dots as inside; only '..' itself goes up", () => {
    expect(isInsideFolder("C:\\data", "C:\\data\\..cache", "win32")).toBe(true);
    expect(isInsideFolder("C:\\data", "C:\\data\\..cache\\x.db", "win32")).toBe(true);
    expect(isInsideFolder("/data", "/data/..cache", "linux")).toBe(true);
    expect(isInsideFolder("/data", "/data/../other", "linux")).toBe(false);
    expect(isInsideFolder("/data", "/", "linux")).toBe(false);
  });
});

describe("processes (PLAT-01)", () => {
  it("starts a program by absolute path in a folder with spaces, passing arguments exactly", async () => {
    const cwd = folderWithSpaces();
    const args = ["two words", 'a "quoted" bit', "50%", "a&b|c", path.join(cwd, "file name.txt")];
    const result = await runProcess(node, ["-e", echoArgs, ...args], { cwd });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { args: string[]; cwd: string };
    expect(parsed.args).toEqual(args);
    expect(fs.realpathSync(parsed.cwd)).toBe(fs.realpathSync(cwd));
  });

  it("reports the exit code, the error output and a time limit", async () => {
    const failed = await runProcess(node, ["-e", "console.error('no'); process.exit(3)"]);
    expect(failed).toMatchObject({ exitCode: 3, stderr: "no\n", timedOut: false });
    const slow = await runProcess(node, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 200 });
    expect(slow.timedOut).toBe(true);
  });

  it("gives a program no input, so one that reads until the end finishes", async () => {
    const readsAll = "process.stdin.resume(); process.stdin.on('end', () => console.log('done'));";
    const result = await runProcess(node, ["-e", readsAll], { timeoutMs: 5000 });
    expect(result).toMatchObject({ exitCode: 0, stdout: "done\n", timedOut: false });
  });

  it("refuses a relative path and a Windows batch file, saying what to do (L-45)", async () => {
    await expect(runProcess("node", ["-v"])).rejects.toThrow(/full path/);
    const shim = path.join(folderWithSpaces(), "claude.cmd");
    fs.writeFileSync(shim, "@echo off\r\n");
    await expect(runProcess(shim, [])).rejects.toThrow(/batch file.*own \.exe/);
  });

  it("finds a program on the PATH and returns its absolute path", () => {
    const name = path.basename(node, path.extname(node));
    const env = { PATH: path.dirname(node), PATHEXT: ".COM;.EXE" };
    expect(findExecutable(name, env)).toBe(node);
    expect(findExecutable("no-such-program-here", env)).toBeNull();
  });
});
