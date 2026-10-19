import { execFileSync, spawn } from "node:child_process";
import dns from "node:dns";
import fs, { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { armTripwires, createCanary, TripwireError, type Tripwires } from "./support/tripwires.ts";

// The tripwires that the server-side boundary checks use (docs/spec/threat-model.md). Every
// folder is a new temporary one, never a real data folder (ENG-19).

let received = 0;
const server = http.createServer((_req, res) => {
  received += 1;
  res.end("ok");
});
let url = "";
const allowed = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-tripwires-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-tripwires-outside-"));
fs.writeFileSync(path.join(allowed, "inside.txt"), "inside");
fs.writeFileSync(path.join(outside, "outside.txt"), "outside");

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`;
});
afterAll(() => {
  server.close();
  fs.rmSync(allowed, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

let wires: Tripwires | undefined;
afterEach(() => wires?.disarm());
const arm = () => (wires = armTripwires({ allowFolders: [allowed] }));

describe("tripwires", () => {
  it("refuse fetch, http and raw sockets, and nothing reaches the server", async () => {
    const before = received;
    const w = arm();
    await expect(fetch(url)).rejects.toThrow();
    expect(() => http.get(url)).toThrow(TripwireError);
    expect(() => net.connect(80, "127.0.0.1")).toThrow(TripwireError);
    w.disarm();
    expect(received).toBe(before);
    expect(w.trips.length).toBeGreaterThanOrEqual(3);
    expect(w.trips.every((t) => t.kind === "network")).toBe(true);
  });

  it("refuse listening and name lookups", async () => {
    const w = arm();
    expect(() => http.createServer().listen(0)).toThrow(TripwireError);
    expect(() => dns.lookup("localhost", () => {})).toThrow(TripwireError);
    await expect(dns.promises.lookup("localhost")).rejects.toThrow(TripwireError);
    expect(w.trips.map((t) => t.kind)).toEqual(["network", "network", "network"]);
  });

  it("refuse processes and workers, through named imports too", () => {
    const w = arm();
    expect(() => spawn(process.execPath, ["--version"])).toThrow(TripwireError);
    expect(() => execFileSync(process.execPath, ["--version"])).toThrow(TripwireError);
    expect(() => new Worker("console.log(1)", { eval: true })).toThrow(TripwireError);
    expect(w.trips.map((t) => t.kind)).toEqual(["process", "process", "worker"]);
  });

  it("allow files inside the allowed folders and refuse the rest", async () => {
    const w = arm();
    expect(readFileSync(path.join(allowed, "inside.txt"), "utf8")).toBe("inside");
    fs.writeFileSync(path.join(allowed, "new.txt"), "new");
    expect(() => readFileSync(path.join(outside, "outside.txt"))).toThrow(TripwireError);
    await expect(readFile(path.join(outside, "outside.txt"))).rejects.toThrow(TripwireError);
    expect(() => fs.writeFileSync(path.join(allowed, "..", "escape.txt"), "x")).toThrow(
      TripwireError,
    );
    expect(() =>
      fs.renameSync(path.join(allowed, "new.txt"), path.join(outside, "moved.txt")),
    ).toThrow(TripwireError);
    expect(() => fs.existsSync(path.join(outside, "outside.txt"))).toThrow(TripwireError);
    expect(w.trips.map((t) => t.kind)).toEqual(["file", "file", "file", "file", "file"]);
  });

  it("put everything back when disarmed", async () => {
    const before = received;
    arm().disarm();
    await (await fetch(url)).text();
    expect(received).toBe(before + 1);
    expect(readFileSync(path.join(outside, "outside.txt"), "utf8")).toBe("outside");
    expect(execFileSync(process.execPath, ["--version"]).toString()).toMatch(/^v\d+/);
  });

  it("refuse to arm twice", () => {
    arm();
    expect(() => armTripwires()).toThrow(/already armed/);
  });
});

describe("canary", () => {
  it("reports nothing while untouched, and each kind of change once made", () => {
    const canary = createCanary();
    try {
      expect(canary.changes()).toEqual([]);
      fs.writeFileSync(path.join(canary.folder, "dropped.txt"), "x");
      fs.appendFileSync(canary.file, "changed");
      expect(canary.changes()).toEqual([
        "files added beside the canary: dropped.txt",
        "the canary's content changed",
        "the canary's time changed",
      ]);
    } finally {
      canary.remove();
    }
  });
});
