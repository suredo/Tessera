import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVATION_ROUTE, BRIDGE_ROUTE } from "@tessera/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";
import { launch, type Launched } from "../src/launcher/index.ts";
import { tryLockFile } from "../src/storage/index.ts";
import { post } from "./support/http.ts";

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
const start = async (
  dataDir: string,
  openBrowser: (url: string) => Promise<void>,
  waitMs?: number,
) => {
  const launched = await launch({ dataDir, port: 0, openBrowser, waitMs });
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
const addressOf = (dataDir: string) => path.join(dataDir, "tessera.address");
// What a copy that was killed leaves behind: its address, with nothing answering there.
const leaveStaleAddress = (dataDir: string, url = "http://127.0.0.1:9") =>
  fs.writeFileSync(addressOf(dataDir), JSON.stringify({ url, instanceId: "gone" }));
// Whether nobody holds the data folder's lock.
const lockFree = (dataDir: string) => {
  const lock = tryLockFile(lockOf(dataDir));
  lock?.release();
  return lock !== null;
};

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
    expect(lockFree(dataDir)).toBe(false);
    await first.stop();
    expect(fs.existsSync(addressOf(dataDir))).toBe(false);
    expect(lockFree(dataDir)).toBe(true);
    expect(await portFree(first.url)).toBe(true);
    expect((await start(dataDir, openBrowser)).status).toBe("started");
  });

  it("serves the bridge's and activation's routes (RUN-04, RUN-03)", async () => {
    const launched = await start(dataFolder(), browser().openBrowser);
    if (launched.status !== "started") throw new Error("not started");
    const port = Number(new URL(launched.url).port);
    // Each route answers a request it can't use with its own plain refusal, not "not found".
    expect(await post(port, BRIDGE_ROUTE, "{}")).toEqual({
      status: 400,
      body: "Send a workspace, a phase and the tool's call, as JSON.",
    });
    expect(await post(port, ACTIVATION_ROUTE, "{}")).toEqual({
      status: 400,
      body: "Send a workspace, a tool version and the data revision, as JSON.",
    });
    await launched.stop();
  });

  it("starts only one copy when two launches race", async () => {
    const dataDir = dataFolder();
    const { openBrowser } = browser();
    const both = await Promise.all([start(dataDir, openBrowser), start(dataDir, openBrowser)]);
    expect(both.map((l) => l.status).sort()).toEqual(["already-running", "started"]);
    expect(both[0].url).toBe(both[1].url);
  });

  it("never starts a second copy while another holds the lock, even with a stale address left behind", async () => {
    // The race Codex found in review: a launch recovering a stale address while another copy
    // has taken over. Here the test holds the lock, as a copy that is still starting does.
    const dataDir = dataFolder();
    const { opened, openBrowser } = browser();
    leaveStaleAddress(dataDir);
    const starting = tryLockFile(lockOf(dataDir));
    expect(starting).not.toBeNull();
    await expect(start(dataDir, openBrowser, 300)).rejects.toThrow(
      "Tessera is already starting in another window.",
    );
    expect(opened).toEqual([]);
    starting?.release();
    expect((await start(dataDir, openBrowser)).status).toBe("started");
  });

  it("starts exactly one copy when several launches recover a stale address at once", async () => {
    const dataDir = dataFolder();
    const { openBrowser } = browser();
    leaveStaleAddress(dataDir);
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => start(dataDir, openBrowser)));
    const started = all.filter((l) => l.status === "started");
    expect(started).toHaveLength(1);
    expect(all.every((l) => l.url === started[0]?.url)).toBe(true);
  });

  it("never opens an address outside this computer", async () => {
    const dataDir = dataFolder();
    const { opened, openBrowser } = browser();
    leaveStaleAddress(dataDir, "https://attacker.example");
    const starting = tryLockFile(lockOf(dataDir));
    await expect(start(dataDir, openBrowser, 300)).rejects.toThrow();
    starting?.release();
    expect(opened).toEqual([]);
  });

  it("leaves nothing running when it fails after starting its server", async () => {
    // Codex's review: publishing the address failed, and the server kept listening without the lock.
    const dataDir = dataFolder();
    const { opened, openBrowser } = browser();
    const port = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    const full = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    const write = vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw full;
    });
    try {
      await expect(launch({ dataDir, port, openBrowser })).rejects.toBe(full);
    } finally {
      write.mockRestore();
    }
    expect(await portFree(`http://127.0.0.1:${port}`)).toBe(true);
    expect(lockFree(dataDir)).toBe(true);
    expect(opened).toEqual([]);
    expect((await start(dataDir, openBrowser)).status).toBe("started");
  });

  it("keeps running when the browser can't be opened, and says so", async () => {
    const launched = await start(dataFolder(), () => Promise.reject(new Error("no browser")));
    expect(launched).toMatchObject({ status: "started", browserOpened: false });
  });
});

// The entry point Tessera.cmd runs, as its own process.
const main = fileURLToPath(new URL("../src/launcher/main.ts", import.meta.url));
function runMain(dataDir: string, nodeArgs: string[] = []) {
  const child = spawn(process.execPath, [...nodeArgs, main], {
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
  it("runs one copy per data folder, and a copy that was killed leaves nothing that blocks the next", async () => {
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
    // The system released its lock; of two launches at once, exactly one starts.
    const [third, fourth] = [runMain(dataDir), runMain(dataDir)];
    const lines = await Promise.all(
      [third, fourth].map((r) => r.line.catch((e: Error) => e.message)),
    );
    const started = lines.filter((l) => l.includes("Tessera is running at"));
    expect(started).toHaveLength(1);
    const url2 = started[0]?.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    expect(lines.filter((l) => l.includes(`already running at ${url2}`))).toHaveLength(1);
    third.child.kill("SIGKILL");
    fourth.child.kill("SIGKILL");
    await Promise.all([third.exit, fourth.exit]);
  });

  it("can stop cleanly by the time it says it's running", async () => {
    // CI caught a stop signal sent the moment the ready line appeared ending the process before
    // its handler existed. Loaded first, this module marks the line with how many SIGTERM
    // handlers there were when it was written, on every platform.
    const marker = `const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk, ...rest) => write(String(chunk).includes("Tessera is running")
        ? "[stop handlers: " + process.listenerCount("SIGTERM") + "] " + chunk : chunk, ...rest);`;
    const run = runMain(dataFolder(), [
      "--import",
      `data:text/javascript,${encodeURIComponent(marker)}`,
    ]);
    const handlers = Number((await run.line).match(/^\[stop handlers: (\d+)\]/)?.[1]);
    expect(handlers).toBeGreaterThan(0);
    run.child.kill("SIGKILL");
    await run.exit;
  });

  it.skipIf(process.platform === "win32")(
    "stops cleanly on a stop signal, removing its lock",
    async () => {
      const dataDir = dataFolder();
      const run = runMain(dataDir);
      await run.line;
      run.child.kill("SIGTERM");
      expect(await run.exit).toBe(0);
      expect(fs.existsSync(addressOf(dataDir))).toBe(false);
      expect(lockFree(dataDir)).toBe(true);
    },
  );
});
