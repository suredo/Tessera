import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ProcessResult } from "../src/platform/index.ts";
import {
  atLeast,
  buildArgs,
  createClaudeProvider,
  findClaude,
  ProviderError,
  TESTED_CLI_VERSION,
  versionOf,
  type StageSpec,
} from "../src/providers/index.ts";

// The Claude Code adapter's contract tests (TEST-02): the exact arguments, the environment, the
// working folder, output parsing, error mapping, usage and cancellation, against a fake claude
// program that records what it was given and answers from canned result envelopes. It never
// reaches a model (ENG-11).

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "support", "fake-claude.ts");
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-claude-test-"));
  temps.push(dir);
  return dir;
};

const answer = z.strictObject({ title: z.string() });
const spec = (overrides: Partial<StageSpec<z.infer<typeof answer>>> = {}) => ({
  stage: "create" as const,
  system: "Make the tool the person asks for.",
  prompt: "I need a shopping list",
  schema: answer,
  model: "claude-sonnet-5-5",
  effort: "medium" as const,
  tools: "none" as const,
  timeLimitMs: 20_000,
  ...overrides,
});
const success = (structured: unknown, usage: object = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 1234,
  structured_output: structured,
  usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 1000,
    output_tokens: 50,
    ...usage,
  },
});
const failed = (subtype: string, result: string) => ({
  type: "result",
  subtype,
  is_error: true,
  result,
  usage: {
    input_tokens: 5,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  },
});

/** The adapter on the fake, with these replies; and what the fake was given, call by call. */
function withReplies(replies: unknown[], env: NodeJS.ProcessEnv = process.env) {
  const dir = tempDir();
  const repliesFile = path.join(dir, "replies.json");
  const calls = path.join(dir, "calls");
  fs.writeFileSync(repliesFile, JSON.stringify(replies));
  const provider = createClaudeProvider({
    executable: process.execPath,
    leadingArgs: [fake, repliesFile, calls],
    live: false,
    env,
  });
  const made = () =>
    fs.existsSync(calls)
      ? fs
          .readdirSync(calls)
          .sort()
          .map(
            (file) =>
              JSON.parse(fs.readFileSync(path.join(calls, file), "utf8")) as {
                args: string[];
                cwd: string;
                envNames: string[];
              },
          )
      : [];
  return { provider, made };
}

describe("arguments and environment (CLI-03, CLI-08, TEST-02)", () => {
  it("CLI-03: passes the locked flags exactly, the wrapped draft-07 schema, the system prompt, then the request", async () => {
    const { provider, made } = withReplies([success({ answer: { title: "Shopping" } })]);
    await provider.run(spec());
    const [call] = made();
    const schemaAt = call!.args.indexOf("--json-schema") + 1;
    const schema = JSON.parse(call!.args[schemaAt]!) as Record<string, unknown>;
    expect(schema).toMatchObject({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      required: ["answer"],
      properties: { answer: { type: "object", required: ["title"] } },
    });
    expect(call!.args).toEqual([
      "--print",
      "--output-format",
      "json",
      "--json-schema",
      call!.args[schemaAt],
      "--model",
      "claude-sonnet-5-5",
      "--effort",
      "medium",
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
      "Make the tool the person asks for.",
      "I need a shopping list",
    ]);
    // Only research gets web tools, and never file tools.
    expect(buildArgs({ ...spec(), tools: "web" })).toContain("WebSearch,WebFetch");
  });

  it("CLI-08: starts the CLI with only the allowlisted environment, in a fresh empty folder it removes", async () => {
    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: "would-bill-the-api",
      ANTHROPIC_AUTH_TOKEN: "x",
      ANTHROPIC_BASE_URL: "http://elsewhere",
      CLAUDE_CODE_SIMPLE: "1",
      OPENAI_API_KEY: "x",
      TESSERA_SECRET: "x",
    };
    const { provider, made } = withReplies([success({ answer: { title: "Shopping" } })], env);
    await provider.run(spec());
    const [call] = made();
    for (const name of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_SIMPLE",
      "OPENAI_API_KEY",
      "TESSERA_SECRET",
    ]) {
      expect(call!.envNames).not.toContain(name);
    }
    expect(call!.envNames.map((name) => name.toUpperCase())).toContain("PATH");
    expect(path.basename(call!.cwd)).toMatch(/^tessera-cli-/);
    expect(fs.existsSync(call!.cwd)).toBe(false);
  });
});

describe("answers and usage (CLI-01, CLI-04)", () => {
  it("CLI-01: unwraps the answer and checks it against the stage's contract", async () => {
    const { provider } = withReplies([success({ answer: { title: "Shopping" } })]);
    const result = await provider.run(spec());
    expect(result.value).toEqual({ title: "Shopping" });
    expect(JSON.parse(result.raw)).toMatchObject({ subtype: "success" });
  });

  it("CLI-04: counts cache writes and reads as input, shows cached input apart, and keeps unknown parts unknown", async () => {
    const { provider } = withReplies([
      success({ answer: { title: "a" } }),
      success({ answer: { title: "b" } }, { cache_creation_input_tokens: undefined }),
    ]);
    expect((await provider.run(spec())).usage).toEqual({
      inputTokens: 1110,
      cachedInputTokens: 1000,
      outputTokens: 50,
      durationMs: 1234,
    });
    // A missing part makes the total unknown, never a smaller number.
    expect((await provider.run(spec())).usage.inputTokens).toBeNull();
  });

  it("CLI-01: an answer that doesn't fit the contract is a schema failure, with what the call cost", async () => {
    const { provider } = withReplies([success({ answer: { name: "not a title" } })]);
    const error = await provider.run(spec()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: "schema", usage: { outputTokens: 50 } });
  });
});

