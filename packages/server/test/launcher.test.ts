import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { launch, type Launched } from "../src/launcher/index.ts";

// Runs on Linux and on Windows in CI. Every launch gets its own data folder under the system's
// temporary folder, never the real one (ENG-19), and a browser that only records what it opened.
const temps: string[] = [];
const running: Launched[] = [];
const children: ChildProcess[] = [];
afterAll(async () => {
  children.forEach((child) => child.kill());
  await Promise.all(running.flatMap((l) => (l.status === "started" ? [l.stop()] : [])));
  temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});
const dataFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-launcher-"));
  temps.push(dir);
  return dir;
};
const browser = () => {
  const opened: string[] = [];
  const openBrowser = (url: string) => {
    opened.push(url);
    return Promise.resolve();
  };
  return { opened, openBrowser };
};
const start = async (dataDir: string, openBrowser: (url: string) => Promise<void>) => {
  const launched = await launch({ dataDir, port: 0, openBrowser });
  running.push(launched);
  return launched;
};
const portFree = (url: string) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: Number(new URL(url).port) });
    socket.on("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(true));
  });
const lockOf = (dataDir: string) => path.join(dataDir, "tessera.lock");

describe("the launcher (PLAT-02)", () => {
  it("starts one copy, opens the browser at it, and stops cleanly", async () => {
    const dataDir = dataFolder();
    const { opened, openBrowser } = browser();
    const first = await start(dataDir, openBrowser);
    expect(first).toMatchObject({ status: "started", browserOpened: true });
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // A second launch opens the copy that runs instead of starting another.
    const second = await start(dataDir, openBrowser);
    expect(second).toMatchObject({ status: "already-running", url: first.url });
    expect(opened).toEqual([first.url, first.url]);
    if (first.status !== "started") throw new Error("not started");
    await first.stop();
    expect(fs.existsSync(lockOf(dataDir))).toBe(false);
    expect(await portFree(first.url)).toBe(true);
    expect((await start(dataDir, openBrowser)).status).toBe("started");
  });

  it("starts only one copy when two launches race", async () => {
    const dataDir = dataFolder();
    const { openBrowser } = browser();
    const both = await Promise.all([start(dataDir, openBrowser), start(dataDir, openBrowser)]);
    expect(both.map((l) => l.status).sort()).toEqual(["already-running", "started"]);
    expect(both[0].url).toBe(both[1].url);
  });

  it("replaces a lock no running copy answers for, and never opens an address outside this computer", async () => {
    const dataDir = dataFolder();
    const { opened, openBrowser } = browser();
    fs.writeFileSync(
      lockOf(dataDir),
      JSON.stringify({ url: "http://127.0.0.1:9", instanceId: "gone" }),
    );
    expect((await start(dataDir, openBrowser)).status).toBe("started");
    const other = dataFolder();
    fs.writeFileSync(
      lockOf(other),
      JSON.stringify({ url: "https://attacker.example", instanceId: "x" }),
    );
    expect((await start(other, openBrowser)).status).toBe("started");
    expect(opened.every((url) => url.startsWith("http://127.0.0.1:"))).toBe(true);
  });

  it("keeps running when the browser can't be opened, and says so", async () => {
    const launched = await start(dataFolder(), () => Promise.reject(new Error("no browser")));
    expect(launched).toMatchObject({ status: "started", browserOpened: false });
  });
});

// The entry point Tessera.cmd runs, as its own process.
const main = fileURLToPath(new URL("../src/launcher/main.ts", import.meta.url));
function runMain(dataDir: string) {
  const child = spawn(process.execPath, [main], {
    env: { ...process.env, TESSERA_DATA_DIR: dataDir, TESSERA_OPEN_BROWSER: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  const line = new Promise<string>((resolve, reject) => {
    child.stdout.on("data", () => output.includes("\n") && resolve(output.trim()));
    child.on("exit", (code) => reject(new Error(`main.ts exited (${code}): ${output}`)));
  });
  const exit = new Promise<number | null>((resolve) => child.on("exit", resolve));
  return { child, line, exit };
}

// Each case starts Node up to three times, which takes seconds on a busy Windows machine.
describe("the launcher's entry point (PLAT-02)", { timeout: 30_000 }, () => {
  it("runs one copy per data folder, and a copy that was killed doesn't block the next", async () => {
    const dataDir = dataFolder();
    const first = runMain(dataDir);
    const url = (await first.line).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    expect(url).toBeDefined();
    const second = runMain(dataDir);
    expect(await second.exit).toBe(0);
    expect(await second.line.catch((e: Error) => e.message)).toContain(`already running at ${url}`);
    // Killed outright, as Windows ends a process, so the lock stays behind.
    first.child.kill("SIGKILL");
    await first.exit;
    const third = runMain(dataDir);
    expect(await third.line).toContain("Tessera is running at");
    third.child.kill("SIGKILL");
    await third.exit;
  });

  it.skipIf(process.platform === "win32")(
    "stops cleanly on a stop signal, removing its lock",
    async () => {
      const dataDir = dataFolder();
      const run = runMain(dataDir);
      await run.line;
      run.child.kill("SIGTERM");
      expect(await run.exit).toBe(0);
      expect(fs.existsSync(lockOf(dataDir))).toBe(false);
    },
  );
});
