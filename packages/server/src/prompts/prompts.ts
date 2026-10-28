import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  bridgeManifest,
  type Artifact,
  type Creation,
  type Edit,
  type FailureClass,
  type Intent,
  type Stage,
} from "@tessera/contracts";
import { UI_STANDARD_VERSION, UI_TOKENS } from "@tessera/runtime/policy";
import { TOOL_SCHEMA_KEYWORDS } from "../data-shape/index.ts";

// Prompts are built from parts (GEN-03), each a file in packages/server/prompts (ENG-16), so every
// change to one is reviewed like code. A part's version is a hash of its text, recorded with each
// call, so a change in outcomes can be traced to the prompt that produced it. Parts are chosen by
// the stage and the intent's structured fields, never by matching words in the request (GEN-02).
// The bridge manifest (CON-03) and the UI standard's variables (VER-06) are generated into their
// parts from their one definitions.

const PROMPTS_FOLDER = fileURLToPath(new URL("../../prompts/", import.meta.url));

/** Every prompt part, by the name of its file in packages/server/prompts. */
export const PROMPT_PARTS = [
  "base",
  "bridge",
  "ui-standard",
  "ui-edit",
  "accessibility",
  "request",
  "source",
  "attempt",
  "diagnostics",
  "create",
  "edit",
  "edit-declarations",
  "edit-attempt",
  "repair-edit-smoke",
  "language",
  "repair-schema-shape",
  "repair-static",
  "repair-smoke",
  "probe",
  "probe-request",
  "intent",
  "intent-request",
  "intent-open",
  "intent-none",
  "intent-no-records",
  "intent-retry",
] as const;
export type PromptPart = (typeof PROMPT_PARTS)[number];

/** The stages that write a tool, and the parts they take. */
export type GenerationStage = Extract<Stage, "create" | "edit" | "repair">;

/**
 * The failure classes repair has a prompt part for (GEN-09). A provider failure is never repaired;
 * behavior gets its part with the stage that finds it.
 */
export const REPAIR_CLASSES = [
  "schema-shape",
  "static",
  "smoke",
] as const satisfies readonly FailureClass[];
export type RepairClass = (typeof REPAIR_CLASSES)[number];

/**
 * The largest prompt, instructions and request together, in characters, that each stage's fixture
 * may reach (GEN-03), about a tenth above what they measured when set: a test fails past it, so a
 * part can't grow unnoticed. The POC's one prompt reached about 18,000. Repair's covers its larger
 * shape, the repair of a creation: the creation prompt with the failed answer quoted, about 21,400
 * when set (GEN-09).
 */
export const PROMPT_BUDGETS: Readonly<Record<GenerationStage, number>> = {
  create: 17_000,
  edit: 18_500,
  repair: 23_500,
};

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** A part's text as its file holds it. */
export function partText(part: PromptPart): string {
  return fs.readFileSync(`${PROMPTS_FOLDER}${part}.md`, "utf8").replace(/\r\n/g, "\n").trimEnd();
}

/** A short hash of `text`: a part's version (ENG-16). */
export const partVersion = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

/**
 * A part with its placeholders filled. Every placeholder must have a value and every value a
 * placeholder, so a part and its caller can't drift apart.
 */
export function fillPart(part: PromptPart, values: Record<string, string> = {}): string {
  const text = partText(part);
  const named = new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]!));
  for (const name of named) {
    if (!(name in values)) throw new Error(`The ${part} prompt part needs a value for ${name}.`);
  }
  for (const name of Object.keys(values)) {
    if (!named.has(name)) throw new Error(`The ${part} prompt part has no place for ${name}.`);
  }
  // A function, so a `$` in a value is never read as a replacement pattern.
  return text.replace(PLACEHOLDER, (_, name: string) => values[name]!);
}

/**
 * A JSON Schema without what tells a model nothing: the `$schema` line, a pattern beside a
 * `format` that says the same, and the bounds every JSON integer has anyway.
 */
function plainSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plainSchema);
  if (value === null || typeof value !== "object") return value;
  const schema = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key, item]) => {
        if (key === "$schema") return false;
        if (key === "pattern" && "format" in schema) return false;
        if (key === "minimum" && item === Number.MIN_SAFE_INTEGER) return false;
        if (key === "maximum" && item === Number.MAX_SAFE_INTEGER) return false;
        return true;
      })
      .map(([key, item]) => [key, plainSchema(item)]),
  );
}

