import {
  artifactSchema,
  ARTIFACT_CONTRACT_VERSION,
  creationSchema,
  type Artifact,
  type Creation,
  type FailureClass,
  type Intent,
} from "@tessera/contracts";
import { UI_STANDARD_VERSION } from "@tessera/runtime/policy";
import { staticCheck } from "../checks/index.ts";
import { checkToolData, compileToolSchema } from "../data-shape/index.ts";
import { assemblePrompt } from "../prompts/index.ts";
import { ProviderError, runStage, type Provider, type Routes } from "../providers/index.ts";

// The create stage (GEN-04, GEN-05): a request becomes a candidate tool, checked by the host before
// anything is stored or run. The model's answer is a discriminated union (CON-02); a tool's data
// declares its shape, reusable defaults and the request's own entries apart; and every failure is
// classed for repair (GEN-09). Staging, activation and repair come after this stage.

/** How long creation may take: the POC's creations took 105 to 131 s (GEN-11). */
export const GENERATION_TIME_LIMIT_MS = 180_000;

type ToolData = Artifact["data"]["defaults"];

/** A checked candidate: the version to stage, and the data a new workspace starts with. */
export type Candidate = {
  artifact: Artifact;
  /** The reusable defaults with the request's own entries added (GEN-05). */
  startingData: ToolData;
  name: string;
  summary: string;
};

export type CreateResult =
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

/** Every record in a top-level list has a string id, unique in its list (DATA-02). */
function idProblems(data: ToolData, what: string): string[] {
  const problems: string[] = [];
  for (const [list, value] of Object.entries(data)) {
    if (!Array.isArray(value)) continue;
    const seen = new Set<string>();
    value.forEach((record, index) => {
      if (record === null || typeof record !== "object" || Array.isArray(record)) return;
      const id = record["id"];
      if (typeof id !== "string" || id === "") {
        problems.push(`${what}: record ${index + 1} in "${list}" has no string id.`);
      } else if (seen.has(id)) {
        problems.push(`${what}: the id "${id}" is used twice in "${list}".`);
      } else {
        seen.add(id);
      }
    });
  }
  return problems;
}

/**
 * The host's checks on a created tool, before anything is stored or run: its data shape, its
 * defaults and starting data against it, the artifact contract, then the static check (VER-01).
 */
export function candidateFrom(creation: Extract<Creation, { outcome: "tool" }>): CreateResult {
  const { schema, reusableDefaults, initialState } = creation.data;
  const shape: string[] = [];
  const compiled = compileToolSchema(schema);
  const startingData = startingDataOf(reusableDefaults, initialState);
  if (!compiled.ok) {
    shape.push(compiled.reason);
  } else {
    for (const [what, data] of [
      ["The reusable defaults", reusableDefaults],
      ["The starting data", startingData],
    ] as const) {
      const fits = checkToolData(schema, data);
      if (!fits.ok) shape.push(`${what}: ${fits.reason}`);
      shape.push(...idProblems(data, what));
    }
  }
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
};

/**
 * Asks the create stage for a tool, on its route (CLI-09), and checks what comes back. A provider
 * failure is classed "provider" and never repaired, except an answer of the wrong shape, which
 * is "schema-shape" and is (GEN-09).
 */
export async function createTool(
  provider: Provider,
  routes: Routes,
  input: CreateInput,
): Promise<CreateResult> {
  const prompt = assemblePrompt({
    stage: "create",
    request: input.request,
    intent: input.intent,
    uiMode: "standard",
  });
  let creation: Creation;
  try {
    const result = await runStage(provider, routes, {
      stage: "create",
      system: prompt.system,
      prompt: prompt.prompt,
      promptParts: prompt.parts,
      schema: creationSchema,
      timeLimitMs: GENERATION_TIME_LIMIT_MS,
      signal: input.signal,
    });
    creation = result.value;
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return {
      kind: "failed",
      failure: error.kind === "schema" ? "schema-shape" : "provider",
      findings: [error.message],
      error,
    };
  }
  if (creation.outcome === "cannot") return { kind: "cannot", reason: creation.reason };
  return candidateFrom(creation);
}
