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
  codexHome,
  codexLaunch,
  codexSignInCommand,
  MODEL_CATALOG_FILE,
  ProviderError,
  restrictCatalog,
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
/** A small bundled catalog, shaped as `codex debug models --bundled` prints it. */
const BUNDLED = JSON.stringify({
  models: [
    {
      slug: "gpt-5.5",
      apply_patch_tool_type: "freeform",
      experimental_supported_tools: [],
      supports_search_tool: true,
      include_skills_usage_instructions: true,
      include_plugin_usage_instructions: true,
      include_apps_usage_instructions: true,
      context_window: 272000,
    },
    {
      slug: "gpt-6-sol",
      apply_patch_tool_type: "freeform",
      experimental_supported_tools: ["send_user_message_async", "clock"],
      supports_search_tool: true,
      tool_mode: "code_mode_only",
    },
  ],
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
  // Tessera's Codex home folder, as the setup check leaves it: a restricted catalog, nothing else.
  const home = path.join(dir, "codex-home");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, MODEL_CATALOG_FILE), JSON.stringify(restrictCatalog(BUNDLED)));
  fs.writeFileSync(repliesFile, JSON.stringify(replies));
  const provider = createCodexProvider({
    executable: process.execPath,
    leadingArgs: [fake, repliesFile, calls],
    live: false,
    home,
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
                codexHome: string | undefined;
                stdin: string;
                schema: string;
                instructions: string;
              },
          )
      : [];
  return { provider, made, home };
}

