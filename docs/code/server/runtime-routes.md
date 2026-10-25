---
type: Code Module
title: "Runtime routes"
description: "The local server's runtime documents on the opposite loopback name: the wrapper with a nonce-bound script, and a tool's document sandboxed under the strict CSP."
resource: ../../../packages/server/src/runtime/
implements: [RUN-01, SEC-03]
tests: [../../../packages/server/test/runtime-routes.test.ts, ../../../packages/web/e2e/sandbox.spec.ts]
tags: [code, server, runtime]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-25T08:29:34Z }
---

# Purpose

Serves the two documents of the [runtime](../runtime/package.md) (`RUN-01`): `/runtime/wrapper` and `/runtime/tool?mount=<id>`. They are routes of the [local server](local-server.md), whose guard has already checked that the request is for localhost, as a frame of the host app or the runtime (`SEC-03`).

# Entry points

- `src/runtime/routes.ts`: `runtimeRoutes` takes a `ToolFor`, which gives a mount's tool code and UI mode, and returns the two routes; `toolDocument` builds a tool's document.

# Invariants

- **The guard's policy stays.** Each route adds its own Content-Security-Policy beside the guard's `frame-ancestors`; the browser enforces every policy.
- **The wrapper runs only its own script,** marked with a new nonce on every request, and frames only the tool's document.
- **A tool's document is sandboxed and under the strict CSP,** by header (`sandbox allow-scripts`), whatever frames it. The preamble runs before the tool's markup and code. Neither document is cached.
- **The host's styles come before the tool's** (`RUN-05`). The tool's document carries the runtime's host stylesheets inline, after the preamble and before the tool's own styles: the accessibility floor always, the UI standard's look in standard mode only (`VER-06`). Their cascade layers are named with a new random mark for every document, so a tool's styles can't add rules to them ([runtime package](../runtime/package.md)).
- **An unknown mount gets 404.** Which mounts exist, and what code each shows, is the caller's (`ToolFor`); the host app's mounts arrive with the app shell (#53).

# Depends on / used by

Depends on `@tessera/runtime/policy` and the runtime's browser scripts, read from `packages/runtime/src` and stripped of their types with Node's `stripTypeScriptTypes`, once. Used by the server the launcher starts, and by the browser tests.

# Pitfalls

- **The scripts are read from the runtime package's source folder,** found by a path relative to this module; moving either package needs that path updated.
- **The tool's markup is inserted as given.** A tool's own document can only hurt itself; a closing `</script>` or `</style>` inside its code is kept from ending its script or styles early.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `runtimeRoutes`, `toolDocument`, `ToolFor` (type)
- `routes.ts`: `ToolFor` (type), `toolDocument`, `runtimeRoutes`
