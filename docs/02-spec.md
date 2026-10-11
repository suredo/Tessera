# Tessera specification

Status: draft 0.3 · 2026-10-11 · Target requirements for Tessera, not a statement of implemented behavior. Written from the Harness POC (see [01-lessons-learned.md](01-lessons-learned.md)). Decisions and open questions are in [05-open-decisions.md](05-open-decisions.md).

This spec says **what** the product does and **which rules it must follow**. The [roadmap](03-roadmap.md) says in which order. The [engineering practices](04-engineering-practices.md) say how we work. The [test scenarios](06-test-scenarios.md) say how we check it the way people will use it. Every requirement has an ID, such as `GEN-04`, so lessons, tests and pull requests can point at it.

---

## 1. Product

### 1.1 What it is

**An environment where people get the interface they need, either by creating it now or by opening one they saved.**

It is a local-first web app where a person describes what they need in everyday words. The app builds a working tool for them inside the conversation, for example a planner, a board, a study helper, a calculator or a simulation. The person then keeps using and changing it, either by talking or by using the tool's own controls. Both act on the same saved data.

Tools are real generated code (HTML, CSS, JavaScript) running in a sandbox. They are not templates filled in. Saved tools can be reopened without calling a model.

**The product ships no tools.** There are no built-in tools, templates, examples or default apps. Every tool exists because the person asked for it, and a person's first interaction is always creating a tool. The product's job is the lifecycle around that: **create, edit, save, update, reopen, undo**. Curated examples, sets of tools, capabilities or micro-apps may come later, and so may a tool store ("check the store before generating"). None is part of the first release, and nothing in the design may assume one exists.

### 1.2 Who it is for

A person with general knowledge who wants to get something done. They are not a developer. They don't know words like "state", "schema", "component" or "engine", and they shouldn't need to.

Implications:
- Requests arrive in natural language, in any phrasing, in the person's language. There are no command prefixes to learn.
- Tools must be useful right away, not empty forms that need setup first (`UX-01`).
- Messages are plain, short and honest (`GEN-12`, `UX-03`).

The first release's actual users are the product owner and testers (A29). The design still serves the non-technical person, and an installer comes later.

### 1.3 Goals for the first release

1. Create a useful tool from one everyday request, starting from nothing.
2. Change it reliably, in looks, behavior or data, without losing anything the person did.
3. Save it, update it, reopen it, find it again by asking, and undo changes, with every version kept.
4. Keep data safe: nothing is silently lost, overwritten or invented.
5. Know when a tool works: the host verifies behavior instead of trusting the model's word.
6. Know what it cost: every model call is measured.

### 1.4 Not in the first release

- Built-in tools, templates, examples or a tool store (see 1.1).
- Simulation engines, research and flow checks. They come in a later milestone (`SIM-*`, roadmap M5); the POC design is the reference.
- Codex as a product provider. Only Claude Code ships in v0.1 (`CLI-01`); Codex and Claude Code both develop, review, run and test Tessera from M0. Product integration is separate from development participation.
- macOS, Linux, or an installer (`PLAT-01`).
- Hosting, accounts, multi-user use, sharing or a marketplace.
- Running native code, or desktop and OS overlays.
- Several tools executing at the same time (one active runtime, `RUN-02`).
- AI inside tools, such as a tool calling a model itself (`CAP-05`).
- A richer versioning system for tools: named versions, drafts or branches, side-by-side comparison. Besides helping people, it could let the AI work on bigger or complex changes in a draft, checked step by step, before anything replaces the live version. The first release keeps linear versions with restore (`DATA-04`, `APP-05`).

### 1.5 Key concepts

| Term | Meaning |
| --- | --- |
| **Tessera** (the host) | The app: chat, panels, storage, checks, and the link to the model. It owns all data and decides what is allowed. |
| **Tool** | An interface the person asked for: generated HTML, CSS and JavaScript that runs in the sandbox. |
| **Workspace** | One working session with one tool: the tool's current version, its data, its versions and its conversation. Every workspace is saved automatically, all the time (`DATA-08`). |
| **Version** | An immutable snapshot of a tool's code. Every accepted change creates a new version; older versions can be restored (`DATA-04`, `APP-05`). |
| **Data** | What the person put into a tool (items, entries, settings), kept by the host in the tool's declared shape (`DATA-03`). |
| **Reusable defaults** | The tool's declared starting configuration, such as categories, units and empty collection shapes. Separate from session entries, original-request data and examples; used by **Use again** (`DATA-07`). |
| **Saved tool** | A named entry in the person's library ("Weekly shopping"), created with **Save to my tools**. It can be opened with **Continue** (the same workspace and data) or **Use again** (the same tool, fresh data, a new workspace) (`DATA-07`), and found by asking (`GEN-18`). |
| **Trash** | Where deleted workspaces and saved tools wait for 30 days before being removed for good (`DATA-09`). |
| **Verification profile** | An internal pattern the host knows how to test, such as "a list of items". Never shown as a tool (`VER-03`). |
| **Host capability** | Something a tool can ask the host for, such as the date and time, outside data, files, or a vetted library (`CAP-*`). |
| **Stage** | One model call in the pipeline (intent, create, edit, repair, review). Every stage is recorded in the ledger (`OBS-01`). |

