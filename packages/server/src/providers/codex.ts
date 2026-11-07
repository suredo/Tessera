import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jsonSchemaOf, type ProviderErrorKind, type Usage } from "@tessera/contracts";
import { z } from "zod";
import { findExecutable, runProcess } from "../platform/index.ts";
import {
  ANSWER_KEY,
  atLeast,
  cleanEnvironment,
  removeFolder,
  versionOf,
  wrapSchema,
  type ClaudeStatus,
} from "./claude.ts";
import { ProviderError, type Provider, type StageResult, type StageSpec } from "./provider.ts";

// The Codex CLI adapter (CLI-01): the second implementation of the provider interface, mirroring
// the Claude Code adapter as closely as the two programs allow. Every model call goes through
// `codex exec` with the locked flags below (CLI-03), from the same clean environment and a fresh
// empty folder (CLI-08), and the events it prints are read for usage (CLI-04) and failures
// (CLI-05) before the host checks the answer. The environment allowlist, schema wrapping, folder
// removal and version helpers are the Claude adapter's own, imported so each has one definition (P3).
//
// What Codex 0.166.0's source settles (read at the tag rust-v0.166.0): web search is the top-level
// `web_search` mode, cached unless set; `model_instructions_file` replaces the model's own
// instructions; the settings in LOCKED_SETTINGS take away what no feature switch reaches.
//
// Two things no setting reaches, closed as the owner chose (#266):
// - Codex reads the global AGENTS.md (or AGENTS.override.md) in its home folder in every call. So
//   Tessera gives Codex a home folder of its own, with its own sign-in, and refuses to start while
//   such a file is in it (CLI-08). `codex debug prompt-input` showed that with the locked settings
//   that file is the only thing besides the request that reaches the model.
// - The model's metadata adds tools whatever is disabled: `apply_patch` (file editing) for every
//   model, and code-mode and clock tools for some. So each call is given its own catalog of
//   models, `model_catalog_json`, built from the installed Codex's bundled one with those taken
//   out (`restrictCatalog`, CLI-03).
//
// Open until the first approved live calls: whether `--output-schema` takes the wrapped schema;
// whether `input_tokens` includes cached input and `output_tokens` the reasoning (assumed, so
// nothing is added); the shapes of failures (see `codexFailureKind`); and that a real call is
// offered no tool with these flags and this catalog.

/** The version the locked flags were tested on. An older codex is refused. */
export const TESTED_CODEX_VERSION = "0.166.0";

/**
 * The features that give the model a tool, all disabled in every stage (CLI-03): running commands,
 * apps and plugins, a browser or the computer, images, other agents, skills and tool suggestions.
 * From `codex features list` at the tested version; the read-only sandbox stays as a second layer.
 */
export const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "remote_plugin",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "image_generation",
  "view_image",
  "multi_agent",
  "skill_search",
  "tool_suggest",
  "sleep_tool",
  "hooks",
  "goals",
  // Off by default at the tested version, still in development; each would add a tool.
  "current_time_reminder",
  "deferred_executor",
  "request_permissions_tool",
  "send_message_to_user_async",
  "token_budget",
] as const;

/**
 * Settings that take away what no feature switch reaches, and keep out instructions that aren't
 * the stage's (CLI-03, CLI-08), as `-c key=value`, read from Codex 0.166.0's source: the tool that
 * asks the person for input, sub-agents whatever the model says, cloud skills, project instruction
 * files above or in the folder, and Codex's own notes on permissions, apps, modes and environment.
 */
export const LOCKED_SETTINGS = [
  "tools.experimental_request_user_input.enabled=false",
  "tools.update_plan.enabled=false",
  "agents.enabled=false",
  "cloud.skills.enabled=false",
  "skills.include_instructions=false",
  "project_root_markers=[]",
  "project_doc_max_bytes=0",
  "include_permissions_instructions=false",
  "include_apps_instructions=false",
  "include_collaboration_mode_instructions=false",
  "include_environment_context=false",
] as const;

/** The stage's system prompt, in the call's folder; it replaces the model's own instructions. */
export const INSTRUCTIONS_FILE = "instructions.md";

/** The restricted catalog of models, in Tessera's Codex home folder, written by `findCodex`. */
export const MODEL_CATALOG_FILE = "tessera-models.json";

/** The files Codex reads from its home folder as instructions for every call (CLI-08). */
export const HOME_INSTRUCTION_FILES = ["AGENTS.override.md", "AGENTS.md"] as const;

const catalogSchema = z.looseObject({
  models: z.array(z.looseObject({ slug: z.string() })).min(1),
});