describe("error mapping (CLI-05)", () => {
  const cases: [string, object][] = [
    ["sign_in", failed("success", "Not logged in · Please run /login")],
    ["usage_limit", failed("error_during_execution", "Claude AI usage limit reached|1761500000")],
    [
      "unavailable_model",
      failed(
        "error_during_execution",
        "The model claude-x does not exist or you do not have access",
      ),
    ],
    [
      "unsupported_effort",
      failed("error_during_execution", "Effort level 'high' is not supported by this model"),
    ],
    ["schema", failed("error_max_structured_output_retries", "")],
    ["turn_limit", failed("error_max_turns", "")],
  ];
  for (const [kind, envelope] of cases) {
    it(`CLI-05: maps a ${kind} failure to its plain message, and keeps the CLI's words`, async () => {
      const { provider } = withReplies([envelope]);
      const error = (await provider.run(spec()).catch((e: unknown) => e)) as ProviderError;
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.kind).toBe(kind);
      expect(error.message.length).toBeGreaterThan(20);
    });
  }

  it("CLI-05: reads a failure from is_error, even when subtype says success (L-71)", async () => {
    const { provider } = withReplies([failed("success", "Not logged in · Please run /login")]);
    await expect(provider.run(spec())).rejects.toMatchObject({ kind: "sign_in" });
  });

  it("CLI-05: a failure it can't name, or output that isn't a result, is an error, not a guess", async () => {
    const unknown = withReplies([failed("error_during_execution", "Something new went wrong")]);
    const one = await unknown.provider.run(spec()).catch((e: unknown) => e);
    expect(one).not.toBeInstanceOf(ProviderError);
    expect((one as Error).message).toContain("Something new went wrong");
    const garbled = withReplies([{ _stdout: "not json", _exitCode: 1 }]);
    const two = await garbled.provider.run(spec()).catch((e: unknown) => e);
    expect((two as Error).message).toMatch(/gave no JSON result \(exit 1\)/);
  });
});

describe("time limit and cancellation (CLI-01, CLI-06)", () => {
  it("CLI-01: stops a call at its time limit", async () => {
    const { provider } = withReplies([
      { ...success({ answer: { title: "late" } }), _delayMs: 10_000 },
    ]);
    await expect(provider.run(spec({ timeLimitMs: 500 }))).rejects.toMatchObject({
      kind: "time_limit",
    });
  });

  it("CLI-06: a cancel stops the running call, and a call cancelled before it starts never runs", async () => {
    const slow = withReplies([{ ...success({ answer: { title: "late" } }), _delayMs: 10_000 }]);
    const controller = new AbortController();
    const started = Date.now();
    const running = slow.provider.run(spec({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 300);
    await expect(running).rejects.toMatchObject({ kind: "cancelled" });
    expect(Date.now() - started).toBeLessThan(8000);

    const never = withReplies([success({ answer: { title: "x" } })]);
    await expect(never.provider.run(spec({ signal: AbortSignal.abort() }))).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(never.made()).toEqual([]);
  });
});

describe("finding Claude Code (CLI-02, PLAT-03)", () => {
  const answering =
    (version: string, auth: string) =>
    (_exe: string, args: readonly string[]): Promise<ProcessResult> =>
      Promise.resolve({
        exitCode: 0,
        stdout: args[0] === "--version" ? version : auth,
        stderr: "",
        timedOut: false,
        cancelled: false,
      });
  /** A PATH folder holding an empty `claude` program file, as the platform names it. */
  const pathWith = (file: string) => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, file), "");
    fs.chmodSync(path.join(dir, file), 0o755);
    return { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  };

  it("CLI-02: reads the version, and compares versions as numbers", () => {
    expect(versionOf("2.1.310 (Claude Code)")).toBe("2.1.310");
    expect(atLeast("2.1.310", TESTED_CLI_VERSION)).toBe(true);
    expect(atLeast("2.1.296", "2.1.296")).toBe(true);
    expect(atLeast("2.1.99", "2.1.296")).toBe(false);
    expect(atLeast("3.0.0", "2.9.999")).toBe(true);
  });

  it("CLI-02: says plainly when Claude Code is missing, or only npm's batch file is found", async () => {
    expect(await findClaude({ PATH: tempDir() }, "win32")).toMatchObject({
      ok: false,
      problem: "missing",
    });
    expect(await findClaude(pathWith("claude.cmd"), "win32")).toMatchObject({
      ok: false,
      problem: "batch-file",
      message: expect.stringContaining("claude.exe") as unknown,
    });
  });

  it("CLI-02: refuses a version older than the tested one, and checks sign-in without a model call", async () => {
    const env = pathWith("claude.exe");
    expect(await findClaude(env, "win32", answering("2.1.100 (Claude Code)", "{}"))).toMatchObject({
      ok: false,
      problem: "old",
    });
    expect(
      await findClaude(env, "win32", answering("2.1.310 (Claude Code)", '{"loggedIn":false}')),
    ).toMatchObject({ ok: false, problem: "signed-out" });
    expect(
      await findClaude(env, "win32", answering("2.1.310 (Claude Code)", '{"loggedIn":true}')),
    ).toMatchObject({
      ok: true,
      version: "2.1.310",
      executable: expect.stringMatching(/claude\.exe$/i) as unknown,
    });
  });
});
