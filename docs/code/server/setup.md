---
type: Code Module
title: "Setup check and probe"
description: "What Tessera needs to reach a model, checked without spending a call: Node.js, Claude Code installed, recent enough and signed in, and the data folder's size; and the opt-in probe, one small model call, run only once the check passes."
resource: ../../../packages/server/src/setup/
implements: [PLAT-03, CLI-02]
tests: [../../../packages/server/test/setup.test.ts]
tags: [code, server, setup, cli]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-26T22:52:08Z }
---

# Purpose

Guides a fresh machine to a working connection (`PLAT-03`): Tessera checks what it needs on start and for the status screen (`APP-07`), and explains each failure in plain words with its fix. The probe (`CLI-02`) is the one check that calls a model, so it costs a call and runs only when the person asks.

# Entry points

- `src/setup/setup.ts`:
  - `checkSetup` gives the setup report: `checkNode` against `MINIMUM_NODE`, Claude Code through the [provider adapters](providers.md)' findClaude, and the data folder with its size from `folderBytes`. It is ready only when both checks pass.
  - `runProbe` makes the probe's call, within `PROBE_TIME_LIMIT_MS`.
  - `setupRoutes` answers the check and the probe for the local server; `SetupOptions` lets tests pass a fake Claude Code.
- The report and the probe's result are contracts in `packages/contracts/src/setup.ts` ([contracts](../contracts/package.md)).

# Invariants

- **The check spends no model call.** Node's version is read from the process, and Claude Code is checked with `claude --version` and `claude auth status`, which reach no model (L-71).
- **Each failure says what is wrong and how to fix it,** in plain words (`GEN-12`): the adapter's messages for Claude Code, and the Node.js version to install.
- **`MINIMUM_NODE` is the root package.json's lower bound;** a test fails if the two disagree.
- **The probe runs only on request, and never while the check fails.** The probe route answers POST only, checks first, and spends nothing if the check fails. Probes sent while one is running share its call, so a double click costs one call.
- **The probe is one small structured answer on the intent stage's route,** the cheapest (`CLI-09`), following the data folder's routes file, with no tools. A failure is the adapter's plain message.
- **Tests fake Claude Code by configuration:** `SetupOptions` (passed through the [launcher](launcher.md)'s `setup` option) replaces `findClaude` and the probe's provider. They never come from the request (`ENG-11`).

# Depends on / used by

The [provider adapters](providers.md) (`findClaude`, `createClaudeProvider`, routing) and the [local server](local-server.md)'s helpers. The [launcher](launcher.md) mounts the routes, and its entry point prints the check's failures on start. The status screen (the rest of #142) shows the report and offers the probe.

# Pitfalls

- **The probe is a live call** when the real Claude Code is used. Run for an evaluation, it counts against the milestone's budget (`TEST-05`). It isn't in the ledger yet (#151).
- **`folderBytes` walks the whole data folder** for each check, which is fine for the sizes M2 expects; a very large folder would make the status screen slower.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `checkNode`, `checkSetup`, `folderBytes`, `MINIMUM_NODE`, `PROBE_TIME_LIMIT_MS`, `runProbe`, `setupRoutes`, `SetupOptions` (type)
- `setup.ts`: `MINIMUM_NODE`, `PROBE_TIME_LIMIT_MS`, `SetupOptions` (type), `checkNode`, `folderBytes`, `checkSetup`, `runProbe`, `setupRoutes`
