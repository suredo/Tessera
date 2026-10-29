import {
  artifactSchema,
  ARTIFACT_CONTRACT_VERSION,
  collectionName,
  creationSchema,
  fieldName,
  recordIdSchema,
  TOOL_DATA_LIMIT_BYTES,
  type Artifact,
  type Creation,
  type FailureClass,
  type Intent,
} from "@tessera/contracts";
import { UI_STANDARD_VERSION } from "@tessera/runtime/policy";
import { staticCheck } from "../checks/index.ts";
import { checkToolData, compileToolSchema } from "../data-shape/index.ts";
import { assemblePrompt, REPAIR_CLASSES, type RepairClass } from "../prompts/index.ts";
import { ProviderError, runStage, type Provider, type Routes } from "../providers/index.ts";

// The create stage (GEN-04, GEN-05): a request becomes a candidate tool, checked by the host before
// anything is stored or run. The model's answer is a discriminated union (CON-02); a tool's data
// declares its shape, reusable defaults and the request's own entries apart; and every failure is
// classed. A failure of the host's own checks is repaired by its class, within its budget (GEN-09);
// staging and activation come after this stage.

/** How long creation may take: the POC's creations took 105 to 131 s (GEN-11). */
export const GENERATION_TIME_LIMIT_MS = 180_000;

/** How long one repair may take: as long as creation, which it answers like (GEN-11). */
export const REPAIR_TIME_LIMIT_MS = 180_000;

/**
 * How many repairs each failure class gets in one request (GEN-09). A repair that fails in
 * another class can still use that class's repair. Each is a model call, counted by the ledger.
 */
export const REPAIR_BUDGETS: Readonly<Record<RepairClass, number>> = {
  "schema-shape": 1,
  static: 1,
  smoke: 1,
};

type ToolData = Artifact["data"]["defaults"];

/** A checked candidate: the version to stage, and the data a new workspace starts with. */
export type Candidate = {
  artifact: Artifact;
  /** The reusable defaults with the request's own entries added (GEN-05). */
  startingData: ToolData;
  name: string;
  summary: string;
};

export type CreateResult = (
  | ({ kind: "candidate" } & Candidate)
  | { kind: "cannot"; reason: string }
  | {
      kind: "failed";
      /** Which repair, if any, can fix it; a provider failure is never repaired (GEN-09). */
      failure: FailureClass;
      /** What is wrong, for repair or the details view (GEN-10). */
      findings: string[];
      /** The provider's own failure, when that was the cause. */
      error?: ProviderError;
    }
) & {
  /** How many repairs it took, counted apart from the first attempt (A40). */
  repairs?: number;
};

/**
 * The data a new workspace starts with: the reusable defaults, with each list the request gave
 * entries for extended by them, and any other value the request gave in place of the default's.
 */
export function startingDataOf(defaults: ToolData, initialState: ToolData): ToolData {
  const data: ToolData = { ...defaults };
  for (const [key, value] of Object.entries(initialState)) {
    const before = data[key];
    data[key] = Array.isArray(before) && Array.isArray(value) ? [...before, ...value] : value;
  }
  return data;
}

/** Whether the schema says a top-level list holds something other than objects, such as text. */
function listOfValues(schema: object, list: string): boolean {
  const property = (schema as { properties?: Record<string, { items?: { type?: unknown } }> })
    .properties?.[list];
  // `type` may be one name or a list of them: only one that rules out objects makes it values.
  const type = property?.items?.type;
  if (typeof type === "string") return type !== "object";
  if (Array.isArray(type)) return !type.includes("object");
  return false;
}

/**
 * Every record the tool keeps can be changed through the patch engine (DATA-02), which counts a
 * top-level list as records only when every item is one, with an id. So a list holding any object
 * holds only records; a list of records, or an empty list the schema doesn't declare as holding
 * other values, has a name a change can address; and each record has an id and field names the
 * patch contract accepts, its id unique in its list. One definition: the patch contract's own.
 */
