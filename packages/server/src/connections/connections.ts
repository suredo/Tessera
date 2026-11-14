// Docs: docs/code/server/connections.md
import {
  CONNECTIONS_LIMIT,
  connectionAuthSchema,
  connectionInputSchema,
  connectionOriginSchema,
  connectionSchema,
  type Connection,
  type ConnectionInput,
} from "@tessera/contracts";
import { z } from "zod";
import type { Store } from "../workspaces/index.ts";

// Connections to outside services that the person adds (CAP-02, ADR 0015). Each names a service,
// the origins it may reach and how its key is sent. The key is written here and read by nothing
// in this module: a connection as listed says only whether it has one. The request path
// (requests.ts) is the only reader, and sends it only to the connection's own origins.

const row = z.object({
  name: z.string(),
  origins: z.string(),
  auth: z.string(),
  has_key: z.number(),
  added_at: z.string(),
});

const asConnection = (r: z.infer<typeof row>): Connection =>
  connectionSchema.parse({
    name: r.name,
    origins: z.array(connectionOriginSchema).parse(JSON.parse(r.origins)),
    auth: connectionAuthSchema.parse(JSON.parse(r.auth)),
    hasKey: r.has_key === 1,
    addedAt: r.added_at,
  });

/** Every connection, by name, each without its key. */
export function listConnections(store: Store): Connection[] {
  return store.db
    .all(
      row,
      "SELECT name, origins, auth, key IS NOT NULL AS has_key, added_at FROM connections ORDER BY name",
    )
    .map(asConnection);
}

/**
 * Adds a connection, refused if its name is taken or there are already `CONNECTIONS_LIMIT`.
 * Returns it as kept, without its key.
 */
export function addConnection(store: Store, input: ConnectionInput): Connection {
  const checked = connectionInputSchema.parse(input);
  return store.db.transaction(() => {
    const taken = store.db.get(
      z.object({ n: z.number() }),
      "SELECT COUNT(*) AS n FROM connections WHERE name = ?",
      checked.name,
    );
    if ((taken?.n ?? 0) > 0)
      throw new Error(`There is already a connection called ${checked.name}.`);
    const count = store.db.get(
      z.object({ n: z.number() }),
      "SELECT COUNT(*) AS n FROM connections",
    );
    if ((count?.n ?? 0) >= CONNECTIONS_LIMIT)
      throw new Error(`Tessera keeps at most ${CONNECTIONS_LIMIT} connections. Remove one first.`);
    store.db.run(
      "INSERT INTO connections (name, origins, auth, key, added_at) VALUES (?, ?, ?, ?, ?)",
      checked.name,
      JSON.stringify(checked.origins),
      JSON.stringify(checked.auth),
      checked.key,
      store.now().toISOString(),
    );
    const added = listConnections(store).find((each) => each.name === checked.name);
    if (!added) throw new Error("Tessera couldn't keep the connection.");
    return added;
  });
}

/** Removes a connection and its key, refused if there is none of that name. */
export function removeConnection(store: Store, name: string): void {
  const removed = store.db.run("DELETE FROM connections WHERE name = ?", name);
  if (removed === 0) throw new Error(`There is no connection called ${name}.`);
}

// A tool's permission to change things through a connection (ADR 0015 point 4, A70): granted when
// the person allows its first write, per workspace and connection, and taken back at any time.
// Only the host app grants one, through the host API: a tool can't reach that API (SEC-03).

/** Whether the person allowed the workspace's tool to change things through `name`. */
export function writesAllowed(store: Store, workspaceId: string, name: string): boolean {
  const found = store.db.get(
    z.object({ n: z.number() }),
    "SELECT COUNT(*) AS n FROM connection_permissions WHERE workspace_id = ? AND connection = ?",
    workspaceId,
    name,
  );
  return (found?.n ?? 0) > 0;
}

/**
 * Keeps the person's permission for the workspace's tool to change things through `name`,
 * refused if there is no such workspace or connection. Allowing again keeps the first time.
 */
export function allowWrites(store: Store, workspaceId: string, name: string): void {
  const exists = (sql: string, value: string) =>
    (store.db.get(z.object({ n: z.number() }), sql, value)?.n ?? 0) > 0;
  if (!exists("SELECT COUNT(*) AS n FROM workspaces WHERE id = ?", workspaceId)) {
    throw new Error("That tool is gone or in the trash.");
  }
  if (!exists("SELECT COUNT(*) AS n FROM connections WHERE name = ?", name)) {
    throw new Error(`There is no connection called ${name}.`);
  }
  store.db.run(
    "INSERT OR IGNORE INTO connection_permissions (workspace_id, connection, allowed_at) VALUES (?, ?, ?)",
    workspaceId,
    name,
    store.now().toISOString(),
  );
}

/** Takes the permission back: the tool's next change through `name` asks the person again. */
export function takeBackWrites(store: Store, workspaceId: string, name: string): void {
  store.db.run(
    "DELETE FROM connection_permissions WHERE workspace_id = ? AND connection = ?",
    workspaceId,
    name,
  );
}
