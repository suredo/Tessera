# Plan: simulation engines and the event-flow planner

> **Reference copy from the Harness POC.** File, script and command names from the POC were replaced with plain component names, so this document stands alone; the POC repository is not needed. Where it says "the POC", it describes how the POC did it, as input for Tessera's own design.

**Authority and ordering (2026-10-11):** the [Tessera spec](../02-spec.md) and [accepted decisions](../05-open-decisions.md) govern implementation. The "as built" sections and dated runs below are historical evidence, including limitations. The experience, engine design and scenario sections are design inputs, not proof of implementation. Tessera requires **structured plan → research and validated reference checks → implementation code → verification** (SIM-04, A46). The POC's draft-code-before-research order, malformed-check dropping and keyword gates must not be ported. Research reuse requires an applicable versioned spec. Network-denying isolation must be demonstrated before engine checks execute (SEC-01).

Status at the end of the POC: phases 1–3 implemented · phase 4 partly done (five live runs, 2026-10-11) · phase 5 not started.

## Phase 1 as built

| Part | Where | Notes |
| --- | --- | --- |
| Engine format and lint | the engine contract | Shape, limits, declarative checks, version links, interface pins. The lint rejects network, storage, DOM, host bridge, timers, wall clock and `Math.random`. |
| Versions, integrity, dependencies | the engine library module | SHA-256 content hash; the source must compile as a complete function body; resolves pinned engines and dependencies in install order; rejects missing, mismatched, unreferenced, circular and deeper-than-3 sets; produces the planner catalog (latest version per engine, no source). |
| Engine host | the shared engine host | One self-contained installer used in the browser and in the check process. Engines are installed as `id@version`, so two engines can depend on different versions of the same engine. `use(id)` returns only declared dependencies, and only their declared methods. Seeded random numbers. |
| Check runner | the isolated check runner | Runs every declared check twice, comparing full results to prove repeatability. |
| Runtime injection | the runtime server | Installs exactly the pinned set before `app.js`. The interface sees a frozen `harness.engines` containing only its pinned engines; the install hook is removed before interface code runs. |
| Pinning and undo | the artifact builder, the artifact contract | Optional `engines: [{id, version, versionId}]` on each immutable interface version, so undo restores the matching engine versions. |
| Shared library | browser storage | IndexedDB version 2 adds an `engines` store: immutable versions, lookup by `id@version`, loading a pinned set with all dependencies. The app loads pins when mounting. |
| Tests | the engine tests, the engine browser check | 11 offline tests, plus a headless Chrome check proving an engine built on another engine runs in the real sandbox and matches the Node result for the same seed. |

**Change from the original plan.** Checks do not run in Node's `vm` module inside the server, because `vm` is not a security boundary and engine code may have been influenced by web pages read during research. They run in a child Node process started with `--permission`, which blocks the file system, child processes, workers and native addons. That process has an empty environment, a 128 MB memory cap and a hard timeout. Inside it, the code still runs in a fresh `vm` context with string code generation disabled, `Math.random` throwing and `Date` removed. Node 22's permission model does not restrict network sockets; reaching one would first require escaping `vm`.

## Phase 2 as built

