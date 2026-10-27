import type { GenerateReply, GenerateRequest } from "@tessera/contracts";
import { candidateMount } from "../host/index.ts";
import { decideIntent, recordLists } from "../intent/index.ts";
import type { OpenTool } from "../prompts/index.ts";
import { ProviderError, type Provider, type Routes } from "../providers/index.ts";
import { saveVersion, loadVersion } from "../versions/index.ts";
import {
  createWorkspace,
  getWorkspace,
  listSavedTools,
  renameWorkspace,
  replaceData,
  type Store,
} from "../workspaces/index.ts";
import { createTool } from "./create.ts";

// A request, carried out as far as the server goes (GEN-01, GEN-04): the intent stage decides
// what it is, the create stage makes a candidate, and the candidate is stored with its workspace
// and starting data, ready for the host app to stage behind the smoke check (RUN-03) and activate
// (DATA-10). Nothing is activated here. Edits and data changes come in their own stages.

/** The plain sentence for a candidate still failing the host's checks after its repairs (GEN-09). */
const CHECKS_FAILED = "The tool Tessera made didn't pass its checks, so nothing was changed.";

/** The open tool as the intent stage is told of it: its name and the lists of records it keeps. */
function openTool(store: Store, workspaceId: string | undefined): OpenTool {
  const workspace = workspaceId ? getWorkspace(store, workspaceId) : undefined;
  if (!workspace?.currentVersion) return null;
  const version = loadVersion(store.db, workspace.currentVersion);
  if (version?.kind !== "ok") return null;
  return { name: workspace.title, lists: recordLists(version.artifact.data.schema) };
}

export async function generate(
  store: Store,
  provider: Provider,
  routes: Routes,
  input: GenerateRequest,
  signal?: AbortSignal,
): Promise<GenerateReply> {
  const open = openTool(store, input.workspaceId);
  let decision;
  try {
    decision = await decideIntent(provider, routes, {
      request: input.request,
      open,
      savedToolIds: listSavedTools(store).map((tool) => tool.id),
      signal,
    });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return { kind: "failed", failure: "provider", message: error.message, findings: [] };
  }
  switch (decision.action) {
    case "open_saved":
      return { kind: "open_saved", savedToolId: decision.savedToolId };
    case "clarify":
    case "unsupported":
    case "ask_to_split":
      return { kind: "answer", answer: decision.action };
    case "edit":
    case "data":
    case "mixed":
      // Changing an open tool comes with the edit and data stages (#146, #150).
      return { kind: "answer", answer: "not_yet" };
  }
  const created = await createTool(provider, routes, {
    request: decision.interfacePart,
    intent: decision.intent,
    signal,
  });
  if (created.kind === "cannot")
    return { kind: "answer", answer: "cannot", reason: created.reason };
  if (created.kind === "failed") {
    return {
      kind: "failed",
      failure: created.failure,
      message: created.failure === "provider" ? created.findings[0]! : CHECKS_FAILED,
      findings: created.findings,
    };
  }
  // A workspace the person opened that has no tool yet becomes this tool's; otherwise a new one.
  const hash = saveVersion(store.db, created.artifact);
  const empty = input.workspaceId ? getWorkspace(store, input.workspaceId) : undefined;
  const workspace = store.db.transaction(() => {
    if (empty && empty.currentVersion === null && empty.data === null) {
      renameWorkspace(store, empty.id, created.name);
      replaceData(store, getWorkspace(store, empty.id)!, created.startingData);
      return getWorkspace(store, empty.id)!;
    }
    return createWorkspace(store, created.name, { data: created.startingData });
  });
  return {
    kind: "candidate",
    workspaceId: workspace.id,
    hash,
    mountId: candidateMount(hash),
    capabilities: created.artifact.capabilities,
    syntheticData: created.artifact.data.defaults,
    expectedDataRevision: workspace.dataRevision,
    name: created.name,
    summary: created.summary,
  };
}
