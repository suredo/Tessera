import {
  HOST_ACTIONS,
  HOST_REQUEST_LIMIT_BYTES,
  HOST_ROUTE,
  hostRequestSchema,
  type HostActionName,
  type HostArgs,
  type HostReply,
  type HostResult,
} from "@tessera/contracts";
import { ZodError } from "zod";
import { json, readJson, text, type Handler } from "../http/index.ts";
import type { ToolFor } from "../runtime/index.ts";
import {
  deleteSavedTool,
  deleteWorkspace,
  emptyTrash,
  listTrash,
  restoreSavedTool,
  restoreWorkspace,
} from "../trash/index.ts";
import {
  continueSavedTool,
  createWorkspace,
  listRecoverySnapshots,
  listSavedTools,
  listUndo,
  listWorkspaces,
  planRestore,
  renameSavedTool,
  renameWorkspace,
  restoreRecoverySnapshot,
  restoreVersion,
  saveTool,
  undoDataChange,
  getWorkspace,
  useAgain,
  workspaceVersions,
  type Store,
} from "../workspaces/index.ts";
import { loadVersion } from "../versions/index.ts";

// The host app's API (APP-03 to APP-08): one route, HOST_ROUTE, answering every action the
// contracts list, each with its arguments checked before it runs and its result checked before it
// is sent (CON-01). The work is the existing modules'; this only connects them to the app.

const FAILED = "Tessera couldn't do that. Nothing was changed.";

// One handler per action in the contract: TypeScript refuses this object if one is missing.
const run: {
  [A in HostActionName]: (store: Store, args: HostArgs<A>) => HostResult<A>;
} = {
  "workspaces.list": (store) => ({ workspaces: listWorkspaces(store) }),
  "workspaces.open": (store, { id }) => {
    // Refused in the workspaces module's own words if it is missing or in the trash.
    workspaceVersions(store, id);
    const workspace = getWorkspace(store, id)!;
    const version = workspace.currentVersion && loadVersion(store.db, workspace.currentVersion);
    return {
      workspace,
      capabilities: version && version.kind === "ok" ? version.artifact.capabilities : [],
    };
  },
  "workspaces.create": (store, { title }) => ({ workspace: createWorkspace(store, title) }),
  "workspaces.rename": (store, { id, title }) => ({ workspace: renameWorkspace(store, id, title) }),
  "workspaces.delete": (store, { id }) => ({ entry: deleteWorkspace(store, id) }),
  "versions.list": (store, { workspaceId }) => ({
    versions: workspaceVersions(store, workspaceId),
  }),
  "versions.planRestore": (store, { workspaceId, hash }) => planRestore(store, workspaceId, hash),
  "versions.restore": (store, { workspaceId, hash, expectedDataRevision, confirmation }) =>
    restoreVersion(store, workspaceId, hash, expectedDataRevision, confirmation),
  "snapshots.list": (store, { workspaceId }) => ({
    snapshots: listRecoverySnapshots(store, workspaceId),
  }),
  "snapshots.restore": (store, { snapshotId, expectedDataRevision }) =>
    restoreRecoverySnapshot(store, snapshotId, expectedDataRevision),
  "undo.list": (store, { workspaceId }) => ({ entries: listUndo(store, workspaceId) }),
  "undo.undo": (store, { workspaceId, number }) => undoDataChange(store, workspaceId, number),
  "library.list": (store) => ({ savedTools: listSavedTools(store) }),
  "library.save": (store, { workspaceId, name }) => ({
    savedTool: saveTool(store, workspaceId, name),
  }),
  "library.rename": (store, { id, name }) => ({ savedTool: renameSavedTool(store, id, name) }),
  "library.delete": (store, { id }) => ({ entry: deleteSavedTool(store, id) }),
  "library.continue": (store, { id }) => continueSavedTool(store, id),
  "library.useAgain": (store, { id, title }) => useAgain(store, id, { title }),
  "trash.list": (store) => listTrash(store),
  "trash.restoreWorkspace": (store, { id }) => ({ workspace: restoreWorkspace(store, id) }),
  "trash.restoreSavedTool": (store, { id }) => ({ savedTool: restoreSavedTool(store, id) }),
  "trash.empty": (store, { confirmation }) => ({ removed: emptyTrash(store, confirmation) }),
};

const fail = (code: "invalid" | "refused" | "failed", message: string): HostReply => ({
  ok: false,
  error: { code, message },
});

const isAction = (action: string): action is HostActionName =>
  Object.prototype.hasOwnProperty.call(HOST_ACTIONS, action);

/**
 * Answers one request from the host app. An action the contracts don't list, or arguments that
 * don't fit it, are `invalid`. The modules' own refusals, plain errors written for the person
 * (such as a workspace in the trash), are `refused` with their words; anything else, such as a
 * database error, is `failed`, and none of its words reach the app.
 */
export function answerHost(store: Store, request: unknown): HostReply {
  const parsed = hostRequestSchema.safeParse(request);
  if (!parsed.success || !isAction(parsed.data.action)) {
    return fail("invalid", "Tessera doesn't know that request.");
  }
  const action = parsed.data.action;
  const args = HOST_ACTIONS[action].args.safeParse(parsed.data.args ?? {});
  if (!args.success) return fail("invalid", "That request isn't complete or isn't valid.");
  try {
    const result = (run[action] as (store: Store, args: unknown) => unknown)(store, args.data);
    const checked = HOST_ACTIONS[action].result.safeParse(result);
    if (!checked.success) return fail("failed", FAILED);
    return { ok: true, result: checked.data };
  } catch (error) {
    if (error instanceof ZodError) {
      return fail("invalid", "That name is empty or too long.");
    }
    // A module's refusal is a plain Error with words for the person; a database or system error
    // carries a code, and is the host's failure.
    if (error instanceof Error && error.constructor === Error && !("code" in error)) {
      return fail("refused", error.message);
    }
    return fail("failed", FAILED);
  }
}

/** The host app's route for the local server, answering from `store`. */
export function hostRoutes(store: Store): Record<string, Handler> {
  return {
    [HOST_ROUTE]: async (req, res) => {
      if (req.method !== "POST") return text(res, 405, "Send a request with POST.");
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > HOST_REQUEST_LIMIT_BYTES) return text(res, 413, "The request is too large.");
      const body = await readJson(req, HOST_REQUEST_LIMIT_BYTES);
      if (body === "too-large") return text(res, 413, "The request is too large.");
      if (body === "invalid") return text(res, 400, "Send a request as JSON.");
      json(res, answerHost(store, body.json));
    },
  };
}

/**
 * The tool each mount shows in the host app: a mount is a workspace, by its ID, and shows that
 * workspace's current tool version, its code and UI mode (RUN-01, RUN-05). A workspace that is
 * missing, in the trash, without a tool or with a damaged version shows nothing.
 */
export const workspaceTools =
  (store: Store): ToolFor =>
  (mountId) => {
    const workspace = getWorkspace(store, mountId);
    if (!workspace?.currentVersion) return undefined;
    const version = loadVersion(store.db, workspace.currentVersion);
    return version?.kind === "ok"
      ? { code: version.artifact.code, ui: version.artifact.ui }
      : undefined;
  };
