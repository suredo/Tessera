import { ACTIVATION_ROUTE, activationRequestSchema } from "@tessera/contracts";
import { json, readJson, text, type Handler } from "../http/index.ts";
import { activateVersion } from "./activation.ts";
import { existingWorkspace, getWorkspace, type Store } from "./workspaces.ts";

// The server's side of RUN-03's last step: once a candidate has passed its checks in the staging
// panel, the host page asks for it to become the workspace's current version. The server activates
// it atomically, checked against the stored version and the planned data revision (DATA-10,
// MIG-06), and answers with the workspace or a plain refusal. A refusal changes nothing.

// The request is three short fields; anything much larger isn't one.
const LIMIT_BYTES = 4096;

// Why a workspace that isn't there can't be activated: missing, or in the trash.
function missingMessage(store: Store, id: string): string {
  try {
    existingWorkspace(store, id);
  } catch (error) {
    return (error as Error).message;
  }
  return `There is no workspace with the ID ${id}.`;
}

/** The activation route for the local server, answering from `store`. */
export function activationRoutes(store: Store): Record<string, Handler> {
  return {
    [ACTIVATION_ROUTE]: async (req, res) => {
      if (req.method !== "POST") return text(res, 405, "Send an activation with POST.");
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > LIMIT_BYTES) return text(res, 413, "The activation is too large.");
      const body = await readJson(req, LIMIT_BYTES);
      if (body === "too-large") return text(res, 413, "The activation is too large.");
      const request = body === "invalid" ? undefined : activationRequestSchema.safeParse(body.json);
      if (!request?.success) {
        return text(res, 400, "Send a workspace, a tool version and the data revision, as JSON.");
      }
      const { workspaceId, hash, expectedDataRevision } = request.data;
      try {
        if (!getWorkspace(store, workspaceId)) {
          // Missing, or in the trash: the workspaces module's error says which, plainly.
          return text(res, 404, missingMessage(store, workspaceId));
        }
        json(res, activateVersion(store, workspaceId, hash, expectedDataRevision));
      } catch {
        // Such as a busy database. The activation is one transaction, so nothing was changed.
        text(res, 500, "The host couldn't do that. Nothing was changed.");
      }
    },
  };
}
