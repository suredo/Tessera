import { REQUEST_CONNECTIONS_LIMIT, type Artifact, type Intent } from "@tessera/contracts";
import { listConnections } from "../connections/index.ts";
import type { Store } from "../workspaces/index.ts";

// The connections a request gives its tool (CAP-02, A66, A74): the ones it already uses, and those
// the intent stage chose that the person has, while it uses fewer than REQUEST_CONNECTIONS_LIMIT.
// The host decides this, never the model: the generation stage may use only these, and is told
// them by name with their addresses, never a key.

export type ToolConnections = {
  /** The names the tool may use, for the host's check of its answer. */
  allowed: string[];
  /** Those the person still has, with their addresses, for the prompt. */
  quoted: { name: string; origins: string[] }[];
};

/** The names of the person's connections, by name, as the intent stage is told them. */
export const connectionNames = (store: Store): string[] =>
  listConnections(store).map((each) => each.name);

/** What `intent` gives a tool that uses `existing` now (none for a new tool). */
export function toolConnections(
  store: Store,
  intent: Pick<Intent, "connections"> | undefined,
  existing: Artifact["connections"] = {},
): ToolConnections {
  const person = new Map(listConnections(store).map((each) => [each.name, each.origins]));
  // The ones it uses stay, whatever their number (an imported tool may use more); new ones join
  // only while it uses fewer than the limit.
  const uses = Object.keys(existing);
  const chosen = [...new Set(intent?.connections ?? [])].filter(
    (name) => person.has(name) && !uses.includes(name),
  );
  const allowed = [
    ...uses,
    ...chosen.slice(0, Math.max(0, REQUEST_CONNECTIONS_LIMIT - uses.length)),
  ];
  return {
    allowed,
    quoted: allowed.flatMap((name) => {
      const origins = person.get(name);
      return origins ? [{ name, origins }] : [];
    }),
  };
}
