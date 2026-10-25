---
type: Code Module
title: "Host API"
description: "The host app's one route to the server: every action its screens ask for (workspaces, the library, versions and restore, undo and the trash), checked against the contracts at both ends, and the tools its mounts show."
resource: ../../../packages/server/src/host/
implements: [CON-01]
tests: [../../../packages/server/test/host-api.test.ts]
tags: [code, server, api, host]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-25T14:12:19Z }
---

# Purpose

Connects the host app's screens (#53) to the server's modules. Everything the app asks for, from listing workspaces to restoring a version or emptying the trash, is one action in the contracts' `HOST_ACTIONS` ([contracts package](../contracts/package.md)), sent to one route, `HOST_ROUTE` (`POST /api/host`). The work is the existing modules': [workspaces](workspaces.md), restore, undo, the library and the [trash](trash.md). This module only checks requests and answers, and connects them.

# Entry points

- `src/host/host.ts`:
  - `answerHost` answers one request: an action and its arguments, checked against the contract, then run, and its result checked against the contract before it is sent (`CON-01`).
  - `hostRoutes` gives the local server the route: POST only, at most 64 KB, JSON. The [launcher](launcher.md) mounts it.
  - `workspaceTools` gives the [runtime routes](runtime-routes.md) the tool each mount shows: a mount is a workspace, by its ID, and shows that workspace's current tool version, its code and UI mode.

# Invariants

- **Opening a workspace gives what its tool declares.** `workspaces.open` answers with the workspace and its current tool's capabilities (`CAP-01`), which the app serves the bridge with; none without a tool. It also records that the workspace was used, which `workspaces.list` gives with the workspaces (`APP-03`).
- **One handler per action.** TypeScript refuses the handler table if an action in the contract has none, and each handler's return must be its action's result.
- **Nothing of the server leaks.** An action the contract doesn't list, or arguments that don't fit it, get `invalid`. A module's own refusal, a plain error written for the person (such as "The workspace is in the trash; restore it first."), gets `refused` with its words. Anything else, such as a database error, which carries a code, gets `failed`, "Tessera couldn't do that. Nothing was changed.", with none of its words. A result that doesn't fit the contract is `failed` too.
- **Refusals that are answers stay answers.** A restore or undo that is refused for a reason, such as stale data, comes back as its result with `ok: false`, its reason and plain message, as the modules give it, so the screen can say why.
- **A mount shows only a workspace's current, readable version.** One that is missing, in the trash, without a tool or with a damaged version shows nothing (the runtime routes answer 404).
- **The route is behind the guard** (`SEC-03`): another site's page can't reach it.

# Depends on / used by

Depends on the [workspaces](workspaces.md), [trash](trash.md), [tool versions](versions.md), [local server](local-server.md) and [runtime routes](runtime-routes.md) modules and the contracts. The host app's screens (#53) use it. Export and import, which move files, have routes of their own ([export and import](archives.md)).

# Pitfalls

- **A plain `Error` without a code is taken as a refusal for the person.** The modules write theirs that way; a new module that throws a plain `Error` with internal details would show them. Throw errors with a code, or a subclass, for anything not meant for the person.
- **Mounts are workspace IDs.** A candidate in the staging panel is shown under another kind of mount, which comes with the staging screen.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `host.ts`: `answerHost`, `hostRoutes`, `workspaceTools`
- `index.ts`: `answerHost`, `hostRoutes`, `workspaceTools`
