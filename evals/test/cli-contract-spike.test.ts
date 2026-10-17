import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intentSchema, toJsonSchema } from "@tessera/contracts";
import { runProcess } from "@tessera/server";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { readLedger } from "../src/index.ts";
import {
  buildArgs,
  cleanEnvironment,
  createClaudeCliProvider,
  toUsage,
} from "../spikes/cli-contract/claude-cli.ts";
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

describe("CLI contract spike (CLI-03, CLI-08, #19)", () => {
  it("passes the locked flags of a normal stage, then the prompt", () => {
    const args = buildArgs(
      {
        stage: "intent",
        prompt: "Make me a list",
        schema: intentSchema,
        model: "claude-haiku-5-5",
        effort: "low",
        tools: "none",
        timeLimitMs: 1000,
      },
      "System prompt",
    );
    const schemaAt = args.indexOf("--json-schema") + 1;
    // The contract's own schema file, in the draft the CLI accepts.
    expect(JSON.parse(args[schemaAt] ?? "")).toEqual(toJsonSchema("intent"));
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
      message: "The CLI call failed (success): Not logged in · Please run /login",
    });
  });

  it("refuses a draft 2020-12 schema, as Claude Code 2.1.296 did in the live run (ENG-13)", async () => {
    const spike = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "spikes");
    const draft2020 = JSON.stringify(z.toJSONSchema(intentSchema, { target: "draft-2020-12" }));
    const result = await runProcess(process.execPath, [
      path.join(spike, "cli-contract", "fake-claude.ts"),
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
    const provider = createClaudeCliProvider({
      executable: process.execPath,
      leadingArgs: [
        "-e",
        "process.stderr.write('error: unknown option --max-turns'); process.exit(1)",
        "--",
      ],
      live: false,
      systemPrompt: "",
    });
    const spec = {
      stage: "intent" as const,
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
