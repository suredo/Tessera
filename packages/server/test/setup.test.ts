import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ROUTES,
  PROBE_ROUTE,
  probeResultSchema,
  SETUP_ROUTE,
  setupReportSchema,
  type ClaudeCheck,
} from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { startLocalServer } from "../src/http/index.ts";
import { createClaudeProvider, FAILURE_MESSAGES, ROUTES_FILE } from "../src/providers/index.ts";
import {
  checkNode,
  checkSetup,
  folderBytes,
  MINIMUM_NODE,
  runProbe,
  setupRoutes,
} from "../src/setup/index.ts";

// The setup check (PLAT-03), the probe (CLI-02) and their routes (APP-07), with Claude Code faked
// by test configuration: the probe's calls go to the fake claude program and never reach a model
// (ENG-11). Every data folder is a new temporary one (ENG-19).

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "support", "fake-claude.ts");
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-setup-test-"));
  temps.push(dir);
  return dir;
};

const READY: ClaudeCheck = { ok: true, executable: "/usr/bin/claude", version: "2.1.310" };
const SIGNED_OUT: ClaudeCheck = {
  ok: false,
  problem: "signed-out",
  message: FAILURE_MESSAGES.sign_in,
};
const usage = {
  input_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 1,
};
const connected = {
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 900,
  structured_output: { answer: { connected: true } },
  usage,
};

/** The adapter on the fake, with these replies; and what the fake was given, call by call. */
function fakeClaude(replies: unknown[]) {
  const dir = tempDir();
  const repliesFile = path.join(dir, "replies.json");
  const calls = path.join(dir, "calls");
  fs.writeFileSync(repliesFile, JSON.stringify(replies));
  const provider = createClaudeProvider({
    executable: process.execPath,
    leadingArgs: [fake, repliesFile, calls],
    live: false,
  });
  const made = () =>
    fs.existsSync(calls)
      ? fs
          .readdirSync(calls)
          .map(
            (file) =>
              JSON.parse(fs.readFileSync(path.join(calls, file), "utf8")) as { args: string[] },
          )
      : [];
  return { provider, made };
}

describe("the setup check (PLAT-03)", () => {
  it("PLAT-03: Node.js passes from the minimum in the root package.json's engines, and an older one says how to fix it", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const engines = (
      JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
        engines: { node: string };
      }
    ).engines.node;
    expect(engines).toMatch(new RegExp(`^>=${MINIMUM_NODE.replaceAll(".", "\\.")}\\b`));
    expect(checkNode(MINIMUM_NODE)).toEqual({
      ok: true,
      version: MINIMUM_NODE,
      minimum: MINIMUM_NODE,
    });
    expect(checkNode("22.23.3").ok).toBe(true);
    expect(checkNode("20.11.0")).toEqual({
      ok: false,
      version: "20.11.0",
      minimum: MINIMUM_NODE,
      message: `Tessera needs Node.js ${MINIMUM_NODE} or later, and this computer has 20.11.0. Install Node.js 22 from nodejs.org, then start Tessera again.`,
    });
  });

  it("PLAT-03: is ready only when Node.js and Claude Code both pass, and passes Claude Code's problem on", async () => {
    const dataDir = tempDir();
    const ready = await checkSetup({ dataDir, findClaude: () => Promise.resolve(READY) });
    expect(ready).toMatchObject({ ready: true, claude: READY });
    const signedOut = await checkSetup({ dataDir, findClaude: () => Promise.resolve(SIGNED_OUT) });
    expect(signedOut).toMatchObject({ ready: false, claude: SIGNED_OUT });
    const oldNode = await checkSetup({
      dataDir,
      findClaude: () => Promise.resolve(READY),
      nodeVersion: "20.0.0",
    });
    expect(oldNode.ready).toBe(false);
    expect(setupReportSchema.parse(oldNode)).toEqual(oldNode);
  });

  it("APP-07: counts what the data folder holds, its folders included", async () => {
    const dataDir = tempDir();
    fs.writeFileSync(path.join(dataDir, "tessera.db"), "x".repeat(1000));
    fs.mkdirSync(path.join(dataDir, "assets", "ab"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "assets", "ab", "one"), "y".repeat(234));
    expect(folderBytes(dataDir)).toBe(1234);
    expect(folderBytes(path.join(dataDir, "missing"))).toBe(0);
    const report = await checkSetup({ dataDir, findClaude: () => Promise.resolve(READY) });
    expect(report.dataFolder).toEqual({ path: dataDir, bytes: 1234 });
  });
});

