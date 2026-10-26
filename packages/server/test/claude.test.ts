import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ProcessResult } from "../src/platform/index.ts";
import {
  atLeast,
  buildArgs,
  createClaudeProvider,
  FAILURE_MESSAGES,
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
                stdin: string;
                system: string;
              },
          )
      : [];
  return { provider, made };
}

describe("arguments and environment (CLI-03, CLI-08, TEST-02)", () => {
  it("CLI-03: passes the locked flags exactly, with the wrapped draft-07 schema, and the request and system prompt apart", async () => {
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
      "--system-prompt-file",
      "system-prompt.md",
    ]);
    // The request on standard input, the system prompt in its file: neither on the command line.
    expect(call!.stdin).toBe("I need a shopping list");
    expect(call!.system).toBe("Make the tool the person asks for.");
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

describe("tidying up never hides an answer (CLI-08, #159)", () => {
  // On Windows the CLI can still hold its working folder after answering: a live signed-out call
  // crashed removing it, which hid the CLI's answer (#159). Removal now failing must change
  // nothing about the call's result.
  function withHeldFolders() {
    const real = fs.rmSync.bind(fs);
    return vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (path.basename(String(target)).startsWith("tessera-cli-")) {
        throw Object.assign(
          new Error(`EBUSY: resource busy or locked, rmdir '${String(target)}'`),
          {
            code: "EBUSY",
          },
        );
      }
      real(target, options);
    });
  }

  it("CLI-08: an answer still comes back when the folder can't be removed", async () => {
    const held = withHeldFolders();
    try {
      const { provider } = withReplies([success({ answer: { title: "Shopping" } })]);
      await expect(provider.run(spec())).resolves.toMatchObject({ value: { title: "Shopping" } });
      expect(held).toHaveBeenCalled();
    } finally {
      held.mockRestore();
    }
  });

  it("CLI-08: a failure keeps its kind, plain message and detail when the folder can't be removed", async () => {
    const held = withHeldFolders();
    try {
      const { provider } = withReplies([failed("success", "Not logged in · Please run /login")]);
      const error = (await provider.run(spec()).catch((e: unknown) => e)) as ProviderError;
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ kind: "sign_in", message: FAILURE_MESSAGES.sign_in });
      expect(JSON.parse(error.detail!)).toMatchObject({
        result: "Not logged in · Please run /login",
      });
    } finally {
      held.mockRestore();
    }
  });
});

describe("long requests (CLI-01, ADR 0002)", () => {
  it("CLI-01: sends a request and a system prompt longer than Windows' command line allows, whole", async () => {
    const { provider, made } = withReplies([success({ answer: { title: "Long" } })]);
    const prompt = "a".repeat(40_000);
    const system = "b".repeat(40_000);
    await expect(provider.run(spec({ prompt, system }))).resolves.toMatchObject({
      value: { title: "Long" },
    });
    const [call] = made();
    expect(call!.stdin).toBe(prompt);
    expect(call!.system).toBe(system);
    expect(call!.args.join(" ").length).toBeLessThan(32_000);
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
      // The person reads only the plain sentence; the CLI's words are kept apart, for the ledger.
      expect(error.message).toBe(FAILURE_MESSAGES[kind as keyof typeof FAILURE_MESSAGES]);
      expect(error.message).not.toMatch(/error_max|input_schema|API Error|subtype/);
      expect(JSON.parse(error.detail!)).toMatchObject({
        subtype: (envelope as { subtype: string }).subtype,
      });
    });
  }

  it("CLI-05: reads the API's status before the CLI's wording (ADR 0002)", async () => {
    const generic = (status: number, result = "Request failed") => ({
      ...failed("error_during_execution", result),
      api_error_status: status,
      terminal_reason: "error",
    });
    const { provider } = withReplies([
      generic(401),
      generic(403),
      generic(429),
      generic(404, "model: claude-x"),
    ]);
    for (const kind of ["sign_in", "sign_in", "usage_limit", "unavailable_model"]) {
      await expect(provider.run(spec())).rejects.toMatchObject({ kind });
    }
  });

  it("CLI-05: maps the real CLI's failures, as captured from Claude Code 2.1.310 (#159)", async () => {
    // Both captured live on 2026-10-26, through the harness; neither used a token.
    const unknownModel = {
      type: "result",
      subtype: "success",
      is_error: true,
      api_error_status: 404,
      terminal_reason: "api_error",
      result:
        "There's an issue with the selected model (claude-nonexistent-0-0). It may not exist or you may not have access to it. Run --model to pick a different model.",
    };
    // No API status when signed out: only the words say so, which is why the wording is read too.
    const signedOut = {
      type: "result",
      subtype: "success",
      is_error: true,
      api_error_status: null,
      terminal_reason: "api_error",
      result: "Not logged in · Please run /login",
    };
    const { provider } = withReplies([unknownModel, signedOut]);
    const first = (await provider.run(spec()).catch((e: unknown) => e)) as ProviderError;
    expect(first).toMatchObject({
      kind: "unavailable_model",
      message: FAILURE_MESSAGES.unavailable_model,
    });
    expect(JSON.parse(first.detail!)).toMatchObject({
      api_error_status: 404,
      terminal_reason: "api_error",
    });
    await expect(provider.run(spec())).rejects.toMatchObject({
      kind: "sign_in",
      message: FAILURE_MESSAGES.sign_in,
    });
  });

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
  /**
   * A PATH folder holding an empty `claude` program file. Its extension is spelled as PATHEXT
   * spells it: Windows ignores the case, but these tests also run on Linux, which doesn't.
   */
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
    expect(await findClaude(pathWith("claude.CMD"), "win32")).toMatchObject({
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

  it("PLAT-03: a Claude Code that is found but can't start is a problem to explain, not an error", async () => {
    // A program file that isn't one: the system refuses to start it, on Windows and elsewhere.
    const env = pathWith(process.platform === "win32" ? "claude.exe" : "claude");
    const found = await findClaude(env);
    expect(found).toEqual({
      ok: false,
      problem: "broken",
      message: expect.stringMatching(
        /^Tessera found Claude Code at .+ but couldn't start it\. Reinstall Claude Code, or check that your account may run it, then try again\.$/,
      ) as unknown,
    });
    const denied = Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    const failsOn =
      (failing: string) =>
      (exe: string, args: readonly string[]): Promise<ProcessResult> =>
        args[0] === failing
          ? Promise.reject(denied)
          : answering("2.1.310 (Claude Code)", '{"loggedIn":true}')(exe, args);
    for (const failing of ["--version", "auth"]) {
      expect(await findClaude(pathWith("claude.exe"), "win32", failsOn(failing))).toMatchObject({
        ok: false,
        problem: "broken",
      });
    }
  });
});
