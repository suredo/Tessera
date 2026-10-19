import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startLocalServer } from "../http/index.ts";
import { findExecutable, runProcess } from "../platform/index.ts";

// Starting Tessera (PLAT-02): one copy per data folder, on a free port, opened in the browser,
// and stopped cleanly. The copy that runs keeps a lock file in the data folder naming its address
// and a random instance ID, which its own API confirms.

const LOCK_FILE = "tessera.lock";
const INSTANCE_ROUTE = "/api/instance";
const ANSWER_TIMEOUT_MS = 2000;

export type LaunchOptions = {
  /** The data folder; tests and development pass their own (ENG-19). */
  dataDir: string;
  port?: number;
  webRoot?: string;
  /** Opens an address in the browser; openInBrowser unless a test passes its own. */
  openBrowser?: (url: string) => Promise<void>;
};

export type Launched = { url: string; browserOpened: boolean } & (
  { status: "started"; stop(): Promise<void> } | { status: "already-running" }
);

type Lock = { url: string; instanceId: string };

function readLock(text: string): Lock | undefined {
  try {
    const lock = JSON.parse(text) as Partial<Lock>;
    // Only an address on this computer: the launcher opens it in the browser.
    if (typeof lock.url !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(lock.url)) return;
    if (typeof lock.instanceId !== "string") return;
    return { url: lock.url, instanceId: lock.instanceId };
  } catch {
    return undefined;
  }
}

// Whether the server at the lock's address is the copy that wrote it.
function answers(lock: Lock): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `${lock.url}${INSTANCE_ROUTE}`,
      { headers: { origin: lock.url }, timeout: ANSWER_TIMEOUT_MS },
      (res) => {
        let body = "";
        res.setEncoding("utf8").on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve(readLock(body)?.instanceId === lock.instanceId));
      },
    );
    req.on("timeout", () => req.destroy()).on("error", () => resolve(false));
  });
}

// The address of the copy already running, or undefined. A lock no copy answers for is left by
// one that didn't stop cleanly; it's removed, unless another launcher has replaced it meanwhile.
async function runningCopy(lockPath: string): Promise<string | undefined> {
  let text: string;
  try {
    text = fs.readFileSync(lockPath, "utf8");
  } catch {
    return undefined;
  }
  const lock = readLock(text);
  if (lock !== undefined && (await answers(lock))) return lock.url;
  try {
    if (fs.readFileSync(lockPath, "utf8") === text) fs.rmSync(lockPath);
  } catch {
    // Already gone.
  }
  return undefined;
}

// Creates the lock with its whole content at once, or returns false if one exists: a hard link
// fails when the name is taken, so no other launcher ever reads a half-written lock.
function createLock(lockPath: string, content: string): boolean {
  const draft = `${lockPath}.${process.pid}.${randomUUID()}`;
  fs.writeFileSync(draft, content);
  try {
    fs.linkSync(draft, lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    fs.rmSync(draft, { force: true });
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
 * instead. The copy that starts writes its lock only once its server answers, and removes it on stop.
 */
export async function launch(options: LaunchOptions): Promise<Launched> {
  const open = options.openBrowser ?? openInBrowser;
  const opened = (url: string) =>
    open(url).then(
      () => true,
      () => false,
    );
  fs.mkdirSync(options.dataDir, { recursive: true });
  const lockPath = path.join(options.dataDir, LOCK_FILE);
  const existing = await runningCopy(lockPath);
  if (existing !== undefined) {
    return { status: "already-running", url: existing, browserOpened: await opened(existing) };
  }
  const instanceId = randomUUID();
  const server = await startLocalServer({
    port: options.port,
    webRoot: options.webRoot,
    routes: {
      [INSTANCE_ROUTE]: (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ url: server.url, instanceId }));
      },
    },
  });
  const content = JSON.stringify({ url: server.url, instanceId });
  // Another launcher can win the race between the check above and here; then its copy is used.
  for (let attempt = 1; !createLock(lockPath, content); attempt++) {
    const other = await runningCopy(lockPath);
    if (other !== undefined || attempt === 3) {
      await server.close();
      if (other === undefined)
        throw new Error(`Tessera couldn't replace its old lock: ${lockPath}`);
      return { status: "already-running", url: other, browserOpened: await opened(other) };
    }
  }
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      if (fs.existsSync(lockPath) && fs.readFileSync(lockPath, "utf8") === content) {
        fs.rmSync(lockPath);
      }
      await server.close();
    })());
  return { status: "started", url: server.url, browserOpened: await opened(server.url), stop };
}
