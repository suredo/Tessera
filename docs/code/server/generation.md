---
type: Code Module
title: "Generation stages"
description: "A request becomes a checked candidate tool: the create stage's answer, a discriminated union, with the tool's data shape, reusable defaults and the request's own entries apart, checked by the host before anything is stored or run, every failure classed, and a failure of the host's checks repaired by its class within its budget; and the pipeline that carries a request through intent and creation to a stored candidate with its workspace, ready to stage."
resource: ../../../packages/server/src/generation/
implements: [GEN-05, CON-02, GEN-07]
tests: [../../../packages/server/test/create.test.ts, ../../../packages/server/test/edit.test.ts, ../../../packages/server/test/edit-pipeline.test.ts, ../../../packages/server/test/pipeline.test.ts]
tags: [code, server, generation]
status: draft
generated: { by: codex/gpt-6, at: 2026-10-28T18:03:38Z }
---

# Purpose

The core of generation (#146): a request's interface part creates or edits a candidate tool, or yields an honest refusal. Creation stores a candidate with a new workspace's starting data. Editing stores a checked version for the existing workspace, leaving its active tool and entries untouched until activation. Failed checks are repaired by class, including browser smoke failures. Chat data actions and mixed requests follow.

# Entry points

- `src/generation/edit.ts`: `editTool` runs an edit or a per-class repair with the edit output contract; `editedCandidate` checks it without storing anything. `EditInput` carries the original artifact, workspace data for local validation only, structured intent and repair usage.
- `src/generation/edit-pipeline.ts`: `generateEdit` retains the workspace/version/revision captured before intent, checks it again before and after editing, and stores only a changed candidate. An identical result returns unchanged without staging or a history entry; a concurrent workspace change returns stale without applying the edit. Actual data migration remains activation's transaction.

- `src/generation/create.ts`:
  - `createTool` asks the create stage on its route (`CLI-09`), within `GENERATION_TIME_LIMIT_MS` (`GEN-11`), repairs a failure of the host's checks on the repair route, within `REPAIR_TIME_LIMIT_MS` and `REPAIR_BUDGETS`, and gives a `CreateResult`: a `Candidate`, a "cannot" with its reason, or a failure with its class and findings, each with how many repairs it took.
  - `candidateFrom` is the host's checks on a created tool.
  - `startingDataOf` builds a new workspace's data from the defaults and the request's entries.
- `src/generation/pipeline.ts`: `generate` carries out a request as far as the server goes.
- `src/generation/routes.ts`: `generationRoutes` answers the host app's requests on the generate route, each run as a job (`CLI-06`); `GenerationOptions` gives it the store, the job queue, the provider and the routes.
- `src/generation/smoke.ts`: `repairSmoke` loads the failed stored version and repairs it using the original interface request, intent language, diagnostics and remaining class budgets. `SmokeRepairContext` is the server-owned continuation remembered by the route.
- The answer's contract is the contracts' creation schema, with the failure classes beside it ([contracts](../contracts/package.md)). The stage's prompt adds the create part to the [prompt assembly](prompts.md).

# Invariants

- **Edits declare file and data changes separately** (`CON-02`, `GEN-07`). Files can stay unchanged or be replaced in full. Data can stay unchanged or migrate one version with the existing declarative migration contract. Thus unchanged files can still produce a real data-declaration change. The host returns `unchanged` only when the complete canonical artifact is identical; a model summary never decides whether a version changed.
- **The host owns preserved declarations** (`GEN-13`, in part). Edit output cannot name or replace the tool's name, capabilities, pins, UI declaration or starting entries. A style-only edit must keep HTML, JavaScript and data identical. Other edits retain unrelated behavior by prompt instruction; semantic verification and narrower prompt context remain later work under #150.
- **Edit migrations cannot lose existing values.** A data change needs the intent's `behaviorChange`, exactly the next version and a changed schema. The target schema/defaults pass the same bounded data checks as creation (`dataProblems`); both current entries and old reusable defaults migrate on copies with loss tracking. Any removed or replaced value, invalid record naming/id, incompatible result, or defaults differing from the migrated old defaults is refused. No workspace data is sent to the prompt or written here. Destructive edits and other declaration changes answer cannot or fail; confirmation flows are outside this slice.
- **Edit repair retains the original baseline.** Each call uses the original code and declarations, with a failed edit quoted separately when its shape is valid. Edits and their schema/static/smoke repairs use the same edit contract and host checks, existing per-class counts and 180-second limits; provider failures never repair. Browser smoke-repair continuation is integrated separately.

- **The answer is a discriminated union** (`CON-02`): a tool, or "cannot" with a reason. No null means two things, and capabilities are limited to the bridge's own.
- **Defaults and the request's entries stay apart** (`GEN-05`). The artifact keeps only the reusable defaults. A new workspace starts from the defaults, with each list the request gave entries for extended by them. The request's entries never become defaults.
- **Nothing is stored or run before the host's checks.** In order:
  - the declared data shape must be one Tessera can check (`DATA-03`);
  - the defaults and the starting data must fit it, within the most data a tool may hold (`DATA-06`), and every record must be one the patch engine can change (`DATA-02`): its list's name, its id and its field names must be ones the patch contract accepts (one definition, the contract's own), and its id unique in its list. As the patch engine counts a list as records only when every item is one, a list holding any object must hold only records, and an empty list is held to the name rule unless the schema declares it a list of other values (an item type that rules out objects, written as one name or a list of them);
  - the artifact must match its contract (`CON-04`);
  - the static check must pass (`VER-01`, [static check](checks.md)).
