import {
  HOST_ACTIONS,
  HOST_ROUTE,
  hostReplySchema,
  type HostActionName,
  type HostArgs,
  type HostResult,
} from "@tessera/contracts";

// The host app's side of the host API (APP-03 to APP-08): each action goes to the server's one
// route, and its answer is checked against the same contract the server checks it with (CON-01).

/** A request the server refused or couldn't do; its message is plain words for the person. */
export class HostError extends Error {}

/** Sends a request and gives back the response; `fetch` by default, a test's own otherwise. */
export type Send = (url: string, init: RequestInit) => Promise<Response>;

/** Asks the server to do `action`; resolves with its result, or rejects with a HostError. */
export async function ask<A extends HostActionName>(
  action: A,
  args: HostArgs<A>,
  send: Send = (url, init) => fetch(url, init),
): Promise<HostResult<A>> {
  const response = await send(HOST_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args }),
  });
  const reply = hostReplySchema.safeParse(await response.json().catch(() => undefined));
  if (!reply.success) throw new HostError("Tessera's answer couldn't be read.");
  if (!reply.data.ok) throw new HostError(reply.data.error.message);
  const result = HOST_ACTIONS[action].result.safeParse(reply.data.result);
  if (!result.success) throw new HostError("Tessera's answer couldn't be read.");
  return result.data as HostResult<A>;
}
