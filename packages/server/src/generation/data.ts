import { randomUUID } from "node:crypto";
import {
  canonicalJson,
  dataPlanSchema,
  type Artifact,
  type DataPlan,
  type DataChangePreview,
  type PatchBatch,
  type JsonValue,
} from "@tessera/contracts";
import { checkToolData } from "../data-shape/index.ts";
import { applyPatch, recordKey } from "../patches/index.ts";
import { assembleDataPrompt, DATA_PROMPT_BUDGET, type RepairClass } from "../prompts/index.ts";
import { ProviderError, runStage, type Provider, type Routes } from "../providers/index.ts";
import { patchWorkspaceData, type Store, type WorkspaceData } from "../workspaces/index.ts";
import { REPAIR_BUDGETS } from "./create.ts";

/** Cheap record planning gets the intent stage's initial 60-second allowance (GEN-11). */
export const DATA_TIME_LIMIT_MS = 60_000;
export const CHAT_DATA_MAX_OPERATIONS = 100;
export type PlannedData = {
  batch: PatchBatch;
  summary: string;
  preview: DataChangePreview[];
  addedIds: string[];
  needsConfirmation: boolean;
};
export type DataPlanResult =
  | { kind: "planned"; plan: PlannedData }
  | { kind: "unchanged" | "clarify" }
  | { kind: "cannot"; reason: string }
  | { kind: "failed"; failure: "provider" | "schema-shape"; findings: string[] };
type Input = {
  request: string;
  language: string;
  artifact: Artifact;
  snapshot: WorkspaceData;
  signal?: AbortSignal;
  repairUsage?: Partial<Record<RepairClass, number>>;
};
const failed = (reason: string): DataPlanResult => ({
  kind: "failed",
  failure: "schema-shape",
  findings: [reason],
});
const records = (data: WorkspaceData["data"], collection: string): Record<string, JsonValue>[] => {
  const list = Object.hasOwn(data, collection) ? data[collection] : undefined;
  return Array.isArray(list)
    ? list.filter(
        (v): v is Record<string, JsonValue> =>
          v !== null && typeof v === "object" && !Array.isArray(v),
      )
    : [];
};

/** Validates a proposed batch against its original snapshot, without changing storage. */
export function checkedDataPlan(
  input: Input,
  answer: Extract<DataPlan, { outcome: "patch" }>,
): DataPlanResult {
  if (answer.patch.operations.length > CHAT_DATA_MAX_OPERATIONS)
    return failed("The proposed change has too many operations.");
  const batch: PatchBatch = { operations: [] };
  for (const op of answer.patch.operations) {
    if (op.op === "add") {
      batch.operations.push(op);
      continue;
    }
    const counts = Object.hasOwn(input.snapshot.revisions, op.collection)
      ? input.snapshot.revisions[op.collection]
      : undefined;
    const count = counts && Object.hasOwn(counts, op.id) ? counts[op.id] : undefined;
    if (!count)
      return failed("The proposed change names an entry absent from the original snapshot.");
    // Never accept a guessed future revision from a model.
    batch.operations.push({ ...op, revisionCount: count });
  }
  const addedIds: string[] = [];
  const revisions = new Map(
    Object.entries(input.snapshot.revisions).flatMap(([collection, counts]) =>
      Object.entries(counts).map(
        ([id, revision]) => [recordKey(collection, id), revision] as const,
      ),
    ),
  );
  const result = applyPatch({ data: input.snapshot.data, revisions }, batch, {
    newId: () => {
      const id = randomUUID();
      addedIds.push(id);
      return id;
    },
  });
  if (!result.ok) return failed(result.message);
  if (!checkToolData(input.artifact.data.schema, result.state.data).ok)
    return failed("The proposed entries don't fit the tool's declared shape.");
  if (canonicalJson(result.state.data) === canonicalJson(input.snapshot.data))
    return { kind: "unchanged" };
  const preview: DataChangePreview[] = [];
  for (const collection of new Set(batch.operations.map((op) => op.collection))) {
    const before = new Map(
      records(input.snapshot.data, collection).map((record) => [record["id"], record]),
    );
    const after = new Map(
      records(result.state.data, collection).map((record) => [record["id"], record]),
    );
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (
        typeof id !== "string" ||
        canonicalJson(before.get(id) ?? null) === canonicalJson(after.get(id) ?? null)
      )
        continue;
      preview.push({
        collection,
        id,
        before: before.get(id) ?? null,
        after: after.get(id) ?? null,
      });
    }
  }
  if (Buffer.byteLength(JSON.stringify(preview), "utf8") > 64 * 1024)
    return failed("The proposed change is too large to review at once.");
  return {
    kind: "planned",
    plan: {
      batch,
      summary: answer.summary,
      preview,
      addedIds,
      needsConfirmation: batch.operations.some((op) => op.op !== "add"),
    },
  };
}

/** Plans on the data route, with one existing schema/shape repair budget and no provider retry. */
export async function planDataChange(
  provider: Provider,
  routes: Routes,
  input: Input,
): Promise<DataPlanResult> {
  const used = input.repairUsage ?? {};
  let diagnostics: string[] | undefined;
  let attempt: unknown;
  for (let repair = 0; ; repair++) {
    const prompt = assembleDataPrompt({
      ...input,
      schema: input.artifact.data.schema,
      ...input.snapshot,
      diagnostics,
      attempt,
    });
    if (prompt.size > DATA_PROMPT_BUDGET)
      return {
        kind: "cannot",
        reason:
          "This tool has too many entries to change in one request. Please use its controls or a smaller tool.",
      };
    let result: DataPlanResult;
    try {
      const response = await runStage(provider, routes, {
        stage: repair ? "repair" : "data",
        ...prompt,
        promptParts: prompt.parts,
        schema: dataPlanSchema,
        timeLimitMs: DATA_TIME_LIMIT_MS,
        signal: input.signal,
      });
      const answer = response.value;
      attempt = answer;
      if (answer.outcome === "cannot") return { kind: "cannot", reason: answer.reason };
      if (answer.outcome === "unchanged" || answer.outcome === "clarify")
        return { kind: answer.outcome };
      result = checkedDataPlan(input, answer);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      result = {
        kind: "failed",
        failure: error.kind === "schema" ? "schema-shape" : "provider",
        findings: [error.message],
      };
    }
    if (
      result.kind !== "failed" ||
      result.failure === "provider" ||
      (used["schema-shape"] ?? 0) >= REPAIR_BUDGETS["schema-shape"]
    )
      return result;
    used["schema-shape"] = (used["schema-shape"] ?? 0) + 1;
    diagnostics = result.findings;
  }
}

/** Commits the frozen host plan against live record revisions and the same tool shape. */
export function commitDataPlan(
  store: Store,
  workspaceId: string,
  hash: string,
  artifact: Artifact,
  plan: PlannedData,
  beforeStore: () => void = () => {},
) {
  let added = 0;
  beforeStore();
  return patchWorkspaceData(store, workspaceId, plan.batch, {
    expectedVersion: hash,
    skipUnchanged: true,
    newId: () => plan.addedIds[added++]!,
    validate: (data) => checkToolData(artifact.data.schema, data).ok,
  });
}