| Part | Where | Notes |
| --- | --- | --- |
| Engine decisions in generation | the engine rules module, the generator | The response schema gains `engines`: one entry per engine the tool needs, each with `decision` (reuse, extend, create, replace), id, base version, `usedByInterface`, reason, and for new versions the full source plus `specJSON` and `checksJSON` (JSON strings, so strict structured output works). `engines: null` keeps the current pins. |
| Prompt | `enginePromptSection()` | Included in **every** generation, edit and repair prompt: the catalog (latest version of each engine), the current pins, sources of pinned engines first (60,000-character budget), the decision order, the source format and the check format. An earlier version added it only for simulation-sounding requests, but "Will my party layout work for 120 guests?" contains none of those words. The section adds about 3,000 characters per prompt. |
| Host rules | `applyEngineOps()` | Rejects reuse of missing versions, `create` with an id that already exists, `create` without a reason when the library is not empty, `extend`/`replace` of unknown engines, an extension that drops a method or renames an existing check, `replace` without an explicit request ("start the simulation over with a different approach", "replace the engine", "from scratch"), and any engine change on a look-only edit (including CSS-only edits). An extension inherits all earlier checks; a replacement does not. |
| Checks before acceptance | `applyEngineOps()` → `runEngineChecks()` | Every new engine version runs its checks in the isolated check process, with the library and the other new versions available as dependencies. Failures, cycles and missing dependencies become repair diagnostics, and the previous attempt's engine entries are shown to the repair stage. |
| Interface/engine agreement | `applyEngineOps()` | `app.js` may call only `harness.engines['<id>']` for pinned ids, and must use every engine it pins. |
| Engine-only changes | the generator | An extension with unchanged screens is a real change, not "no interface code changed". |
| Client | the app, browser storage | Sends the library (pinned set first, then the latest version of each engine, at most 24) with every generation request. New engine versions are stored only when their interface is accepted, so rejected candidates never enter the library. Behavior verification mounts candidates with their new engines. **Code & usage** lists each engine decision and reason. |
| Records | the artifact contract | `generation.engineDecisions` (decision, id, version, reason). New specs carry `researched: false` until phase 3. |
| Tests | the engine-rules scenario tests, the recorded engine test | Scenarios M1–M8 through the real pipeline with scripted replies (10 tests), and a recorded browser run through the real UI (11 checks, video and screenshots). Fixtures live in shared engine fixtures. |

**Known limits.**
- **Look-only detection is a keyword check:** visual words with no behavior words. "Make the waiting numbers bigger" contains "wait", so it counts as a behavior request and engine changes are allowed. Words inside test markers count too, which is why the scripted scenarios use `[e2e-…]` markers instead of `[engine-…]`.
- **"Check first" for `create` is partly the model's judgment:** the host only blocks duplicate ids and missing reasons. Whether an existing engine really fits is the model's decision, shown in **Code & usage**.
- **The spec was written by the generation model** before phase 3. Research now replaces it for new engines; see below.

## Phase 3 as built

| Part | Where | Notes |
| --- | --- | --- |
| Research stage | the research module, the generator | Runs for engines that are created or replaced, or extended with `newMaths: true`, **or extended so that the engine reads a setting its base version did not** (for example `options.groupSize`; added 2026-10-11, see run 5). The research prompt names the new settings. Reuse, look-only edits and small extensions never research. At most 3 engines per request; each engine is researched once per request and the result is kept across repairs. |
| Historical order of work, superseded for Tessera | the generator | The POC used draft code → cheap rules → research → full rules/checks. Tessera instead validates a structured plan without implementation code, researches, then generates code (SIM-04). |
| Web tools | the Claude CLI adapter | Only the research stage runs Claude Code with `--tools WebSearch,WebFetch --allowedTools WebSearch WebFetch` (and `--max-turns 16`). Every other stage keeps `--tools ""`. Safe mode, no MCP servers and `dontAsk` permissions stay on. |
| Codex research, session-specific limitation | the provider routes | Claude could not verify Codex web search in the later engine session. The POC adapter used a labelled model-knowledge fallback. This fallback is not evidence of researched engine correctness and is not an approved substitute for Tessera's research gate. |
| Output | `RESEARCH_SCHEMA`, `researchResult()` | Summary, chosen model and why, equations, parameters (value, unit, range, source), assumptions, plain-language limitations, sources (web research must cite at least 2 http(s) sources it read), and 1–10 reference checks written against the draft's methods. Text is stripped of control characters and length-limited; web content is treated as data. An `insufficient` outcome stops the request with a plain explanation. |
| Reference checks | the engine rules module | A researched spec replaces the model's own spec. Reference checks (named "Reference: …") are appended to the engine's checks; model-written "Reference:" checks are discarded, so a repair cannot weaken them. Malformed reference checks are dropped at research time and listed in `spec.droppedChecks`; research fails only if none remain. If the draft disagrees with a reference check, the normal repair loop fixes the engine. |
| Deadline and usage | the generator | Research has a 240-second limit of its own and does not count toward the five-minute generation deadline. Each research call is a `research` stage in the usage ledger. Telemetry allows 8 stages. |
| Telling the person | the generator, the app | The reply ends with "Before building the simulation, I looked up how this works (N sources)." **Code & usage** shows "researched: web · N sources" for each researched engine. |
| Tests | the research tests, the recorded engine test | 9 offline tests. The recorded browser run now uses the scripted Claude provider and checks that research runs only for the three new engines. |

