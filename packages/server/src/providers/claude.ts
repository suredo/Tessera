import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jsonSchemaOf, type ProviderErrorKind, type Usage } from "@tessera/contracts";
import { z } from "zod";
import { findExecutable, runProcess } from "../platform/index.ts";
import { ProviderError, type Provider, type StageResult, type StageSpec } from "./provider.ts";

// The Claude Code adapter (CLI-01): every model call goes through the claude program with the
// locked flags of ADR 0002 (CLI-03), from a clean environment and an empty folder (CLI-08), and its
// result is read for usage (CLI-04) and failures (CLI-05) before the host checks the answer.

/** The version the locked flags were tested on (ADR 0002). An older claude is refused. */
export const TESTED_CLI_VERSION = "2.1.296";

/** The CLI's own turn limit; not a hard bound (L-73), so every call also has a time limit. */
export const MAX_TURNS = 3;

/** The field every answer travels in. */
export const ANSWER_KEY = "answer";

/**
 * The CLI hands the schema to the API as a tool's input schema, which must be an object at the
 * top level (L-72), while a contract may be a union (CON-02). So every schema travels wrapped as
 * `{ answer: <contract> }`, with shared definitions moved to the top so references still resolve.
 */
export function wrapSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema, definitions, $defs, ...contract } = schema;
  return {
    ...($schema === undefined ? {} : { $schema }),
    type: "object",
    properties: { [ANSWER_KEY]: contract },
    required: [ANSWER_KEY],
    additionalProperties: false,
    ...(definitions === undefined ? {} : { definitions }),
    ...($defs === undefined ? {} : { $defs }),
  };
}

const wrappedAnswer = z.object({ [ANSWER_KEY]: z.unknown() });

/** The locked flags of a stage (CLI-03), then the request. No stage gets file tools. */
export function buildArgs(spec: StageSpec<unknown>): string[] {
  return [
    "--print",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(wrapSchema(jsonSchemaOf(spec.schema))),
    "--model",
    spec.model,
    "--effort",
    spec.effort,
    "--tools",
    spec.tools === "web" ? "WebSearch,WebFetch" : "",
    "--safe-mode",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--max-turns",
    String(MAX_TURNS),
    "--system-prompt",
    spec.system,
    spec.prompt,
  ];
}

// Only what the CLI needs to start and find its sign-in (CLI-08). API keys would switch billing to
// the API (L-52), and a parent Claude Code session sets variables such as ANTHROPIC_BASE_URL and
// CLAUDE_CODE_SIMPLE that change where and how the CLI calls the model (L-74).
const KEPT = new Set(
  [
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERNAME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
  ].map((name) => name.toUpperCase()),
);

/** The environment the CLI starts with: an allowlist, compared regardless of case on Windows. */
export const cleanEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([name]) => KEPT.has(name.toUpperCase())));

/** The parts of the CLI's JSON result the adapter reads. The rest stays in the raw answer. */
export const resultEnvelopeSchema = z.looseObject({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  num_turns: z.number().optional(),
  duration_ms: z.number().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  /** Tools the CLI was asked for and refused: with every tool off, none should appear. */
  permission_denials: z.array(z.unknown()).optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});
export type ResultEnvelope = z.infer<typeof resultEnvelopeSchema>;

/** Input counts uncached input, cache writes and cache reads (CLI-04); a missing part is unknown. */
export function toUsage(envelope: ResultEnvelope): Usage {
  const u = envelope.usage;
  const parts = [u?.input_tokens, u?.cache_creation_input_tokens, u?.cache_read_input_tokens];
  const known = parts.filter((n) => n !== undefined);
  return {
    inputTokens: known.length === parts.length ? known.reduce((a, b) => a + b, 0) : null,
    cachedInputTokens: u?.cache_read_input_tokens ?? null,
    outputTokens: u?.output_tokens ?? null,
    durationMs: envelope.duration_ms ?? null,
  };
}

/** What the person reads for each failure (CLI-05, GEN-12): plain, and with what to do. */
export const FAILURE_MESSAGES: Record<ProviderErrorKind, string> = {
  sign_in: "Claude Code isn't signed in. Open a terminal, run `claude auth login`, then try again.",
  usage_limit:
    "Your Claude plan's usage limit is reached for now. Try again when it resets; nothing was changed.",
  unavailable_model: "The model chosen for this step isn't available to your Claude plan.",
  unsupported_effort: "The model chosen for this step doesn't take the effort level set for it.",
  schema: "The answer didn't have the shape Tessera asked for.",
  turn_limit: "The answer took more steps than allowed, so it was stopped.",
  time_limit: "The answer took too long, so it was stopped.",
  cancelled: "Stopped, as asked.",
};

/** Reads which failure a result is, from `is_error` and its error text, never `subtype` (L-71). */
export function failureKind(envelope: ResultEnvelope): ProviderErrorKind | undefined {
  const text = `${envelope.subtype} ${envelope.result ?? ""}`.toLowerCase();
  if (envelope.subtype === "error_max_turns") return "turn_limit";
  if (envelope.subtype === "error_max_structured_output_retries" || /input_schema/.test(text)) {
    return "schema";
  }
  if (/log ?in|authenticat|sign.?in|not logged/.test(text)) return "sign_in";
  if (/usage limit|rate limit|limit reached/.test(text)) return "usage_limit";
  if (/effort/.test(text) && /not supported|unsupported|invalid|not available/.test(text)) {
    return "unsupported_effort";
  }
  if (/model/.test(text) && /not found|not available|invalid|unknown|does not exist/.test(text)) {
    return "unavailable_model";
  }
  return undefined;
}

