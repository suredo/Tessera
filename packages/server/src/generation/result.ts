import type { GenerateReply } from "@tessera/contracts";

/**
 * Internal stages cannot grant activation authority, or name a discussion for the next request;
 * the request route adds both.
 */
export type GenerationResult =
  | Exclude<GenerateReply, { kind: "candidate" | "discussion" }>
  | Omit<Extract<GenerateReply, { kind: "candidate" }>, "activation">
  | Omit<Extract<GenerateReply, { kind: "discussion" }>, "token">;