/** The bridge manifest (CON-03) as the bridge part quotes it: compact JSON, without the noise. */
export const manifestForPrompt = (): string => JSON.stringify(plainSchema(bridgeManifest()));

/** The UI standard's variables, one per line, from the one definition of its tokens (VER-06). */
const tokenLines = () =>
  Object.entries(UI_TOKENS)
    .map(([name, value]) => `- --ui-${name}: ${value}`)
    .join("\n");

export type PromptInput = {
  stage: GenerationStage;
  /** What the person asked, in their words. */
  request: string;
  /** The intent stage's answer, when there is one: its fields choose parts (GEN-02). */
  intent?: Intent;
  /** The tool's UI mode: the UI standard's part goes only to a tool in standard mode. */
  uiMode: Artifact["ui"]["mode"];
  /** The tool's code now: edit, and the repair of an edit, change it. */
  source?: Artifact["code"];
  /** Original declarations for an edit; never the workspace's own records. */
  editArtifact?: Artifact;
  /** A failed edit answer, quoted independently of its original source. */
  editAttempt?: Extract<Edit, { outcome: "edit" }>;
  /** The answer that failed, when repair follows creation: repair answers again in full. */
  attempt?: Extract<Creation, { outcome: "tool" }>;
  /** Why the last attempt failed: repair takes that class's part (GEN-09). */
  failure?: RepairClass;
  /** What the checks found, in plain words: repair fixes it (GEN-09). */
  diagnostics?: readonly string[];
};

export type AssembledPrompt = {
  /** The stage's instructions: the parts that don't depend on the request. */
  system: string;
  /** The request, with the quoted material it needs. */
  prompt: string;
  /** Each part used, as `name@version`, in order, for the ledger (ENG-16). */
  parts: string[];
  /** The whole prompt's size in characters, instructions and request together (GEN-03). */
  size: number;
};

/**
 * Builds a generation stage's prompt from the parts it needs. The instructions always have the
 * base rules; the bridge manifest unless the intent says the request only changes the look; the
 * UI standard's look for a tool in standard mode; and the accessibility rules, in either mode.
 * The request has the person's words; edit adds the tool's code. Repair adds its failure class's
 * part and what the checks found, with the tool's code when it repairs an edit, or the create
 * part and the failed answer, if there was one in the right shape, when it repairs a creation.
 */