### Live research probe (2026-10-10, one call)

`node the live research probe` ran one real research call: Claude `claude-sonnet-5-5`, medium effort, web tools only, researching the crowd engine for "Will my party layout work for 120 guests? Where will lines form at the bar?".

| Measure | Result |
| --- | --- |
| Time and usage | 49.6 s; 32,718 input tokens (22,648 cached), 3,689 output tokens |
| Model chosen | Random (Poisson) arrivals into a single-server queue, with a crowd-density check. A full crowd-movement model was judged unnecessary for a party layout, with the reason given in plain words |
| Sources | 2, both read: an M/M/1 formula reference and an arXiv paper on the fundamental diagram of pedestrian movement |
| Parameters | Including free walking speed 1.34 m/s, 0.5–1.0 m² per person in a queue, and a crowd density limit |
| Limitations (shown to the person) | 6, for example rushes after toasts or dinner, one bartender only, and guests holding drinks walking differently from study crowds |
| Reference checks | 4 returned. One was malformed (`{"op":"between","value":0,"max":4}`), which at the time rejected the whole result. **Fixed:** malformed checks are now dropped at research time, and the prompt states the exact value formats. Replaying the saved response through the fixed code keeps 3 checks, and the draft crowd engine passes all of them (about 120 arrivals in 10 minutes; about 30 served when the bar is overloaded). |

The raw response, validated spec and check results were kept as local evidence in the POC. The prompt-format fix was confirmed by replaying the saved response, not by a second live call.

## Decisions so far

| Question | Decision |
| --- | --- |
| First simulation | An event and space flow planner: "Will my event or shop layout work?" |
| Who owns the maths | A general **engine system**. The AI first checks whether a suitable engine exists. If none does, it researches the established model and writes its own engine. Later changes build on that engine; a full replacement needs an explicit user request. |
| Research | Web search is allowed **only** in a dedicated research step. Every other step stays tool-free. |
| Reuse | Engines live in a shared library. Any workspace can reuse one. Changes create new versions, and existing tools keep the version they were built on until they are updated. |
| Generality | The design aims to support different simulation domains; that breadth is not established by the party-planner runs. The POC library started empty. Tessera's base-engine policy remains an M5 decision (D9); domain accuracy requires independent reference evidence. |
| Main purpose | Prove that Harness can **create new things** and keep them **modular**: engines that are separate from interfaces, reused across tools, extended in place, and built from smaller engines. |
| First version scope | 2D top-down view, heat map, story moments, side-by-side comparison. No 3D. |

## Who it is for

A person with general knowledge and a goal, not a technical user: someone hosting a party, running a small shop, organizing a school fair or a wedding. They describe what they are planning in everyday words. The interface never uses terms like "agent", "throughput", "density", "parameters" or "model". Results are phrased the way a friend would say them: "The drinks line reaches the front door around 8:15."

## The experience

