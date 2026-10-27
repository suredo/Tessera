import { intentSchema, type Artifact, type Intent } from "@tessera/contracts";
import { assembleIntentPrompt, type OpenTool, type RecordList } from "../prompts/index.ts";
import type { Provider } from "../providers/index.ts";
import { runStage, type Routes } from "../providers/index.ts";

// The intent stage (GEN-01): one cheap call works out what a request asks for, as structured
// fields, in any language (GEN-15), and the host decides from them what happens, with guardrails
// the model can't talk its way past. Nothing here looks at the request's words to decide
// (GEN-02); the one check on words is that a split part is made of the request's own (ADR 0008).

/** How long the intent stage may take (GEN-11). */
export const INTENT_TIME_LIMIT_MS = 60_000;

/**
 * The lists of records a tool keeps, from its declared data shape (DATA-03): each top-level list
 * of objects, with its fields other than `id`, which only the host sets.
 */
export function recordLists(schema: Artifact["data"]["schema"]): RecordList[] {
  const properties = schema["properties"];
  if (!isObject(properties)) return [];
  return Object.entries(properties).flatMap(([name, value]): RecordList[] => {
    if (!isObject(value) || value["type"] !== "array") return [];
    const items = value["items"];
    if (!isObject(items) || !isObject(items["properties"])) return [];
    return [{ name, fields: Object.keys(items["properties"]).filter((field) => field !== "id") }];
  });
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Marks stay part of their word (a vowel sign in Devanagari changes the word), and the text is
// normalized first, so a letter written as one character or as a letter and an accent is one word.
const words = (text: string) =>
  text
    .normalize("NFC")
    .toLowerCase()
    .match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

/**
 * The words of a split part that the request doesn't contain, ignoring case and punctuation, in
 * any script. A part may leave words out; any word it adds, changes or translates is listed
 * (ADR 0008, L-75).
 */
export function wordsNotInRequest(request: string, part: string): string[] {
  const known = new Set(words(request));
  return [...new Set(words(part).filter((word) => !known.has(word)))];
}

/** A split part is usable when it has words, and all of them are the request's. */
const keepsWords = (request: string, part: string | null): part is string =>
  part !== null && words(part).length > 0 && wordsNotInRequest(request, part).length === 0;

/**
 * What the host does with a request. Where nothing is split, the part is the whole request
 * (ADR 0008). `ask_to_split` means a mixed request's parts weren't the request's own words twice:
 * nothing is done, and the person is asked to send the two changes separately.
 */
export type IntentDecision = { intent: Intent } & (
  | { action: "create" | "new_tool" | "edit"; interfacePart: string }
  | { action: "data"; dataPart: string }
  | { action: "mixed"; interfacePart: string; dataPart: string }
  | { action: "open_saved"; savedToolId: string }
  | { action: "clarify" | "unsupported" | "ask_to_split" }
);

export type IntentInput = {
  request: string;
  /** The tool open now, with the lists it keeps; null when none is. */
  open: OpenTool;
  /** The IDs of the saved tools the person can open (GEN-18); none until the catalogue (#145). */
  savedToolIds?: readonly string[];
  signal?: AbortSignal;
};

/**
 * Asks the intent stage what `request` is, on its route (CLI-09), and decides what happens.
 * The guardrails (GEN-01): with no tool open, a request opens a saved tool or creates one (A12);
 * a request that isn't about the open tool never changes it; a saved tool must be one listed.
 * A mixed answer whose parts aren't the request's own words is asked once more, then left to the
 * person (ADR 0008). A provider failure goes back to the caller (CLI-05).
 */
export async function decideIntent(
  provider: Provider,
  routes: Routes,
  input: IntentInput,
): Promise<IntentDecision> {
  const ask = async (retry: boolean) => {
    const prompt = assembleIntentPrompt({ request: input.request, open: input.open, retry });
    const result = await runStage(provider, routes, {
      stage: "intent",
      system: prompt.system,
      prompt: prompt.prompt,
      promptParts: prompt.parts,
      schema: intentSchema,
      timeLimitMs: INTENT_TIME_LIMIT_MS,
      signal: input.signal,
    });
    return result.value;
  };
  const first = route(input, await ask(false));
  if (first.action !== "ask_to_split") return first;
  // Asked once more, then left to the person if the parts still aren't the request's words.
  return route(input, await ask(true));
}

/**
 * The host's decision for one answer. A mixed answer whose parts fail the word check is
 * `ask_to_split`; the caller asks the stage once more before leaving it to the person.
 */
function route(input: IntentInput, intent: Intent): IntentDecision {
  const { request, open } = input;
  const whole = { intent, interfacePart: request };
  // No tool open: nothing to change, so the request opens a saved tool or creates one (A12).
  if (open === null) {
    if (intent.kind === "open_saved" && input.savedToolIds?.includes(intent.savedToolId)) {
      return { action: "open_saved", savedToolId: intent.savedToolId, intent };
    }
    if (intent.kind === "clarify" || intent.kind === "unsupported") {
      return { action: intent.kind, intent };
    }
    return { action: "create", ...whole };
  }
  switch (intent.kind) {
    case "open_saved":
      return input.savedToolIds?.includes(intent.savedToolId)
        ? { action: "open_saved", savedToolId: intent.savedToolId, intent }
        : { action: "new_tool", ...whole };
    case "clarify":
    case "unsupported":
      return { action: intent.kind, intent };
    // With a tool open, building one is a new tool: the open one stays as it is.
    case "create":
    case "new_tool":
      return { action: "new_tool", ...whole };
  }
  // A change to the open tool or its records, unless it isn't about the open tool: an unrelated
  // request never overwrites it (GEN-01).
  if (!intent.targetsCurrentTool) return { action: "new_tool", ...whole };
  if (intent.kind === "edit") return { action: "edit", ...whole };
  if (intent.kind === "data") return { action: "data", dataPart: request, intent };
  // Mixed: the one case that is split, so the one case whose parts are checked (ADR 0008).
  if (keepsWords(request, intent.interfacePart) && keepsWords(request, intent.dataPart)) {
    return {
      action: "mixed",
      interfacePart: intent.interfacePart,
      dataPart: intent.dataPart,
      intent,
    };
  }
  return { action: "ask_to_split", intent };
}
