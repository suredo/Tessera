import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ProcessResult } from "../src/platform/index.ts";
import {
  atLeast,
  buildCodexArgs,
  CODEX_FAILURE_MESSAGES,
  codexInputText,
  createCodexProvider,
  findCodex,
  ProviderError,
  TESTED_CODEX_VERSION,
  versionOf,
  type StageSpec,
} from "../src/providers/index.ts";

// The Codex adapter's contract tests (TEST-02): the exact arguments, the environment, the working
// folder, output parsing, error mapping, usage and cancellation, against a fake codex program that
// records what it was given and answers with canned JSON-line events. It never reaches a model
// (ENG-11).

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "support", "fake-codex.ts");
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-codex-test-"));
  temps.push(dir);
  return dir;
};

const answer = z.strictObject({ title: z.string() });
const spec = (overrides: Partial<StageSpec<z.infer<typeof answer>>> = {}) => ({
  stage: "create" as const,
  system: "Make the tool the person asks for.",
  prompt: "I need a shopping list",
  schema: answer,
  model: "gpt-5.5",
  effort: "medium" as const,
  tools: "none" as const,
  timeLimitMs: 20_000,
  ...overrides,
});
const USAGE = {
  input_tokens: 1110,
  cached_input_tokens: 1000,
  cache_write_input_tokens: 0,
  output_tokens: 50,
  reasoning_output_tokens: 10,
};
/** A reply that answers, with the usage its turn.completed reports. */
const success = (value: unknown, usage: Record<string, number> = USAGE) => ({
  answer: value,
  usage,
});
const started = [{ type: "thread.started", thread_id: "t" }, { type: "turn.started" }];
const finalMessage = (text: string) => ({
  type: "item.completed",
  item: { id: "item_9", type: "agent_message", text },
});
const completed = (usage: Record<string, number> = USAGE) => ({ type: "turn.completed", usage });
/** A reply that fails the way Codex is assumed to: an error event, then a failed turn. */
const failed = (message: string) => ({
  _events: [...started, { type: "error", message }, { type: "turn.failed", error: { message } }],
  _exitCode: 1,
});

/** The adapter on the fake, with these replies; and what the fake was given, call by call. */
function withReplies(replies: unknown[], env: NodeJS.ProcessEnv = process.env) {
  const dir = tempDir();
  const repliesFile = path.join(dir, "replies.json");
  const calls = path.join(dir, "calls");
  fs.writeFileSync(repliesFile, JSON.stringify(replies));
  const provider = createCodexProvider({
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
                schema: string;
              },
          )
      : [];
  return { provider, made };
}