---

## 2. Principles

These come straight from what went wrong and right in the POC.

| # | Principle | Meaning in practice |
| --- | --- | --- |
| P1 | **The model proposes, the host decides** | Every model output is a structured proposal. The host validates it, applies it, or sends it back for repair. Permissions, data integrity, versions, sandboxing and verification are never left to the model. |
| P2 | **Verify outcomes, not claims** | A tool counts as working only when host checks pass. A message like "I added your topics" is shown only if the host confirms the topics were added. |
| P3 | **One definition, many uses** | Each contract (bridge API, verification profiles, checks, UI standard) is defined once. Prompt text, types, static checks and runtime enforcement are generated from that definition, so nothing can say one thing in the prompt and check another. |
| P4 | **Structured over guessed** | Intent comes from a structured model answer that the host checks, not from keyword matching. Keyword rules may only act as tested safety nets, never as the main decision. |
| P5 | **Testable by design** | Generated tools that match a verification profile expose stable hooks, so the host can test them even though their design changes every time. |
| P6 | **Nothing invisible** | Every model call, failure reason and check result is recorded. The person sees plain words; the details view shows everything. |
| P7 | **Local-first and private** | Persistent data stays locally. Model calls send the task context needed by their stage through the signed-in CLI; that context can include user-provided data. Data-provider requests send only the explicitly requested search terms/filters (`CAP-02`). Neither path silently forwards unrelated workspace contents. |

---

## 3. Architecture

```text
Launcher (Windows)                    starts the local server, opens the browser (PLAT-02)

Browser
├── Host app (React 19 + Compiler)    chat, tool panel, workspaces, saved tools, versions, trash, setup, details
└── Sandboxed tool runtime            generated code; talks to the host only through the bridge

Local server (Node.js 22 + TypeScript), bound to 127.0.0.1
├── Pipeline                          intent → find saved | generate/edit → checks → repair → result
├── Provider adapter                  Claude Code CLI (process isolation, locked flags, usage)
├── Capabilities                      clock, data providers, files in and out, vetted libraries
├── Check runner                      static checks; behavior checks are driven in the browser
├── Storage (SQLite)                  workspaces, versions, data, saved tools, trash, ledger
├── Runtime server                    serves sandbox documents with strict CSP
└── Evaluation runner                 scenarios, budget guard, dry run, AI review, reports (dev only)

Shared package
└── Contracts (zod)                   schemas → TypeScript types + JSON Schema for model outputs
```

Tooling (decided, A14 and A15): Node.js 22 LTS, pnpm workspaces, Vite, zod, React 19 with the React Compiler.

Repository layout (proposal): a pnpm workspace with `packages/contracts`, `packages/server`, `packages/web` (React host app) and `packages/runtime`, plus `evals/` for the evaluation runner, scenarios and reports. The sandboxed runtime stays framework-free: generated tools are plain HTML, CSS and JS, whatever the host uses.

---

## 4. Platform and setup (`PLAT`)

| ID | Requirement |
| --- | --- |
| PLAT-01 | **Windows first** (A29). The first release supports Windows 10 and 11. Code avoids Windows-only assumptions (paths, process spawning, line endings) behind small platform helpers, so macOS and Linux can follow without a rewrite. |
| PLAT-02 | **Launcher.** One double-click (a shortcut or script) starts the local server, picks a free port if the default is taken, prevents a second copy from running, and opens the browser at Tessera. Closing it stops the server cleanly. |
| PLAT-03 | **Setup check.** On start, and from the setup screen (`APP-07`), Tessera checks: Node version; Claude Code installed (path and version, `CLI-02`); signed in; minimum version met. Each failure is explained in plain words, with the exact fix. Nothing that needs the model is offered until the check passes. |
| PLAT-04 | **Data location.** The SQLite file, exports and logs live in one user data folder, shown on the setup screen and easy to back up. It is never inside a cloud-synced folder by default (L-02). |

---

## 5. Host app (`APP`)

What the person sees and can do. Visual design follows the same UI standard as generated tools, adapted for the host (`VER-06`).

| ID | Requirement |
| --- | --- |
| APP-01 | **Main screen.** A chat and a tool panel side by side on wide screens, stacked on narrow ones, with a resizable divider. The tool panel can be inline, expanded or full screen. Window controls (minimize, expand, full screen, versions, save, details) belong to the host, never to generated tools. |
| APP-02 | **First run and empty state.** With no workspaces, the screen invites the person to describe what they need. There are no example tools (A12). |
| APP-03 | **Workspaces.** A list of workspaces (name, last used, saved or not), with switching, renaming, and deleting to the trash. Switching keeps exactly one tool running (`RUN-02`), and the chat belongs to its workspace. |
| APP-04 | **Saved tools library.** The person's saved tools with name, short description, last update and search. Each entry offers **Continue** and **Use again** (`DATA-07`), plus rename, **Save as a new tool**, and delete to the trash. |
| APP-05 | **Versions.** For the current tool: versions with the change summary, time and verification results. **Restore** brings back older interface code as a new version while preserving current data. If compatibility conversion would lose information, show the affected fields/records and obtain confirmation before proceeding; retain a recovery snapshot. Cancel keeps the current version and data (`DATA-10`). **Undo** is one step back for interface or data changes (`DATA-04`). |
| APP-06 | **Export and import** of a workspace or a saved tool to and from a file (`DATA-05`), with validation and a plain report of what was imported. |
| APP-07 | **Setup and status screen.** Claude Code status (installed, version, signed in), the data folder, storage size, and the probe (`CLI-02`, `PLAT-03`). |
| APP-08 | **Trash.** Deleted workspaces and saved tools, with restore and the date each will be removed. Emptying the trash early asks for confirmation and names what will be removed (`DATA-09`). |
| APP-09 | **Details view.** Source, versions, checks, the ledger and diagnostics, behind a "details" control and out of the person's way (`UX-06`, `OBS-01`). |
| APP-10 | **Progress and cancel** for running requests (`GEN-16`, `UX-02`). |
| APP-11 | **Accessible host.** The host app itself meets WCAG 2.2 AA: everything works by keyboard, controls are labelled, contrast is sufficient, focus is visible, and reduced motion is respected. It is tested with an automated accessibility checker in CI. |

