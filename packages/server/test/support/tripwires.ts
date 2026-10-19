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
// while armed, opening a network connection, sending on one opened before, starting a process or
// worker, or touching a file outside the allowed folders is recorded and refused. It is a test aid
// that detects a breach in code that should never try; it is not an isolation mechanism (SEC-01).

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

// How each path argument of a file function is checked, by position. "follow" checks where the
// path really leads, through links and junctions, as the call itself would; "link" checks the
// link itself, for calls that act on it without following it; "target" is a new link's target,
// read from the link's folder. Each function is patched in its callback, Sync and promise forms.
type PathRule = "follow" | "link" | "target";
const FILE_FUNCTIONS: Record<string, readonly PathRule[]> = {
  access: ["follow"],
  appendFile: ["follow"],
  chmod: ["follow"],
  chown: ["follow"],
  copyFile: ["follow", "follow"],
  cp: ["follow", "follow"],
  createReadStream: ["follow"],
  createWriteStream: ["follow"],
  exists: ["follow"],
  lchown: ["link"],
  link: ["follow", "link"],
  lstat: ["link"],
  lutimes: ["link"],
  mkdir: ["follow"],
  mkdtemp: ["follow"],
  open: ["follow"],
  opendir: ["follow"],
  readdir: ["follow"],
  readFile: ["follow"],
  readlink: ["link"],
  realpath: ["follow"],
  rename: ["link", "link"],
  rm: ["link"],
  rmdir: ["link"],
  stat: ["follow"],
  statfs: ["follow"],
  symlink: ["target", "link"],
  truncate: ["follow"],
  unlink: ["link"],
  utimes: ["follow"],
  watch: ["follow"],
  watchFile: ["follow"],
  writeFile: ["follow"],
};
const PROCESS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];

// The real functions, taken before anything is patched, so checking a path never trips itself.
const realpathNative = fs.realpathSync.native;
const lstatSync = fs.lstatSync;
const readlinkSync = fs.readlinkSync;

let armed = false;

const pathOf = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value instanceof URL) return fileURLToPath(value);
  if (Buffer.isBuffer(value)) return value.toString();
  return null; // A file descriptor: it was opened through a checked path.
};

/**
 * Where a path really leads: links and junctions resolved, a dangling one included, and for a
 * file that doesn't exist yet, the real folder it would go in. With `follow` false only the
 * folders above are resolved, for a call that acts on a link itself. Null for a link loop.
 */
function realPath(p: string, follow = true, depth = 0): string | null {
  const abs = path.resolve(p);
  const parent = path.dirname(abs);
  const inParent = (): string | null => {
    if (parent === abs) return abs; // The root.
    const real = realPath(parent, true, depth + 1);
    return real === null ? null : path.join(real, path.basename(abs));
  };
  if (depth > 40) return null;
  if (!follow) return inParent();
  try {
    return realpathNative(abs);
  } catch {
    // Missing, a dangling link, or a loop: look at the entry itself.
  }
  let isLink: boolean;
  try {
    isLink = lstatSync(abs).isSymbolicLink();
  } catch {
    return inParent(); // Doesn't exist yet: its folders decide where it would go.
  }
  return isLink ? realPath(path.resolve(parent, readlinkSync(abs)), true, depth + 1) : inParent();
}

/**
 * Arms the tripwires until `disarm`. Files are allowed only inside `allowFolders` (none by
 * default), judged by where a path really leads. Only one set can be armed at a time.
 */
export function armTripwires(options: { allowFolders?: readonly string[] } = {}): Tripwires {
  if (armed) throw new Error("Tripwires are already armed; disarm the first set.");
  armed = true;
  const allowFolders = (options.allowFolders ?? []).map((f) => realPath(f) ?? path.resolve(f));
  const trips: Trip[] = [];
  const restore: (() => void)[] = [];

  const record = (kind: TripKind, what: string): TripwireError => {
    const t = { kind, what };
    trips.push(t);
    return new TripwireError(t);
  };
  const trip = (kind: TripKind, what: string): never => {
    throw record(kind, what);
  };
  // A promise API rejects instead of throwing, as the real call would fail. Functions hung on
  // the original, such as realpathSync.native, are checked the same way.
  const wrap = (fn: AnyFn, check: (args: unknown[]) => void, promises: boolean): AnyFn => {
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
    for (const [key, value] of Object.entries(fn))
      (wrapper as unknown as Patchable)[key] =
        typeof value === "function" ? wrap(value as AnyFn, check, promises) : value;
    return wrapper;
  };
  const patch = (
    target: Patchable,
    name: string,
    check: (args: unknown[]) => void,
    promises = false,
  ) => {
    const original = target[name];
    if (typeof original !== "function") return;
    target[name] = wrap(original as AnyFn, check, promises);
    restore.push(() => (target[name] = original));
  };
  const checkPaths = (rules: readonly PathRule[]) => (args: unknown[]) => {
    rules.forEach((rule, i) => {
      const p = pathOf(args[i]);
      if (p === null) return;
      const linkPath = pathOf(args[i + 1]);
      const real =
        rule === "target" && linkPath !== null
          ? realPath(path.resolve(path.dirname(path.resolve(linkPath)), p))
          : realPath(p, rule !== "link");
      if (real !== null && allowFolders.some((folder) => isInsideFolder(folder, real))) return;
      trip(
        "file",
        real === null
          ? `${p}, a link loop`
          : real === path.resolve(p)
            ? p
            : `${p}, which leads to ${real}`,
      );
    });
  };

  const fsModule = fs as unknown as Patchable;
  const fsPromises = fs.promises as unknown as Patchable;
  for (const [name, rules] of Object.entries(FILE_FUNCTIONS)) {
    patch(fsModule, name, checkPaths(rules));
    patch(fsModule, `${name}Sync`, checkPaths(rules));
    patch(fsPromises, name, checkPaths(rules), true);
  }

  // New connections: net, http, https, tls and fetch all connect through net.Socket.
  const where = (args: unknown[]) => JSON.stringify(args[0] ?? null) ?? "";
  patch(net.Socket.prototype as unknown as Patchable, "connect", (a) => trip("network", where(a)));
  patch(net.Server.prototype as unknown as Patchable, "listen", (a) => trip("network", where(a)));
  // Connections opened before arming and kept for reuse, as the pools behind fetch and http do:
  // every write to a socket goes through _writeGeneric. On a network socket the write fails and
  // the socket closes, so the request errors where the code under test sees it. Pipes, such as
  // the test runner's own output, have no remote port and pass.
  const socketProto = net.Socket.prototype as unknown as Patchable;
  const writeGeneric = socketProto["_writeGeneric"];
  if (typeof writeGeneric === "function") {
    socketProto["_writeGeneric"] = function (this: net.Socket, ...args: unknown[]) {
      if (this.remotePort === undefined) return (writeGeneric as AnyFn).apply(this, args);
      const error = record("network", `${this.remoteAddress}:${this.remotePort}, kept open`);
      const callback = args[3];
      if (typeof callback === "function") (callback as (e: Error) => void)(error);
      this.destroy(error);
    };
    restore.push(() => (socketProto["_writeGeneric"] = writeGeneric));
  }
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
