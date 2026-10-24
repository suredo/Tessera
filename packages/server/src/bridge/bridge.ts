import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BRIDGE_ACTIONS,
  BRIDGE_REQUEST_LIMIT_BYTES,
  BRIDGE_ROUTE,
  bridgeDataRequestSchema,
  checkBridgeCall,
  type BridgeDataRequest,
  type BridgeErrorCode,
  type BridgeReply,
} from "@tessera/contracts";
import type { Handler } from "../http/index.ts";
import type { PatchRefusal } from "../patches/index.ts";
import { loadVersion } from "../versions/index.ts";
import {
  getWorkspace,
  patchWorkspaceData,
  readWorkspaceData,
  type Store,
} from "../workspaces/index.ts";

// The server's side of the bridge (RUN-04): the host page passes on a tool's data calls, and the
// server checks each one again with the shared check before it reads or changes saved data. The
// capabilities come from the workspace's stored tool version, never from the browser. Only the
// phase comes from the host page: the person's first interaction is something only the browser
// sees (the owner's decision on #46). Revisions are checked against the saved ones (BRG-04).

// Instances are the browser's: the port of each mount is bound to its own (BRG-05).
const SERVER_INSTANCE = "server";
const FAILED = "The host couldn't do that.";

// The engine's reasons, as the bridge's codes.
const PATCH_CODES: Record<PatchRefusal, BridgeErrorCode> = {
  stale: "stale",
  invalid: "invalid-args",
  "too-large": "too-large",
};

const refusal = (requestId: string, code: BridgeErrorCode, message: string): BridgeReply => ({
  requestId,
  ok: false,
  error: { code, message },
});

// The capabilities the workspace's current tool version declares; none without a usable one.
function declaredCapabilities(store: Store, hash: string | null): string[] {
  if (hash === null) return [];
  const reading = loadVersion(store.db, hash);
  return reading?.kind === "ok" ? reading.artifact.capabilities : [];
}

/**
 * Answers a tool's data call for the workspace it runs in: checked first, with the stored
 * version's capabilities and the phase the host page sends (RUN-04, GEN-06), then read or applied
 * against the saved data and revisions (DATA-02, BRG-04). Nothing is changed by a refused call.
 * Returns the reply to send, or null when the call carries no usable request ID to answer.
 */
export function answerDataCall(store: Store, request: BridgeDataRequest): BridgeReply | null {
  const workspace = getWorkspace(store, request.workspaceId);
  const checked = checkBridgeCall(SERVER_INSTANCE, request.call, {
    instanceId: SERVER_INSTANCE,
    phase: request.phase,
    capabilities: workspace ? declaredCapabilities(store, workspace.currentVersion) : [],
  });
  if (!checked.ok) return checked.reply;
  const { requestId, action, args } = checked;
  if (!workspace) {
    return refusal(
      requestId,
      "failed",
      "The tool's workspace is gone or in the trash. Nothing was changed.",
    );
  }
  try {
    if (action === "data.read") {
      const result = BRIDGE_ACTIONS["data.read"].result.safeParse(
        readWorkspaceData(store, workspace.id),
      );
      if (!result.success) return refusal(requestId, "failed", FAILED);
      return { requestId, ok: true, result: result.data };
    }
    if (action === "data.patch") {
      const result = patchWorkspaceData(store, workspace.id, args);
      if (!result.ok) return refusal(requestId, PATCH_CODES[result.reason], result.message);
      return { requestId, ok: true, result: { addedIds: result.addedIds } };
    }
    return refusal(requestId, "failed", `The server doesn't answer "${action}"; the host does.`);
  } catch {
    // Such as a busy database: nothing of the server, such as a path, reaches the tool.
    return refusal(requestId, "failed", FAILED);
  }
}

// The request's body as JSON, read up to a limit: "too-large" past it, "invalid" if not JSON.
async function readJson(req: IncomingMessage, limitBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > limitBytes) return "too-large" as const;
    chunks.push(chunk);
  }
  try {
    return { json: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return "invalid" as const;
  }
}

const text = (res: ServerResponse, status: number, message: string): void => {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(message);
};

/** The bridge's route for the local server, answering from `store`. */
export function bridgeRoutes(store: Store): Record<string, Handler> {
  // A call within the bridge's own limit, with room for the workspace and the phase.
  const limitBytes = BRIDGE_REQUEST_LIMIT_BYTES + 1024;
  return {
    [BRIDGE_ROUTE]: async (req, res) => {
      if (req.method !== "POST") return text(res, 405, "Send a tool's call with POST.");
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > limitBytes) return text(res, 413, "The call is too large.");
      const body = await readJson(req, limitBytes);
      if (body === "too-large") return text(res, 413, "The call is too large.");
      const request = body === "invalid" ? undefined : bridgeDataRequestSchema.safeParse(body.json);
      if (!request?.success) {
        return text(res, 400, "Send a workspace, a phase and the tool's call, as JSON.");
      }
      const reply = answerDataCall(store, request.data);
      if (reply === null) return text(res, 400, "The call has no request ID to answer.");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
    },
  };
}
