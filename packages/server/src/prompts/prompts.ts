import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  bridgeManifest,
  CHART_LIMITS,
  CHART_TYPES,
  PROFILE_IDS,
  PROFILES,
  REVIEW_RUBRIC,
  type Artifact,
  type Creation,
  type Edit,
  type FailureClass,
  type Intent,
  type AcceptanceChecks,
  type ReviewItem,
  type Stage,
} from "@tessera/contracts";
import { UI_STANDARD_VERSION, UI_TOKENS } from "@tessera/runtime/policy";
import { TOOL_SCHEMA_KEYWORDS } from "../data-shape/index.ts";

// Prompts are built from parts (GEN-03), each a file in packages/server/prompts (ENG-16), so every
// change to one is reviewed like code. A part's version is a hash of its text, recorded with each
// call, so a change in outcomes can be traced to the prompt that produced it. Parts are chosen by
// the stage and the intent's structured fields, never by matching words in the request (GEN-02).
// The bridge manifest (CON-03), the UI standard's variables (VER-06) and the verification profiles
// (VER-03, VER-04) are generated into their parts from their one definitions.

const PROMPTS_FOLDER = fileURLToPath(new URL("../../prompts/", import.meta.url));

/** Every prompt part, by the name of its file in packages/server/prompts. */
export const PROMPT_PARTS = [
  "base",
  "bridge",
  "ui-standard",
  "ui-edit",
  "accessibility",
  "profile",
  "chart",
  "request",
  "source",
  "source-style",
  "attempt",
  "diagnostics",
  "create",
  "core",
  "edit",
  "edit-declarations",
  "edit-attempt",
  "repair-edit-smoke",
  "repair-edit-behavior",
  "repair-behavior",
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
  "intent-saved",
  "intent-no-saved",
  "intent-retry",
  "intent-proposal",
  "data-plan",
  "data-context",
  "repair-data-plan",
  "data-attempt",
  "review",
  "review-run",
  "acceptance",
  "acceptance-checks",
  "acceptance-quoted",
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
  "behavior",
] as const satisfies readonly FailureClass[];
export type RepairClass = (typeof REPAIR_CLASSES)[number];

/**
 * The largest prompt, instructions and request together, in characters, that each stage's fixture
 * may reach (GEN-03), about a tenth above what they measured when set: a test fails past it, so a
 * part can't grow unnoticed. The POC's one prompt reached about 18,000. Repair's covers its larger
 * shape, the repair of a creation: the creation prompt with the failed answer quoted, about 21,400
 * when set (GEN-09). Edit's rose from 18,500 in M3 for the verification profile's part, which states
 * every rule a profile's check enforces (VER-04, #273): its fixture with the part measured 18,835;
 * the owner approved 20,000 on 2026-11-08. With the chart part too (CAP-04, #283), the largest edit,
 * the filtering profile's and a chart's, measured 20,306, and the owner approved 22,000 the same
 * day, room for the chart profile's part.
 * Creation's fixture is a creation that fits a profile, its largest shape: with the item list,
 * 16,997 when set at 17,000; with the filtering profile, 17,530, and the owner approved 20,000 on
 * 2026-11-08, room for the profiles still to come. Every profile's part is measured in both, with
 * and without the chart part.
 */
