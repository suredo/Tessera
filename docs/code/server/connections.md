---
type: Code Module
title: "Connections"
description: "Connections to outside services that the person adds (CAP-02, ADR 0015): kept in the data folder with their keys, which no listing, reply or export carries, and the request path, which sends a tool's read only through the connections its version names, only to their origins, with the key added by the host (CNX-01 to CNX-06)."
resource: ../../../packages/server/src/connections/
implements: [CNX-01, CNX-02, CNX-03, CNX-04, CNX-05, CNX-06]
tests: [../../../packages/server/test/connections.test.ts, ../../../packages/server/test/connection-requests.test.ts, ../../../packages/server/test/data-folder.test.ts]
tags: [code, server, connections, security]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-14T12:13:57Z }
---

# Purpose

Keeps the connections the person adds to outside services, as [ADR 0015](../../decisions/adr/0015-person-connections.md) decides (`CAP-02`, A65): Tessera chooses no sources, so any service the person names can be one. Built in #349's steps ([plan](https://github.com/suredo/Tessera/issues/349)): connections can be added, listed and removed (step 1), and a tool can read through the ones its version names (step 2), with the boundary's checks, `CNX-01` to `CNX-06` in the [threat model](../../spec/threat-model.md). This doc doesn't claim `CAP-02` yet: writes stay refused until the first-write confirmation, and a tool being checked reaches nothing until staging's made-up answers (step 3).

# Entry points

- `src/connections/connections.ts`: `listConnections` gives every connection, by name, each as the contracts' `Connection`, which says whether it has a key but never carries one. `addConnection` checks a `ConnectionInput` and keeps it, refusing a taken name or more than the contracts' limit of 50, in plain words; `removeConnection` removes one and its key, refusing a name it doesn't know.
- `src/connections/requests.ts`: `requestThroughConnection` makes a tool's request through a connection, for the tool version it runs and the mount's phase, and gives the contracts' connection answer, or throws a `ConnectionRefusal` with the bridge's code and a plain message. `ConnectionRequestOptions` lowers the time and size limits for a test.
- The [host API](host-api.md) answers `connections.list`, `connections.add` and `connections.remove` with them, and the [bridge route](bridge.md) answers a tool's `connection.request` through `requestThroughConnection`. The [contracts](../contracts/package.md) define the shapes in `src/connection.ts`.

# Behavior

- **A connection is a name, origins and how its key is sent** (`CON-01`). The name is how a tool will ask for it: lowercase letters, digits and hyphens, starting with a letter, at most 40 characters. Its origins, one to five, each once, are an http or https scheme, a host and a port if needed, written as the URL standard writes them, with no path, query or credentials, so a request can't be aimed past them by how an address is written. The key goes in a header (with a prefix such as `Bearer `), in a query parameter, or nowhere; a key is given exactly when one is sent, on one line, at most 4,096 characters.
- **The key stays in the server.** It is kept in the `connections` table, from migration `0017-connections.sql` ([storage](storage.md)), apart from tool data. No listing or reply reads it: a listing selects only whether it is set. Exports read workspaces and saved tools only, so an archive never carries a connection or its key.
- **Connections belong to the person, not to a workspace.** Removing a workspace leaves them; removing a connection removes its key.
- **A tool reaches only the connections its version names** (`CNX-01`, A66). The names come from the stored version the workspace runs, never from the browser. Any other connection is refused as `not-allowed`, and one the version names but the person removed as `failed`, before anything is sent.
- **The address is the connection's; only the path is the tool's** (`CNX-02`). The tool gives a path starting with a single `/` (no whole address, `\`, `#`, spaces or control characters) and may pick one of the connection's origins, its first by default. The host joins them with the URL standard and refuses any result that isn't on that origin. A tool may set only `accept`, `accept-language` and `content-type`; the host sets the rest, the key included.
- **A redirect is never followed** (`CNX-03`): it is refused, so neither the request nor its key goes anywhere else. Not Modified isn't a redirect.
- **The key goes to the service and nowhere else** (`CNX-04`). It is added last, in its header or after the tool's query, which stays exactly as written; a tool that sends the key's query parameter itself is refused. The answer says where it came from (the connection, the address without the key, and when it arrived). No refusal passes on an error's own words, which could name the address and the key with it. The tests look for the key in every reply, every other table of the data folder and the console.
- **An answer is limited** (`CNX-05`): 1 MB, counted as it is read, and 15 seconds for the whole of it; past either, or in a type that isn't text (an image, for now), it is refused whole. A service's own error, such as a 404, is an answer for the tool to read.
- **Until #349 step 3, only reads, and never from a check** (`CNX-06`). GET and HEAD go out; any other method, and any request in the staging phase, is refused as `not-allowed` before anything is sent. A read with a body is `invalid-args`. A read runs freely while the tool starts too (ADR 0015, point 3).

# Pitfalls

- **Keys aren't encrypted at rest,** like everything in the data folder (the [threat model](../../spec/threat-model.md)). Encrypting them, for example with Windows' protected storage, is left for the owner to ask for.
- **A path on the origin can go anywhere on it.** Dot segments resolve on the connection's own origin, which is what the person allowed: a connection is a whole origin, never a path under one.
- **The checks don't yet confirm a tool's connections before it runs.** The request path refuses any other at run time; the static check that a tool asks only for connections its version names comes with the connections prompt part (#349 step 4), when a model can first name one.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `connections.ts`: `listConnections`, `addConnection`, `removeConnection`
- `index.ts`: `addConnection`, `listConnections`, `removeConnection`, `ConnectionRefusal`, `requestThroughConnection`, `ConnectionRequestOptions` (type), `Connection` (type), `ConnectionInput` (type)
- `requests.ts`: `ConnectionRequestOptions` (type), `ConnectionRefusal`, `requestThroughConnection`