1. **Start from the goal.** The first screen asks "What are you planning?" with choices such as a party, shop, fair, wedding or "something else". The choice picks sensible starting values: arrival pattern, how long people stay, typical service times. There is no settings page.
2. **Sketch the space.** A top-down floor plan. Drag in walls, doors, tables, a bar or counter, a stage, restrooms and exits. Pieces snap to a grid. Sizes are in metres, with everyday comparisons on hover ("about the length of a car"). A blank plan offers a few starter rooms.
3. **Plain controls.** "How many guests", "Do they arrive together or spread out", "How long does it take to get a drink", "How long is the event". Each control explains itself in one line.
4. **Watch it play out.** People appear as dots that walk in, queue, mingle and leave. Play, pause, a speed choice (1×, 4×, 16×) and a timeline to drag through the event. A heat-map toggle shows where it gets crowded over time.
5. **Story moments.** The timeline is marked with the moments that matter, written as sentences: "8:15 · Drinks line reaches the entrance", "9:00 · Restroom wait peaks at about 6 minutes", "The dance floor never gets uncomfortably full". Clicking a moment jumps the view there.
6. **Compare two layouts.** "Try another layout" copies the plan into version B. Both versions run with the same guests side by side, followed by a plain verdict: "Layout B halves the longest wait, mainly because the bar moved away from the door."
7. **Honest about limits.** Every result is labelled as an estimate from a simplified model. A "How this works" panel says in plain words what the simulation accounts for and what it doesn't (for example: people's moods, groups splitting up, emergencies). It links to the engine's sources.
8. **Chat works on the same plan.** "Move the bar to the window wall", "What if 50 more people come?" and "Add a second exit" change the plan or start a comparison.

The interface follows the [default UI standard](ui-standard.md). Heat-map and crowd colors fall under its exception for meaningful visualization. They use a colorblind-safe sequential scale with a legend, and crowding is also shown in words, never by color alone.

## The engine system

### What an engine is

An engine is a versioned, reusable simulation component stored separately from any interface. Each version holds:

| Part | Purpose |
| --- | --- |
| Spec | A plain summary, the equations, typical values with units and ranges, assumptions, limitations, reference cases and sources. Produced by the research step. |
| Code | One self-contained JavaScript file that registers the engine, for example `defineEngine({ id: 'crowd-flow', version: 1, create(options) { … } })`. It has no network, storage or DOM access, and the same prohibited-API rules as generated code apply. |
| Interface | The documented methods and readouts, such as `advance(seconds)`, `snapshot()` and `events()`. Interfaces call only these. |
| Checks | Reference cases from the spec plus invariant checks, run by the host before the version is accepted. |
| History | Parent version, change request, creation stages and usage, like interface versions today. |

The POC library started empty; its separate `harness.heart.create` solver was not in the catalog. Tessera's base-engine policy remains D9. The historical heart API is not a required Tessera API unless explicitly adopted in its bridge manifest.

### Modularity: engines built from engines

An engine can declare dependencies on other library engines, pinned by version, for example `requires: ['queue-service@1']`. It receives them through `use('queue-service')` inside its own code, never through globals. This lets small engines be shared. A queue engine (people waiting to be served at a counter) can serve both the event planner's crowd engine and a later shop-checkout tool.

- **Planning:** the plan's engine decision may list several engines, each with its own reuse, extend or create decision. Splitting is encouraged when part of the maths is useful on its own, such as queues, arrivals over time, or movement.
- **Pinning:** dependencies are pinned like interfaces are. A new version of `queue-service` never changes `crowd-flow` until `crowd-flow` itself is updated, and that update re-runs its checks.
- **Isolation:** each engine sees only its declared dependencies' interfaces. Circular dependencies and dependencies deeper than three levels are rejected.
- **Runtime:** the host injects the pinned engine and its dependencies in dependency order.

### Target rules for Tessera

These replace conflicting rules in the original proposal. Use SIM-01 to SIM-06 in the spec as the requirement source; historical POC implementation is described above.

