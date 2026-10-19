import childProcess from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import workerThreads from "node:worker_threads";
import { isInsideFolder } from "../../src/platform/index.ts";

// Tripwires for the server-side boundary checks in the threat model (docs/spec/threat-model.md):
// while armed, opening a network connection, starting a process or worker, or touching a file
// outside the allowed folders is recorded and refused. It is a test aid that detects a breach in
// code that should never try; it is not an isolation mechanism (SEC-01).

export type TripKind = "network" | "process" | "worker" | "file";
export interface Trip {
  kind: TripKind;
  what: string;
}

/** Thrown by a tripped call, so code under test fails there instead of carrying on. */
export class TripwireError extends Error {
  readonly code = "ETRIPWIRE";
  constructor(trip: Trip) {
    super(`Tripwire: ${trip.kind} access refused (${trip.what})`);
  }
}

export interface Tripwires {
  /** Every refused attempt, in order. A negative test expects this to stay empty. */
  readonly trips: readonly Trip[];
  /** Puts every patched function back. Safe to call twice. */
  disarm(): void;
}

type AnyFn = (this: unknown, ...args: unknown[]) => unknown;
type Patchable = Record<string, unknown>;

// File functions whose first argument is a path, and those whose second is one too. Each is
// patched in its callback, Sync and promise forms where they exist.
const ONE_PATH = [
  "access",
  "appendFile",
  "chmod",
  "chown",
  "exists",
  "lchown",
  "lstat",
  "lutimes",
  "mkdir",
  "mkdtemp",
  "open",
  "opendir",
  "readdir",
  "readFile",
  "readlink",
  "realpath",
  "rm",
  "rmdir",
  "stat",
  "statfs",
  "truncate",
  "unlink",
  "utimes",
  "writeFile",
];
const TWO_PATHS = ["copyFile", "cp", "link", "rename", "symlink"];
const STREAMS_AND_WATCHERS = ["createReadStream", "createWriteStream", "watch", "watchFile"];
const PROCESS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];

let armed = false;

const pathOf = (value: unknown): string | null => {
  if (typeof value === "string") return value.startsWith("file:") ? fileURLToPath(value) : value;
  if (value instanceof URL) return fileURLToPath(value);
  if (Buffer.isBuffer(value)) return value.toString();
  return null; // A file descriptor: it was opened through a checked path.
};

/**
 * Arms the tripwires until `disarm`. Files are allowed only inside `allowFolders` (none by
 * default). Only one set can be armed at a time.
 */
export function armTripwires(options: { allowFolders?: readonly string[] } = {}): Tripwires {
  if (armed) throw new Error("Tripwires are already armed; disarm the first set.");
  armed = true;
  const allowFolders = options.allowFolders ?? [];
  const trips: Trip[] = [];
  const restore: (() => void)[] = [];

  const trip = (kind: TripKind, what: string): never => {
    const t = { kind, what };
    trips.push(t);
    throw new TripwireError(t);
  };
  // A promise API rejects instead of throwing, as the real call would fail.
  const patch = (
    target: Patchable,
    name: string,
    check: (args: unknown[]) => void,
    promises = false,
  ) => {
    const original = target[name];
    if (typeof original !== "function") return;
    const fn = original as AnyFn;
    const wrapper = function (this: unknown, ...args: unknown[]) {
      if (!promises) check(args);
      else {
        try {
          check(args);
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
      return fn.apply(this, args);
    };
    Object.assign(wrapper, fn); // Keeps properties such as realpathSync.native.
    target[name] = wrapper;
    restore.push(() => (target[name] = original));
  };
  const checkPaths = (count: number) => (args: unknown[]) => {
    for (const arg of args.slice(0, count)) {
      const p = pathOf(arg);
      if (p !== null && !allowFolders.some((folder) => isInsideFolder(folder, p))) trip("file", p);
    }
  };

  const fsModule = fs as unknown as Patchable;
  const fsPromises = fs.promises as unknown as Patchable;
  for (const [names, count] of [
    [ONE_PATH, 1],
    [TWO_PATHS, 2],
    [STREAMS_AND_WATCHERS, 1],
  ] as const) {
    for (const name of names) {
      patch(fsModule, name, checkPaths(count));
      patch(fsModule, `${name}Sync`, checkPaths(count));
      patch(fsPromises, name, checkPaths(count), true);
    }
  }

  // Sockets cover net, http, https, tls and fetch, which all connect through net.Socket.
  const where = (args: unknown[]) => JSON.stringify(args[0] ?? null) ?? "";
  patch(net.Socket.prototype as unknown as Patchable, "connect", (a) => trip("network", where(a)));
  patch(net.Server.prototype as unknown as Patchable, "listen", (a) => trip("network", where(a)));
  for (const name of ["bind", "connect", "send"])
    patch(dgram.Socket.prototype as unknown as Patchable, name, () => trip("network", "dgram"));
  for (const name of ["lookup", "resolve"]) {
    patch(dns, name, (a) => trip("network", `dns ${where(a)}`));
    patch(dns.promises, name, (a) => trip("network", `dns ${where(a)}`), true);
  }

  for (const name of PROCESS) patch(childProcess, name, (a) => trip("process", where(a)));
  patch(process as unknown as Patchable, "dlopen", (a) =>
    trip("process", `native addon ${where(a)}`),
  );
  patch(workerThreads, "Worker", (a) => trip("worker", where(a)));

  // ES module imports such as `import { readFileSync } from "node:fs"` see the patches only
  // after this call.
  syncBuiltinESMExports();

  return {
    trips,
    disarm() {
      if (restore.length === 0) return;
      for (const undo of restore.splice(0).reverse()) undo();
      syncBuiltinESMExports();
      armed = false;
    },
  };
}

export interface Canary {
  /** A folder outside the allowed ones, holding only the canary file. */
  folder: string;
  file: string;
  /** What changed: the canary's content or time, or files added beside it. Empty if nothing. */
  changes(): string[];
  remove(): void;
}

/** Makes a canary folder in the system's temporary folder. Check it after disarming. */
export function createCanary(): Canary {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-canary-"));
  const file = path.join(folder, "canary.txt");
  const content = "If this file changes, a boundary check failed.\n";
  fs.writeFileSync(file, content);
  const { mtimeMs } = fs.statSync(file);
  return {
    folder,
    file,
    changes() {
      const found: string[] = [];
      const others = fs.readdirSync(folder).filter((name) => name !== "canary.txt");
      if (others.length > 0) found.push(`files added beside the canary: ${others.join(", ")}`);
      if (!fs.existsSync(file)) return [...found, "the canary was removed"];
      if (fs.readFileSync(file, "utf8") !== content) found.push("the canary's content changed");
      if (fs.statSync(file).mtimeMs !== mtimeMs) found.push("the canary's time changed");
      return found;
    },
    remove: () => fs.rmSync(folder, { recursive: true, force: true }),
  };
}
