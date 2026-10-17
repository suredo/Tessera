import fs from "node:fs";
import { providerScriptSchema, type ProviderScript, type Usage } from "@tessera/contracts";
import { ProviderError, type Provider, type StageResult, type StageSpec } from "./provider.ts";

// A provider that answers from a script instead of a model, for tests and dry runs (ENG-11,
// OBS-02). The script is chosen by test configuration; the request text never changes the reply.

const ZERO_USAGE: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, durationMs: 0 };

/** The script doesn't fit the calls made: a broken test or pipeline, never a model failure. */
export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptError";
  }
}

export type ScriptedProvider = Provider & {
  /** How many replies have not been used yet. A test can expect 0 once it is done. */
  remaining(): number;
};

/** Answers each call with the script's next reply, which must be for the stage being called. */
export function createScriptedProvider(script: ProviderScript): ScriptedProvider {
  const replies = providerScriptSchema.parse(script).replies;
  let next = 0;

  const answer = <T>(spec: StageSpec<T>): StageResult<T> => {
    if (spec.signal?.aborted) {
      throw new ProviderError("cancelled", "The request was cancelled before it started.");
    }
    const reply = replies[next];
    if (!reply) {
      throw new ScriptError(
        `Script "${script.name}" has no reply left for the ${spec.stage} call.`,
      );
    }
    if (reply.stage !== spec.stage) {
      throw new ScriptError(
        `Script "${script.name}" has a ${reply.stage} reply next, but the call is for ${spec.stage}.`,
      );
    }
    next += 1;
    const usage = reply.usage ?? ZERO_USAGE;
    if (reply.kind === "error") {
      throw new ProviderError(
        reply.error,
        `The script made this call fail (${reply.error}).`,
        usage,
      );
    }
    // The host checks the answer as it would a model's, so a script can test a bad answer too.
    const checked = spec.schema.safeParse(reply.value);
    if (!checked.success) {
      throw new ProviderError("schema", "The answer did not have the expected shape.", usage);
    }
    return { value: checked.data, usage, raw: JSON.stringify(reply.value) };
  };

  return {
    name: `scripted:${script.name}`,
    live: false,
    // A failure comes back as a rejected promise, as a model call's would.
    run: <T>(spec: StageSpec<T>) => new Promise<StageResult<T>>((resolve) => resolve(answer(spec))),
    remaining: () => replies.length - next,
  };
}

/** Reads a script from a JSON fixture file and checks its shape. */
export function loadScript(file: string): ProviderScript {
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ScriptError(`The script in ${file} is not JSON: ${(error as Error).message}`);
  }
  const parsed = providerScriptSchema.safeParse(json);
  if (!parsed.success) {
    throw new ScriptError(`The script in ${file} is not valid: ${parsed.error.message}`);
  }
  return parsed.data;
}
