import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jsonSchemaOf, type Usage } from "@tessera/contracts";
import {
  ProviderError,
  runProcess,
  type Provider,
  type StageResult,
  type StageSpec,
} from "@tessera/server";
import { z } from "zod";

// Just enough of a Claude Code caller to test the CLI contract (CLI-03, CLI-08) before anything is
// built on it. The real adapter, with its fake-process contract tests, replaces it in M2.

export const MAX_TURNS = 3;

/** The locked flags of a normal stage (CLI-03), then the prompt. Research and file tools: never. */
export function buildArgs(spec: StageSpec<unknown>, systemPrompt: string): string[] {
  return [
    "--print",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(jsonSchemaOf(spec.schema)),
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
      : envelope.subtype === "error_max_structured_output_retries"
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
  return new ProviderError(kind, `The CLI call failed (${envelope.subtype}).`, usage);
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
      const checked = spec.schema.safeParse(envelope.structured_output);
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
