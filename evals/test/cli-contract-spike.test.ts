import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intentSchema, toJsonSchema } from "@tessera/contracts";
import {
  buildArgs,
  cleanEnvironment,
  createClaudeProvider,
  runProcess,
  toUsage,
  wrapSchema,
} from "@tessera/server";
import { Ajv } from "ajv";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { readLedger } from "../src/index.ts";
import { FAKE_CLAUDE } from "../spikes/cli-contract/claude-cli.ts";
import { fakeProvider, plannedCalls, PLAN, runSpike } from "../spikes/cli-contract/run.ts";

// The spike's own runs use the system's temporary folder, never a real data folder (ENG-19).
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-cli-spike-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let runs = 0;
const newFolder = () => path.join(root, `run-${++runs}`);
const fakeCalls = (dataFolder: string) =>
  fs
    .readdirSync(path.join(dataFolder, "fake-calls"))
    .sort()
    .map(
      (file) =>
        JSON.parse(fs.readFileSync(path.join(dataFolder, "fake-calls", file), "utf8")) as {
          args: string[];
          cwd: string;
          envNames: string[];
        },
    );

const spikeFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "spikes",
  "cli-contract",
);

// These tests start real processes, which can take seconds on a busy machine (ENG-20).
describe("CLI contract spike (CLI-03, CLI-08, #19)", { timeout: 30_000 }, () => {
  it("passes the locked flags of a normal stage, then the prompt", () => {
    const args = buildArgs({
      stage: "intent",
      system: "System prompt",
      prompt: "Make me a list",
      schema: intentSchema,
      model: "claude-haiku-5-5",
      effort: "low",
      tools: "none",
      timeLimitMs: 1000,
    });
    const schemaAt = args.indexOf("--json-schema") + 1;
    // The contract's own schema, in the draft the CLI accepts, wrapped in an object for the API.
    expect(JSON.parse(args[schemaAt] ?? "")).toEqual(wrapSchema(toJsonSchema("intent")));
    expect(toJsonSchema("intent")["$schema"]).toBe("http://json-schema.org/draft-07/schema#");
    expect(args.filter((_, i) => i !== schemaAt)).toEqual([
      "--print",
      "--output-format",
      "json",
      "--json-schema",
      "--model",
      "claude-haiku-5-5",
      "--effort",
      "low",
      "--tools",
      "",
      "--safe-mode",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      "--max-turns",
      "3",
      "--system-prompt",
      "System prompt",
      "Make me a list",
    ]);
  });

  it("wraps any contract, a union included, in an object whose references still resolve", () => {
    const union = toJsonSchema("intent");
    expect(union["type"]).toBeUndefined();
    const wrapped = wrapSchema(union);
    expect(wrapped).toMatchObject({ type: "object", required: ["answer"] });
    expect(wrapped["$schema"]).toBe(union["$schema"]);

    // Shared definitions move to the top, where "#/definitions/..." points.
    const withRefs = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "array",
      items: { $ref: "#/definitions/item" },
      definitions: { item: { type: "string", minLength: 1 } },
    };
    const validate = new Ajv({ strict: true }).compile(wrapSchema(withRefs));
    expect(validate({ answer: ["milk"] })).toBe(true);
    expect(validate({ answer: [""] })).toBe(false);
    expect(validate(["milk"])).toBe(false);
  });

  it("starts the CLI with an allowlisted environment: no API keys, no parent session (L-52)", () => {
    const env = cleanEnvironment({
      Path: "C:\\bin",
      USERPROFILE: "C:\\Users\\a",
      ANTHROPIC_API_KEY: "x",
      ANTHROPIC_AUTH_TOKEN: "x",
      ANTHROPIC_BASE_URL: "http://localhost:1",
      CLAUDE_CODE_SIMPLE: "1",
      CLAUDECODE: "1",
      OPENAI_API_KEY: "x",
    });
    expect(Object.keys(env).sort()).toEqual(["Path", "USERPROFILE"]);
  });

  it("counts cache writes and reads as input, and leaves unknown parts unknown (CLI-04, L-47)", () => {
    const envelope = { type: "result" as const, subtype: "success", is_error: false };
    expect(
      toUsage({
        ...envelope,
        duration_ms: 900,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 3000,
          output_tokens: 40,
        },
      }),
    ).toEqual({ inputTokens: 3210, cachedInputTokens: 3000, outputTokens: 40, durationMs: 900 });
    expect(toUsage({ ...envelope, usage: { input_tokens: 10, output_tokens: 4 } })).toEqual({
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: 4,
      durationMs: null,
    });
  });

  it("rehearses the exact run against a fake claude at no cost (ENG-07)", async () => {
    const dataFolder = newFolder();
    const report = await runSpike({
      mode: "dry-run",
      provider: fakeProvider(dataFolder),
      dataFolder,
    });

    expect(report.calls.map((c) => [c.check, c.passed])).toEqual(
      plannedCalls().map((c) => [c.check, true]),
    );
    expect(report.summary).toMatchObject({ callCount: 3, inputTokens: 0, outputTokens: 0 });
    expect(readLedger(dataFolder).every((e) => e.mode === "dry-run")).toBe(true);

    // What reached the program: the prompt intact as the last argument, a fresh folder outside
    // the repository, and nothing from a parent Claude Code session.
    const calls = fakeCalls(dataFolder);
    expect(calls.map((c) => c.args.at(-1))).toEqual(plannedCalls().map((c) => c.request));
    for (const call of calls) {
      expect(path.relative(process.cwd(), call.cwd).startsWith("..")).toBe(true);
      expect(fs.existsSync(call.cwd)).toBe(false);
      expect(call.envNames.filter((n) => /^(ANTHROPIC|CLAUDE|OPENAI)/i.test(n))).toEqual([]);
    }
  });

  it("stops after a failed first call, and maps the CLI's turn limit (CLI-05)", async () => {
    const dataFolder = newFolder();
    const replies = path.join(root, `replies-${runs}.json`);
    const turnLimit = { type: "result", subtype: "error_max_turns", is_error: true, usage: {} };
    fs.writeFileSync(replies, JSON.stringify([turnLimit, turnLimit, turnLimit]));
    const report = await runSpike({
      mode: "dry-run",
      provider: fakeProvider(dataFolder, replies),
      dataFolder,
    });
    expect(report.calls).toHaveLength(1);
    expect(readLedger(dataFolder)[0]?.outcome).toMatchObject({
      kind: "failed",
      error: "turn_limit",
    });
  });

  // Codex's review of #37: a first call that answers but fails its checks must stop the run too.
  it("stops after a first call that answers but fails its checks (ENG-07)", async () => {
    const dataFolder = newFolder();
    const replies = path.join(root, `replies-${runs}.json`);
    const canned = JSON.parse(
      fs.readFileSync(path.join(spikeFolder, "dry-run-replies.json"), "utf8"),
    ) as Record<string, unknown>[];
    const toolAttempted = { ...canned[0], permission_denials: [{}] };
    fs.writeFileSync(replies, JSON.stringify([toolAttempted, canned[1], canned[2]]));
    const report = await runSpike({
      mode: "dry-run",
      provider: fakeProvider(dataFolder, replies),
      dataFolder,
    });
    expect(report.calls).toEqual([
      { check: "intent schema", passed: false, notes: ["a tool was attempted"] },
    ]);
    expect(readLedger(dataFolder)).toHaveLength(1);
    expect(fakeCalls(dataFolder)).toHaveLength(1);
  });

  // The second live run's failure: "success" yet is_error, 0 tokens, from a CLI not signed in. Its
  // words weren't recorded then, so the text here stands in for them.
  it("maps a sign-in failure and keeps the CLI's words in the ledger (ENG-13)", async () => {
    const dataFolder = newFolder();
    const replies = path.join(root, `replies-${runs}.json`);
    const usage = {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    };
    const notSignedIn = {
      type: "result",
      subtype: "success",
      is_error: true,
      duration_ms: 1817,
      result: "Not logged in · Please run /login",
      usage,
    };
    fs.writeFileSync(replies, JSON.stringify([notSignedIn]));
    await runSpike({ mode: "dry-run", provider: fakeProvider(dataFolder, replies), dataFolder });
    expect(readLedger(dataFolder)[0]?.outcome).toEqual({
      kind: "failed",
      error: "sign_in",
      message:
        "Claude Code isn't signed in. Open a terminal, run `claude auth login`, then try again. (success: Not logged in · Please run /login)",
    });
  });

  it("fails like the API did in the third live run for a schema that isn't an object (ENG-13)", async () => {
    const spike = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "spikes");
    const result = await runProcess(process.execPath, [
      FAKE_CLAUDE,
      path.join(spike, "cli-contract", "dry-run-replies.json"),
      path.join(root, "replay-union-calls"),
      "--json-schema",
      JSON.stringify(toJsonSchema("intent")),
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      is_error: true,
      result: "API Error: 400 tools.1.custom.input_schema.type: Field required",
    });
  });

  it("refuses a draft 2020-12 schema, as Claude Code 2.1.296 did in the live run (ENG-13)", async () => {
    const spike = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "spikes");
    const draft2020 = JSON.stringify(z.toJSONSchema(intentSchema, { target: "draft-2020-12" }));
    const result = await runProcess(process.execPath, [
      FAKE_CLAUDE,
      path.join(spike, "cli-contract", "dry-run-replies.json"),
      path.join(root, "replay-calls"),
      "--json-schema",
      draft2020,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      '--json-schema is not a valid JSON Schema: no schema with key or ref "https://json-schema.org/draft/2020-12/schema"',
    );
  });

  it("records a CLI that prints no JSON result as a crash, with its message", async () => {
    const provider = createClaudeProvider({
      executable: process.execPath,
      leadingArgs: [
        "-e",
        "process.stderr.write('error: unknown option --max-turns'); process.exit(1)",
        "--",
      ],
      live: false,
    });
    const spec = {
      stage: "intent" as const,
      system: "",
      prompt: "x",
      schema: intentSchema,
      model: PLAN.model,
      effort: PLAN.effort,
      tools: "none" as const,
      timeLimitMs: 10_000,
    };
    await expect(provider.run(spec)).rejects.toThrow(/unknown option --max-turns/);
  });
});