export const PROMPT_BUDGETS: Readonly<Record<GenerationStage, number>> = {
  create: 20_000,
  edit: 22_000,
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
 * The tag every marker of a prompt's quoted material carries (SEC-02): a short hash of that
 * material, skipping any tag that appears in it, so no quoted text can hold the marker that ends
 * its quote and have what follows read as instructions. The same material always gets the same
 * tag, so a prompt stays the same for the same call.
 */
export function quoteTag(quoted: readonly string[]): string {
  for (let attempt = 0; ; attempt++) {
    const hash = createHash("sha256").update(JSON.stringify([attempt, ...quoted]));
    const tag = `q${hash.digest("hex").slice(0, 8)}`;
    if (!quoted.some((text) => text.includes(tag))) return tag;
  }
}

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
        // A strict empty object already says that an action takes no arguments.
        if (
          schema["type"] === "object" &&
          schema["additionalProperties"] === false &&
          typeof schema["properties"] === "object" &&
          schema["properties"] !== null &&
          Object.keys(schema["properties"]).length === 0 &&
          (key === "properties" || key === "description")
        )
          return false;
        if (key === "$schema") return false;
        if (key === "pattern" && "format" in schema) return false;
        if (key === "minimum" && item === Number.MIN_SAFE_INTEGER) return false;
        if (key === "maximum" && item === Number.MAX_SAFE_INTEGER) return false;
        return true;
      })
      .map(([key, item]) => {
        // JSON object keys are always strings; propertyNames cannot see another type.
        if (key === "propertyNames" && item !== null && typeof item === "object") {
          const { type, ...constraints } = item as Record<string, unknown>;
          if (type === "string") return [key, plainSchema(constraints)];
        }
        return [key, plainSchema(item)];
      }),
  );
}

/** The bridge manifest (CON-03) as the bridge part quotes it: compact JSON, without the noise. */
export const manifestForPrompt = (): string => {
  const manifest = bridgeManifest();
  // The host's page-isolation metadata is not an instruction to the model.
  return JSON.stringify(
    plainSchema({
      ...manifest,
      methods: Object.fromEntries(
        Object.entries(manifest.methods).map(([name, method]) => [name, method.argument]),
      ),
    }),
  );
};

/** The UI standard's variables, one per line, from the one definition of its tokens (VER-06). */
const tokenLines = () =>
  Object.entries(UI_TOKENS)
    .map(([name, value]) => `- --ui-${name}: ${value}`)
    .join("\n");

