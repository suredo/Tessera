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

// Each process test starts Node at least once, which can take seconds on a loaded machine. Every
// limit below leaves room for that and still fails when the behaviour breaks (ENG-20).
describe("processes (PLAT-01)", { timeout: 20_000 }, () => {
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

  it("ends a program that ignores the request to stop at the time limit", async () => {
    // Outside Windows a program can catch the request; Windows always ends it. Runs on both.
    const ignores = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
    // Stopped by about 2 s (the limit, then a second's grace); a program left running would only
    // end at the test's 20 s limit, so 8 s allows a slow start without missing that.
    const started = Date.now();
    const result = await runProcess(node, ["-e", ignores], { timeoutMs: 1000 });
    expect(Date.now() - started).toBeLessThan(8000);
    expect(result).toMatchObject({ exitCode: null, timedOut: true });
  });

  it("CLI-06: stops a program when cancelled, and never starts one cancelled before", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const running = runProcess(node, ["-e", "setTimeout(() => {}, 10000)"], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    const result = await running;
    // Stopped within seconds, not at the program's own 10 s.
    expect(Date.now() - started).toBeLessThan(8000);
    expect(result).toMatchObject({ cancelled: true, timedOut: false });
    const never = await runProcess(node, ["-e", "require('fs').writeFileSync('x','')"], {
      signal: AbortSignal.abort(),
    });
    expect(never).toEqual({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: true,
    });
  });

  it("gives a program no input, so one that reads until the end finishes", async () => {
    const readsAll = "process.stdin.resume(); process.stdin.on('end', () => console.log('done'));";
    // A program left waiting for input would reach the 8 s limit and report timedOut.
    const result = await runProcess(node, ["-e", readsAll], { timeoutMs: 8000 });
    expect(result).toMatchObject({ exitCode: 0, stdout: "done\n", timedOut: false });
  });

  it("returns when the program exits, even if a program it started still holds the output", async () => {
    // The parent exits at once; its child is detached and released but still holds the output for
    // 15 s. Returning within 8 s shows runProcess didn't wait for it, however slowly a loaded
    // machine starts Node (ENG-20).
    const leavesChild =
      'const c = require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { stdio: "inherit", detached: true }); c.unref(); console.log("parent done " + c.pid);';
    const started = Date.now();
    const result = await runProcess(node, ["-e", leavesChild]);
    const elapsed = Date.now() - started;
    const child = Number(/parent done (\d+)/.exec(result.stdout)?.[1]);
    try {
      process.kill(child);
    } catch {
      // Already gone.
    }
    expect(elapsed).toBeLessThan(8000);
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.stdout).toMatch(/^parent done \d+\n$/);
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

  // Permission to run exists only outside Windows, so this case runs on Linux CI.
  it.skipIf(process.platform === "win32")(
    "skips a file that isn't allowed to run, as a shell does",
    () => {
      const [first, second] = [folderWithSpaces(), folderWithSpaces()];
      fs.writeFileSync(path.join(first, "tool"), "#!/bin/sh\n", { mode: 0o644 });
      fs.writeFileSync(path.join(second, "tool"), "#!/bin/sh\n", { mode: 0o755 });
      const env = { PATH: `${first}:${second}` };
      expect(findExecutable("tool", env)).toBe(path.join(second, "tool"));
    },
  );

  // Making a link needs admin rights on Windows, so this case runs on Linux CI.
  it.skipIf(process.platform === "win32")(
    "returns a link as found, not the file it points to, as a shell does",
    () => {
      const dir = folderWithSpaces();
      fs.symlinkSync(node, path.join(dir, "shim"));
      expect(findExecutable("shim", { PATH: dir })).toBe(path.join(dir, "shim"));
    },
  );
});
