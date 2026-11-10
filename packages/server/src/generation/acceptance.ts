// Docs: docs/code/server/generation.md
import { acceptanceSchema, type AcceptanceChecks } from "@tessera/contracts";
import { ACCEPTANCE_PROMPT_BUDGET, assembleAcceptancePrompt } from "../prompts/index.ts";
import { ProviderError, runStage, type Provider, type Routes } from "../providers/index.ts";
import { INTENT_TIME_LIMIT_MS } from "../intent/index.ts";

// The acceptance stage (VER-09, A49, an M3 experiment): for a new tool that fits no verification
// profile, a separate stage, never the generator, turns the person's request into a few checks
// the host runs before the tool opens. It sees only the request; the tool is written after, told
// the hooks the checks use. It runs on the acceptance route, the cheapest (CLI-09, A18).

/** What the stage gave: checks, none with its reason, or nothing it could use. */
export type AcceptanceResult =
  | { kind: "checks"; acceptance: AcceptanceChecks }
  | { kind: "none"; reason: string }
  | { kind: "failed"; reason: string };

/**
 * Failures that end the request, as they would at any stage: the person is signed out, out of
 * usage, has no such model or effort, or stopped it. Any other failure of this experimental stage
 * leaves the tool to be made without checks, never refused for them.
 */
const ENDS_REQUEST = new Set([
  "sign_in",
  "usage_limit",
  "unavailable_model",
  "unsupported_effort",
  "cancelled",
]);

/** Asks the acceptance stage once for checks of `request`, written in its `language`. */
export async function writeAcceptance(
  provider: Provider,
  routes: Routes,
  input: { request: string; language: string; signal?: AbortSignal; timeLimitMs?: number },
): Promise<AcceptanceResult> {
  const prompt = assembleAcceptancePrompt({ request: input.request, language: input.language });
  if (prompt.size > ACCEPTANCE_PROMPT_BUDGET) {
    return { kind: "failed", reason: "The request is too long to write checks for." };
  }
  try {
    const { value } = await runStage(provider, routes, {
      stage: "acceptance",
      system: prompt.system,
      prompt: prompt.prompt,
      promptParts: prompt.parts,
      schema: acceptanceSchema,
      timeLimitMs: input.timeLimitMs ?? INTENT_TIME_LIMIT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return value.outcome === "checks"
      ? { kind: "checks", acceptance: value }
      : { kind: "none", reason: value.reason };
  } catch (error) {
    if (!(error instanceof ProviderError) || ENDS_REQUEST.has(error.kind)) throw error;
    return { kind: "failed", reason: error.message };
  }
}