1. **Check first.** A structured plan names reuse/extend/create/replace decisions, base versions, required settings/methods and reasons, without implementation code. The host verifies IDs, versions, dependencies and declared changes. Semantic suitability remains a model judgment unless a specific host rule establishes it; matching a description alone is not proof of equivalence. Modularity policy is decided in D9.
2. **Research before code.** For new/replaced engines or changed mathematical behavior/settings, validate a cited spec and required reference checks before generating implementation code. Repair malformed required checks or stop; do not silently discard coverage. Code that introduces unresearched mathematical changes returns to research before regeneration. Reuse of an applicable researched spec avoids another call.
3. **Checked implementation.** Run engine checks outside the server in the tested filesystem/network/process-restricted boundary required by SEC-01, with resource limits. A `vm` context alone is insufficient. Each applicable reference case must pass within its tolerance, along with declared invariants. For a movement model those may include:
   - same seed gives the same result
   - nothing passes through walls
   - speeds stay within the spec's range
   - everyone who enters eventually leaves or is still accounted for

   Failures go back to a repair stage, exactly as UI violations do now.
4. **Changes build on the existing engine.**
   - A request about the interface must leave the engine untouched. The host checks this byte for byte, like the CSS-only route.
   - An engine change produces a new version from the current code. It must keep every existing interface method and still pass all previous checks plus any new ones.
   - Replacing an engine requires explicit user intent represented in the structured plan and checked against the current contract. Do not port the POC's keyword detector as the primary decision.
5. **Version pinning.** Each interface artifact records the engine id and version it uses. A new engine version never changes an existing interface until that interface is edited or the person asks to update it. Undo restores the previous pairing.

### The research step

- **Tools:** Claude Code's research stage alone gets web tools. Verify exact flags through adapter contract tests and an approved probe. A later Codex product research adapter needs equivalent verification. If a required research capability is unavailable, fail explicitly or reuse an applicable researched spec; do not substitute unverified model knowledge.
- **Output schema:**
  - `summary` (plain words)
  - `model` (name and why it was chosen)
  - `equations`
  - `parameters` (name, meaning, typical value, unit, range, source)
  - `assumptions`
  - `limitations` (plain words, shown to the person)
  - `referenceCases` (input, expected result, tolerance, source)
  - `sources` (title, URL)
- **Safety:** web pages are untrusted data. Quoting them is prompt guidance, not an isolation guarantee. Validate the spec and reference checks; limit research tools and keep generated code isolated. The person sees "Researching this model…" with sources; changed assumptions may require fresh research.
- **Cost:** research runs only when an engine is created, replaced or extended with new maths. Reuse and interface edits never research. It gets its own deadline and appears in the usage ledger as a separate stage.

### Where engines run and live

- **Storage:** the POC used an IndexedDB `engines` store. Tessera uses server-owned SQLite under DATA-01, with immutable versions and pinned dependencies included in export/import; browser storage is not authoritative.
- **Runtime:** the runtime registry injects the pinned engine source into the sandboxed child before `app.js`. It is exposed as a frozen `harness.engines['crowd-flow']` exposing only `create`. Engine code runs under the same CSP: no network, no storage.
- **Randomness:** the host provides a seeded random generator, so runs are repeatable and comparisons are fair. Both layouts use the same arriving guests.

## The first engine: crowd flow

The research step decides the actual model. These are the expectations its checks will be judged against:

- **Movement:** an established pedestrian model, likely a social-force or steering approach (Helbing and Molnár, 1995, is the usual starting point). Typical free walking speed is around 1.3 m/s with natural variation.
- **Doors and corridors:** flow through a doorway is capped at the researched rate per metre of width, often cited around 1.3 people per metre per second.
- **Queues:** service points (bar, counter, restrooms) serve people at a set rate with variation. People choose the shortest sensible line.
- **Behavior over time:** people arrive, visit points of interest, linger and leave, driven by the event type chosen.
- **Scale:** at least 500 people at interactive speed on a typical laptop, using spatial hashing for neighbors. Phones may run at a lower update rate, never with different results.
- **Readouts:** positions, crowding grid for the heat map, queue lengths and waits per service point, and timed events used for story moments.

## Data

