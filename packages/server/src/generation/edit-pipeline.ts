import { profileIdSchema, type Intent, type Workspace } from "@tessera/contracts";
import type { GenerationResult } from "./result.ts";
import { candidateMount } from "../host/index.ts";
import type { RepairClass } from "../prompts/index.ts";
import type { Provider, Routes } from "../providers/index.ts";
import { loadVersion, saveVersion } from "../versions/index.ts";
import { getWorkspace, noteOf, type Store } from "../workspaces/index.ts";
import { editTool } from "./edit.ts";
import type { SmokeRepairContext } from "./smoke.ts";
import { DEFAULT_STAGE_TIME_LIMITS, type StageTimeLimits } from "./time-limits.ts";

/** An edit stores a checked version, never data; activation owns the eventual migration. */
export async function generateEdit(
  store: Store,
  provider: Provider,
  routes: Routes,
  baseline: Workspace | undefined,
  request: string,
  intent: Intent,
  signal?: AbortSignal,
  remember?: (context: SmokeRepairContext) => void,
  beforeStore: () => void = () => signal?.throwIfAborted(),
  repairUsage: Partial<Record<RepairClass, number>> = {},
  limits: StageTimeLimits = DEFAULT_STAGE_TIME_LIMITS,
  /** The answer of the discussion the request follows (GEN-19): the edit is told it. */
  conversation?: string,
): Promise<GenerationResult> {
  const stale = { kind: "answer", answer: "stale" } as const;
  if (!baseline?.currentVersion || baseline.data === null) return stale;
  const current = () => {
    const now = getWorkspace(store, baseline.id);
    return (
      now?.currentVersion === baseline.currentVersion && now.dataRevision === baseline.dataRevision
    );
  };
  if (!current()) return stale;
  const original = loadVersion(store.db, baseline.currentVersion);
  if (original?.kind !== "ok") return stale;
  // An edit keeps the profile the tool's current version was checked by, or none, whatever the
  // edit's intent named (VER-03, L-94): a profile is the kind of tool it is, and an edit must never
  // turn a calendar into a study planner to pass a check nobody asked for.
  const kept = profileIdSchema.safeParse(
    noteOf(store, baseline.id, baseline.currentVersion)?.profile ?? null,
  );
  intent = { ...intent, profile: kept.success ? kept.data : null };
  const data = baseline.data;
  const edit = () =>
    editTool(provider, routes, {
      request,
      intent,
      ...(conversation ? { conversation } : {}),
      artifact: original.artifact,
      data,
      signal,
      repairUsage,
      timeLimits: limits,
    });
  let result = await edit();
  // A look CSS alone can't make, such as motion that follows the mouse, is tried once more as an
  // edit of the tool's code, rather than imitated or refused (L-96).
  if (result.kind === "cannot" && intent.lookOnly && current()) {
    intent = { ...intent, lookOnly: false };
    result = await edit();
  }
  if (!current()) return stale;
  if (result.kind === "cannot")
    // The model's own words, when the plain reason replaced them, stay for the details (GEN-10).
    return {
      kind: "answer",
      answer: "cannot",
      reason: result.reason,
      ...(result.detail ? { findings: [result.detail] } : {}),
    };
  if (result.kind === "unchanged")
    return {
      kind: "answer",
      answer: "unchanged",
      ...(result.summary ? { reason: result.summary } : {}),
      ...(result.leftOut ? { leftOut: result.leftOut } : {}),
    };
  if (result.kind === "failed")
    return {
      kind: "failed",
      failure: result.failure,
      message:
        result.failure === "provider"
          ? result.findings[0]!
          : "The change didn't pass its checks. Your tool and entries were kept.",
      findings: result.findings,
    };
  beforeStore();
  const hash = saveVersion(store.db, result.artifact);
  const reply = {
    kind: "candidate" as const,
    operation: "edit" as const,
    workspaceId: baseline.id,
    hash,
    mountId: candidateMount(hash),
    capabilities: result.artifact.capabilities,
    connections: result.artifact.connections,
    syntheticData: result.artifact.data.defaults,
    profile: intent?.profile ?? null,
    // Checks from the request are for a new tool only, in the experiment (VER-09).
    acceptance: null,
    expectedDataRevision: baseline.dataRevision,
    name: baseline.title,
    summary: result.summary,
    ...(result.leftOut ? { leftOut: result.leftOut } : {}),
  };
  remember?.({
    reply,
    request,
    intent,
    repairUsage,
    baseVersion: baseline.currentVersion,
  });
  return reply;
}