function failure(envelope: ResultEnvelope): Error {
  const usage = toUsage(envelope);
  const kind = failureKind(envelope);
  // The CLI's own words stay with the error, for the ledger (GEN-10); the person reads the
  // plain message.
  const said = (envelope.result ?? "").slice(0, 500);
  if (kind === undefined) {
    return new Error(`The CLI failed in an unexpected way (${envelope.subtype}): ${said}`);
  }
  return new ProviderError(kind, `${FAILURE_MESSAGES[kind]} (${envelope.subtype}: ${said})`, usage);
}

export type ClaudeOptions = {
  /** The absolute path of the program to start: the real claude.exe, or node for the fake. */
  executable: string;
  /** Arguments that come before the CLI's own, such as the fake's script and reply files. */
  leadingArgs?: string[];
  /** True only for the real CLI. */
  live: boolean;
  env?: NodeJS.ProcessEnv;
};

/** The Claude Code adapter for the program given; see `findClaude` for the real one. */
export function createClaudeProvider(options: ClaudeOptions): Provider {
  const run = async <T>(spec: StageSpec<T>): Promise<StageResult<T>> => {
    if (spec.signal?.aborted) throw new ProviderError("cancelled", FAILURE_MESSAGES.cancelled);
    // A new, empty working folder outside the repository for every call (CLI-08).
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-cli-"));
    try {
      const result = await runProcess(
        options.executable,
        [...(options.leadingArgs ?? []), ...buildArgs(spec)],
        {
          cwd,
          env: cleanEnvironment(options.env ?? process.env),
          timeoutMs: spec.timeLimitMs,
          signal: spec.signal,
        },
      );
      if (result.cancelled) throw new ProviderError("cancelled", FAILURE_MESSAGES.cancelled);
      if (result.timedOut) throw new ProviderError("time_limit", FAILURE_MESSAGES.time_limit);
      let envelope: ResultEnvelope;
      try {
        envelope = resultEnvelopeSchema.parse(JSON.parse(result.stdout));
      } catch {
        throw new Error(
          `The CLI gave no JSON result (exit ${result.exitCode}): ${result.stderr || result.stdout}`.slice(
            0,
            2000,
          ),
        );
      }
      // A failure is is_error, whatever subtype says: a failed call can say "success" (L-71).
      if (envelope.is_error || envelope.subtype !== "success") throw failure(envelope);
      const usage = toUsage(envelope);
      const wrapped = wrappedAnswer.safeParse(envelope.structured_output);
      const checked = spec.schema.safeParse(wrapped.success ? wrapped.data[ANSWER_KEY] : undefined);
      if (!checked.success) throw new ProviderError("schema", FAILURE_MESSAGES.schema, usage);
      return { value: checked.data, usage, raw: result.stdout };
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  };
  return { name: options.live ? "claude" : "claude-fake", live: options.live, run };
}

/** The version in `claude --version`'s answer, such as "2.1.310 (Claude Code)", or undefined. */
export const versionOf = (text: string): string | undefined => /\d+\.\d+\.\d+/.exec(text)?.[0];

/** Whether `version` is at least `minimum`, comparing major, minor and patch as numbers. */
export function atLeast(version: string, minimum: string): boolean {
  const [a, b] = [version, minimum].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i += 1) {
    if (a![i]! !== b![i]!) return a![i]! > b![i]!;
  }
  return true;
}

/** What Tessera found about Claude Code, for the setup check (PLAT-03) and the status screen. */
export type ClaudeStatus =
  | { ok: true; executable: string; version: string }
  | {
      ok: false;
      problem: "missing" | "batch-file" | "old" | "signed-out" | "broken";
      message: string;
    };

/**
 * Finds the real Claude Code and checks it, without spending a model call (CLI-02): it is on the
 * PATH as a program (not npm's `claude.cmd`, which can't be started without a shell, L-45), at
 * least the tested version, and signed in, from `claude auth status`, which reaches no model.
 */
export async function findClaude(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  run: typeof runProcess = runProcess,
): Promise<ClaudeStatus> {
  // On Windows the program itself first: npm's claude.cmd, earlier on the PATH, would hide it.
  const executable =
    (platform === "win32" ? findExecutable("claude.exe", env, platform) : null) ??
    findExecutable("claude", env, platform);
  if (!executable) {
    return {
      ok: false,
      problem: "missing",
      message: "Claude Code isn't installed, or isn't on the PATH. Install it, then try again.",
    };
  }
  if (/\.(cmd|bat)$/i.test(executable)) {
    return {
      ok: false,
      problem: "batch-file",
      message: `Claude Code was found as ${executable}, which Tessera can't start. Install Claude Code's own program (claude.exe), then try again.`,
    };
  }
  const clean = cleanEnvironment(env);
  const answer = await run(executable, ["--version"], { env: clean, timeoutMs: 30_000 });
  const version = versionOf(answer.stdout);
  if (answer.exitCode !== 0 || version === undefined) {
    return {
      ok: false,
      problem: "broken",
      message: `Claude Code didn't say its version (${(answer.stderr || answer.stdout).trim().slice(0, 200)}).`,
    };
  }
  if (!atLeast(version, TESTED_CLI_VERSION)) {
    return {
      ok: false,
      problem: "old",
      message: `Claude Code ${version} is older than ${TESTED_CLI_VERSION}, the version Tessera is tested with. Update it with \`claude update\`, then try again.`,
    };
  }
  const status = await run(executable, ["auth", "status"], {
    cwd: os.tmpdir(),
    env: clean,
    timeoutMs: 30_000,
  });
  let signedIn: boolean;
  try {
    signedIn = (JSON.parse(status.stdout) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    // An answer that isn't JSON is no sign-in.
    signedIn = false;
  }
  if (!signedIn) return { ok: false, problem: "signed-out", message: FAILURE_MESSAGES.sign_in };
  return { ok: true, executable, version };
}
