import { BRIDGE_ROUTE, bridgeReplySchema, type BridgeDataRequest } from "@tessera/contracts";
import { BridgeError, type DataCallContext, type DataHandlers } from "./bridge.ts";

// The host page's data handlers (RUN-04): each data call a mounted tool makes goes to the server's
// bridge route, which checks it again and answers it from the saved data. The server's refusal,
// such as a stale change (BRG-04), comes back to the tool with its code and plain message.

/** Sends a request and gives back the response; `fetch` by default, a test's own otherwise. */
export type Send = (url: string, init: RequestInit) => Promise<Response>;

/** Data handlers for a tool running in `workspaceId`, answered by the server. */
export function serverData(
  workspaceId: string,
  send: Send = (url, init) => fetch(url, init),
): DataHandlers {
  const ask = async ({ phase, call }: DataCallContext): Promise<unknown> => {
    const body: BridgeDataRequest = { workspaceId, phase, call };
    const response = await send(BRIDGE_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // Anything but a reply, such as a refused or broken request, is the host's failure, and the
    // bridge answers it plainly; the server's words for it don't reach the tool.
    if (!response.ok) throw new Error(`The bridge route answered ${response.status}.`);
    const reply = bridgeReplySchema.safeParse(await response.json());
    if (!reply.success) throw new Error("The bridge route's answer isn't a reply.");
    if (!reply.data.ok) throw new BridgeError(reply.data.error.code, reply.data.error.message);
    return reply.data.result;
  };
  return {
    // The bridge checks every result against the manifest before the tool sees it.
    read: (context) => ask(context) as ReturnType<DataHandlers["read"]>,
    patch: (_batch, context) => ask(context) as ReturnType<DataHandlers["patch"]>,
    // The server checks the image is one the workspace's data names (AST-04).
    asset: (_args, context) => ask(context) as ReturnType<NonNullable<DataHandlers["asset"]>>,
  };
}