function recordProblems(schema: object, data: ToolData, what: string): string[] {
  const problems: string[] = [];
  const isObject = (item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item);
  for (const [list, value] of Object.entries(data)) {
    if (!Array.isArray(value)) continue;
    const records = value.filter(isObject) as Record<string, unknown>[];
    const holdsRecords = records.length > 0 || (value.length === 0 && !listOfValues(schema, list));
    if (!holdsRecords) continue;
    if (!collectionName.safeParse(list).success) {
      problems.push(
        `${what}: the list "${list}" needs a name of letters, digits and _ that starts with a letter.`,
      );
    }
    if (records.length !== value.length) {
      problems.push(
        `${what}: the list "${list}" mixes records with other values; keep records apart.`,
      );
    }
    const seen = new Set<string>();
    records.forEach((record, index) => {
      const id = record["id"];
      if (!recordIdSchema.safeParse(id).success) {
        problems.push(
          `${what}: record ${index + 1} in "${list}" needs an id of letters, digits, _ and - (up to 64).`,
        );
      } else if (seen.has(id as string)) {
        problems.push(`${what}: the id "${id as string}" is used twice in "${list}".`);
      } else {
        seen.add(id as string);
      }
      for (const field of Object.keys(record)) {
        if (field !== "id" && !fieldName.safeParse(field).success) {
          problems.push(
            `${what}: the field "${field}" in "${list}" needs a name of letters, digits and _ that starts with a letter.`,
          );
        }
      }
    });
  }
  return problems;
}

/**
 * The host's checks on a created tool, before anything is stored or run: its data shape, its
 * defaults and starting data against it, the artifact contract, then the static check (VER-01).
 */
export function dataProblems(
  schema: object,
  reusableDefaults: ToolData,
  startingData: ToolData,
): string[] {
  const shape: string[] = [];
  const compiled = compileToolSchema(schema);
  if (!compiled.ok) {
    shape.push(compiled.reason);
  } else {
    for (const [what, data] of [
      ["The reusable defaults", reusableDefaults],
      ["The starting data", startingData],
    ] as const) {
      const fits = checkToolData(schema, data);
      if (!fits.ok) shape.push(`${what}: ${fits.reason}`);
      // Within the most data one tool may hold (DATA-06), before anything is stored.
      const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
      if (bytes > TOOL_DATA_LIMIT_BYTES) {
        shape.push(
          `${what}: it is ${Math.ceil(bytes / 1024)} KB, more than the ${TOOL_DATA_LIMIT_BYTES / 1024} KB a tool may hold.`,
        );
      }
      shape.push(...recordProblems(schema, data, what));
    }
  }
  return shape;
}

/** Builds a creation only after the shared data checks, artifact validation and static check. */
export function candidateFrom(creation: Extract<Creation, { outcome: "tool" }>): CreateResult {
  const { schema, reusableDefaults, initialState } = creation.data;
  const startingData = startingDataOf(reusableDefaults, initialState);
  const shape = dataProblems(schema, reusableDefaults, startingData);
  const built = {
    contractVersion: ARTIFACT_CONTRACT_VERSION,
    code: creation.code,
    data: { schemaVersion: 1, schema, defaults: reusableDefaults, migrations: [] },
    capabilities: [...new Set(creation.capabilities)].sort(),
    pins: [],
    ui: { standardVersion: UI_STANDARD_VERSION, mode: creation.uiMode },
  };
  const artifact = artifactSchema.safeParse(built);
  if (!artifact.success) {
    shape.push(
      ...artifact.error.issues.map((issue) => `The tool ${issue.path.join(".")}: ${issue.message}`),
    );
  }
  if (shape.length > 0 || !artifact.success) {
    return { kind: "failed", failure: "schema-shape", findings: shape };
  }
  const checked = staticCheck(artifact.data.code);
  if (!checked.ok) {
    return {
      kind: "failed",
      failure: "static",
      findings: checked.findings.map(
        (f) =>
          `${f.part === "html" ? "HTML" : "JavaScript"}${f.line ? `, line ${f.line}` : ""}: ${f.message}`,
      ),
    };
  }
  return {
    kind: "candidate",
    artifact: artifact.data,
    startingData,
    name: creation.name,
    summary: creation.summary,
  };
}

