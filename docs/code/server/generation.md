---
type: Code Module
title: "Generation stages"
description: "A request becomes a checked candidate tool: the create stage's answer, a discriminated union, with the tool's data shape, reusable defaults and the request's own entries apart, checked by the host before anything is stored or run, and every failure classed for repair; and the pipeline that carries a request through intent and creation to a stored candidate with its workspace, ready to stage."
resource: ../../../packages/server/src/generation/
implements: [GEN-05, CON-02, GEN-04]
tests: [../../../packages/server/test/create.test.ts, ../../../packages/server/test/pipeline.test.ts]
tags: [code, server, generation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T07:17:25Z }
---

# Purpose

The core of generation (#146): a request's interface part becomes a candidate tool, or an honest "no tool can do this". The create stage makes a candidate; the pipeline carries a request through the intent stage and creation, and stores the candidate with its workspace and starting data, ready for the host app to stage and activate. Repair and edits follow.

# Entry points

- `src/generation/create.ts`:
  - `createTool` asks the create stage on its route (`CLI-09`), within `GENERATION_TIME_LIMIT_MS` (`GEN-11`), and gives a `CreateResult`: a `Candidate`, a "cannot" with its reason, or a failure with its class and findings.
  - `candidateFrom` is the host's checks on a created tool.
  - `startingDataOf` builds a new workspace's data from the defaults and the request's entries.
- `src/generation/pipeline.ts`: `generate` carries out a request as far as the server goes.
- `src/generation/routes.ts`: `generationRoutes` answers the host app's requests on the generate route, each run as a job (`CLI-06`); `GenerationOptions` gives it the store, the job queue, the provider and the routes.
- The answer's contract is the contracts' creation schema, with the failure classes beside it ([contracts](../contracts/package.md)). The stage's prompt adds the create part to the [prompt assembly](prompts.md).

# Invariants

- **The answer is a discriminated union** (`CON-02`): a tool, or "cannot" with a reason. No null means two things, and capabilities are limited to the bridge's own.
- **Defaults and the request's entries stay apart** (`GEN-05`). The artifact keeps only the reusable defaults. A new workspace starts from the defaults, with each list the request gave entries for extended by them. The request's entries never become defaults.
- **Nothing is stored or run before the host's checks.** In order:
  - the declared data shape must be one Tessera can check (`DATA-03`);
  - the defaults and the starting data must fit it, and every record must be one the patch engine can change (`DATA-02`): its list's name, its id and its field names must be ones the patch contract accepts (one definition, the contract's own), and its id unique in its list. As the patch engine counts a list as records only when every item is one, a list holding any object must hold only records, and an empty list is held to the name rule unless the schema declares it a list of other values (an item type that rules out objects, written as one name or a list of them);
  - the artifact must match its contract (`CON-04`);
  - the static check must pass (`VER-01`, [static check](checks.md)).
- **Every failure is classed** (`GEN-09`):
  - schema-shape: a data shape, data or answer that doesn't fit, which repair can fix;
  - static: findings with the part and line;
  - provider: any other failure of the call (sign-in, limits, time), which is never repaired.

  Smoke and behavior failures come from staging and M3.
- **The prompt's schema keywords are the host's own list,** the one the data shape is checked against, so the model is told exactly what passes.

- **The pipeline carries a request as far as the server goes, and activates nothing.** The intent stage decides, with the open tool and its lists, and the saved tools' IDs.
  - Clarify, unsupported and ask-to-split are answered as they are, and a listed saved tool is offered to open.
  - A change to the open tool (edit, data, mixed) is answered "not yet" until the edit and data stages exist.
  - Create and new tool run the create stage on the interface part. A checked candidate is stored, and its workspace starts with its starting data: the open workspace if it has no tool and no data yet, or a new one, named after the tool.
  - The reply gives the candidate's mount (`v-` and its hash) and its defaults as synthetic data, for staging (`RUN-03`). The host app stages it behind the smoke check and activates it (`DATA-10`), and activation keeps the starting data.
- **A failure stores nothing.** A candidate that fails the host's checks is answered with a plain sentence and its findings. A provider failure, in either stage, gives the adapter's plain message. A setup problem, or a routes file Tessera can't use, is answered in plain words before any call.
- **One request at a time** (`CLI-06`): each runs as a job in the server's job queue.

# Depends on / used by

The [provider adapters](providers.md)' routing, the [prompt assembly](prompts.md), the [data shape](data-shape.md) checks, the [static check](checks.md), and the contracts. The pipeline (#146) will run the [intent stage](intent.md), then this stage, then staging and activation, then the data part of a mixed request.

# Pitfalls

- **The create prompt always assembles in standard mode.** A request for its own design can still answer custom, but its prompt carried the standard's look; a custom-mode first prompt waits for the intent stage to say so.
- **"cannot" overlaps the intent stage's unsupported.** The intent stage should catch those first; the create stage's answer is the second wall, not the main one.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `create.ts`: `GENERATION_TIME_LIMIT_MS`, `Candidate` (type), `CreateResult` (type), `startingDataOf`, `candidateFrom`, `CreateInput` (type), `createTool`
- `index.ts`: `candidateFrom`, `createTool`, `GENERATION_TIME_LIMIT_MS`, `startingDataOf`, `Candidate` (type), `CreateInput` (type), `CreateResult` (type), `generate`, `generationRoutes`, `GenerationOptions` (type)
- `pipeline.ts`: `generate`
- `routes.ts`: `GenerationOptions` (type), `generationRoutes`