export type PromptInput = {
  stage: GenerationStage;
  /** What the person asked, in their words. */
  request: string;
  /**
   * A big new tool's two-pass plan (GEN-17): what the core pass builds now and what comes later,
   * quoted as JSON. Creation and its repairs keep to the core.
   */
  core?: {
    core: readonly { name: string; request: string }[];
    later: readonly { name: string; request: string }[];
  };
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
  /**
   * The checks written from the request (VER-09, an M3 experiment), for a new tool that fits no
   * profile: their hooks and what each checks are stated as requirements, as a profile's are.
   */
  acceptance?: AcceptanceChecks;
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

/** The profile part's values: each hook with what it marks, and each rule. */
function profileValues(id: keyof typeof PROFILES): Record<string, string> {
  const profile = PROFILES[id];
  return {
    hooks: profile.hooks.map((hook) => `- data-hook="${hook.name}": ${hook.says}.`).join("\n"),
    rules: profile.rules.map((rule) => `- ${rule}`).join("\n"),
  };
}

/** A request's checks as the generation prompt quotes them: their hooks and checks, as data. */
const acceptanceQuoted = (acceptance: AcceptanceChecks) => ({
  hooks: acceptance.hooks,
  checks: acceptance.checks,
});

/** The intent part's list of profiles, from their one definitions (VER-03). */
export const profilesForIntent = (): string =>
  PROFILE_IDS.map((id) => `  - ${id}: ${PROFILES[id].fits}.`).join("\n");

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
  // How to draw a chart through the host (CAP-04, ADR 0014), for a tool that will show one or
  // already declares chart: the spec in words, from its one definition's types and limits.
  if (
    input.intent?.drawsCharts ||
    input.editArtifact?.capabilities.includes("chart") ||
    input.attempt?.capabilities.includes("chart")
  ) {
    addSystem("chart", {
      types: CHART_TYPES.join(", "),
      title: String(CHART_LIMITS.title),
      labels: String(CHART_LIMITS.labels),
      series: String(CHART_LIMITS.series),
      text: String(CHART_LIMITS.text),
    });
  }
  // A verification profile's hooks and rules, from its one definition, when the tool will fit it:
  // every rule its check enforces is stated here (VER-03, VER-04).
  if (input.intent?.profile) addSystem("profile", profileValues(input.intent.profile));
  // The checks written from the request, for a tool that fits no profile (VER-09): the system says
  // to pass them, in fixed words; the checks themselves, another model's answer, are quoted as data
  // in the request, so nothing in them is read as instructions (SEC-02).
  const acceptance = input.acceptance && !input.intent?.profile ? input.acceptance : undefined;
  if (acceptance) addSystem("acceptance-checks");
  // What creation answers, with the data schema keywords the host accepts (DATA-03, GEN-05).
  if (creating) {
    addSystem("create", { keywords: [...TOOL_SCHEMA_KEYWORDS].sort().join(", ") });
  }
  if (input.editArtifact)
    addSystem("edit", { keywords: [...TOOL_SCHEMA_KEYWORDS].sort().join(", ") });
  if (stage === "repair")
    addSystem(
      input.editArtifact && (input.failure === "smoke" || input.failure === "behavior")
        ? `repair-edit-${input.failure}`
        : `repair-${input.failure!}`,
    );
  // One tag for every marker in this prompt, from all it quotes as raw text (SEC-02).
  const tag = quoteTag([
    ...(input.source ? [input.source.html, input.source.css, input.source.js] : []),
    ...(stage === "repair" && input.attempt
      ? [
          input.attempt.name,
          input.attempt.summary,
          ...Object.values(input.attempt.code),
          JSON.stringify(input.attempt.data, null, 2),
        ]
      : []),
    ...(input.diagnostics ?? []),
    ...(acceptance ? [JSON.stringify(acceptanceQuoted(acceptance), null, 2)] : []),
  ]);
  const request: [PromptPart, string, string][] = [];
  const addRequest = (part: PromptPart, values: Record<string, string>) =>
    request.push([part, fillPart(part, values), partVersion(partText(part))]);
  addRequest("request", { request: input.request });
  // The language the intent stage found, given as a fact, so the tool's words never depend on the
  // model guessing it (GEN-15).
  if (input.intent) addRequest("language", { language: input.intent.language });
  // The core pass's scope, as data: what to build now and what to leave for later (GEN-17).
  if (input.core && creating) {
    addRequest("core", {
      core: JSON.stringify(input.core.core),
      later: JSON.stringify(input.core.later),
    });
  }
  // A look-only edit needs the page's structure for its selectors and the style it changes, never
  // the behavior, which stays identical (GEN-14).
  if (input.source && input.intent?.lookOnly) {
    addRequest("source-style", { html: input.source.html, css: input.source.css, tag });
  } else if (input.source) addRequest("source", { ...input.source, tag });
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
  if (input.editAttempt) {
    // A look-only edit's failed answer is quoted as its style alone, whatever mode it came in, so
    // no repair path brings the JavaScript back into the prompt (GEN-14).
    const attempt = input.editAttempt;
    const scoped =
      input.intent?.lookOnly && attempt.files.mode === "replace"
        ? { ...attempt, files: { mode: "style" as const, css: attempt.files.code.css } }
        : attempt;
    addRequest("edit-attempt", { attempt: JSON.stringify(scoped) });
  }
  if (stage === "repair" && input.attempt) {
    const { name, summary, code, data, capabilities, uiMode } = input.attempt;
    addRequest("attempt", {
      name,
      summary,
      ...code,
      data: JSON.stringify(data, null, 2),
      settings: JSON.stringify({ capabilities, uiMode }),
      tag,
    });
  }
  if (acceptance) {
    addRequest("acceptance-quoted", {
      checks: JSON.stringify(acceptanceQuoted(acceptance), null, 2),
      tag,
    });
  }
  if (stage === "repair") {
    addRequest("diagnostics", {
      diagnostics: input.diagnostics!.map((line) => `- ${line}`).join("\n"),
      tag,
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
 * The intent stage's budget, like the generation stages' (GEN-03): its largest shape, a second ask in a
 * tool with two lists with a full catalogue of saved tools (GEN-18), measured about 8,100 characters
 * when set.
 */
export const INTENT_PROMPT_BUDGET = 8_900;

/** Includes the actual entries: oversized contexts are refused before spending a call. */
export const DATA_PROMPT_BUDGET = 12_000;

/** Builds the isolated data stage; no source code or interface instruction is included (GEN-04). */
export function assembleDataPrompt(input: {
  request: string;
  language: string;
  schema: Artifact["data"]["schema"];
  data: Artifact["data"]["defaults"];
  revisions: Record<string, Record<string, number>>;
  diagnostics?: readonly string[];
  attempt?: unknown;
}): AssembledPrompt {
  const parts: string[] = [];
  const use = (part: PromptPart, values?: Record<string, string>) => {
    const filled = fillPart(part, values);
    parts.push(`${part}@${partVersion(partText(part))}`);
    return filled;
  };
  const system = [use("data-plan"), ...(input.diagnostics ? [use("repair-data-plan")] : [])].join(
    "\n\n",
  );
  const prompt = [
    use("request", { request: input.request }),
    use("language", { language: input.language }),
    use("data-context", {
      context: JSON.stringify({
        schema: input.schema,
        data: input.data,
        revisions: input.revisions,
      }),
    }),
    ...(input.diagnostics
      ? [
          use("diagnostics", {
            diagnostics: input.diagnostics.join("\n"),
            tag: quoteTag(input.diagnostics),
          }),
        ]
      : []),
    ...(input.attempt ? [use("data-attempt", { attempt: JSON.stringify(input.attempt) })] : []),
  ].join("\n\n");
  return { system, prompt, parts, size: system.length + prompt.length };
}

/** A list of records the open tool keeps, with its fields, as its data shape declares them. */
export type RecordList = { name: string; fields: string[] };

/** What the intent stage is told about the tool open now, or null when none is (ADR 0008). */
export type OpenTool = { name: string; lists: RecordList[] } | null;

/** A saved tool as the intent stage sees it, to find one by asking (GEN-18). */
export type SavedToolEntry = { id: string; name: string; description: string };

/**
 * Builds the intent stage's prompt (GEN-01): its instructions, then the open tool with the lists
 * of records it keeps, which decide data against mixed (ADR 0008), the saved tools it may open
 * (GEN-18), and the request. `retry` adds the reminder for a second ask, after a mixed answer
 * whose parts weren't the request's words.
 */
export function assembleIntentPrompt(input: {
  request: string;
  open: OpenTool;
  /** The catalogue, already chosen and in order (`savedToolCatalogue`); none when left out. */
  saved?: readonly SavedToolEntry[];
  /** What the entry changes waiting for review do; none wait when left out. */
  proposal?: string;
  retry?: boolean;
}): AssembledPrompt {
  const used: string[] = [];
  const use = (part: PromptPart, values?: Record<string, string>) => {
    used.push(`${part}@${partVersion(partText(part))}`);
    return fillPart(part, values);
  };
  // The system part's version covers the profiles generated into it.
  const system = fillPart("intent", { profiles: profilesForIntent() });
  used.push(`intent@${partVersion(system)}`);
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
  // The saved tools' names and descriptions are the person's or a model's words: quoted as JSON
  // too, so none of them can read as an instruction (SEC-02).
  const saved = input.saved?.length
    ? use("intent-saved", {
        tools: JSON.stringify(
          input.saved.map(({ id, name, description }) => ({ id, name, description })),
        ),
      })
    : use("intent-no-saved");
  // The waiting changes' summary is a model's words: quoted as JSON too (SEC-02).
  const context = input.proposal
    ? `${open}\n\n${use("intent-proposal", { proposal: JSON.stringify(input.proposal) })}`
    : open;
  let prompt = use("intent-request", { open: context, saved, request: input.request });
  if (input.retry) prompt += `\n\n${use("intent-retry")}`;
  return { system, prompt, parts: used, size: system.length + prompt.length };
}

/** A fixed part used as it is, such as the probe's: its text and its `name@version`. */
export function fixedPart(part: PromptPart): { text: string; part: string } {
  const text = fillPart(part);
  return { text, part: `${part}@${partVersion(text)}` };
}

/**
 * The review stage's budget (GEN-03): a run's steps and the final source of every version of its
 * tools, quoted whole, are most of it. T10's rerun, two tools with their versions, measured about
 * 26,500 characters in its rehearsal; the screenshots go as images, outside it.
 */
export const REVIEW_PROMPT_BUDGET = 120_000;

/** One step of a run, as the reviewer reads it: what was done, what the host said and found. */
export type ReviewStep = {
  step: number;
  action: string;
  outcome: string;
  message: string;
  problems: readonly string[];
  /** The step's screenshot, by the name it has among the images, when one is attached. */
  screenshot?: string;
};

/** One version of one tool, as the reviewer reads it: what it was made for, its checks, its code. */
export type ReviewVersion = {
  tool: string;
  version: number;
  summary: string;
  checks: readonly string[];
  profile: string | null;
  html: string;
  css: string;
  js: string;
};

/**
 * One tool's data as the reviewer reads it (L-92): its entries at the end of the run, and each
 * data change the run recorded, oldest first, with what each record held before it. A tool's
 * starting entries are its data, not its source, so without this a reviewer can't see them.
 */
export type ReviewData = {
  tool: string;
  /** The tool's entries when the run ended, as JSON; cut short past a few thousand characters. */
  atEnd: string;
  changes: readonly {
    /** What the change did to each record it touched, or "replaced whole" for a whole replace. */
    records: readonly { collection: string; id: string; change: string; before: unknown }[];
  }[];
};

/**
 * Builds the review stage's prompt (EVAL-03): the rubric as its one definition words it, then the
 * run's steps and the source of each version, quoted as data, and the names of the screenshots
 * attached as images, or why none are (A27).
 */
export function assembleReviewPrompt(input: {
  scenario: string;
  items: readonly ReviewItem[];
  steps: readonly ReviewStep[];
  versions: readonly ReviewVersion[];
  /** Each tool's data at the end of the run and its recorded changes (L-92). */
  data?: readonly ReviewData[];
  images: readonly string[];
  /** Why no screenshot is attached, when none is: the adapter can't pass images, or none were kept. */
  noImages?: string;
}): AssembledPrompt {
  const parts: string[] = [];
  const use = (part: PromptPart, values?: Record<string, string>) => {
    const filled = fillPart(part, values);
    parts.push(`${part}@${partVersion(partText(part))}`);
    return filled;
  };
  const rubric = input.items.map((item) => `- ${item}: ${REVIEW_RUBRIC[item]}`).join("\n");
  const system = use("review", { rubric });
  const run = JSON.stringify(
    { steps: input.steps, versions: input.versions, data: input.data ?? [] },
    null,
    1,
  );
  const images = input.images.length
    ? `The screenshots are attached as images, in this order: ${input.images.join(", ")}.`
    : `No screenshots are attached: ${input.noImages ?? "none were kept"}. Judge from the rest, and mark what only a screenshot could show as unverified.`;
  const prompt = use("review-run", {
    scenario: input.scenario,
    items: input.items.join(", "),
    run,
    tag: quoteTag([run]),
    images,
  });
  return { system, prompt, parts, size: system.length + prompt.length };
}

/** The acceptance stage's budget (GEN-03): its instructions and the request, measured about 2,300. */
export const ACCEPTANCE_PROMPT_BUDGET = 4_000;

/**
 * Builds the acceptance stage's prompt (VER-09): its instructions, then the person's request and
 * language. It sees nothing of the tool; another stage writes that.
 */
export function assembleAcceptancePrompt(input: {
  request: string;
  language: string;
}): AssembledPrompt {
  const parts: string[] = [];
  const use = (part: PromptPart, values?: Record<string, string>) => {
    const filled = fillPart(part, values);
    parts.push(`${part}@${partVersion(partText(part))}`);
    return filled;
  };
  const system = use("acceptance");
  const prompt = [
    use("request", { request: input.request }),
    use("language", { language: input.language }),
  ].join("\n\n");
  return { system, prompt, parts, size: system.length + prompt.length };
}
