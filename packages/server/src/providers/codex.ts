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
// Open questions, to settle with the first live probe (nothing here was run against a model):
// - Does Codex have a dedicated instructions setting, so the system prompt need not travel in the
//   request text (see `inputText`)? And is the user's global ~/.codex/AGENTS.md still loaded with
//   --ignore-user-config? If it is, the person's own instructions reach every stage.
// - Does `--output-schema` accept this wrapped schema as it is? OpenAI's strict structured output
//   wants `additionalProperties: false` and every property required throughout, which a contract
//   may not satisfy. The wrapping is kept (a non-object root is not known to work).
// - Does Codex's `input_tokens` include cached input (assumed, as in OpenAI's accounting), and
//   `output_tokens` the reasoning tokens (assumed)? And does it already include
//   `cache_write_input_tokens`? Assumed yes: nothing is added.
// - The shapes of Codex's failure events are not captured yet (see `codexFailureKind`).
// - Do the `--disable` flags below take away every tool, as Claude's `--tools ""` does (CLI-03)? A
//   read-only sandbox alone still lets the model run commands that read files anywhere it may
//   (`command_execution` items were seen in a review run), so the features that grant tools are
//   disabled by name, from `codex features list` at the tested version. The probe must show a
//   stage that asks to list files gets no command run. Feature names can change in a later version.
// - Is `tools.web_search` the setting that turns web search off and on?

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
] as const;

/** Where the answer's JSON Schema is written, in the call's own empty working folder. */
export const OUTPUT_SCHEMA_FILE = "output-schema.json";

/**
 * What goes on standard input: the stage's system prompt, a separator, then the request. Codex has
 * no system-prompt flag, so for now both travel as one text. Kept in one small function so it can
 * change once the probe shows whether Codex has a dedicated instructions setting.
 */
export const inputText = (spec: Pick<StageSpec<unknown>, "system" | "prompt">): string =>
  `${spec.system}\n---\nThe request:\n${spec.prompt}`;

/**
 * The locked flags of a stage (CLI-03), in this order. The text goes on standard input (`-`), so
 * it does not count toward the command line's limit, about 32,000 characters on Windows. `folder`
 * is the call's own empty working folder, where the schema file was written.
 */
export function buildArgs(spec: StageSpec<unknown>, folder: string): string[] {
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
    // And should one remain, it may not write files: the sandbox is read-only.
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
    // Only research gets web search (CLI-03).
    "-c",
    `tools.web_search=${spec.tools === "web" ? "true" : "false"}`,
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
  sign_in: "Codex isn't signed in. Open a terminal, run `codex login`, then try again.",
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
  env?: NodeJS.ProcessEnv;
};

/** The Codex adapter for the program given; see `findCodex` for the real one. */
export function createCodexProvider(options: CodexOptions): Provider {
  const run = async <T>(spec: StageSpec<T>): Promise<StageResult<T>> => {
    if (spec.signal?.aborted) {
      throw new ProviderError("cancelled", CODEX_FAILURE_MESSAGES.cancelled);
    }
    // A new, empty working folder outside the repository for every call (CLI-08).
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-cli-"));
    try {
      fs.writeFileSync(
        path.join(cwd, OUTPUT_SCHEMA_FILE),
        JSON.stringify(wrapSchema(jsonSchemaOf(spec.schema))),
        "utf8",
      );
      const started = Date.now();
      const result = await runProcess(
        options.executable,
        [...(options.leadingArgs ?? []), ...buildArgs(spec, cwd)],
        {
          cwd,
          env: cleanEnvironment(options.env ?? process.env),
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
 * Finds the real Codex CLI and checks it, without spending a model call (CLI-02): it is on the
 * PATH as a program (not npm's `codex.cmd`), at least the tested version, and signed in, from
 * `codex login status`, which reaches no model.
 */
export async function findCodex(
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
  let status: Awaited<ReturnType<typeof runProcess>>;
  try {
    status = await run(executable, ["login", "status"], {
      cwd: os.tmpdir(),
      env: clean,
      timeoutMs: 30_000,
    });
  } catch {
    return cantStart;
  }
  // "Logged in using ChatGPT", on either stream; "Not logged in" is the other answer.
  const said = `${status.stdout}\n${status.stderr}`;
  if (!/Logged in/.test(said) || /not logged in/i.test(said)) {
    return { ok: false, problem: "signed-out", message: CODEX_FAILURE_MESSAGES.sign_in };
  }
  return { ok: true, executable, version };
}