---

## 6. Contracts (`CON`)

| ID | Requirement |
| --- | --- |
| CON-01 | **One schema source.** All cross-boundary shapes are defined once in `packages/contracts`, with zod (A14): artifacts, bridge messages, stored records, and every model output (intent, generation, repair, review). TypeScript types and the JSON Schema passed to the CLI (`--json-schema`) are generated from it. No hand-written duplicate schemas. |
| CON-02 | **No overloaded meanings.** Model outputs use explicit discriminated unions, for example `files: { mode: "unchanged" }` versus `{ mode: "replace", ... }`. A `null` never means two different things. (The POC read `files: null` as "nothing to change" and discarded a valid engine-only change.) |
| CON-03 | **Bridge API manifest.** Every host API available to generated code (actions, capabilities, arguments, return values, limits, examples) is listed in one machine-readable manifest. The prompt's API section, the static checks (`VER-01`) and runtime enforcement (`RUN-04`) are all generated from it. |
| CON-04 | **Versioned contracts.** Artifacts and stored records carry contract versions. Older saved tools are revalidated on open and either migrated or clearly marked incompatible. They never fail silently. |
| CON-05 | **Units in contracts.** Any numeric field that has a unit names it (`waitSeconds`, not `wait`). Prompts ask generated code and checks to name units the same way. (The POC lost a live run to seconds versus minutes.) |

---

## 7. Generation pipeline (`GEN`)

### 7.1 Flow

```text
request ─► intent (structured) ─► route
              │                     ├─ open saved ─► match in the library ─► offer Continue / Use again
              │                     ├─ data change ─► validated patch batch ─► apply
              │                     ├─ create / edit ─► generate ─► checks ─► (repair) ─► stage ─► activate
              │                     │                     └─ then: pending data part ─► patch batch
              │                     ├─ new tool ─► new workspace ─► create
              │                     └─ clarify / unsupported ─► plain answer
              └─ every step: ledger entry, diagnostics, time limit, cancellation
```

### 7.2 Requirements

