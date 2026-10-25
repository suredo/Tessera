import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { archiveRoutes } from "../archives/index.ts";
import { bridgeRoutes } from "../bridge/index.ts";
import { startLocalServer, type LocalServer } from "../http/index.ts";
import { findExecutable, runProcess } from "../platform/index.ts";
import { openDataFolder, tryLockFile, type Clock, type DataFolder } from "../storage/index.ts";
import { collectAssets, sweepAssets } from "../assets/index.ts";
import { hostRoutes, workspaceTools } from "../host/index.ts";
import { runtimeRoutes } from "../runtime/index.ts";
import { removeExpired } from "../trash/index.ts";
import { activationRoutes } from "../workspaces/index.ts";

// Starting Tessera (PLAT-02): one copy per data folder, on a free port, opened in the browser,
// and stopped cleanly. The copy that runs holds an exclusive lock on a file in the data folder for
// as long as it runs, opens the database there (PLAT-04), and writes its address and a random
// instance ID, which its own API confirms, beside it.

/** Held by the copy that runs; the system releases it if that copy is killed. */
const LOCK_FILE = "tessera.lock";
/** The running copy's address and instance ID; only the lock's holder writes it. */
const ADDRESS_FILE = "tessera.address";
const INSTANCE_ROUTE = "/api/instance";
const ANSWER_TIMEOUT_MS = 2000;
const POLL_MS = 100;
/** How often a running copy removes what has been in the trash for 30 days (DATA-09). */
const TRASH_SWEEP_MS = 60 * 60 * 1000;

export type LaunchOptions = {
  /** The data folder; tests and development pass their own (ENG-19). */
  dataDir: string;
  port?: number;
  webRoot?: string;
  /** Opens an address in the browser; openInBrowser unless a test passes its own. */
  openBrowser?: (url: string) => Promise<void>;
  /** How long to wait for a copy that holds the lock to answer; 10 seconds unless a test passes its own. */
  waitMs?: number;
  /** What time it is; tests pass a clock they can move (DATA-09). */
  now?: Clock;
};

export type Launched = { url: string; browserOpened: boolean } & (
  | { status: "started"; dataFolder: DataFolder; stop(): Promise<void> }
  | { status: "already-running" }
);

type Address = { url: string; instanceId: string };

function readAddress(text: string): Address | undefined {
  try {
    const address = JSON.parse(text) as Partial<Address>;
    // Only an address on this computer: the launcher opens it in the browser.
    if (typeof address.url !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(address.url)) return;
    if (typeof address.instanceId !== "string") return;
    return { url: address.url, instanceId: address.instanceId };
  } catch {
    return undefined;
  }
}

// Whether the server at the address is the copy that wrote it.
function answers(address: Address): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `${address.url}${INSTANCE_ROUTE}`,
      { headers: { origin: address.url }, timeout: ANSWER_TIMEOUT_MS },
      (res) => {
        let body = "";
        res.setEncoding("utf8").on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve(readAddress(body)?.instanceId === address.instanceId));
      },
    );
    req.on("timeout", () => req.destroy()).on("error", () => resolve(false));
  });
}

// The address of the copy that holds the lock, once it answers there, or undefined after waitMs.
// Until then the file may be missing, half written or left by a copy that was killed.
async function ownersAddress(file: string, waitMs: number): Promise<string | undefined> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    let address: Address | undefined;
    try {
      address = readAddress(fs.readFileSync(file, "utf8"));
    } catch {
      // Not written yet.
    }
    if (address !== undefined && (await answers(address))) return address.url;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** Opens an address in the default browser, without a shell. */
export async function openInBrowser(url: string): Promise<void> {
  const [program, args]: [string | null, string[]] =
    process.platform === "win32"
      ? [
          path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "rundll32.exe"),
          ["url.dll,FileProtocolHandler", url],
        ]
      : process.platform === "darwin"
        ? ["/usr/bin/open", [url]]
        : [findExecutable("xdg-open"), [url]];
  if (program === null) throw new Error("No program to open the browser was found.");
  const result = await runProcess(program, args, { timeoutMs: 10_000 });
  if (result.exitCode !== 0) throw new Error(`The browser didn't open: ${result.stderr.trim()}`);
}

/**
 * Starts Tessera, or, if a copy already runs on this data folder, opens that one in the browser
 * instead. Only the copy that holds the data folder's lock starts; it releases the lock on stop.
 */
export async function launch(options: LaunchOptions): Promise<Launched> {
  const open = options.openBrowser ?? openInBrowser;
  const opened = (url: string) =>
    open(url).then(
      () => true,
      () => false,
    );
  fs.mkdirSync(options.dataDir, { recursive: true });
  const addressPath = path.join(options.dataDir, ADDRESS_FILE);
  const lock = tryLockFile(path.join(options.dataDir, LOCK_FILE));
  if (lock === null) {
    const url = await ownersAddress(addressPath, options.waitMs ?? 10_000);
    if (url === undefined) {
      throw new Error(
        "Tessera is already starting in another window. If it doesn't open, close that window and try again.",
      );
    }
    return { status: "already-running", url, browserOpened: await opened(url) };
  }
  const instanceId = randomUUID();
  // What /api/instance answers: nothing until this copy has published its address.
  let published = "";
  let server: LocalServer | undefined;
  let dataFolder: DataFolder | undefined;
  try {
    // This copy holds the lock, so any address left in the folder is from one that was killed.
    fs.rmSync(addressPath, { force: true });
    // Only the lock's holder opens the database, so a second copy never migrates it.
    dataFolder = await openDataFolder(options.dataDir, { now: options.now });
    // What has been in the trash for 30 days goes at every start, and hourly while running; then
    // the assets nothing refers to any more go too (DATA-09, DATA-11). Before that, the files an
    // interrupted write left are swept (AST-06).
    removeExpired(dataFolder);
    await sweepAssets(dataFolder);
    await collectAssets(dataFolder);
    server = await startLocalServer({
      port: options.port,
      webRoot: options.webRoot,
      routes: {
        ...bridgeRoutes(dataFolder),
        ...activationRoutes(dataFolder),
        ...hostRoutes(dataFolder),
        ...archiveRoutes(dataFolder),
        ...runtimeRoutes(workspaceTools(dataFolder)),
        [INSTANCE_ROUTE]: (_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(published);
        },
      },
    });
    published = JSON.stringify({ url: server.url, instanceId });
    fs.writeFileSync(addressPath, published);
    // A successful start: backups made before earlier migrations are no longer needed (ENG-18).
    dataFolder.started();
  } catch (error) {
    // A copy that fails to start leaves nothing running: its server closes before the lock goes,
    // so the next launch never takes the lock while this one still listens.
    await server?.close().catch(() => {});
    dataFolder?.close();
    lock.release();
    throw error;
  }
  const running = server;
  const folder = dataFolder;
  const sweep = setInterval(() => {
    try {
      removeExpired(folder);
      // Its database work is done before it first waits, so stopping can't close the database
      // under it; only removing files goes on after.
      collectAssets(folder).catch(() => {});
    } catch {
      // Such as a busy database: the next sweep, or the next start, tries again.
    }
  }, TRASH_SWEEP_MS).unref();
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      clearInterval(sweep);
      fs.rmSync(addressPath, { force: true });
      await running.close();
      folder.close();
      lock.release();
    })());
  return {
    status: "started",
    url: running.url,
    browserOpened: await opened(running.url),
    dataFolder: folder,
    stop,
  };
}
