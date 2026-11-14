---
type: Code Module
title: "Bridge route"
description: "The server's side of the bridge: a tool's data calls, passed on by the host page, checked again with the stored version's capabilities and answered from the saved data and revisions."
resource: ../../../packages/server/src/bridge/
implements: [RUN-04, CAP-01, GEN-06, BRG-04, DATA-02, AST-04, AST-05]
tests: [../../../packages/server/test/bridge-routes.test.ts, ../../../packages/server/test/connection-requests.test.ts]
tags: [code, server, bridge]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-14T12:14:36Z }
---

# Purpose

Answers a tool's data calls from the saved data (`RUN-04`, `DATA-02`). The host page serves the bridge to a mounted tool (the [runtime package](../runtime/package.md)) and passes its data calls on here; the server checks each one again with the same `checkBridgeCall` from the [contracts package](../contracts/package.md) before it reads or changes anything, so a bug in the host page can't reach the data with a call the manifest refuses.

# Entry points

- `src/bridge/bridge.ts`:
  - `bridgeRoutes` gives the local server its one bridge route, the contracts' `/api/bridge`: a POST whose JSON body is the contracts' bridge data request, the workspace, the mount's phase and the tool's call. It answers with the bridge's reply as JSON. The [launcher](launcher.md) mounts it.
  - `answerDataCall` checks one call and answers it, asynchronously: `data.read` from the workspace's saved data and revisions, `data.patch` through the [workspaces](workspaces.md) module's patch function, `asset.read` from the [asset store](assets.md), and `connection.request` through the [connections](connections.md) module's request path. Its options, and `bridgeRoutes`', pass that path's limits on, for a test to lower.

# Invariants

- **Checked again, by the server's own lights** (`RUN-04`, `CAP-01`). The capabilities are those the workspace's current, stored tool version declares, read from the database, never sent by the browser; a workspace without a usable version declares none. Arguments, size, shape and action are checked as the host page checked them, by the same function.
- **Only the phase is the host page's word** (`GEN-06`, the owner's decision on #46). The person's first interaction is seen only in the browser, so the host page sends the mount's phase, and a write is refused unless it is `active`. The staging panel runs on synthetic data and never calls this route.
- **A stale change is refused whole** (`BRG-04`). `data.patch` runs against the saved revisions in one transaction; a batch planned against an older revision changes nothing and gets `stale` with the patch engine's plain message, while one touching other records applies. The engine's other refusals become `invalid-args` and `too-large`.
- **A write must leave the data fitting the tool's shape** (`DATA-02`, [#322](https://github.com/suredo/Tessera/issues/322)). `data.patch` checks the changed data against the JSON Schema of the version the workspace runs, inside the same transaction and against that same version, as a chat change is checked. A change that wouldn't fit gets `invalid-args` with "The change doesn't fit this tool. Your entries were kept." and nothing is saved. A workspace without a usable version has no shape to check, so it gets `failed` and nothing is written. The check is the [data shape](data-shape.md) module's cached compiled schema; on data near the 256 KB limit it adds no measurable time to a write.
- **Nothing of the server reaches the tool.** A workspace that is gone or in the trash gets a plain `failed` reply; any unexpected error, such as a busy database, becomes "The host couldn't do that." Results are checked against the manifest before they are sent.
- **A tool gets only the images its own workspace names** (`AST-04`, `DATA-11`). `asset.read` answers only for an asset the workspace's data, versions or snapshots name, found as cleanup finds references; another workspace's image is refused as `invalid-args`, even by its right ID. The answer is the image's type and its bytes as base64, checked against the manifest: never a path, a folder or an address (`AST-05`). The file is read at once, as the reply is built; one asset is at most 25 MB.
- **A request through a connection goes only through the connections the stored version names** (`CNX-01`, A66). The names, like the capabilities, come from the workspace's current version in the database; a workspace without a usable version names none, so nothing is sent. The phase the host page sends is checked here too: a staging call reaches no service (`CNX-06`). The request path's refusals come back with their code and plain words ([connections](connections.md)).
- **Only data and connection actions are the server's.** An accepted call for another action, such as `clock.now`, gets `failed`: the host page answers those itself.
- **The request is bounded.** Only POST; a body over the bridge's limit, with room for the workspace and phase, is refused with 413 before it is parsed; one that isn't the contract gets 400. The local server's guard has already refused anything not from the host app's own pages (`SEC-03`).

# Depends on / used by

Depends on the contracts, [workspaces](workspaces.md), the [data shape](data-shape.md) module, [tool versions](versions.md) and the [local server](local-server.md)'s `Handler`. The [launcher](launcher.md) mounts it, and the [runtime](../runtime/package.md)'s `serverData` calls it from the host page. Its path is the contracts' `BRIDGE_ROUTE`.

# Pitfalls

- **Instances are the browser's.** The server doesn't know mounts: each mount's port is bound to its own instance (`BRG-05`), so the server checks calls as one instance.
- **The host page must send the call as the tool made it.** The server checks the call itself, not just its arguments, so the request ID comes back in the reply.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `bridge.ts`: `answerDataCall`, `bridgeRoutes`
- `index.ts`: `answerDataCall`, `bridgeRoutes`