export function assemblePrompt(input: PromptInput): AssembledPrompt {
  const { stage } = input;
  if (stage === "edit" && input.source === undefined) {
    throw new Error("The edit stage needs the tool's code.");
  }
  if (stage === "repair" && !input.diagnostics?.length) {
    throw new Error("The repair stage needs what the checks found.");
  }
  if (stage === "repair" && input.failure === undefined) {
    throw new Error("The repair stage needs the failure's class.");
  }
  if (input.source !== undefined && input.attempt !== undefined) {
    throw new Error("A repair follows either an edit or a creation, not both.");
  }
  // Repairing a creation: the tool's code isn't stored yet, so the stage answers as creation does.
  const creating = stage === "create" || (stage === "repair" && input.source === undefined);
  // Each part with the text it adds. A system part's version covers its generated content too;
  // a request part's covers only its wording, since what it quotes changes with every call.
  const system: [PromptPart, string, string][] = [];
  const addSystem = (part: PromptPart, values?: Record<string, string>) => {
    const text = fillPart(part, values);
    system.push([part, text, partVersion(text)]);
  };
  addSystem("base");
  if (!input.intent?.lookOnly) {
    addSystem("bridge", { manifest: manifestForPrompt() });
  }
  if (input.uiMode === "standard") {
    addSystem(input.editArtifact ? "ui-edit" : "ui-standard", {
      version: String(UI_STANDARD_VERSION),
      tokens: tokenLines(),
    });
  }
  // In custom mode too: a custom look drops the standard's look, never its accessibility (UX-04).
  addSystem("accessibility");
  // What creation answers, with the data schema keywords the host accepts (DATA-03, GEN-05).
  if (creating) {
    addSystem("create", { keywords: [...TOOL_SCHEMA_KEYWORDS].sort().join(", ") });
  }
  if (input.editArtifact)
    addSystem("edit", { keywords: [...TOOL_SCHEMA_KEYWORDS].sort().join(", ") });
  if (stage === "repair")
    addSystem(
      input.editArtifact && input.failure === "smoke"
        ? "repair-edit-smoke"
        : `repair-${input.failure!}`,
    );
  const request: [PromptPart, string, string][] = [];
  const addRequest = (part: PromptPart, values: Record<string, string>) =>
    request.push([part, fillPart(part, values), partVersion(partText(part))]);
  addRequest("request", { request: input.request });
  // The language the intent stage found, given as a fact, so the tool's words never depend on the
  // model guessing it (GEN-15).
  if (input.intent) addRequest("language", { language: input.intent.language });
  if (input.source) addRequest("source", { ...input.source });
  if (input.editArtifact) {
    const { data, capabilities, pins, ui } = input.editArtifact;
    addRequest("edit-declarations", {
      declarations: JSON.stringify({
        data,
        capabilities,
        pins,
        ui,
        requestedChange: {
          lookOnly: input.intent?.lookOnly ?? false,
          behaviorChange: input.intent?.behaviorChange ?? false,
        },
      }),
    });
  }
  if (input.editAttempt) addRequest("edit-attempt", { attempt: JSON.stringify(input.editAttempt) });
  if (stage === "repair" && input.attempt) {
    const { name, summary, code, data, capabilities, uiMode } = input.attempt;
    addRequest("attempt", {
      name,
      summary,
      ...code,
      data: JSON.stringify(data, null, 2),
      settings: JSON.stringify({ capabilities, uiMode }),
    });
  }
  if (stage === "repair") {
    addRequest("diagnostics", {
      diagnostics: input.diagnostics!.map((line) => `- ${line}`).join("\n"),
    });
  }
  const joined = (parts: [PromptPart, string, string][]) =>
    parts.map(([, text]) => text).join("\n\n");
  const assembled = { system: joined(system), prompt: joined(request) };
  return {
    ...assembled,
    parts: [...system, ...request].map(([part, , version]) => `${part}@${version}`),
    size: assembled.system.length + assembled.prompt.length,
  };
}

/**
 * The intent stage's budget, like the generation stages' (GEN-03): its fixture, a second ask in a
 * tool with two lists, measured about 4,450 characters when set.
 */
export const INTENT_PROMPT_BUDGET = 4_900;

/** A list of records the open tool keeps, with its fields, as its data shape declares them. */
export type RecordList = { name: string; fields: string[] };

/** What the intent stage is told about the tool open now, or null when none is (ADR 0008). */
export type OpenTool = { name: string; lists: RecordList[] } | null;

/**
 * Builds the intent stage's prompt (GEN-01): its instructions, then the open tool with the lists
 * of records it keeps, which decide data against mixed (ADR 0008), and the request. `retry` adds
 * the reminder for a second ask, after a mixed answer whose parts weren't the request's words.
 */
export function assembleIntentPrompt(input: {
  request: string;
  open: OpenTool;
  retry?: boolean;
}): AssembledPrompt {
  const used: string[] = [];
  const use = (part: PromptPart, values?: Record<string, string>) => {
    used.push(`${part}@${partVersion(partText(part))}`);
    return fillPart(part, values);
  };
  const system = use("intent");
  // Each part's version covers its wording; what it quotes changes with every call. The tool's
  // name and lists come from the tool itself, so they are quoted as JSON between markers, data
  // and never instructions (SEC-02): a newline or an instruction in a name stays inside a string.
  const tool = (open: NonNullable<OpenTool>) =>
    JSON.stringify({
      name: open.name,
      lists: Object.fromEntries(open.lists.map((list) => [list.name, list.fields])),
    });
  const open = !input.open
    ? use("intent-none")
    : input.open.lists.length === 0
      ? `${use("intent-open", { tool: tool(input.open) })}\n${use("intent-no-records")}`
      : use("intent-open", { tool: tool(input.open) });
  let prompt = use("intent-request", { open, request: input.request });
  if (input.retry) prompt += `\n\n${use("intent-retry")}`;
  return { system, prompt, parts: used, size: system.length + prompt.length };
}

/** A fixed part used as it is, such as the probe's: its text and its `name@version`. */
export function fixedPart(part: PromptPart): { text: string; part: string } {
  const text = fillPart(part);
  return { text, part: `${part}@${partVersion(text)}` };
}