| ID | Requirement |
| --- | --- |
| GEN-01 | **Structured intent stage.** A cheap model call returns `{ kind, interfacePart, dataPart, behaviorChange, lookOnly, targetsCurrentTool, savedToolId, language }`, where `kind` is create, edit, data, mixed, new_tool, open_saved, clarify or unsupported. The prompt includes examples of the POC's failure cases: style wording, behavior statements ("guests arrive in groups"), unrelated requests, mixed requests, and non-English requests. Host guardrails apply on top: with no tool open, a request either opens a saved tool (`GEN-18`) or creates one (A12); an unrelated request can never overwrite the current tool; and destructive data changes need an explicit target. |
| GEN-02 | **No keyword gating.** Prompt sections, capabilities and rules are never switched on or off by regular expressions over the request. Where a keyword heuristic is kept as a safety net, it has tests for false positives and false negatives in every supported language. (The POC's "engine section only for simulation words" missed "Will my party layout work?") |
| GEN-03 | **Modular prompt assembly.** Prompts are built from parts: base rules, the bridge manifest (`CON-03`), the UI standard (`VER-06`), the matching verification profile (`VER-03`), if any, current source, and diagnostics. Only relevant parts are included. Each stage records its prompt size, and CI fails if a fixture prompt grows past its budget. (The POC's single prompt reached about 18,000 characters, carrying heart, study and flow contracts into every request.) |
| GEN-04 | **Mixed requests are split.** The interface part goes to generation. The data part is applied by the host after the new version is installed, as a validated patch batch. Neither step sees the other's instruction. |
| GEN-05 | **Starting data.** Creation output separates `reusableDefaults` from `initialState` (session data supplied in this request, such as 120 guests or shopping entries). Both conform to the declared data schema (`DATA-03`). The host constructs and validates a new workspace once from defaults plus initial state. Request-supplied entries never become reusable defaults unless the person explicitly asks to reuse them. Labelled example data is kept distinguishable from real entries and is not silently copied by Use again. |
| GEN-06 | **Code never writes user data on startup.** The bridge rejects writes before the tool is active, with an explanatory error. Prompts state this rule. |
| GEN-07 | **Real changes only.** An edit whose result is identical to the current version is not activated. Changes outside the screens (data schema, later engines) count as real changes and are declared explicitly (`CON-02`). |
| GEN-08 | **Honest outcome messages.** The message shown to the person is composed by the host. It combines the model's plain summary with verified facts: what was applied, what was not, and whether behavior was verified. It never claims success for a step that failed. |
| GEN-09 | **Repair by failure class.** Failures are classified as schema shape, static check, smoke check, behavior check or provider error. Each class has its own repair budget and prompt part. Schema-shape errors are repairable too. Provider errors (auth, limits, timeouts) are never sent to repair. |
| GEN-10 | **Diagnostics are never thrown away.** The last failure reasons of every request are stored in the ledger and shown in the details view, while the person sees a plain message. |
| GEN-11 | **Time limits from measurements.** Every stage has a configurable time limit. Defaults start from the POC's measurements: creation took 105–131 s, so generation and repair get 180 s, intent gets 60 s, and a whole request gets 5 minutes. They are revisited with real p95 numbers (`OBS-03`). |
| GEN-12 | **Plain language.** Messages and generated names avoid internal terms. A lint list (state, schema, viewState, capability, harness, JSON and similar) is checked in tests, and internal repair names never become tool names. |
| GEN-13 | **Keep what wasn't asked to change.** Edits keep the tool's name, declarations, data, look and unrelated behavior unless the request changes them. This is checked by the host, not only stated in the prompt. |
| GEN-14 | **Scoped context for narrow edits.** Edits the host can verify as narrow (CSS-only) send only the relevant source, and the host enforces that the other files stay identical. This is ported from the POC, where it reduced prompt size by 63% on a recorded case. |
| GEN-15 | **Any language.** Requests and replies work in the person's language without prefixes. Generated tools follow the person's language. |
| GEN-16 | **Progress during long stages.** The person sees progress while a stage runs (for example "Building your planner… 40 s"), and can cancel. See `CLI-07`. |
| GEN-17 | **Two passes for big tools** (starting point, A17). When the intent stage judges a request as large, the first pass builds a small working core that is verified and activated. Further features arrive as edits, each verified. M2 measures this against single-pass generation (time to first useful tool, total time, tokens, pass rate) before it becomes final. |
| GEN-18 | **Find saved tools first** (A28). The intent stage receives a short catalogue of the person's saved tools (name and one-line description, the most recent first, within a size budget). If the request matches one ("open my budget", "I need my shopping list"), it returns `open_saved` with that tool's ID. The host checks the ID exists and offers **Continue** or **Use again**, never silently opening or overwriting anything. With no match, or if the person asks for a new one, Tessera creates a tool. This is the local form of the later "check the store first". |

---

## 8. Runtime and sandbox (`RUN`)

Port the POC design; it held up in every boundary test.

| ID | Requirement |
| --- | --- |
| RUN-01 | **Sandbox.** Generated code runs in an opaque-origin `sandbox="allow-scripts"` child frame inside a wrapper on the opposite loopback host (127.0.0.1 versus localhost). A strict CSP blocks network, storage, workers, nested frames and navigation. The bridge is a fresh MessageChannel bound to the expected frame and instance. |
| RUN-02 | **One active runtime.** Exactly one tool executes at a time. Minimized and suspended tools are disposed (frames, channels, timers), and a watchdog recovers from busy loops. |
| RUN-03 | **Staging before activation.** A candidate first mounts in a hidden verification panel against synthetic data. It is activated against real data only after its checks pass. On failure the previous version is restored. |
| RUN-04 | **Bridge enforcement.** Every bridge call is checked against the manifest (`CON-03`), the tool's declared capabilities, the current revision and the instance identity. Calls before activation are rejected (`GEN-06`). |
| RUN-05 | **Host stylesheets.** An accessibility layer (visible focus, reduced motion) always loads. The UI standard layer loads in standard mode (`VER-06`). |
| RUN-06 | **Supported browsers.** Chrome and Edge are tested in CI (`TEST-06`); Firefox is best effort. Embedded browser panes that cannot load nested sandboxed frames are documented as unsupported. (The Claude desktop app's built-in pane could not mount POC tools.) |
| RUN-07 | **Host clock.** The bridge provides the current date and time (`now()`, today's date, time zone). Generated code uses it instead of reading the system clock. Static checks flag direct `Date.now()` or `new Date()` without arguments (`VER-01`). Tests set the clock, so "the next day" is simulated, never waited for. (The POC had past-dated defaults, and date-dependent tools could not be tested.) |

---

## 9. Host capabilities (`CAP`)

Generated tools run in a sandbox with no network, files or storage (`RUN-01`). Anything more they need is a **host capability**: provided by the host, declared in the bridge manifest (`CON-03`), requested by the tool, and enforced at runtime. The clock (`RUN-07`) is the first one.

| ID | Requirement |
| --- | --- |
| CAP-01 | **Declared, minimal, visible.** Each capability is listed in the manifest with its arguments, limits and a plain description. A tool's declared capabilities are shown in the details view, and undeclared use is rejected (`RUN-04`, `VER-01`). |
| CAP-02 | **Data providers.** Outside data comes only through host-owned providers. The host sends the explicitly requested search terms/filters to a vetted source, caches results and returns records with provenance. The UI identifies the provider and what is sent; unrelated records, files and chat history are never forwarded. Search terms may themselves contain personal information, so do not promise that no user data ever leaves the machine. Generated code never fetches anything. Choose sources at the start of M4 ([D11](05-open-decisions.md#d11-outside-data-for-medium-apps), A42). |
| CAP-03 | **Files in and out.** A tool can ask the person to pick a file (an image to edit). The host shows the picker and passes the content to the tool. A tool can offer a file to save (an exported image, CSV or document), which the host saves after the person confirms. Tools never see the file system. |
| CAP-04 | **Vetted libraries** (decided, A25). The host injects a small set of pinned, reviewed libraries into the sandbox: a chart library first, three.js for 3D later. They are declared like other capabilities, so generated code doesn't reinvent them. Each library is added by an ADR, covered by the UI standard where it draws, and updated deliberately. Generated code may not load any other library. |
| CAP-05 | **AI inside tools: later.** Tools calling a model themselves (for example summarizing a saved article) is out of scope for the first release. It would be a capability with its own budget and consent. |

---

## 10. Data and persistence (`DATA`)

| ID | Requirement |
| --- | --- |
| DATA-01 | **Storage: SQLite on the local server** (decided, A9). Workspaces, versions, data, saved tools, the trash and the call ledger live in a SQLite file managed by the local server, in the data folder (`PLAT-04`). Data survives browser changes and can be backed up. The browser holds no source of truth. (The POC kept everything in one browser profile's IndexedDB, and demos were lost to anyone without that profile.) |
| DATA-02 | **Changes are validated patches.** Data changes from chat are patch operations on stable IDs (add, replace, remove). They are resolved one at a time against a working copy, applied atomically, and rejected if the data changed meanwhile (revision check). AI changes never replace a whole object. (The POC had both a whole-object data loss and a "rename the wrong record after a delete" bug.) |
| DATA-03 | **Per-tool data schema.** Each tool declares a versioned data shape and reusable defaults. Shape changes include a bounded, deterministic migration, validated against source and target schemas on a copy. Prefer declarative transformations; generated migration code follows `SEC-01` and never runs in the server process. Compatibility and activation follow `DATA-10`. |
| DATA-04 | **Immutable versions and undo.** Tool versions are immutable and hashed, including their schema/defaults and dependency pins. Interface undo/restore creates a new version and retains current data under `DATA-10`. Data undo reverses only the eligible change, with a revision check that rejects intervening edits rather than overwriting newer work. Historical data recovery is explicit, never an automatic consequence of restoring interface code. |
| DATA-05 | **Export and import.** A workspace or saved tool (versions and data) exports to a file and imports back, with validation. This is also how test fixtures are made (`TEST-04`). |
| DATA-06 | **Size limits stated.** Data size limits are explicit and reported plainly when hit. Proposed starting limit: 256 KiB of data per tool (the POC's 32 KiB was enough for its planners), revisited with real use. |
| DATA-07 | **Continue or use again** (A21, A44). **Continue** reopens the saved entry's explicitly linked workspace and current data. **Use again** creates a separate workspace from that entry's current tool version and reusable defaults only, excluding session entries, original-request data and examples. It does not retarget the saved entry's Continue link. The new workspace is autosaved and can be added as its own named library entry. Show the linked workspace when offering Continue so the target is unambiguous. |
| DATA-08 | **Always saved; the library is named** (A30). Every workspace, version and data change is written to storage as it happens; there is no "unsaved work". **Save to my tools** adds a named entry to the library, which is what Continue, Use again and finding saved tools work from. A saved tool follows its workspace's latest version (A32), so later improvements are kept. Older versions stay restorable (`APP-05`), and **Save as a new tool** makes a separate entry when the person wants a variant. |
| DATA-09 | **Trash** (A31). Deleting a workspace or saved tool moves it to the trash, where it can be restored for 30 days. After that it is removed for good. Emptying the trash early needs confirmation that names what will be removed. Nothing is deleted without passing through the trash. |
| DATA-10 | **Atomic activation, restore and recovery** (A45). Treat interface code, schema, reusable defaults, dependency pins and data revision as a compatible unit. Stage checks/migrations on a copy while keeping the committed unit recoverable; commit the new unit in one transaction only if the source revision still matches. A crash, failed check or stale revision retains the old unit. Restoring old code first tries to preserve current data exactly. If a valid conversion would omit information, show a concrete loss preview and warning, preserve the full current unit in a recovery snapshot, and require confirmation. If compatibility cannot be established, refuse activation and explain why; a generic warning is insufficient. Test schema-changing edits, lossy/cancelled restore, intervening writes and crashes during commit. |

---

## 11. Verification (`VER`)

| ID | Requirement |
| --- | --- |
| VER-01 | **Static checks with a real parser.** Generated JavaScript is parsed (acorn or the TypeScript compiler). Checks cover forbidden APIs, undeclared bridge actions and capabilities, calls to methods that don't exist in the manifest, data writes at startup, and direct reads of the system clock. The POC's token scanner could not follow aliases or scopes. |
| VER-02 | **Smoke check for every candidate.** In the verification panel the tool must: mount; render something; throw no errors for a few seconds; pass the accessibility floor (labelled inputs, named buttons); and show no horizontal scroll at 390 px. |
| VER-03 | **Verification profiles (internal, not tools).** The host keeps a registry of verification profiles: behavior patterns it knows how to test, for example "something with a list of items", "something that schedules with rules" or, later, "a simulation with a run control". **They are not tools and never appear to the person.** When a person's request matches a profile, its prompt part asks the generated tool to expose stable hooks (element IDs, a data shape), and its synthetic fixture and behavior check run before activation. Every profile is one definition (`P3`). Hidden test hooks in matching tools are accepted (A19). Which profiles to build first follows from the real-life test scenarios ([06-test-scenarios.md](06-test-scenarios.md#6-scenario-sets-per-milestone)). Tools that match no profile get only the smoke check (`VER-02`) and are labelled "behavior not verified". |
| VER-04 | **No hidden requirements.** Every observable requirement a behavior check enforces is generated into the prompt from the same definition (`P3`). (The POC's study check enforced an 18:00 rule and a visible helper that the prompt never mentioned, and live runs failed on both.) |
| VER-05 | **Checks only when relevant.** Bind policy checks to the current accepted policy and its version. Previous passing evidence preserves a policy only while the user has not changed it. An explicit change ("Fridays are allowed now") supersedes the old restriction and its checks; retain the old evidence with the old version. Matching element IDs alone never impose policy. Test introducing, changing and removing a restriction. |
| VER-06 | **UI standard.** The UI standard doc is the source. It is injected into prompts, backed by host stylesheets, checked statically, and has a custom mode for explicit requests. This is ported from the POC (a copy is kept in [reference/ui-standard.md](reference/ui-standard.md)). |
| VER-07 | **Useful diagnostics.** Every check failure says what was expected, what was observed, whose rule it is (the person's, a verification-profile rule, or a reference value), and gives hints for common mistakes (unit factors of 60, 1000 or 3600). |
| VER-08 | **Verified status is visible.** Each tool version shows whether its behavior was verified and by which checks, in plain words for the person and in detail in the details view. |

---

## 12. Provider adapter: Claude Code CLI (`CLI`)

You chose signed-in CLIs. These requirements turn every CLI problem from the POC into a design rule.

| ID | Requirement |
| --- | --- |
| CLI-01 | **Adapter interface.** `run(stageSpec) → { value, usage, raw }`, where `stageSpec` includes prompt, schema, model, effort, tool policy, time limit and cancellation signal. Claude Code is the first adapter. Codex can be added later behind the same interface and contract tests. |
| CLI-02 | **Executable resolution and probe.** Use an absolute path to the real executable (`claude.exe` on Windows; the npm `claude.cmd` shim cannot be spawned). At startup, probe and show: version, sign-in status, and a tiny structured-output call (opt-in, because it costs a call). |
| CLI-03 | **Locked flags per stage.** Normal stages have safe mode, tools disabled, no MCP servers/session persistence, `dontAsk` permissions and a small turn limit. Only research gets web tools. Only the evaluation reviewer may get file-reading tools, conditional on the enforced boundary in CLI-08; otherwise supply approved image inputs without file tools. Document every flag, enforce a tested CLI version and cover exact arguments with fake-process tests. |
| CLI-04 | **Normalized usage.** Input totals include uncached input, cache writes and cache reads; cached input is shown separately. Failed and cancelled calls are recorded, with unknown values marked unknown, never as zero. |
| CLI-05 | **Error mapping.** Sign-in, usage limit, unavailable model, unsupported effort, schema failure and turn limit each map to a plain message. Provider errors stop the request; they are not repaired. |
| CLI-06 | **Job control.** One AI job runs at a time; this is configurable. A cancellation while queued means the job never starts. A newer request supersedes an older one cleanly, so neither is lost. |
| CLI-07 | **Progress.** If the CLI's streaming output mode can report progress without breaking structured output, use it for `GEN-16`. Otherwise show elapsed time and stage names. Decided in [D7](05-open-decisions.md#d7-progress-streaming). |
| CLI-08 | **Clean environment and bounded model tools.** Use a temporary working directory; remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` unless API billing is explicitly allowed. Tool-free stages expose no file tools to the model. A temporary directory is not an OS filesystem sandbox, and the trusted CLI still needs its sign-in/configuration files. Reviewer access uses an enforced allowlist for sanitized files in one run folder, with traversal/symlink and outside-folder denial tests. If the chosen adapter cannot enforce that boundary, disable file tools and supply approved images through a supported input mechanism; do not claim isolation from a prompt instruction alone. |
| CLI-09 | **Default model routing** (starting point, A18): Haiku 5.5 low for intent and data actions; Sonnet 5.5 medium for creation and repairs; Sonnet 5.5 low for edits; Sonnet 5.5 medium for research (M5). Opus only by explicit configuration, never as an automatic fallback. Each stage's route is configurable and recorded in the ledger. |

---

## 13. Observability, cost and speed (`OBS`)

| ID | Requirement |
| --- | --- |
| OBS-01 | **Call ledger.** Every model call records: stage, model, effort, prompt characters, input, output and cached tokens, time, outcome and diagnostics. It is persisted, viewable per workspace and per request, and exportable. |
| OBS-02 | **Evaluation harness with a budget guard.** A built-in live-evaluation mode enforces a hard call cap, logs every call and request, and has a dry-run mode with canned replies, so scripts are rehearsed at no cost. This carries over the POC's budget-guarded live server. |
| OBS-03 | **Metrics.** Per stage: p50/p95 time, tokens, repair rate and check pass rate, computed from the ledger and reported after each live evaluation. |
| OBS-04 | **Speed targets** (starting points, revisited with M2 measurements). Host screens respond within 100 ms. A saved tool opens and mounts within 5 s. Intent within 10 s at p95. A chat data change within 15 s at p95. A first useful tool (the core pass, `GEN-17`) within 90 s at p95. Misses are reported in the metrics, not hidden. |

---

## 14. Security (`SEC`)

| ID | Requirement |
| --- | --- |
| SEC-01 | **AI code never runs in the server process.** Generated UI code runs in the browser sandbox. Generated migrations and later engine checks require a separate execution boundary with filesystem, network, process and worker access denied, an empty environment, and memory/time limits. A Node permission flag or `vm` context alone is not proof of that boundary. Select and negatively test the isolation mechanism before enabling the execution path (M1 for executable migrations, M5 for engines); use declarative migrations if executable isolation is unavailable. The POC's acknowledged engine network gap must not be carried forward as a guarantee. |
| SEC-02 | **Untrusted text is data.** Web pages, generated source, tool data and earlier model output are passed to prompts as quoted data, with an explicit "never instructions" rule. |
| SEC-03 | **Local only, rebinding-safe.** The server binds to 127.0.0.1. Every route checks the `Host` header against the expected local names, which blocks DNS-rebinding attacks from web pages. API routes require same-origin requests, and runtime documents are served only to the expected origins. |
| SEC-04 | **Least tools.** Only the stage that needs a tool gets it (`CLI-03`). |
| SEC-05 | **Threat model and boundary evidence.** Record trust boundaries for generated UI, data/migrations, the trusted CLI, reviewer tools, research and imports. Before each path ships, tests attempt forbidden file/network/process access and malformed or stale bridge requests. M1 covers runtime/import/migration paths, M3 reviewer access, and M5 engines/research. M6 is a broader audit, not the first security validation. Claims describe the tested boundary and remaining limits, not general proof of safety. |

---

## 15. User experience (`UX`)

| ID | Requirement |
| --- | --- |
| UX-01 | **Useful immediately.** A new tool shows something meaningful at once: the person's stated data (`GEN-05`), sensible defaults, or clearly labelled examples. It is never an empty form that needs several inputs before anything appears. It never invents the person's real data. (Every POC party planner opened empty and needed room size, stations and placement before Run did anything.) |
| UX-02 | **Progress and cancel** during generation (`GEN-16`, `APP-10`). |
| UX-03 | **Honest labels.** Estimates are labelled as estimates. Unverified behavior is labelled. Partial success is reported as partial. |
| UX-04 | **UI standard and accessibility floor** in every generated tool (`VER-06`, `RUN-05`); the host app meets WCAG 2.2 AA (`APP-11`). |
| UX-05 | **English first, translatable** (decided, A10). All host text goes through a translation layer from day one, so adding languages needs no code changes. Only English ships at first. No host text is hard-coded in components. |
| UX-06 | **Details view.** Source, versions, checks, ledger and diagnostics are behind a "details" control, not in the person's way (`APP-09`). |
| UX-07 | **Lifecycle.** Minimize, restore, reload and reopen keep data and the tool's place. The POC lost minimized mode on reload. |

---

## 16. Simulation engines (`SIM`, later milestone)

The POC's [simulation-engines-plan.md](reference/simulation-engines-plan.md) is the reference design. Requirements to carry over when M5 starts:

| ID | Requirement |
| --- | --- |
| SIM-01 | Engines are versioned modules, separate from tools. Each has a spec, source, an interface (methods), dependencies pinned as `id@version`, and checks. Tools pin engine versions, and undo restores the matching versions. |
| SIM-02 | Engine checks run in an isolated process (`SEC-01`). Every check runs twice and full results are compared, to prove repeatability. Randomness comes only from a seeded generator; `Math.random` and `Date` are unavailable. |
| SIM-03 | Rules: check the library first; build changes on the existing engine; replace only on an explicit request; look-only edits never touch engines; new versions keep all methods and earlier checks. |
| SIM-04 | **Research before implementation code** (A46). For a new engine, replacement or extension that changes mathematical behavior/settings: first produce a structured change plan without implementation code, then obtain and validate the cited research spec/reference checks, then generate code against that spec. The host compares declared settings and methods with the base contract; do not trust a `newMaths` flag alone. If code reveals unresearched mathematical changes, reject it and return to research before regenerating. Pure reuse or a change covered by the existing researched spec needs no new research. Malformed required reference checks are repaired or cause an explicit failure; never silently remove acceptance coverage. Only research has web tools. Cache by research inputs/spec version and budget its high cost (34–85 s and up to 90k input tokens per POC call). |
| SIM-05 | The simulation verification profile (`VER-03`) has hooks (a run control, a text summary of results, the plan in a standard shape) and a synthetic fixture. |
| SIM-06 | Modularity: decide in [D9](05-open-decisions.md#d9-engine-modularity) whether splitting reusable engines is a rule the host enforces or guidance. In five live POC runs Claude always built one combined engine. |

---

## 17. Testing (`TEST`)

Summary; details are in [04-engineering-practices.md](04-engineering-practices.md#5-testing).

| ID | Requirement |
| --- | --- |
| TEST-01 | Unit tests for contracts, pipeline logic, data patches, checks and adapters, run on every change in CI. |
| TEST-02 | CLI contract tests with fake processes: arguments, environment, stdin, output parsing, error mapping, usage, cancellation. |
| TEST-03 | Scripted-provider end-to-end tests in Playwright, with screenshots and video: the real pipeline with canned model replies chosen by test configuration, never by words in the request (`ENG-11`). |
| TEST-04 | Replay fixtures: sanitized exports (`DATA-05`) of real live-run outputs, committed and replayed offline, so a live failure becomes a permanent regression test. |
| TEST-05 | Budgeted live evaluations at each milestone, through `OBS-02`. Each evaluation is a set of real-life scenarios in which a simulated person creates tools from nothing and then edits, saves, updates and reopens them. Scenarios, the test application catalogue and judging are defined in [06-test-scenarios.md](06-test-scenarios.md). |
| TEST-06 | Browser coverage: Chrome and Edge in CI, at fixed viewports including 390 px, on Windows (`PLAT-01`). |

---

## 18. Evaluation (`EVAL`)

Details, the scenario format and the test application catalogue are in [06-test-scenarios.md](06-test-scenarios.md).

| ID | Requirement |
| --- | --- |
| EVAL-01 | **Scenario files.** Real-life scenarios are data files (`evals/scenarios/*.yaml`): a person, a goal, a language, a budget, and steps (`say`, `do`, `next-day`, `reload`, `save`, `continue`, `use-again`, `undo`, `cancel`, `switch`, `delete`, `restore`) with expected host facts. Every scenario starts from an empty Tessera. |
| EVAL-02 | **Automatic host facts.** The runner checks every step without a model: created or changed as expected, data exact, nothing unrelated changed, checks passed, no false success, within budget. |
| EVAL-03 | **AI technical review.** A separate reviewer scores fulfilment, defaults or explicitly requested styles, exercised controls, accessibility, messages, code and coherence, with evidence. Use the same rubric regardless of generator model. Screenshots arrive through enforced read-only run-folder access or approved image inputs with file tools disabled (CLI-08, A27). Unexercised behavior remains unverified; screenshots/source alone do not prove controls work. Store the structured review with the run. |
| EVAL-04 | **Human final verdict.** Each live evaluation produces a report with video, screenshots per step, host facts, the AI review and costs. The product owner marks each scenario accept, accept with notes, or reject. Agreement between the AI review and the human verdict is tracked. |
| EVAL-05 | **Model matrix.** Selected scenarios run with different generation models (for example Sonnet and Opus, later Codex), so tool quality and style consistency can be compared across models. |
| EVAL-06 | **Languages.** A few scenarios are in Portuguese (A23). They check that generated tools follow the person's language while the host stays English. |
| EVAL-07 | **Live runs become replays.** The outputs of each approved live run are stored as a replay scenario and run in CI (`TEST-04`). |

---

## 19. Acceptance for the first release

The first release (roadmap M4) is accepted when:

1. **Live evaluation.** The M4 scenario set ([06-test-scenarios.md](06-test-scenarios.md#6-scenario-sets-per-milestone)) passes in a budgeted live evaluation, with your final verdict (`EVAL-04`), and:
   - at least 85% of predeclared AI-dependent steps passing without user retry/rephrasing; automatic repairs are allowed, counted and reported (A40). Report deterministic lifecycle steps separately and require them all to pass. Failed/blocked required AI steps remain in the denominator; report counts, repeats and per-scenario results, not only a pooled percentage;
   - no unapproved data loss; explicitly confirmed incompatible restores retain a recoverable snapshot (`DATA-10`);
   - no false success message.

   All results are recorded in the ledger.
2. **Applicable mitigations verified.** Every lesson with a planned design mitigation due by M4 has implementation evidence and a regression test. The coverage report maps each lesson to a milestone and records proposed, implemented and verified status separately. Research/engine-specific L-37/L-42 and the engine case of L-31 are due in M5; Codex research compatibility L-44 is due when that provider feature is integrated, no earlier than M6. Other portions of a shared requirement remain due in their own milestone. A deferred item is visibly out of scope, never counted as a resolved release defect.
3. **Every tool is checked.** Every generated tool gets the smoke check, and tools matching a verification profile get behavior checks with visible status.
4. **The lifecycle works.** Create, edit, save, find by asking, Continue, Use again, restore a version, undo, delete to trash and restore all pass in scripted end-to-end tests and in the live scenarios.
5. **Portability.** Export and import round-trip a workspace, and a fresh clone runs all offline tests without local-only files.
6. **Cost and speed are known.** p50/p95 time and tokens per request type are reported against the speed targets (`OBS-04`), and the creation p95 fits within the stage limits.
7. **Setup works.** On a clean Windows machine (Windows Sandbox, A43), the launcher and setup check guide a tester from a fresh install to a first created tool (scenario P1).
