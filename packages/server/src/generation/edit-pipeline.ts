import type { GenerateReply, Intent, Workspace } from "@tessera/contracts";
import { candidateMount } from "../host/index.ts";
import type { RepairClass } from "../prompts/index.ts";
import type { Provider, Routes } from "../providers/index.ts";
import { loadVersion, saveVersion } from "../versions/index.ts";
import { getWorkspace, type Store } from "../workspaces/index.ts";
import { editTool } from "./edit.ts";
import type { SmokeRepairContext } from "./smoke.ts";

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
): Promise<GenerateReply> {
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
  const result = await editTool(provider, routes, {
    request,
    intent,
    artifact: original.artifact,
    data: baseline.data,
    signal,
    repairUsage,
  });
  if (!current()) return stale;
  if (result.kind === "cannot") return { kind: "answer", answer: "cannot", reason: result.reason };
  if (result.kind === "unchanged") return { kind: "answer", answer: "unchanged" };
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
    syntheticData: result.artifact.data.defaults,
    expectedDataRevision: baseline.dataRevision,
    name: baseline.title,
    summary: result.summary,
  };
  remember?.({ reply, request, intent, repairUsage, baseVersion: baseline.currentVersion });
  return reply;
}
