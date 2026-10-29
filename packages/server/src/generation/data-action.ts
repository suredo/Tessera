import type { Artifact, DataReply } from "@tessera/contracts";
import type { RepairClass } from "../prompts/index.ts";
import type { Provider, Routes } from "../providers/index.ts";
import { loadVersion } from "../versions/index.ts";
import { getWorkspace, readWorkspaceData, type Store } from "../workspaces/index.ts";
import { commitDataPlan, planDataChange, type PlannedData } from "./data.ts";

/** Only the server retains the full plan; the browser can confirm its opaque token once. */
export type DataOffer = {
  workspaceId: string;
  hash: string;
  artifact: Artifact;
  plan: PlannedData;
};
export type OfferData = (offer: DataOffer) => string;

export function applyDataOffer(store: Store, offer: DataOffer, beforeStore: () => void): DataReply {
  const result = commitDataPlan(
    store,
    offer.workspaceId,
    offer.hash,
    offer.artifact,
    offer.plan,
    beforeStore,
  );
  if (!result.ok)
    return result.reason === "stale"
      ? { kind: "answer", answer: "data_stale" }
      : {
          kind: "failed",
          failure: "schema-shape",
          message: "The change doesn't fit this tool. Your entries were kept.",
          findings: [result.message],
        };
  return result.changed
    ? {
        kind: "data_changed",
        workspaceId: offer.workspaceId,
        name: result.workspace.title,
        count: offer.plan.preview.length,
        summary: offer.plan.summary,
      }
    : { kind: "answer", answer: "data_unchanged" };
}

/** Plans on the current entries, and never overwrites/removes an entry without a later approval. */
export async function changeData(
  store: Store,
  provider: Provider,
  routes: Routes,
  workspaceId: string | undefined,
  request: string,
  language: string,
  signal: AbortSignal | undefined,
  beforeStore: () => void,
  offerData?: OfferData,
  repairUsage?: Partial<Record<RepairClass, number>>,
): Promise<DataReply> {
  const workspace = workspaceId ? getWorkspace(store, workspaceId) : undefined;
  const hash = workspace?.currentVersion;
  if (!workspace || !hash) return { kind: "answer", answer: "data_stale" };
  const version = loadVersion(store.db, hash);
  if (version?.kind !== "ok") return { kind: "answer", answer: "data_stale" };
  const result = await planDataChange(provider, routes, {
    request,
    language,
    artifact: version.artifact,
    snapshot: readWorkspaceData(store, workspace.id),
    signal,
    repairUsage,
  });
  if (result.kind === "failed")
    return {
      kind: "failed",
      failure: result.failure,
      findings: result.findings,
      message:
        result.failure === "provider"
          ? result.findings[0]!
          : "The change couldn't be prepared. Your entries were kept.",
    };
  if (result.kind === "cannot")
    return { kind: "answer", answer: "data_cannot", reason: result.reason };
  if (result.kind !== "planned")
    return {
      kind: "answer",
      answer: result.kind === "clarify" ? "data_clarify" : "data_unchanged",
    };
  if (getWorkspace(store, workspace.id)?.currentVersion !== hash)
    return { kind: "answer", answer: "data_stale" };
  const offer: DataOffer = {
    workspaceId: workspace.id,
    hash,
    artifact: version.artifact,
    plan: result.plan,
  };
  if (!result.plan.needsConfirmation) return applyDataOffer(store, offer, beforeStore);
  if (!offerData) return { kind: "answer", answer: "data_clarify" };
  return {
    kind: "data_confirmation",
    workspaceId: workspace.id,
    name: workspace.title,
    token: offerData(offer),
    summary: result.plan.summary,
    changes: result.plan.preview,
  };
}
