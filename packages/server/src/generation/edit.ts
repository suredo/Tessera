import {
  artifactSchema,
  canonicalJson,
  editSchema,
  type Artifact,
  type Edit,
  type Intent,
} from "@tessera/contracts";
import { staticCheck } from "../checks/index.ts";
import { migrateData } from "../data-shape/index.ts";
import { assemblePrompt, type RepairClass } from "../prompts/index.ts";
import { ProviderError, runStage, type Provider, type Routes } from "../providers/index.ts";
import {
  dataProblems,
  GENERATION_TIME_LIMIT_MS,
  REPAIR_BUDGETS,
  REPAIR_TIME_LIMIT_MS,
  type CreateResult,
} from "./create.ts";

type Answer = Extract<Edit, { outcome: "edit" }>;
type Repair = { failure: RepairClass; diagnostics: readonly string[]; attempt?: Answer };
export type EditInput = {
  request: string;
  artifact: Artifact;
  data: Artifact["data"]["defaults"];
  intent?: Intent;
  signal?: AbortSignal;
  repairUsage?: Partial<Record<RepairClass, number>>;
  repair?: Repair;
};
export type EditResult = (
  | { kind: "candidate"; artifact: Artifact; summary: string }
  | { kind: "unchanged" }
  | Extract<CreateResult, { kind: "failed" | "cannot" }>
) & { repairs?: number };
const shapeFailure = (findings: string[]): EditResult => ({
  kind: "failed",
  failure: "schema-shape",
  findings,
});

/** Host validation, on copies; no workspace writes and no model-owned lifecycle fields (GEN-07). */
export function editedCandidate(input: EditInput, answer: Answer): EditResult {
  const before = input.artifact;
  let data = before.data;
  if (answer.data.mode === "migrate") {
    if (input.intent?.lookOnly)
      return shapeFailure(["A style edit must keep the data declaration."]);
    if (!input.intent?.behaviorChange)
      return shapeFailure(["A data declaration change needs a requested behavior change."]);
    const { migration, schema, defaults } = answer.data;
    const problems = dataProblems(schema, defaults, defaults);
    if (problems.length) return shapeFailure(problems);
    if (
      migration.fromVersion !== data.schemaVersion ||
      migration.toVersion !== data.schemaVersion + 1
    ) {
      return shapeFailure(["The migration must go from the current data version to the next."]);
    }
    if (canonicalJson(schema) === canonicalJson(data.schema)) {
      return shapeFailure(["Keep the data unchanged when its shape has not changed."]);
    }
    data = {
      schemaVersion: migration.toVersion,
      schema,
      defaults,
      migrations: [...data.migrations, migration],
    };
  }
  const built = artifactSchema.safeParse({
    ...before,
    data,
    code: answer.files.mode === "replace" ? answer.files.code : before.code,
  });
  if (!built.success)
    return shapeFailure(built.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const artifact = built.data;
  const findings = dataProblems(data.schema, data.defaults, data.defaults);
  if (findings.length) return shapeFailure(findings);
  for (const [what, original] of [
    ["Current data", input.data],
    ["Reusable defaults", before.data.defaults],
  ] as const) {
    const migrated = migrateData(original, before.data, data, { trackLosses: true });
    if (!migrated.ok) return shapeFailure([`${what}: ${migrated.message}`]);
    if (migrated.losses.length)
      return shapeFailure([`${what}: the edit would remove or replace existing values.`]);
    const problems = dataProblems(data.schema, data.defaults, migrated.data);
    if (problems.length) return shapeFailure(problems);
    if (
      what === "Reusable defaults" &&
      canonicalJson(migrated.data) !== canonicalJson(data.defaults)
    ) {
      return shapeFailure(["Keep the reusable defaults, applying only the declared migration."]);
    }
  }
  if (
    input.intent?.lookOnly &&
    (artifact.code.html !== before.code.html || artifact.code.js !== before.code.js)
  ) {
    return {
      kind: "failed",
      failure: "static",
      findings: ["A style edit must keep HTML and JavaScript identical."],
    };
  }
  const checked = staticCheck(artifact.code);
  if (!checked.ok)
    return {
      kind: "failed",
      failure: "static",
      findings: checked.findings.map(
        (f) => `${f.part}${f.line ? `, line ${f.line}` : ""}: ${f.message}`,
      ),
    };
  return canonicalJson(artifact) === canonicalJson(before)
    ? { kind: "unchanged" }
    : { kind: "candidate", artifact, summary: answer.summary };
}

/** Edit and per-class repair use the same output contract and host checks (CON-02, GEN-09). */
export async function editTool(
  provider: Provider,
  routes: Routes,
  input: EditInput,
): Promise<EditResult> {
  const used = input.repairUsage ?? {};
  let repair = input.repair;
  let repairs = 0;
  for (;;) {
    if (repair) {
      if ((used[repair.failure] ?? 0) >= REPAIR_BUDGETS[repair.failure])
        return {
          kind: "failed",
          failure: repair.failure,
          findings: [...repair.diagnostics],
          repairs,
        };
      used[repair.failure] = (used[repair.failure] ?? 0) + 1;
      repairs++;
    }
    const stage = repair ? "repair" : "edit";
    const prompt = assemblePrompt({
      stage,
      request: input.request,
      intent: input.intent,
      uiMode: input.artifact.ui.mode,
      source: input.artifact.code,
      editArtifact: input.artifact,
      ...(repair && {
        failure: repair.failure,
        diagnostics: repair.diagnostics,
        editAttempt: repair.attempt,
      }),
    });
    let result: EditResult;
    let attempt: Answer | undefined;
    try {
      const response = await runStage(provider, routes, {
        stage,
        system: prompt.system,
        prompt: prompt.prompt,
        promptParts: prompt.parts,
        schema: editSchema,
        signal: input.signal,
        timeLimitMs: repair ? REPAIR_TIME_LIMIT_MS : GENERATION_TIME_LIMIT_MS,
      });
      if (response.value.outcome === "cannot")
        result = { kind: "cannot", reason: response.value.reason };
      else {
        attempt = response.value;
        result = editedCandidate(input, attempt);
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      result = {
        kind: "failed",
        failure: error.kind === "schema" ? "schema-shape" : "provider",
        findings: [error.message],
        error,
      };
    }
    if (
      result.kind !== "failed" ||
      result.failure === "provider" ||
      result.failure === "behavior"
    ) {
      return repairs ? { ...result, repairs } : result;
    }
    if ((used[result.failure] ?? 0) >= REPAIR_BUDGETS[result.failure])
      return { ...result, repairs };
    repair = { failure: result.failure, diagnostics: result.findings, attempt };
  }
}
