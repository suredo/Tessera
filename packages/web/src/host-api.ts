import {
  HOST_ACTIONS,
  HOST_ROUTE,
  hostReplySchema,
  type HostActionName,
  type HostArgs,
  type HostResult,
} from "@tessera/contracts";
import { t } from "./i18n/translate.ts";

// The host app's side of the host API (APP-03 to APP-08): each action goes to the server's one
// route, and its answer is checked against the same contract the server checks it with (CON-01).

/** A request the server refused or couldn't do; its message is plain words for the person. */
export class HostError extends Error {
  /** The HTTP status when the server itself refused, such as 409 for a stopped request. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    if (status !== undefined) this.status = status;
  }
}

/** A refusal the server made itself (under 500): unlike a lost reply or a server error, it started
 * nothing, so it can be said for certain. */
export const isRefusal = (error: unknown): error is HostError =>
  error instanceof HostError && error.status !== undefined && error.status < 500;

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
  if (!reply.success) throw new HostError(t("app.unreadable"));
  if (!reply.data.ok) throw new HostError(reply.data.error.message);
  const result = HOST_ACTIONS[action].result.safeParse(reply.data.result);
  if (!result.success) throw new HostError(t("app.unreadable"));
  return result.data as HostResult<A>;
}