describe("arguments and environment (CLI-03, CLI-08, TEST-02)", () => {
  it("CLI-03: passes the locked flags exactly, with the wrapped draft-07 schema in a file, and the system prompt and request on standard input", async () => {
    const { provider, made, home } = withReplies([success({ title: "Shopping" })]);
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
      "--disable",
      "goals",
      "--disable",
      "current_time_reminder",
      "--disable",
      "deferred_executor",
      "--disable",
      "request_permissions_tool",
      "--disable",
      "send_message_to_user_async",
      "--disable",
      "token_budget",
      // What no feature switch reaches, and no instructions but the stage's.
      "-c",
      "tools.experimental_request_user_input.enabled=false",
      "-c",
      "tools.update_plan.enabled=false",
      "-c",
      "agents.enabled=false",
      "-c",
      "cloud.skills.enabled=false",
      "-c",
      "skills.include_instructions=false",
      "-c",
      "project_root_markers=[]",
      "-c",
      "project_doc_max_bytes=0",
      "-c",
      "include_permissions_instructions=false",
      "-c",
      "include_apps_instructions=false",
      "-c",
      "include_collaboration_mode_instructions=false",
      "-c",
      "include_environment_context=false",
      "-c",
      `model_instructions_file=${JSON.stringify(path.join(folder, "instructions.md"))}`,
      "-c",
      `model_catalog_json=${JSON.stringify(path.join(home, "tessera-models.json"))}`,
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
      'web_search="disabled"',
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
    // The request alone on standard input; the system prompt in its own file, replacing the model's.
    expect(call!.stdin).toBe("I need a shopping list");
    expect(call!.instructions).toBe("Make the tool the person asks for.");
    // Only research gets web search, live.
    expect(buildCodexArgs({ ...spec(), tools: "web" }, folder, home)).toContain(
      'web_search="live"',
    );
    expect(buildCodexArgs({ ...spec(), tools: "web" }, folder, home)).not.toContain(
      'web_search="disabled"',
    );
  });

  it("CLI-08: starts the CLI with only the allowlisted environment and Tessera's own Codex home, in a fresh empty folder it removes", async () => {
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
    const { provider, made, home } = withReplies([success({ title: "Shopping" })], env);
    await provider.run(spec());
    const [call] = made();
    // The person's own CODEX_HOME is replaced by Tessera's.
    expect(call!.codexHome).toBe(home);
    for (const name of [
      "OPENAI_API_KEY",
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

describe("Tessera's Codex home folder (CLI-03, CLI-08)", () => {
  it("CLI-03: the catalog takes out every tool a model's metadata adds, and keeps the rest", () => {
    const { models } = restrictCatalog(BUNDLED);
    expect(models.map((model) => model.slug)).toEqual(["gpt-5.5", "gpt-6-sol"]);
    for (const model of models) {
      expect(model).toMatchObject({
        apply_patch_tool_type: null,
        experimental_supported_tools: [],
        supports_search_tool: false,
        include_skills_usage_instructions: false,
        include_plugin_usage_instructions: false,
        include_apps_usage_instructions: false,
      });
      expect(model).not.toHaveProperty("tool_mode");
    }
    expect(models[0]).toHaveProperty("context_window", 272000);
    expect(() => restrictCatalog('{"models":[]}')).toThrow();
    expect(() => restrictCatalog("not json")).toThrow();
  });

  it("CLI-08: never calls without the catalog, or with an instructions file in the home folder", async () => {
    for (const ready of [
      (home: string) => fs.rmSync(path.join(home, MODEL_CATALOG_FILE)),
      (home: string) => fs.writeFileSync(path.join(home, "AGENTS.md"), "Always answer in French."),
      (home: string) => fs.writeFileSync(path.join(home, "AGENTS.override.md"), "x"),
    ]) {
      const { provider, made, home } = withReplies([success({ title: "Shopping" })]);
      ready(home);
      await expect(provider.run(spec())).rejects.toThrow(/setup check/);
      expect(made()).toHaveLength(0);
    }
  });

  it("CLI-08: the sign-in command is quoted for the terminal each platform opens", () => {
    expect(codexSignInCommand("C:\\Users\\o'neil\\Tessera\\codex", "win32")).toBe(
      "$env:CODEX_HOME = 'C:\\Users\\o''neil\\Tessera\\codex'; codex login",
    );
    expect(codexSignInCommand("/home/o'neil/tessera/codex", "linux")).toBe(
      "CODEX_HOME='/home/o'\\''neil/tessera/codex' codex login",
    );
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
    expect(call!.stdin).toBe(codexInputText({ prompt }));
    expect(call!.stdin).toBe(prompt);
    expect(call!.instructions).toBe(system);
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
    // As Codex 0.166.0 said it in the probe (#266), for a model a ChatGPT sign-in can't use.
    [
      "unavailable_model",
      failed("The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account."),
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
  /** Codex answering the version, `login status` (on stderr, as Codex prints it) and the catalog. */
  const answering =
    (version: string, login: string, models: ProcessResult | string = BUNDLED) =>
    (_exe: string, all: readonly string[]): Promise<ProcessResult> => {
      // npm's launcher script, when Codex is started through it, comes before Codex's own arguments.
      const args = all[0]?.endsWith(".js") ? all.slice(1) : all;
      if (args[0] === "debug" && typeof models !== "string") return Promise.resolve(models);
      const said = { "--version": version, debug: models }[args[0] ?? ""];
      return Promise.resolve({
        exitCode: 0,
        stdout: typeof said === "string" ? said : "",
        stderr: args[0] === "login" ? login : "",
        timedOut: false,
        cancelled: false,
      });
    };
  const signedIn = answering("codex-cli 0.166.0", "Logged in using ChatGPT");
  const home = () => path.join(tempDir(), "codex");
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
    expect(await findCodex(home(), { PATH: tempDir() }, "win32")).toMatchObject({
      ok: false,
      problem: "missing",
    });
    expect(await findCodex(home(), pathWith("codex.CMD"), "win32")).toMatchObject({
      ok: false,
      problem: "batch-file",
      message: expect.stringContaining("codex.exe") as unknown,
    });
  });

  it("CLI-02, PLAT-03: npm's codex.cmd is started through the launcher script beside it, with Node", async () => {
    const env = pathWith("codex.cmd");
    const script = path.join(env.PATH, "node_modules", "@openai", "codex", "bin", "codex.js");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, "");
    const started: string[][] = [];
    const recording = (exe: string, args: readonly string[]) => {
      started.push([exe, ...args]);
      return signedIn(exe, args);
    };
    expect(await findCodex(home(), env, "win32", recording)).toEqual({
      ok: true,
      executable: script,
      version: "0.166.0",
    });
    // Every check starts Node with the script; nothing starts the batch file.
    expect(started.map(([exe, first]) => [exe, first])).toEqual([
      [process.execPath, script],
      [process.execPath, script],
      [process.execPath, script],
    ]);
    // And so does every call, through the adapter.
    expect(codexLaunch(script)).toEqual({ executable: process.execPath, leadingArgs: [script] });
    expect(codexLaunch("C:\\Tools\\codex.exe")).toEqual({
      executable: "C:\\Tools\\codex.exe",
      leadingArgs: [],
    });
  });

  it("CLI-08: Tessera's Codex home folder is one per account, outside every data folder, and tests can move it", () => {
    expect(codexHome({ LOCALAPPDATA: "C:\\Users\\o\\AppData\\Local" }, "win32")).toBe(
      path.join("C:\\Users\\o\\AppData\\Local", "Tessera", "codex-home"),
    );
    expect(codexHome({ XDG_DATA_HOME: "/home/o/.local/share" }, "linux")).toBe(
      path.join("/home/o/.local/share", "Tessera", "codex-home"),
    );
    const moved = tempDir();
    expect(codexHome({ TESSERA_CODEX_HOME: moved }, "win32")).toBe(path.resolve(moved));
  });

  it("CLI-02: refuses a version older than the tested one, and checks sign-in without a model call", async () => {
    const env = pathWith("codex.exe");
    expect(await findCodex(home(), env, "win32", answering("codex-cli 0.100.0", ""))).toMatchObject(
      { ok: false, problem: "old" },
    );
    const folder = home();
    const signIn = codexSignInCommand(folder, "win32");
    expect(
      await findCodex(folder, env, "win32", answering("codex-cli 0.166.0", "Not logged in")),
    ).toEqual({
      ok: false,
      problem: "signed-out",
      message: `Codex isn't signed in for Tessera, which keeps a Codex sign-in of its own. Open a terminal, run \`${signIn}\`, sign in with your ChatGPT account, then try again.`,
    });
    // Signed in with an API key: billed apart from the plan, so refused (CLI-02).
    expect(
      await findCodex(
        folder,
        env,
        "win32",
        answering("codex-cli 0.166.0", "Logged in using an API key - sk-***"),
      ),
    ).toMatchObject({
      ok: false,
      problem: "signed-out",
      message: expect.stringContaining("some other way than a ChatGPT account") as unknown,
    });
    expect(await findCodex(folder, env, "win32", signedIn)).toMatchObject({
      ok: true,
      version: "0.166.0",
      executable: expect.stringMatching(/codex\.exe$/i) as unknown,
    });
  });

  it("CLI-08: checks and readies Tessera's own Codex folder, with Codex pointed at it", async () => {
    const env = { ...pathWith("codex.exe"), CODEX_HOME: "/the-person's-own" };
    const folder = home();
    const seen: { args: readonly string[]; codexHome: string | undefined }[] = [];
    const recording = (
      exe: string,
      args: readonly string[],
      options: { env?: NodeJS.ProcessEnv },
    ) => {
      seen.push({ args, codexHome: options.env?.CODEX_HOME });
      return signedIn(exe, args);
    };
    expect(await findCodex(folder, env, "win32", recording as typeof signedIn)).toMatchObject({
      ok: true,
    });
    // The folder is made, and the catalog written there is the restricted one.
    expect(JSON.parse(fs.readFileSync(path.join(folder, MODEL_CATALOG_FILE), "utf8"))).toEqual(
      restrictCatalog(BUNDLED),
    );
    // Sign-in and the catalog are read from Tessera's folder, never the person's own.
    expect(seen.map(({ args }) => args.join(" "))).toEqual([
      "--version",
      "login status",
      "debug models --bundled",
    ]);
    expect(seen.slice(1).map(({ codexHome }) => codexHome)).toEqual([folder, folder]);
    // An instructions file there is reported, never deleted, and nothing more is asked of Codex.
    fs.writeFileSync(path.join(folder, "AGENTS.md"), "Always answer in French.");
    expect(await findCodex(folder, env, "win32", signedIn)).toMatchObject({
      ok: false,
      problem: "broken",
      message: expect.stringContaining("AGENTS.md") as unknown,
    });
    expect(fs.existsSync(path.join(folder, "AGENTS.md"))).toBe(true);
  });

  it("CLI-03: a catalog Codex can't give, or that isn't one, is a problem to explain", async () => {
    const env = pathWith("codex.exe");
    const failedRun = {
      exitCode: 1,
      stdout: "",
      stderr: "boom",
      timedOut: false,
      cancelled: false,
    };
    for (const models of [failedRun, "not json", '{"models":[]}']) {
      const folder = home();
      expect(
        await findCodex(
          folder,
          env,
          "win32",
          answering("codex-cli 0.166.0", "Logged in using ChatGPT", models),
        ),
      ).toMatchObject({
        ok: false,
        problem: "broken",
        message: expect.stringContaining("list of models") as unknown,
      });
      expect(fs.existsSync(path.join(folder, MODEL_CATALOG_FILE))).toBe(false);
    }
  });

  it("PLAT-03: a Codex that is found but can't start is a problem to explain, not an error", async () => {
    // A program the system refuses to start: on Windows a file that isn't a program; elsewhere a
    // script naming an interpreter that doesn't exist (an empty file would run through sh there).
    const dir = tempDir();
    const file = path.join(dir, process.platform === "win32" ? "codex.exe" : "codex");
    fs.writeFileSync(file, process.platform === "win32" ? "" : "#!/nonexistent/tessera-test\n");
    fs.chmodSync(file, 0o755);
    const found = await findCodex(home(), { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" });
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
        args[0] === failing ? Promise.reject(denied) : signedIn(exe, args);
    for (const failing of ["--version", "login", "debug"]) {
      expect(
        await findCodex(home(), pathWith("codex.exe"), "win32", failsOn(failing)),
      ).toMatchObject({
        ok: false,
        problem: "broken",
      });
    }
  });
});