The plan (walls, objects, settings) is saved in workspace data. The POC used a 32 KiB limit; Tessera's initial limit is specified by DATA-06. Derived results may be recomputed from pinned engines, seed and saved inputs; repeatability is verified on those inputs rather than assumed generally. Reusable layout defaults are separate from a session's actual guests/results (DATA-07).

## Creation and modularity scenarios

These are the main evidence the plan is meant to produce. Each runs scripted first (no model calls), then once live.

| # | Scenario | What it proves |
| --- | --- | --- |
| M1 | Create the event planner from an empty library | The AI finds nothing to reuse, researches, and creates `crowd-flow` (and `queue-service`, if it splits them) with passing checks |
| M2 | Restyle the planner ("make the heat map easier to read") | Interface-only edits leave the engines byte-for-byte unchanged |
| M3 | Change behavior ("people walk slower when it's crowded") | `crowd-flow` gets a new version built from the old code; old checks still pass; undo returns to the old version |
| M4 | New tool: "How long will the checkout lines be in my shop?" | A different tool reuses `queue-service` instead of creating a duplicate, at the pinned version |
| M5 | New tool on an unrelated subject (for example, "How fast will my bathtub fill and drain?") | The planner correctly creates a new engine instead of forcing an unrelated one |
| M6 | Update `queue-service` from the shop tool | The event planner keeps its pinned version until it is updated, and nothing breaks |
| M7 | "Start the crowd simulation over with a different approach" | Replacement happens only on an explicit request and still runs the research and checks |
| M8 | A candidate that fails its checks, edits a pinned engine without permission, or adds a circular dependency | The host rejects it and repairs or keeps the working version |

## How it will be verified

- **Offline tests:**
  - engine catalog and plan decisions
  - research schema validation
  - engine check runner (passing and failing engines)
  - the byte-for-byte engine preservation rule
  - version pinning and undo
  - injection of the engine into the runtime
- **Scripted scenarios:** new markers in the scripted-provider server cover M1–M8 above, including research results, an engine that fails its checks once, an interface edit that tries to modify an engine, reuse by a second workspace, and dependency pinning.
- **Recorded browser test:** a recorded browser test, like the POC's UI-standard test, that sketches a layout, runs it, checks story moments, compares two layouts and checks the narrow layout, with video and screenshots.
- **Live check:** a small, explicitly budgeted run of M1–M7 on Claude, recording calls, usage and whether each rule held.

## Phases

| Phase | Delivers | Model calls |
| --- | --- | --- |
| 1. Engine foundation | Engine format, empty catalog, dependencies between engines, IndexedDB store, runtime injection, Node check runner, version pinning | None |
| 2. Pipeline rules | Plan decision field, preservation and replacement rules, engine repair loop, prompts | None (scripted) |
| 3. Research step | Research stage with web tools only, schema, safety prompt, usage records | Small live probe |
| 4. Crowd engine and planner | First engine created through the pipeline, the planner interface, chat actions | Budgeted live run |
| 5. Verification | Scripted scenarios, recorded browser test, live check write-up | Budgeted |

## Risks and open questions

- **Research quality:** sources found online vary in quality. Mitigation: the spec must cite its sources, the reference cases come with tolerances, and limitations are always shown. A human review of the first crowd spec is worth doing.
- **Engine trust:** engines are still AI-written code. The sandbox limits what they can reach, but not whether the maths is right. The checks catch clear errors, not subtle modelling mistakes.
- **Codex web search:** the exact CLI option needs to be confirmed.
- **Over-splitting or under-splitting:** the AI might split engines too finely or not at all. M4 and M5 show whether its choices pay off; the split rule may need tuning after the live run.
- **Matching "existing" engines:** deciding when a catalog engine already covers a request is a judgment. The first version relies on the planner's declared decision plus a simple host check, and shows the decision to the person.
- **Library growth:** there is no rule yet for retiring old engine versions. Sharing engines across devices or people is out of scope.