/**
 * The catalog given to every call (CLI-03): the installed Codex's bundled catalog
 * (`codex debug models --bundled`) with what adds a tool taken out of each model. The file
 * editing tool and the extra tools the metadata names are removed, and so is code mode, which
 * hands the model its tools through a script. Search tooling is marked unsupported, and Codex's
 * notes on skills, plugins and apps are left out. Throws when the text isn't a catalog.
 */
export function restrictCatalog(bundled: string): { models: Record<string, unknown>[] } {
  const catalog = catalogSchema.parse(JSON.parse(bundled));
  return {
    models: catalog.models.map((model) => {
      const restricted: Record<string, unknown> = {
        ...model,
        apply_patch_tool_type: null,
        experimental_supported_tools: [],
        supports_search_tool: false,
        include_skills_usage_instructions: false,
        include_plugin_usage_instructions: false,
        include_apps_usage_instructions: false,
      };
      delete restricted.tool_mode;
      return restricted;
    }),
  };
}

/**
 * The command that signs Codex in for Tessera alone: `codex login` with Tessera's home folder,
 * written for the terminal the platform opens (PowerShell on Windows).
 */
export const codexSignInCommand = (home: string, platform: NodeJS.Platform): string =>
  platform === "win32"
    ? `$env:CODEX_HOME = '${home.replaceAll("'", "''")}'; codex login`
    : `CODEX_HOME='${home.replaceAll("'", `'\\''`)}' codex login`;

/** Where the answer's JSON Schema is written, in the call's own empty working folder. */
export const OUTPUT_SCHEMA_FILE = "output-schema.json";

/**
 * What goes on standard input: the request alone. The system prompt goes in `INSTRUCTIONS_FILE`,
 * given as `model_instructions_file`, which replaces the model's own instructions.
 */
export const inputText = (spec: Pick<StageSpec<unknown>, "prompt">): string => spec.prompt;

/**
 * The locked flags of a stage (CLI-03), in this order. The text goes on standard input (`-`), so
 * it does not count toward the command line's limit, about 32,000 characters on Windows. `folder`
 * is the call's own empty working folder, where the schema file was written; `home` is Tessera's
 * Codex home folder, where the restricted catalog is.
 */
export function buildArgs(spec: StageSpec<unknown>, folder: string, home: string): string[] {
  return [
    // The non-interactive command: one request in, one answer out.
    "exec",
    // Events as JSON lines on standard output, which the adapter reads for the answer and usage.
    "--json",
    // The answer's shape, as a file in the call's folder; the contract's draft-07 schema, wrapped
    // as `{ answer: <contract> }` exactly as for Claude, since a non-object root is not known to work.
    "--output-schema",
    path.join(folder, OUTPUT_SCHEMA_FILE),
    // The stage's model, from the routing table.
    "-m",
    spec.model,
    // The stage's effort, as a TOML string value.
    "-c",
    `model_reasoning_effort="${spec.effort}"`,
    // No tool of any kind (CLI-03): each feature that grants one is disabled by name.
    ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    // What no feature switch reaches, and no instructions but the stage's.
    ...LOCKED_SETTINGS.flatMap((setting) => ["-c", setting]),
    // The stage's system prompt replaces the model's own instructions, as Claude's file does.
    "-c",
    `model_instructions_file=${JSON.stringify(path.join(folder, INSTRUCTIONS_FILE))}`,
    // The models as Tessera restricted them: no tool comes from a model's own metadata.
    "-c",
    `model_catalog_json=${JSON.stringify(path.join(home, MODEL_CATALOG_FILE))}`,
    // And should a tool remain, it may not write files: the sandbox is read-only.
    "-s",
    "read-only",
    // Never stop to ask for approval, which nobody is there to give.
    "-c",
    'approval_policy="never"',
    // Not the person's own config file: its profiles, MCP servers and model settings are not ours.
    "--ignore-user-config",
    // Not the person's own rules files.
    "--ignore-rules",
    // Leave no session on disk.
    "--ephemeral",
    // The working folder is a new empty folder, not a repository.
    "--skip-git-repo-check",
    // No colour codes in anything the CLI prints.
    "--color",
    "never",
    // Only research gets web search, live; every other stage none (CLI-03). Codex's default is
    // cached search, so it is always set.
    "-c",
    `web_search="${spec.tools === "web" ? "live" : "disabled"}"`,
    // Work in the call's own empty folder (CLI-08).
    "-C",
    folder,
    // Read the text from standard input.
    "-",
  ];
}

/** The parts of one event the adapter reads. The rest stays in the raw output. */
const eventSchema = z.looseObject({
  type: z.string(),
  message: z.string().optional(),
  error: z.union([z.string(), z.looseObject({ message: z.string().optional() })]).optional(),
  item: z.looseObject({ type: z.string().optional(), text: z.string().optional() }).optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      cached_input_tokens: z.number().optional(),
      cache_write_input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      reasoning_output_tokens: z.number().optional(),
    })
    .optional(),
});
export type CodexEvent = z.infer<typeof eventSchema>;

/** The events on standard output, one JSON object per line; any other line is ignored. */
export function parseEvents(stdout: string): CodexEvent[] {
  const events: CodexEvent[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = eventSchema.safeParse(JSON.parse(line));
      if (event.success) events.push(event.data);
    } catch {
      // Not an event.
    }
  }
  return events;
}

/**
 * Usage from the last `turn.completed` (CLI-04). Codex's `input_tokens` is taken to include the
 * cached input and the cache writes, so nothing is added to it; its `output_tokens` to include the
 * reasoning tokens. The CLI reports no duration, so the adapter's own is given. A missing number
 * is unknown, never 0.
 */
export function toUsage(events: readonly CodexEvent[], durationMs: number): Usage {
  const usage = events.findLast((event) => event.type === "turn.completed")?.usage;
  return {
    inputTokens: usage?.input_tokens ?? null,
    cachedInputTokens: usage?.cached_input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    durationMs,
  };
}

/** What the person reads for each failure (CLI-05, GEN-12): plain, and with what to do. */
export const CODEX_FAILURE_MESSAGES: Record<ProviderErrorKind, string> = {
  sign_in:
    "Codex isn't signed in for Tessera, which keeps a Codex sign-in of its own. Tessera's setup check shows how to sign in; then try again.",
  usage_limit:
    "Your Codex plan's usage limit is reached for now. Try again when it resets; nothing was changed.",
  unavailable_model: "The model chosen for this step isn't available to your Codex plan.",
  unsupported_effort: "The model chosen for this step doesn't take the effort level set for it.",
  schema: "The answer didn't have the shape Tessera asked for.",
  turn_limit: "The answer took more steps than allowed, so it was stopped.",
  time_limit: "The answer took too long, so it was stopped.",
  cancelled: "Stopped, as asked.",
};

/** The words of a failure event: its message, or its error's. */
const failureText = (event: CodexEvent): string =>
  event.message ?? (typeof event.error === "string" ? event.error : (event.error?.message ?? ""));

/**
 * Which failure an `error` or `turn.failed` event is, read from its words (the shapes are not
 * captured yet, so there is no structured field to read first). A wording it doesn't know is
 * undefined: a crash to look into, never a guess.
 */
export function codexFailureKind(text: string): ProviderErrorKind | undefined {
  const lower = text.toLowerCase();
  if (/log ?in|authenticat|sign.?in|not logged|unauthori[sz]ed|\b401\b/.test(lower)) {
    return "sign_in";
  }
  if (/usage limit|rate limit|limit reached|too many requests|\b429\b/.test(lower)) {
    return "usage_limit";
  }
  if (/effort/.test(lower) && /not supported|unsupported|invalid|not available/.test(lower)) {
    return "unsupported_effort";
  }
  if (
    /model/.test(lower) &&
    /not found|not available|unsupported|invalid|unknown|does not exist|no access/.test(lower)
  ) {
    return "unavailable_model";
  }
  return undefined;
}

const clip = (text: string) => text.slice(0, 2000);
const unexpected = (what: string) =>
  new Error(`The Codex CLI failed in an unexpected way: ${clip(what)}`);

const wrappedAnswer = z.object({ [ANSWER_KEY]: z.unknown() });

export type CodexOptions = {
  /** The absolute path of the program to start: the real codex.exe, or node for the fake. */
  executable: string;
  /** Arguments that come before the CLI's own, such as the fake's script and reply files. */
  leadingArgs?: string[];
  /** True only for the real CLI. */
  live: boolean;
  /** Tessera's own Codex home folder (CLI-08), checked and given its catalog by `findCodex`. */
  home: string;
  env?: NodeJS.ProcessEnv;
};

/** The clean environment, with Codex pointed at Tessera's own home folder (CLI-08). */
const codexEnvironment = (env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv => ({
  ...cleanEnvironment(env),
  CODEX_HOME: home,
});

/** The Codex adapter for the program given; see `findCodex` for the real one. */
export function createCodexProvider(options: CodexOptions): Provider {
  const run = async <T>(spec: StageSpec<T>): Promise<StageResult<T>> => {
    if (spec.signal?.aborted) {
      throw new ProviderError("cancelled", CODEX_FAILURE_MESSAGES.cancelled);
    }
    // Never a call without the restricted catalog, or with instructions in the home folder.
    if (!fs.existsSync(path.join(options.home, MODEL_CATALOG_FILE))) {
      throw new Error("Tessera's Codex folder isn't ready: run the setup check first.");
    }
    const homeInstructions = HOME_INSTRUCTION_FILES.find((file) =>
      fs.existsSync(path.join(options.home, file)),
    );
    if (homeInstructions !== undefined) {
      throw new Error(
        `Tessera's Codex folder has ${homeInstructions}, which would reach every call; run the setup check.`,
      );
    }
    // A new, empty working folder outside the repository for every call (CLI-08).
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-cli-"));
    try {
      fs.writeFileSync(path.join(cwd, INSTRUCTIONS_FILE), spec.system, "utf8");
      fs.writeFileSync(
        path.join(cwd, OUTPUT_SCHEMA_FILE),
        JSON.stringify(wrapSchema(jsonSchemaOf(spec.schema))),
        "utf8",
      );
      const started = Date.now();
      const result = await runProcess(
        options.executable,
        [...(options.leadingArgs ?? []), ...buildArgs(spec, cwd, options.home)],
        {
          cwd,
          env: codexEnvironment(options.env ?? process.env, options.home),
          timeoutMs: spec.timeLimitMs,
          signal: spec.signal,
          input: inputText(spec),
        },
      );
      const durationMs = Date.now() - started;
      if (result.cancelled) throw new ProviderError("cancelled", CODEX_FAILURE_MESSAGES.cancelled);
      if (result.timedOut) throw new ProviderError("time_limit", CODEX_FAILURE_MESSAGES.time_limit);
      const events = parseEvents(result.stdout);
      if (events.length === 0) {
        throw unexpected(`no events (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
      }
      const usage = toUsage(events, durationMs);
      // A failure: a failed turn, or an error with no completed turn after it (an error can also
      // be a notice that the CLI recovered from; that is an open question).
      const completed = events.some((event) => event.type === "turn.completed");
      const failedEvent = events.findLast(
        (event) => event.type === "turn.failed" || (event.type === "error" && !completed),
      );
      if (failedEvent !== undefined) {
        const text = failureText(failedEvent);
        const kind = codexFailureKind(text);
        const detail = JSON.stringify({ type: failedEvent.type, message: text.slice(0, 500) });
        if (kind === undefined) throw unexpected(detail);
        // The person reads only the plain sentence; the CLI's words go to the ledger (CLI-05, GEN-12).
        throw new ProviderError(kind, CODEX_FAILURE_MESSAGES[kind], usage, detail);
      }
      if (result.exitCode !== 0) {
        throw unexpected(`exit ${result.exitCode}: ${result.stderr || result.stdout}`);
      }
      const message = events.findLast(
        (event) => event.type === "item.completed" && event.item?.type === "agent_message",
      );
      const text = message?.item?.text;
      if (text === undefined) {
        throw new ProviderError(
          "schema",
          CODEX_FAILURE_MESSAGES.schema,
          usage,
          "The Codex CLI gave no final message.",
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ProviderError("schema", CODEX_FAILURE_MESSAGES.schema, usage, clip(text));
      }
      const wrapped = wrappedAnswer.safeParse(parsed);
      const answer = wrapped.success ? wrapped.data[ANSWER_KEY] : undefined;
      const checked = spec.schema.safeParse(answer);
      if (!checked.success) {
        throw new ProviderError("schema", CODEX_FAILURE_MESSAGES.schema, usage, undefined, answer);
      }
      return { value: checked.data, usage, raw: result.stdout };
    } finally {
      removeFolder(cwd);
    }
  };
  return { name: options.live ? "codex" : "codex-fake", live: options.live, run };
}

/** What Tessera found about Codex: the same shape as for Claude Code (the contracts' check). */
export type CodexStatus = ClaudeStatus;

/**
 * Finds the real Codex CLI and readies Tessera's Codex home folder, without spending a model call
 * (CLI-02, CLI-08): Codex is on the PATH as a program (not npm's `codex.cmd`), at least the tested
 * version; the home folder holds no instructions file; Codex is signed in there with a ChatGPT
 * account, from `codex login status`, which reaches no model (an API key would bill the API, so it
 * is refused); and the restricted catalog is written from `codex debug models --bundled`.
 */
export async function findCodex(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  run: typeof runProcess = runProcess,
): Promise<CodexStatus> {
  // On Windows the program itself first: npm's codex.cmd, earlier on the PATH, would hide it.
  const executable =
    (platform === "win32" ? findExecutable("codex.exe", env, platform) : null) ??
    findExecutable("codex", env, platform);
  if (!executable) {
    return {
      ok: false,
      problem: "missing",
      message: "Codex isn't installed, or isn't on the PATH. Install it, then try again.",
    };
  }
  if (/\.(cmd|bat)$/i.test(executable)) {
    return {
      ok: false,
      problem: "batch-file",
      message: `Codex was found as ${executable}, which Tessera can't start. Install Codex's own program (codex.exe), then try again.`,
    };
  }
  const clean = cleanEnvironment(env);
  const cantStart: CodexStatus = {
    ok: false,
    problem: "broken",
    message: `Tessera found Codex at ${executable} but couldn't start it. Reinstall Codex, or check that your account may run it, then try again.`,
  };
  let answer: Awaited<ReturnType<typeof runProcess>>;
  try {
    answer = await run(executable, ["--version"], { env: clean, timeoutMs: 30_000 });
  } catch {
    return cantStart;
  }
  const version = versionOf(answer.stdout);
  if (answer.exitCode !== 0 || version === undefined) {
    return {
      ok: false,
      problem: "broken",
      message: `Codex didn't say its version (${(answer.stderr || answer.stdout).trim().slice(0, 200)}).`,
    };
  }
  if (!atLeast(version, TESTED_CODEX_VERSION)) {
    return {
      ok: false,
      problem: "old",
      message: `Codex ${version} is older than ${TESTED_CODEX_VERSION}, the version Tessera is tested with. Update it, then try again.`,
    };
  }
  // Tessera's own home folder: made if new, and never with instructions for every call in it.
  // A file found there is the person's to remove, so it is reported, not deleted.
  try {
    fs.mkdirSync(home, { recursive: true });
  } catch {
    return {
      ok: false,
      problem: "broken",
      message: `Tessera couldn't make its Codex folder at ${home}. Check that your account may write there, then try again.`,
    };
  }
  const instructions = HOME_INSTRUCTION_FILES.find((file) => fs.existsSync(path.join(home, file)));
  if (instructions !== undefined) {
    return {
      ok: false,
      problem: "broken",
      message: `Tessera's Codex folder has an instructions file, ${path.join(home, instructions)}, that would reach every request. Remove it, then try again.`,
    };
  }
  const inHome = { cwd: os.tmpdir(), env: codexEnvironment(env, home), timeoutMs: 30_000 };
  let status: Awaited<ReturnType<typeof runProcess>>;
  try {
    status = await run(executable, ["login", "status"], inHome);
  } catch {
    return cantStart;
  }
  // "Logged in using ChatGPT", on either stream; "Not logged in", or another way in, otherwise.
  const said = `${status.stdout}\n${status.stderr}`;
  const signIn = codexSignInCommand(home, platform);
  if (!/Logged in/.test(said) || /not logged in/i.test(said)) {
    return {
      ok: false,
      problem: "signed-out",
      message: `Codex isn't signed in for Tessera, which keeps a Codex sign-in of its own. Open a terminal, run \`${signIn}\`, sign in with your ChatGPT account, then try again.`,
    };
  }
  if (!/Logged in using ChatGPT/.test(said)) {
    return {
      ok: false,
      problem: "signed-out",
      message: `Codex is signed in for Tessera some other way than a ChatGPT account, which could be billed apart from your plan. Open a terminal, run \`${signIn}\`, sign in with your ChatGPT account, then try again.`,
    };
  }
  // The catalog every call is given, from this Codex's own bundled one (no network).
  const unreadable: CodexStatus = {
    ok: false,
    problem: "broken",
    message: `Tessera couldn't read the list of models from Codex ${version}. Reinstall or update Codex, then try again.`,
  };
  let models: Awaited<ReturnType<typeof runProcess>>;
  try {
    models = await run(executable, ["debug", "models", "--bundled"], inHome);
  } catch {
    return cantStart;
  }
  if (models.exitCode !== 0) return unreadable;
  try {
    fs.writeFileSync(
      path.join(home, MODEL_CATALOG_FILE),
      JSON.stringify(restrictCatalog(models.stdout)),
      "utf8",
    );
  } catch {
    return unreadable;
  }
  return { ok: true, executable, version };
}
