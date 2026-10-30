import type { GenerateReply } from "@tessera/contracts";

/** Internal stages cannot grant activation authority; the request route adds it. */
export type GenerationResult =
  | Exclude<GenerateReply, { kind: "candidate" }>
  | Omit<Extract<GenerateReply, { kind: "candidate" }>, "activation">;