- **Every failure is classed** (`GEN-09`):
  - schema-shape: a data shape, data or answer that doesn't fit, which repair can fix;
  - static: findings with the part and line;
  - provider: any other failure of the call (sign-in, limits, time), which is never repaired.

  Smoke failures come from browser staging; behavior failures wait for M3.
- **A failure of the host's checks is repaired by its class** (`GEN-09`). Schema-shape and static failures go to the repair stage, on its own route (Sonnet medium, `CLI-09`), with their class's prompt part, what the checks found and the failed answer quoted, or, for an answer of the wrong shape, the request alone. The repair answers as creation does, and its answer goes through the same checks. Each class has its own budget in one request, one repair each for now, so a static failure after a shape repair still gets its own, and the result says how many repairs it took (A40). A provider failure, in creation or in a repair, is never repaired. A repair may also answer "cannot".
- **The prompt's schema keywords are the host's own list,** the one the data shape is checked against, so the model is told exactly what passes.

- **It doesn't carry out a mixed request yet.** `GEN-04` asks that the interface part goes to generation and the data part is applied after, as a validated patch batch; until the edit and data stages exist, a mixed request is answered "not yet", and `GEN-04` isn't claimed.
- **The pipeline carries a request as far as the server goes, and activates nothing.** The intent stage decides, with the open tool and its lists, and the saved tools' IDs.
  - Clarify, unsupported and ask-to-split are answered as they are, and a listed saved tool is offered to open.
  - An interface edit runs `generateEdit` against the open tool. Data and mixed requests are answered "not yet" until their stages exist.
  - Create and new tool run the create stage on the interface part. A checked candidate is stored, and its workspace starts with its starting data: the open workspace if it has no tool and no data yet, or a new one, named after the tool.
  - The reply gives the candidate's mount (`v-` and its hash) and its defaults as synthetic data, for staging (`RUN-03`). The host app stages it behind the smoke check and activates it (`DATA-10`), and activation keeps the starting data.
- **A creation failure stores nothing.** A candidate that still fails the server's checks after its repairs is answered with a plain sentence and its findings. A provider failure, in either stage, gives the adapter's plain message. A setup problem, or a routes file Tessera can't use, is answered in plain words before any call. A smoke failure happens after the initial candidate and starting workspace have been stored; its repair activates nothing and changes no workspace data.
- **Smoke repair continues the same creation** (`GEN-09`). The browser sends the workspace, candidate hash and smoke reason to `/api/generate/repair-smoke`, which answers with the generation reply contract. The route retains at most 100 continuations for seven minutes after creation, with the original request, intent and repair counts. It consumes a continuation before calling repair, so duplicate or concurrent reports cannot buy another repair; a restart or expiry loses eligibility. The repaired candidate gets no new continuation. Schema and static failures from the repair use only their remaining budgets; provider failures are never repaired.
- **Smoke repair never reinstalls starting data** (`GEN-05`). A creation's failed answer comes from the stored artifact, with empty initial state, and its workspace must still have no active version. An edit's continuation keeps the original active version and the expected data revision, reconstructs the failed edit against that original artifact, and uses the edit stage/contract. Both repair paths must preserve the failed candidate's exact data declaration and defaults and retain the expected workspace revision before and after the call. The browser stages the repaired version against its defaults and activates it against that same revision. Existing entries are kept exactly once; an edit's requested migration is applied only at activation.
- **One request at a time** (`CLI-06`): each runs as a job in the server's job queue.

# Depends on / used by

The [provider adapters](providers.md)' routing, the [prompt assembly](prompts.md), the [data shape](data-shape.md) checks, the [static check](checks.md), and the contracts. The pipeline (#146) will run the [intent stage](intent.md), then this stage, then staging and activation, then the data part of a mixed request.

# Pitfalls

- **The first create prompt always assembles in standard mode.** A request for its own design can still answer custom, but its prompt carried the standard's look; a custom-mode first prompt waits for the intent stage to say so. Repair uses the failed answer's mode when it has one.
- **"cannot" overlaps the intent stage's unsupported.** The intent stage should catch those first; the create stage's answer is the second wall, not the main one.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `create.ts`: `GENERATION_TIME_LIMIT_MS`, `REPAIR_TIME_LIMIT_MS`, `REPAIR_BUDGETS`, `Candidate` (type), `CreateResult` (type), `startingDataOf`, `dataProblems`, `candidateFrom`, `CreateInput` (type), `createTool`
- `edit-pipeline.ts`: `generateEdit`
- `edit.ts`: `EditInput` (type), `EditResult` (type), `editedCandidate`, `editTool`
- `index.ts`: `candidateFrom`, `dataProblems`, `createTool`, `GENERATION_TIME_LIMIT_MS`, `REPAIR_BUDGETS`, `REPAIR_TIME_LIMIT_MS`, `startingDataOf`, `Candidate` (type), `CreateInput` (type), `CreateResult` (type), `generate`, `editedCandidate`, `editTool`, `EditInput` (type), `EditResult` (type), `generationRoutes`, `GenerationOptions` (type)
- `pipeline.ts`: `generate`
- `routes.ts`: `GenerationOptions` (type), `generationRoutes`
- `smoke.ts`: `SmokeRepairContext` (type), `repairSmoke`
