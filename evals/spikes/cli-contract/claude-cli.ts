import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonSchemaOf, type Usage } from "@tessera/contracts";
import {
  findExecutable,
  ProviderError,
  runProcess,
  type Provider,
  type StageResult,
  type StageSpec,
} from "@tessera/server";
import { z } from "zod";
import type { RunMode } from "../../src/index.ts";

// Just enough of a Claude Code caller to test the CLI contract (CLI-03, CLI-08) before anything is
// built on it, shared by the M0 spikes. The real adapter, with its fake-process contract tests,
// replaces it in M2.

const here = path.dirname(fileURLToPath(import.meta.url));

export const MAX_TURNS = 3;

/** The field every answer travels in. */
export const ANSWER_KEY = "answer";

/**
 * The CLI hands the schema to the API as a tool's input schema, which must be an object at the
 * top level (the third live run, #19), while a contract may be a union (CON-02). So every schema
 * travels wrapped as `{ answer: <contract> }`, with shared definitions moved to the top so that
 * their references still resolve.
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

/** The locked flags of a normal stage (CLI-03), then the prompt. Research and file tools: never. */
export function buildArgs(spec: StageSpec<unknown>, systemPrompt: string): string[] {
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
    systemPrompt,
    spec.prompt,
  ];
}

// Only what the CLI needs to start and find its sign-in. Everything else stays out: API keys would
// switch billing to the API (CLI-08, L-52), and a parent Claude Code session sets variables such as
// ANTHROPIC_BASE_URL and CLAUDE_CODE_SIMPLE that change where and how the CLI calls the model.
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

/** The parts of the CLI's JSON result this spike reads. The rest is kept in the request log. */
export const resultEnvelopeSchema = z.looseObject({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  num_turns: z.number().optional(),
  duration_ms: z.number().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
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

// The CLI's failures, mapped to the provider's error kinds (CLI-05) as far as the text allows.
function failure(envelope: ResultEnvelope): ProviderError {
  const usage = toUsage(envelope);
  const text = `${envelope.subtype} ${envelope.result ?? ""}`.toLowerCase();
  const kind =
    envelope.subtype === "error_max_turns"
      ? "turn_limit"
      : envelope.subtype === "error_max_structured_output_retries" || /input_schema/.test(text)
        ? "schema"
        : /log ?in|authenticat|sign.?in/.test(text)
          ? "sign_in"
          : /usage limit|rate limit/.test(text)
            ? "usage_limit"
            : /model/.test(text) && /not found|not available|invalid|unknown/.test(text)
              ? "unavailable_model"
              : undefined;
  if (kind === undefined) {
    throw new Error(
      `The CLI failed in an unexpected way (${envelope.subtype}): ${envelope.result}`,
    );
  }
  // The CLI's own words go into the ledger, so a failure can be understood without a rerun.
  const said = (envelope.result ?? "").slice(0, 500);
  return new ProviderError(kind, `The CLI call failed (${envelope.subtype}): ${said}`, usage);
}

/**
 * Whether the CLI is signed in, from `claude auth status`, which reaches no model. Checked before
 * a live run so that a missing sign-in costs no call from the budget.
 */
export async function isSignedIn(executable: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const status = await runProcess(executable, ["auth", "status"], {
    cwd: os.tmpdir(),
    env: cleanEnvironment(env),
    timeoutMs: 30_000,
  });
  try {
    return (JSON.parse(status.stdout) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
}

export type ClaudeCliOptions = {
  /** The absolute path of the program to start: the real claude.exe, or node for the fake. */
  executable: string;
  /** Arguments that come before the CLI's own, such as the fake's script and reply files. */
  leadingArgs?: string[];
  /** True only for the real CLI. */
  live: boolean;
  systemPrompt: string;
  env?: NodeJS.ProcessEnv;
};

export function createClaudeCliProvider(options: ClaudeCliOptions): Provider {
  const run = async <T>(spec: StageSpec<T>): Promise<StageResult<T>> => {
    // A new, empty working folder outside the repository for every call (CLI-08).
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-cli-"));
    try {
      const args = [...(options.leadingArgs ?? []), ...buildArgs(spec, options.systemPrompt)];
      const result = await runProcess(options.executable, args, {
        cwd,
        env: cleanEnvironment(options.env ?? process.env),
        timeoutMs: spec.timeLimitMs,
      });
      if (result.timedOut) throw new ProviderError("time_limit", "The CLI call took too long.");
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
      if (envelope.is_error || envelope.subtype !== "success") throw failure(envelope);
      const usage = toUsage(envelope);
      const wrapped = wrappedAnswer.safeParse(envelope.structured_output);
      const checked = spec.schema.safeParse(wrapped.success ? wrapped.data[ANSWER_KEY] : undefined);
      if (!checked.success) {
        throw new ProviderError("schema", "The answer did not have the expected shape.", usage);
      }
      return { value: checked.data, usage, raw: result.stdout };
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  };
  return { name: options.live ? "claude-cli" : "claude-cli-fake", live: options.live, run };
}

/**
 * The dry run's provider: the same caller, starting the fake claude instead of the real one. The
 * fake answers from `repliesFile` by call order and writes what it got to `callsFolder`.
 */
export const fakeClaudeProvider = (
  systemPrompt: string,
  repliesFile: string,
  callsFolder: string,
): Provider =>
  createClaudeCliProvider({
    executable: process.execPath,
    leadingArgs: [path.join(here, "fake-claude.ts"), repliesFile, callsFolder],
    live: false,
    systemPrompt,
  });

/** The real CLI, after the free checks: it is on the PATH, gives its version and is signed in. */
export async function liveClaudeProvider(
  systemPrompt: string,
): Promise<{ provider: Provider; cliVersion: string }> {
  const executable = findExecutable("claude");
  if (!executable) throw new Error("The claude program is not on the PATH.");
  const version = await runProcess(executable, ["--version"], {
    env: cleanEnvironment(process.env),
    timeoutMs: 30_000,
  });
  if (version.exitCode !== 0) throw new Error(`claude --version failed: ${version.stderr}`);
  // A missing sign-in stops here, before the harness counts a call (L-71).
  if (!(await isSignedIn(executable, process.env))) {
    throw new Error(
      "The claude program is not signed in. Run `claude auth login`, then try again.",
    );
  }
  const provider = createClaudeCliProvider({ executable, live: true, systemPrompt });
  return { provider, cliVersion: version.stdout.trim() };
}

/** `--dry-run`, or `--live` with `--approved-cap` equal to the cap the owner approved (ENG-07). */
export function runModeFrom(argv: readonly string[], approvedCap: number): RunMode {
  const live = argv.includes("--live");
  if (live === argv.includes("--dry-run")) throw new Error("Pass either --dry-run or --live.");
  const capAt = argv.indexOf("--approved-cap");
  if (live && (capAt < 0 || Number(argv[capAt + 1]) !== approvedCap)) {
    throw new Error(`A live run needs --approved-cap ${approvedCap}, the cap the owner approved.`);
  }
  return live ? "live" : "dry-run";
}

/** A new folder for one run, under the ignored test-output folder (ENG-10, ENG-19). */
export const runFolder = (spike: string, mode: RunMode): string =>
  path.join(
    here,
    "..",
    "..",
    "..",
    "test-output",
    "evals",
    `${spike}-${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
