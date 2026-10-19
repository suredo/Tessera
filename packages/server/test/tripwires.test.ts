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

  it("refuse a request on a connection opened before arming", async () => {
    const before = received;
    await (await fetch(url)).text(); // Leaves a connection in fetch's pool.
    const agent = new http.Agent({ keepAlive: true });
    await new Promise<void>((resolve) =>
      http.get(url, { agent }, (res) => res.resume().on("end", resolve)),
    );
    expect(received).toBe(before + 2);
    const w = arm();
    await expect(fetch(url)).rejects.toThrow();
    await new Promise<void>((resolve) => http.get(url, { agent }).on("error", () => resolve()));
    w.disarm();
    agent.destroy();
    expect(received).toBe(before + 2);
    expect(w.trips.length).toBeGreaterThanOrEqual(2);
    expect(w.trips.every((t) => t.kind === "network")).toBe(true);
  });

  it("follow links and junctions out of the allowed folder, dangling ones too", () => {
    const junction = path.join(allowed, "junction");
    const dangling = path.join(allowed, "dangling");
    fs.symlinkSync(outside, junction, "junction");
    fs.symlinkSync(path.join(outside, "missing"), dangling, "junction");
    try {
      const w = arm();
      expect(() => readFileSync(path.join(junction, "outside.txt"))).toThrow(TripwireError);
      expect(() => fs.writeFileSync(path.join(junction, "new.txt"), "x")).toThrow(TripwireError);
      expect(() => fs.mkdirSync(dangling)).toThrow(TripwireError);
      expect(() => fs.writeFileSync(path.join(dangling, "new.txt"), "x")).toThrow(TripwireError);
      expect(() => fs.realpathSync.native(path.join(outside, "outside.txt"))).toThrow(
        TripwireError,
      );
      expect(() => fs.symlinkSync(outside, path.join(allowed, "another"), "junction")).toThrow(
        TripwireError,
      );
      // Calls on the link itself stay inside.
      expect(fs.lstatSync(junction).isSymbolicLink()).toBe(true);
      expect(w.trips.map((t) => t.kind)).toEqual(Array(6).fill("file"));
      expect(w.trips[0]?.what).toContain("which leads to");
    } finally {
      wires?.disarm();
      fs.rmSync(junction);
      fs.rmSync(dangling);
    }
    expect(fs.readdirSync(outside)).toEqual(["outside.txt"]);
  });

  it("follow a file link out of the allowed folder", (ctx) => {
    const link = path.join(allowed, "file-link.txt");
    try {
      fs.symlinkSync(path.join(outside, "outside.txt"), link, "file");
    } catch {
      ctx.skip(); // Windows allows file links only in developer mode or as administrator.
    }
    try {
      arm();
      expect(() => readFileSync(link)).toThrow(TripwireError);
      expect(() => fs.writeFileSync(link, "x")).toThrow(TripwireError);
    } finally {
      wires?.disarm();
      fs.rmSync(link);
    }
    expect(readFileSync(path.join(outside, "outside.txt"), "utf8")).toBe("outside");
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