## Phase 4 live runs (2026-10-11)

Budget approved: 20 Claude model calls. Used: **17** (10 + 7). Run through the real UI in headless Chrome against the budget-guarded live server, by the live planner run. Both were rehearsed first in dry-run mode, with canned replies, at no cost. Videos, screenshots, per-call logs and observations were kept as local evidence in the POC.

| | Run 1 (all 6 steps) | Run 2 (re-check of steps 1, 4a, 4b, 5 after fixes) |
| --- | --- | --- |
| Calls | 10: 4 generate, 1 research, 5 action | 7: 3 generate, 1 research, 3 action |
| Tokens | 150,793 input (28,426 cached), 58,559 output | 96,622 input (23,053 cached), 30,123 output |
| Model time | 373 s | 210 s |
| Creation | 107 s, 15,541 output tokens; one engine `party-queues@1`, researched (web, 2 sources) | 107 s, 16,561 output tokens; same engine design, researched (web, 2 sources) |

**What worked.**
- **Creation:** a "Party layout check" planner (guests and room fields, stations, room sketch, Run) from an everyday-language request, labelled an educational estimate.
- **Edits:** "Show me the key moments" added a moments list and reused the engine. "Let me try a second layout and compare them" added Layout A/B with comparison. "Make the heat map easier to read" restyled the sketch with engines untouched.
- **Rules:** every engine rule held. No call was refused or failed.

**Defects found and fixed.**
1. **Starting data was dropped.** "for 120 guests" produced an empty planner, because new tools had to start empty and nothing applied data stated in the creation request. Chat changes were then correctly refused ("there is no guest count"). Fixed: the generation response may carry `initialViewStateJSON` for new interfaces only; the host validates it and the client applies it once (the starting-data tests). Run 2 confirmed it: the planner opened with 120 guests, and "What if 50 more people come?" set 170.
2. **Behavior statements were misrouted.** "Guests often arrive in groups of 2 to 4" went to the action planner and got a clarifying question. Fixed: statements about how the simulated world behaves are routed to an edit. Run 2 confirmed the routing.
3. **"Easier to read" was not recognised as look-only.** Before the run, the look-only rule did not recognise readability wording ("easier to read", "readable", "clearer"). Fixed before run 1.

**Still open.**
- **The behavior change failed validation.** In run 2 the groups-of-arrivals change failed validation on the edit and on its repair. The reasons were not recorded, because failed generations returned only a generic message. Fixed for next time: the result now carries the last `diagnostics` and the live log records them. The cause of this failure is unknown.
- **The simulation was never exercised end to end.** Run 2's planner adds stations through a dropdown, an "Add station" button and a click on the sketch, which the generic script could not drive. Its label matching also filled "Guests arrive over (min)" with 120. Interfaces generated fresh each time need a behavior check designed for this kind of tool, not generic clicking.
- **Close to the time limit.** Creation took 107 s against the 120 s generation stage limit.
- **No engine splitting.** Claude built one combined engine both times, so live reuse by a second tool (scenario M4) was not exercised.

## Flow planner behavior check (2026-10-11)

Added after the live runs showed that generic clicking cannot drive planners designed fresh each time.

- **Hooks:** the generation prompt asks event and space flow planners for:
  - a `#runSimulation` button
  - a visible `#flowResults` text summary listing each station by name with its numbers (also a text alternative to the sketch, as the UI standard asks)
  - the plan stored in `viewState.layout` as `{room:{width,length}, guests, stations:[{id,type,name,x,y}]}`

  Starting data for such planners uses the same shape.
