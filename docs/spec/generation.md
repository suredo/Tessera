# Generation pipeline (`GEN`)

## Flow

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

## Requirements

| ID | Requirement |
| --- | --- |
| GEN-01 | **Structured intent stage.** A cheap model call returns `{ kind, interfacePart, dataPart, behaviorChange, lookOnly, targetsCurrentTool, savedToolId, language, features }`, where `features` lists the separate things the request asks for (used by `GEN-17`), and where `kind` is create, edit, data, mixed, new_tool, open_saved, clarify or unsupported. The prompt includes examples of the POC's failure cases: style wording, behavior statements ("guests arrive in groups"), unrelated requests, mixed requests, and non-English requests. Host guardrails apply on top: with no tool open, a request either opens a saved tool (`GEN-18`) or creates one (A12); an unrelated request can never overwrite the current tool; and destructive data changes need an explicit target. |
| GEN-02 | **No keyword gating.** Prompt sections, capabilities and rules are never switched on or off by regular expressions over the request. Where a keyword heuristic is kept as a safety net, it has tests for false positives and false negatives in every supported language. (The POC's "engine section only for simulation words" missed "Will my party layout work?") |
| GEN-03 | **Modular prompt assembly.** Prompts are built from parts: base rules, the bridge manifest (`CON-03`), the UI standard (`VER-06`), the matching verification profile (`VER-03`), if any, current source, and diagnostics. Only relevant parts are included. Each stage records its prompt size, and CI fails if a fixture prompt grows past its budget. (The POC's single prompt reached about 18,000 characters, carrying heart, study and flow contracts into every request.) |
| GEN-04 | **Mixed requests are split.** The interface part goes to generation. The data part is applied by the host after the new version is installed, as a validated patch batch. Neither step sees the other's instruction. |
| GEN-05 | **Starting data.** Creation output separates `reusableDefaults` from `initialState` (session data supplied in this request, such as 120 guests or shopping entries). Both conform to the declared data schema (`DATA-03`). The host constructs and validates a new workspace once from defaults plus initial state. Request-supplied entries never become reusable defaults unless the person explicitly asks to reuse them. Labelled example data is kept distinguishable from real entries and is not silently copied by Use again. |
| GEN-06 | **Code never writes user data on startup.** The bridge rejects writes before the tool is active, with an explanatory error. Prompts state this rule. |
| GEN-07 | **Real changes only.** An edit whose result is identical to the current version is not activated. Changes outside the screens (data schema, later engines) count as real changes and are declared explicitly (`CON-02`). |
| GEN-08 | **Honest outcome messages.** The message shown to the person is composed by the host. It combines the model's plain summary with verified facts: what was applied, what was not, and whether behavior was verified. It never claims success for a step that failed. |
| GEN-09 | **Repair by failure class.** Failures are classified as schema shape, static check, smoke check, behavior check or provider error. Each class has its own repair budget and prompt part. Schema-shape errors are repairable too. Provider errors (auth, limits, timeouts) are never sent to repair. |
| GEN-10 | **Diagnostics are never thrown away.** The last failure reasons of every request are stored in the ledger and shown in the details view, while the person sees a plain message. |
| GEN-11 | **Time limits from measurements.** Every stage has a configurable time limit. Defaults start from the POC's measurements: creation took 105–131 s, so generation and repair get 180 s each and intent gets 60 s. A request's overall limit covers its planned stages plus one repair (7 minutes by default), so a slow creation can still be repaired. With two passes (`GEN-17`), the core pass and each follow-up feature are separate requests with their own limits. All limits are revisited with real p95 numbers (`OBS-03`). |
| GEN-12 | **Plain language.** Messages and generated names avoid internal terms. A lint list (state, schema, viewState, capability, harness, JSON and similar) is checked in tests, and internal repair names never become tool names. |
| GEN-13 | **Keep what wasn't asked to change.** Edits keep the tool's name, declarations, data, look and unrelated behavior unless the request changes them. This is checked by the host, not only stated in the prompt. |
| GEN-14 | **Scoped context for narrow edits.** Edits the host can verify as narrow (CSS-only) send only the relevant source, and the host enforces that the other files stay identical. This is ported from the POC, where it reduced prompt size by 63% on a recorded case. |
| GEN-15 | **Any language.** Requests and replies work in the person's language without prefixes. Generated tools follow the person's language. |
| GEN-16 | **Progress during long stages.** The person sees progress while a stage runs (for example "Building your planner… 40 s"), and can cancel. See `CLI-07`. |
| GEN-17 | **Two passes for big tools** (starting point, A17). When a request is large, the first pass builds a small working core that is verified and activated. The host decides this from the intent stage's `features` list with a tested threshold, not from a model's own "large" flag (L-37). Further features arrive as edits, each verified. M2 measures this against single-pass generation (time to first useful tool, total time, tokens, pass rate) before it becomes final. |
| GEN-18 | **Find saved tools first** (A28). The intent stage receives a short catalogue of the person's saved tools (name and one-line description, the most recent first, within a size budget). If the request matches one ("open my budget", "I need my shopping list"), it returns `open_saved` with that tool's ID. The host checks the ID exists and offers **Continue** or **Use again**, never silently opening or overwriting anything. With no match, or if the person asks for a new one, Tessera creates a tool. This is the local form of the later "check the store first". |