describe("arguments and environment (CLI-03, CLI-08, TEST-02)", () => {
  it("CLI-03: passes the locked flags exactly, with the wrapped draft-07 schema in a file, and the system prompt and request on standard input", async () => {
    const { provider, made } = withReplies([success({ title: "Shopping" })]);
    await provider.run(spec());
    const [call] = made();
    const folder = call!.args[call!.args.indexOf("-C") + 1]!;
    expect(call!.args).toEqual([
      "exec",
      "--json",
      "--output-schema",
      path.join(folder, "output-schema.json"),
      "-m",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="medium"',
      // Every feature that grants a tool, by name: written out, so none can drop silently.
      "--disable",
      "shell_tool",
      "--disable",
      "unified_exec",
      "--disable",
      "apps",
      "--disable",
      "plugins",
      "--disable",
      "remote_plugin",
      "--disable",
      "browser_use",
      "--disable",
      "browser_use_external",
      "--disable",
      "computer_use",
      "--disable",
      "image_generation",
      "--disable",
      "view_image",
      "--disable",
      "multi_agent",
      "--disable",
      "skill_search",
      "--disable",
      "tool_suggest",
      "--disable",
      "sleep_tool",
      "--disable",
      "hooks",
      "-s",
      "read-only",
      "-c",
      'approval_policy="never"',
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--skip-git-repo-check",
      "--color",
      "never",
      "-c",
      "tools.web_search=false",
      "-C",
      folder,
      "-",
    ]);
    // The schema file, as the fake read it while the call ran: wrapped, draft-07.
    expect(JSON.parse(call!.schema)).toMatchObject({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      required: ["answer"],
      properties: { answer: { type: "object", required: ["title"] } },
    });
    // The text on standard input: the system prompt, a separator, then the request.
    expect(call!.stdin).toBe(
      "Make the tool the person asks for.\n---\nThe request:\nI need a shopping list",
    );
    // Only research gets web search.
    expect(buildCodexArgs({ ...spec(), tools: "web" }, folder)).toContain("tools.web_search=true");
    expect(buildCodexArgs({ ...spec(), tools: "web" }, folder)).not.toContain(
      "tools.web_search=false",
    );
  });

  it("CLI-08: starts the CLI with only the allowlisted environment, in a fresh empty folder it removes", async () => {
    const env = {
      ...process.env,
      OPENAI_API_KEY: "would-bill-the-api",
      CODEX_HOME: "/elsewhere",
      CODEX_API_KEY: "x",
      CODEX_SANDBOX: "seatbelt",
      ANTHROPIC_API_KEY: "x",
      ANTHROPIC_BASE_URL: "http://elsewhere",
      CLAUDE_CODE_SIMPLE: "1",
      TESSERA_SECRET: "x",
    };
    const { provider, made } = withReplies([success({ title: "Shopping" })], env);
    await provider.run(spec());
    const [call] = made();
    for (const name of [
      "OPENAI_API_KEY",
      "CODEX_HOME",
      "CODEX_API_KEY",
      "CODEX_SANDBOX",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_SIMPLE",
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
  // On Windows the CLI can still hold its working folder after answering. Removal now failing must
  // change nothing about the call's result.
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
      const { provider } = withReplies([success({ title: "Shopping" })]);
      await expect(provider.run(spec())).resolves.toMatchObject({ value: { title: "Shopping" } });
      expect(held).toHaveBeenCalled();
    } finally {
      held.mockRestore();
    }
  });

  it("CLI-08: a failure keeps its kind, plain message and detail when the folder can't be removed", async () => {
    const held = withHeldFolders();
    try {
      const { provider } = withReplies([failed("Not logged in. Please run `codex login`")]);
      const error = (await provider.run(spec()).catch((e: unknown) => e)) as ProviderError;
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ kind: "sign_in", message: CODEX_FAILURE_MESSAGES.sign_in });
      expect(JSON.parse(error.detail!)).toMatchObject({
        message: "Not logged in. Please run `codex login`",
      });
    } finally {
      held.mockRestore();
    }
  });
});

describe("long requests (CLI-01)", () => {
  it("CLI-01: sends a request and a system prompt longer than Windows' command line allows, whole", async () => {
    const { provider, made } = withReplies([success({ title: "Long" })]);
    const prompt = "a".repeat(40_000);
    const system = "b".repeat(40_000);
    await expect(provider.run(spec({ prompt, system }))).resolves.toMatchObject({
      value: { title: "Long" },
    });
    const [call] = made();
    expect(call!.stdin).toBe(codexInputText({ system, prompt }));
    expect(call!.stdin).toBe(`${system}\n---\nThe request:\n${prompt}`);
    expect(call!.args.join(" ").length).toBeLessThan(32_000);
  });
});

