// Docs: docs/code/server/generation.md
import { discussionSchema } from "@tessera/contracts";
import { INTENT_TIME_LIMIT_MS } from "../intent/index.ts";
import { assembleDiscussPrompt, type OpenTool } from "../prompts/index.ts";
import { runStage, type Provider, type Routes } from "../providers/index.ts";

// The discuss stage (GEN-19, A59): a question or an idea about the open tool, or one to come, is
// answered in plain words by one call on the discuss route, the cheapest (CLI-09). It is told the
// open tool and what tools here can and can't do, and nothing else: it builds nothing, changes no
// data and makes no version. A provider failure goes back to the caller, as at any stage.

/** Asks the discuss stage once for an answer to `request`, in its `language`. */
export async function answerDiscussion(
  provider: Provider,
  routes: Routes,
  input: {
    request: string;
    open: OpenTool;
    language: string;
    signal?: AbortSignal;
    timeLimitMs?: number;
  },
): Promise<string> {
  const prompt = assembleDiscussPrompt(input);
  const { value } = await runStage(provider, routes, {
    stage: "discuss",
    system: prompt.system,
    prompt: prompt.prompt,
    promptParts: prompt.parts,
    schema: discussionSchema,
    timeLimitMs: input.timeLimitMs ?? INTENT_TIME_LIMIT_MS,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return value.answer;
}
