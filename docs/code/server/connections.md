---
type: Code Module
title: "Connections"
description: "Connections to outside services that the person adds (CAP-02, ADR 0015): each names a service, the origins it may reach and how its key is sent, kept in the data folder with its key, which no listing, reply or export carries."
resource: ../../../packages/server/src/connections/
implements: []
tests: [../../../packages/server/test/connections.test.ts, ../../../packages/server/test/data-folder.test.ts]
tags: [code, server, connections, security]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-14T07:00:00Z }
---

# Purpose

Keeps the connections the person adds to outside services, as [ADR 0015](../../decisions/adr/0015-person-connections.md) decides (`CAP-02`, A65): Tessera chooses no sources, so any service the person names can be one. This is the first of #349's steps ([plan](https://github.com/suredo/Tessera/issues/349)): connections can be added, listed and removed, and nothing yet sends a request. So this doc claims no requirement yet: `CAP-02` is counted as verified only once the request path and its boundary checks exist. The bridge action, the request path, the first-write confirmation and staging's made-up answers follow.

# Entry points

- `src/connections/connections.ts`: `listConnections` gives every connection, by name, each as the contracts' `Connection`, which says whether it has a key but never carries one. `addConnection` checks a `ConnectionInput` and keeps it, refusing a taken name or more than the contracts' limit of 50, in plain words; `removeConnection` removes one and its key, refusing a name it doesn't know.
- The [host API](host-api.md) answers `connections.list`, `connections.add` and `connections.remove` with them. The [contracts](../contracts/package.md) define the shapes in `src/connection.ts`.

# Behavior

- **A connection is a name, origins and how its key is sent** (`CON-01`). The name is how a tool will ask for it: lowercase letters, digits and hyphens, starting with a letter, at most 40 characters. Its origins, one to five, each once, are an http or https scheme, a host and a port if needed, written as the URL standard writes them, with no path, query or credentials, so a request can't be aimed past them by how an address is written. The key goes in a header (with a prefix such as `Bearer `), in a query parameter, or nowhere; a key is given exactly when one is sent, on one line, at most 4,096 characters.
- **The key stays in the server.** It is kept in the `connections` table, from migration `0017-connections.sql` ([storage](storage.md)), apart from tool data. No listing or reply reads it: a listing selects only whether it is set. Exports read workspaces and saved tools only, so an archive never carries a connection or its key.
- **Connections belong to the person, not to a workspace.** Removing a workspace leaves them; removing a connection removes its key.

# Pitfalls

- **Keys aren't encrypted at rest,** like everything in the data folder (the [threat model](../../spec/threat-model.md)). Encrypting them, for example with Windows' protected storage, is left for the owner to ask for.
- **Nothing here sends a request.** The connections boundary's checks (#349's later steps) don't exist yet, so nothing yet relies on a connection's origins.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `connections.ts`: `listConnections`, `addConnection`, `removeConnection`
- `index.ts`: `addConnection`, `listConnections`, `removeConnection`, `Connection` (type), `ConnectionInput` (type)