export type CreateInput = {
  /** The interface part the intent stage decided on: the whole request when nothing is split. */
  request: string;
  intent?: Intent;
  signal?: AbortSignal;
  /** Counts carried across the server checks and browser staging of this request. */
  repairUsage?: Partial<Record<RepairClass, number>>;
  /** Resume creation at a repair after a failure reported by browser staging. */
  repair?: Repair;
};

const repairable = (failure: FailureClass): failure is RepairClass =>
  (REPAIR_CLASSES as readonly string[]).includes(failure);

/**
 * Asks the create stage for a tool, on its route (CLI-09), and checks what comes back. A failure of
 * the host's checks, or an answer of the wrong shape, is sent to repair on the repair route with
 * its class's part, what the checks found and the failed answer, while that class has repairs left
 * (GEN-09). A provider failure is classed "provider" and never repaired.
 */
export async function createTool(
  provider: Provider,
  routes: Routes,
  input: CreateInput,
): Promise<CreateResult> {
  const used = input.repairUsage ?? {};
  let repairs = 0;
  let attempt: Extract<Creation, { outcome: "tool" }> | undefined;
  if (input.repair?.failure) {
    const failure = input.repair.failure;
    if ((used[failure] ?? 0) >= REPAIR_BUDGETS[failure]) {
      return { kind: "failed", failure, findings: [...(input.repair.diagnostics ?? [])] };
    }
    used[failure] = (used[failure] ?? 0) + 1;
    repairs += 1;
    attempt = input.repair.attempt;
  }
  let result = await ask(provider, routes, input, input.repair ?? {});
  for (;;) {
    if (result.answer) attempt = result.answer;
    const { outcome } = result;
    if (outcome.kind !== "failed" || !repairable(outcome.failure)) break;
    const failure = outcome.failure;
    if ((used[failure] ?? 0) >= REPAIR_BUDGETS[failure]) break;
    used[failure] = (used[failure] ?? 0) + 1;
    repairs += 1;
    result = await ask(provider, routes, input, {
      failure,
      diagnostics: outcome.findings,
      // Only an answer of the right shape is quoted; a wrong-shape answer has none.
      attempt: outcome.error ? undefined : attempt,
    });
  }
  return repairs > 0 ? { ...result.outcome, repairs } : result.outcome;
}

type Repair = {
  failure?: RepairClass;
  diagnostics?: readonly string[];
  attempt?: Extract<Creation, { outcome: "tool" }>;
};

/** One call, creation or a repair, and the host's checks on its answer. */
async function ask(
  provider: Provider,
  routes: Routes,
  input: CreateInput,
  repair: Repair,
): Promise<{ outcome: CreateResult; answer?: Extract<Creation, { outcome: "tool" }> }> {
  const stage = repair.failure ? "repair" : "create";
  const prompt = assemblePrompt({
    stage,
    request: input.request,
    intent: input.intent,
    uiMode: repair.attempt?.uiMode ?? "standard",
    ...repair,
  });
  let creation: Creation;
  try {
    const result = await runStage(provider, routes, {
      stage,
      system: prompt.system,
      prompt: prompt.prompt,
      promptParts: prompt.parts,
      schema: creationSchema,
      timeLimitMs: stage === "repair" ? REPAIR_TIME_LIMIT_MS : GENERATION_TIME_LIMIT_MS,
      signal: input.signal,
    });
    creation = result.value;
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return {
      outcome: {
        kind: "failed",
        failure: error.kind === "schema" ? "schema-shape" : "provider",
        findings: [error.message],
        error,
      },
    };
  }
  if (creation.outcome === "cannot") {
    return { outcome: { kind: "cannot", reason: creation.reason } };
  }
  return { outcome: candidateFrom(creation), answer: creation };
}