describe("answers and usage (CLI-01, CLI-04)", () => {
  it("CLI-01: unwraps the answer and checks it against the stage's contract", async () => {
    const { provider } = withReplies([
      {
        _events: [
          ...started,
          // An earlier message is not the answer: the last one is.
          finalMessage("working on it"),
          finalMessage(JSON.stringify({ answer: { title: "Shopping" } })),
          completed(),
        ],
      },
    ]);
    const result = await provider.run(spec());
    expect(result.value).toEqual({ title: "Shopping" });
    expect(result.raw).toContain('"type":"turn.completed"');
  });

  it("CLI-04: takes input as Codex counts it, shows cached input apart, and keeps unknown parts unknown", async () => {
    const { provider } = withReplies([
      success({ title: "a" }),
      success({ title: "b" }, { cached_input_tokens: 5, output_tokens: 7 }),
      { _events: [...started, finalMessage(JSON.stringify({ answer: { title: "c" } }))] },
    ]);
    // Input already includes the cached input: it is not added again.
    const first = (await provider.run(spec())).usage;
    expect(first).toMatchObject({ inputTokens: 1110, cachedInputTokens: 1000, outputTokens: 50 });
    expect(first.durationMs).toBeGreaterThanOrEqual(0);
    // A missing part is unknown, never 0.
    expect((await provider.run(spec())).usage).toMatchObject({
      inputTokens: null,
      cachedInputTokens: 5,
      outputTokens: 7,
    });
  });

  it("CLI-04: a call that reports no usage at all gives only its own duration", async () => {
    const { provider } = withReplies([
      { _events: [...started, finalMessage(JSON.stringify({ answer: { title: "c" } }))] },
    ]);
    const { usage } = await provider.run(spec());
    expect(usage).toMatchObject({ inputTokens: null, cachedInputTokens: null, outputTokens: null });
    expect(usage.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("CLI-01: an answer that doesn't fit the contract is a schema failure, with what the call cost", async () => {
    const { provider } = withReplies([success({ name: "not a title" })]);
    const error = await provider.run(spec()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      kind: "schema",
      usage: { inputTokens: 1110, outputTokens: 50 },
      detail: undefined,
    });
    // The answer as it came, unchecked, for the ledger to keep its code (GEN-10).
    expect((error as ProviderError).answer).toEqual({ name: "not a title" });
  });

  it("CLI-01: no final message, or text that isn't JSON, is a schema failure with what it said", async () => {
    const { provider } = withReplies([
      { _events: [...started, completed()] },
      { _events: [...started, finalMessage("Sorry, here is prose."), completed()] },
    ]);
    await expect(provider.run(spec())).rejects.toMatchObject({
      kind: "schema",
      usage: { outputTokens: 50 },
    });
    await expect(provider.run(spec())).rejects.toMatchObject({
      kind: "schema",
      detail: "Sorry, here is prose.",
    });
  });
});

describe("error mapping (CLI-05)", () => {
  const cases: [string, object][] = [
    ["sign_in", failed("Not logged in. Please run `codex login`")],
    ["usage_limit", failed("You've hit your usage limit. Try again later.")],
    [
      "unavailable_model",
      failed("The model gpt-x does not exist or you do not have access to it."),
    ],
    ["unsupported_effort", failed("Reasoning effort 'xhigh' is not supported by this model")],
  ];
  for (const [kind, reply] of cases) {
    it(`CLI-05: maps a ${kind} failure to its plain message, and keeps the CLI's words`, async () => {
      const { provider } = withReplies([reply]);
      const error = (await provider.run(spec()).catch((e: unknown) => e)) as ProviderError;
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.kind).toBe(kind);
      // The person reads only the plain sentence; the CLI's words are kept apart, for the ledger.
      expect(error.message).toBe(
        CODEX_FAILURE_MESSAGES[kind as keyof typeof CODEX_FAILURE_MESSAGES],
      );
      expect(error.message).not.toMatch(/codex-cli|turn\.failed|rate_limit/);
      expect(JSON.parse(error.detail!)).toMatchObject({ type: "turn.failed" });
    });
  }

  it("CLI-05: reads an error event with no failed turn after it, and a failed turn's error text", async () => {
    const { provider } = withReplies([
      { _events: [...started, { type: "error", message: "401 Unauthorized" }], _exitCode: 1 },
      {
        _events: [...started, { type: "turn.failed", error: { message: "429 Too Many Requests" } }],
      },
    ]);
    await expect(provider.run(spec())).rejects.toMatchObject({ kind: "sign_in" });
    await expect(provider.run(spec())).rejects.toMatchObject({ kind: "usage_limit" });
  });

  it("CLI-05: a notice before a completed turn is not a failure", async () => {
    const { provider } = withReplies([
      {
        _events: [
          ...started,
          { type: "error", message: "Reconnecting... 1/5" },
          finalMessage(JSON.stringify({ answer: { title: "Shopping" } })),
          completed(),
        ],
      },
    ]);
    await expect(provider.run(spec())).resolves.toMatchObject({ value: { title: "Shopping" } });
  });

  it("CLI-05: a failure it can't name, or output that isn't events, is an error, not a guess", async () => {
    const unknown = withReplies([failed("Something new went wrong")]);
    const one = await unknown.provider.run(spec()).catch((e: unknown) => e);
    expect(one).not.toBeInstanceOf(ProviderError);
    expect((one as Error).message).toMatch(/^The Codex CLI failed in an unexpected way/);
    expect((one as Error).message).toContain("Something new went wrong");
    const garbled = withReplies([{ _stdout: "not json", _exitCode: 1 }]);
    const two = await garbled.provider.run(spec()).catch((e: unknown) => e);
    expect(two).not.toBeInstanceOf(ProviderError);
    expect((two as Error).message).toMatch(/no events \(exit 1\): not json/);
    // A non-zero exit after events that name no failure is an error too.
    const silent = withReplies([{ _events: [...started], _exitCode: 3 }]);
    const three = await silent.provider.run(spec()).catch((e: unknown) => e);
    expect(three).not.toBeInstanceOf(ProviderError);
    expect((three as Error).message).toMatch(/exit 3/);
  });
});

describe("time limit and cancellation (CLI-01, CLI-06)", () => {
  it("CLI-01: stops a call at its time limit", async () => {
    const { provider } = withReplies([{ ...success({ title: "late" }), _delayMs: 10_000 }]);
    await expect(provider.run(spec({ timeLimitMs: 500 }))).rejects.toMatchObject({
      kind: "time_limit",
    });
  });

  it("CLI-06: a cancel stops the running call, and a call cancelled before it starts never runs", async () => {
    const slow = withReplies([{ ...success({ title: "late" }), _delayMs: 10_000 }]);
    const controller = new AbortController();
    const startedAt = Date.now();
    const running = slow.provider.run(spec({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 300);
    await expect(running).rejects.toMatchObject({ kind: "cancelled" });
    expect(Date.now() - startedAt).toBeLessThan(8000);

    const never = withReplies([success({ title: "x" })]);
    await expect(never.provider.run(spec({ signal: AbortSignal.abort() }))).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(never.made()).toEqual([]);
  });
});

describe("finding Codex (CLI-02, PLAT-03)", () => {
  const answering =
    (version: string, login: string) =>
    (_exe: string, args: readonly string[]): Promise<ProcessResult> =>
      Promise.resolve({
        exitCode: 0,
        stdout: args[0] === "--version" ? version : login,
        stderr: "",
        timedOut: false,
        cancelled: false,
      });
  /**
   * A PATH folder holding an empty `codex` program file. Its extension is spelled as PATHEXT
   * spells it: Windows ignores the case, but these tests also run on Linux, which doesn't.
   */
  const pathWith = (file: string) => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, file), "");
    fs.chmodSync(path.join(dir, file), 0o755);
    return { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  };

  it("CLI-02: reads the version, and compares versions as numbers", () => {
    expect(versionOf("codex-cli 0.166.0")).toBe("0.166.0");
    expect(atLeast("0.170.2", TESTED_CODEX_VERSION)).toBe(true);
    expect(atLeast("0.166.0", "0.166.0")).toBe(true);
    expect(atLeast("0.99.0", "0.166.0")).toBe(false);
    expect(atLeast("1.0.0", "0.999.999")).toBe(true);
  });

  it("CLI-02: says plainly when Codex is missing, or only npm's batch file is found", async () => {
    expect(await findCodex({ PATH: tempDir() }, "win32")).toMatchObject({
      ok: false,
      problem: "missing",
    });
    expect(await findCodex(pathWith("codex.CMD"), "win32")).toMatchObject({
      ok: false,
      problem: "batch-file",
      message: expect.stringContaining("codex.exe") as unknown,
    });
  });

  it("CLI-02: refuses a version older than the tested one, and checks sign-in without a model call", async () => {
    const env = pathWith("codex.exe");
    expect(await findCodex(env, "win32", answering("codex-cli 0.100.0", ""))).toMatchObject({
      ok: false,
      problem: "old",
    });
    expect(
      await findCodex(env, "win32", answering("codex-cli 0.166.0", "Not logged in")),
    ).toMatchObject({ ok: false, problem: "signed-out", message: CODEX_FAILURE_MESSAGES.sign_in });
    expect(
      await findCodex(env, "win32", answering("codex-cli 0.166.0", "Logged in using ChatGPT")),
    ).toMatchObject({
      ok: true,
      version: "0.166.0",
      executable: expect.stringMatching(/codex\.exe$/i) as unknown,
    });
  });

  it("PLAT-03: a Codex that is found but can't start is a problem to explain, not an error", async () => {
    // A program the system refuses to start: on Windows a file that isn't a program; elsewhere a
    // script naming an interpreter that doesn't exist (an empty file would run through sh there).
    const dir = tempDir();
    const file = path.join(dir, process.platform === "win32" ? "codex.exe" : "codex");
    fs.writeFileSync(file, process.platform === "win32" ? "" : "#!/nonexistent/tessera-test\n");
    fs.chmodSync(file, 0o755);
    const found = await findCodex({ PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" });
    expect(found).toEqual({
      ok: false,
      problem: "broken",
      message: expect.stringMatching(
        /^Tessera found Codex at .+ but couldn't start it\. Reinstall Codex, or check that your account may run it, then try again\.$/,
      ) as unknown,
    });
  });

  it("PLAT-03: a start refused on the version or the sign-in check is a problem to explain", async () => {
    const denied = Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    const failsOn =
      (failing: string) =>
      (exe: string, args: readonly string[]): Promise<ProcessResult> =>
        args[0] === failing
          ? Promise.reject(denied)
          : answering("codex-cli 0.166.0", "Logged in using ChatGPT")(exe, args);
    for (const failing of ["--version", "login"]) {
      expect(await findCodex(pathWith("codex.exe"), "win32", failsOn(failing))).toMatchObject({
        ok: false,
        problem: "broken",
      });
    }
  });
});