describe("the probe (CLI-02)", () => {
  it("CLI-02: makes one small structured call on the intent stage's route, without tools", async () => {
    const { provider, made } = fakeClaude([connected]);
    expect(await runProbe(provider, tempDir())).toEqual({
      ok: true,
      model: DEFAULT_ROUTES.intent.model,
      durationMs: 900,
    });
    const [call] = made();
    expect(call!.args[call!.args.indexOf("--model") + 1]).toBe(DEFAULT_ROUTES.intent.model);
    expect(call!.args[call!.args.indexOf("--tools") + 1]).toBe("");
  });

  it("CLI-02: follows the routes file, and says plainly when the call fails", async () => {
    const dataDir = tempDir();
    fs.writeFileSync(
      path.join(dataDir, ROUTES_FILE),
      JSON.stringify({ intent: { model: "claude-sonnet-5-5", effort: "low" } }),
    );
    const routed = fakeClaude([connected]);
    expect(await runProbe(routed.provider, dataDir)).toMatchObject({
      ok: true,
      model: "claude-sonnet-5-5",
    });
    const failing = fakeClaude([
      {
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Not logged in · Please run /login",
        usage: { ...usage, input_tokens: 0, output_tokens: 0 },
      },
    ]);
    expect(await runProbe(failing.provider, tempDir())).toEqual({
      ok: false,
      message: FAILURE_MESSAGES.sign_in,
    });
  });
});

describe("the setup routes (APP-07)", () => {
  type Answer = { status: number; body: string };
  const send = (port: number, route: string, method: string): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: route,
          method,
          headers: { origin: `http://127.0.0.1:${port}` },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8").on("data", (chunk: string) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });

  it("APP-07: answers the check to GET, and runs the probe on POST only", async () => {
    const dataDir = tempDir();
    const { provider, made } = fakeClaude([connected]);
    const server = await startLocalServer({
      port: 0,
      routes: setupRoutes({
        dataDir,
        findClaude: () => Promise.resolve(READY),
        probeProvider: () => provider,
      }),
    });
    try {
      const check = await send(server.port, SETUP_ROUTE, "GET");
      expect(check.status).toBe(200);
      expect(setupReportSchema.parse(JSON.parse(check.body))).toMatchObject({ ready: true });
      expect((await send(server.port, SETUP_ROUTE, "POST")).status).toBe(405);
      expect((await send(server.port, PROBE_ROUTE, "GET")).status).toBe(405);
      expect(made()).toEqual([]);
      const probe = await send(server.port, PROBE_ROUTE, "POST");
      expect(probeResultSchema.parse(JSON.parse(probe.body))).toMatchObject({ ok: true });
      expect(made()).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("CLI-02: never spends a call while the check fails, and shares one call between probes sent together", async () => {
    const dataDir = tempDir();
    const { provider, made } = fakeClaude([{ ...connected, _delayMs: 300 }]);
    let claude: ClaudeCheck = SIGNED_OUT;
    const server = await startLocalServer({
      port: 0,
      routes: setupRoutes({
        dataDir,
        findClaude: () => Promise.resolve(claude),
        probeProvider: () => provider,
      }),
    });
    try {
      const refused = await send(server.port, PROBE_ROUTE, "POST");
      expect(JSON.parse(refused.body)).toEqual({
        ok: false,
        message:
          "The probe would fail until the setup check passes. Fix what the status screen shows first.",
      });
      expect(made()).toEqual([]);
      claude = READY;
      const both = await Promise.all([
        send(server.port, PROBE_ROUTE, "POST"),
        send(server.port, PROBE_ROUTE, "POST"),
      ]);
      expect(both.map((answer) => JSON.parse(answer.body) as unknown)).toEqual([
        expect.objectContaining({ ok: true }),
        expect.objectContaining({ ok: true }),
      ]);
      expect(made()).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