- **The check:** the flow check applies when an interface has those hooks, or when an earlier version passed it. Before activation, Harness loads a synthetic layout (12 × 18 m room, 120 guests, entrance, bar, food, restrooms) in the hidden verification panel and presses Run. It requires `#flowResults` to settle into a summary with numbers that names at least two stations and is not an empty-state prompt. Running must leave `viewState.layout` unchanged, and a reload must restore the saved layout with Run still enabled. A failure goes to the existing behavior-repair loop. Evidence appears in **Code & usage** under "Behavior".
- **Scope:** it proves the simulation runs on a real plan and reports per-station results. It does not judge accuracy; engine checks and research cover that.
- **Tests:** the flow-check tests (3 offline tests), and scenario 7 of the recorded engine test. In that scenario a scripted planner ignores the saved layout, the flow check catches it, a behavior repair fixes it, and the live planner then runs on the starting layout.

### Live runs 3 and 4 (2026-10-11, with the flow check)

Budget approved: 12 Claude calls, plus a raise of the generation stage limit from 120 to 180 seconds. Used: **10** (3 + 7).

| | Run 3 | Run 4 (retry after fixes) |
| --- | --- | --- |
| Calls | 3: 2 generate, 1 research | 7: 3 generate, 1 research, 3 action |
| Tokens | 121,908 input (84,324 cached), 30,181 output | 120,501 input (53,275 cached), 40,688 output |
| Creation | 131 s (would have timed out at 120 s); research 85 s | 105 s, plus a 55 s repair; research 66 s, 3 web sources |
| Outcome | Kept out: the engine's own check failed | **Planner passed the flow check before activation** |

**Run 3:** the engine reported a maximum wait of 180 (seconds) while its own check expected 3 (minutes). The one repair did not fix it, so the interface was correctly kept out. Fixes:
- **Unit hint:** check failures now add a units hint when a result is off by a typical unit factor (60, 100, 1,000, 3,600).
- **Whose check:** failure messages say whose check failed. A research reference check means fix the engine. The model's own check means fix the engine, or the check if its expected value was wrong.

**Run 4:**
- **Flow check passed:** Claude's planner (`venue-flow@1`) went through the flow check with the synthetic venue and activated. Its summary read: "This layout may struggle: average waits over 3 minutes, some waits over 10 minutes…".
- **Chat changes:** "What if 50 more people come?" changed 120 to 170. Stations added through chat landed in the plan, but no room size had been given, so Run showed "No results yet". The scenario wording was incomplete; the script now states the room size.
- **Step 5 bug:** the step was routed to an edit correctly, and Claude returned an engine-only change with `files: null`. The generator treated `files: null` as "nothing to change" and discarded it. **Fixed:** `files: null` with an engine change now means "keep every interface file" (regression test in the engine-rules scenario tests).
- **Script fix:** the "120 guests" check in the script read page text, which does not include input values. Fixed.

**Phase 4 totals:** 27 Claude calls across four runs. Not yet seen live: an engine extension accepted end to end (step 5), and reuse of an engine by a second tool (Claude has built one combined engine every time).

### Live run 5 (2026-10-11, step 5 retry)

Budget approved: 8 Claude calls. Used: **5**: 3 generate, 1 research, 1 action. Tokens: 73,919 input (26,056 cached), 26,386 output; 187 s of model time.

- **Step 1:** created `party-flow@1` (research: web, 3 sources). The planner passed the flow check before activation and opened with the 120 stated guests.
- **Step 5:** "Guests often arrive in groups of 2 to 4" went to an edit. Claude extended the engine to `party-flow@2` (accepted after one repair) and the screens were kept. The edited planner went through the flow check again with the new engine version and passed. **The engine-extension path now works live end to end.**
- **Research depended on the model's flag.** No research ran for the groups change, because Claude marked it `newMaths: false`, so batch arrivals were not checked against sources. **Fixed:** the host also researches any extension whose engine reads a setting its base version did not, whatever the flag says. `engineOptionNames()` in the research module finds these settings by scanning the source (`options.x`, `options['x']`, destructuring, destructured `create({ … })` parameters). It is a static scan, so setting names built at run time are missed. Not yet confirmed live.

**Phase 4 totals:** 32 Claude calls across five runs. Still not seen live: reuse of an engine by a second tool; Claude has built one combined engine every time.
