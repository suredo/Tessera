import {
  ACTIVATION_ROUTE,
  activationReplySchema,
  type ActivationReply,
  type ActivationRequest,
} from "@tessera/contracts";
import type { Send } from "./server-data.ts";

// The host page's last step of staging (RUN-03): a candidate that passed its checks is activated
// by the server's activation route, atomically, or refused there with nothing changed (DATA-10).

/** Activates a stored tool version in a workspace; resolves with the server's answer. */
export type Activate = (request: ActivationRequest) => Promise<ActivationReply>;

/**
 * Activation through the server. A refusal, such as a stale revision (MIG-06), is an answer; a
 * request the route can't take, or a broken answer, is an error with the route's plain words.
 */
export function serverActivation(send: Send = (url, init) => fetch(url, init)): Activate {
  return async (request) => {
    const response = await send(ACTIVATION_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const said = await response.text();
      throw new Error(said || `The activation route answered ${response.status}.`);
    }
    const reply = activationReplySchema.safeParse(await response.json());
    if (!reply.success) throw new Error("The activation route's answer isn't a reply.");
    return reply.data;
  };
}
