# Lessons learned from the Harness POC

Status: draft 0.3 · 2026-10-11 · Covers the whole POC, from the first Codex runs on 2026-10-08 to the last live planner run on 2026-10-11. Mitigation classifications below describe Tessera's plan, not completed implementation.

This document records POC observations, failures and proposed Tessera mitigations. Requirement IDs point to [02-spec.md](02-spec.md) and [04-engineering-practices.md](04-engineering-practices.md). The ambition is to prevent or automatically catch at least 90% of these failure cases; implementation and measurements must establish progress toward it. The [coverage count](#coverage) measures mapped plans only.

---

## 1. What the POC was

**Harness** was a local web app (Node.js, no dependencies) where a person typed what they needed and an AI wrote a small working tool, in HTML, CSS and JavaScript, inside the chat. The person could then change it by talking or by using its controls. Over three days it grew:

- **Foundation:**
  - generated tools in a sandbox, with a bridge for actions on host-held data
  - versions, undo and saved tools
  - a study behavior check
  - two providers (Codex CLI, Claude Code CLI)
- **Final days:**
  - an enforced UI standard
  - a simulation engine system (versioned engines, isolated checks, dependencies)
  - engine rules in generation
  - a research step with web search
  - starting data
  - a flow-planner behavior check
- **Evidence:** 157 offline tests, three recorded browser test suites with video, and about 120 live model calls across many evaluation runs.

This document is self-contained. It summarizes the POC's evaluation reports: two runs of the same student workflow (on Codex and on Claude), a fault-injection and live-matrix simulation, a drawing-tool run, independent review findings, and the engine, research and planner runs from this session. The POC repository is not needed to use it.

---

## 2. What worked: keep these

| Area | What to keep | Evidence |
| --- | --- | --- |
| Core idea | Generated code, not templates, can make useful tools from everyday requests: a study planner with enforced scheduling, notes to flashcards, a drawing tool, a task board, a converter, an event planner | Live runs on Codex and Claude |
| Ownership | **The host owns data, permissions, versions and lifecycle; generated code only presents.** Every safety fix was possible because of this split | All evaluations |
| Sandbox | Opaque-origin child frame, opposite-loopback wrapper, strict CSP and MessageChannel bridge. Passed 13/13 boundary checks every time it was tested; network probes never reached the server | POC boundary evaluations, repeated after each runtime change |
| Data safety | Atomic, revision-checked patch batches with stable IDs; stale changes rejected; AI changes never replace whole objects | 250-operation stress test |
| Versions | Immutable, hashed tool versions; staging and rollback; undo that refuses to overwrite newer work | Many live runs |
| Behavior checks | Host-driven checks with synthetic data before activation (study suite, flow suite), with failures sent to repair. They turned "the model says it works" into "the host saw it work" | Study and flow gates live |
| Diagnostics to repair | Precise failure messages fed back to the model fixed problems that vague ones could not | The note-restore check failed 4 times with a vague message and passed first time once the message was precise |
| UI standard | One doc used in prompts, host stylesheets, static checks and a custom mode. Generated tools looked consistent; focus stayed visible | Recorded UI suite 16/16 |
| Engines | Versioned engine modules with pinned dependencies, isolated checks, seeded randomness, and identical results in Node and the browser | Engine browser check 5/5; live extension accepted |
| Research | A cited spec and reference checks before engine acceptance. The POC drafted code first; Tessera requires research before implementation code (SIM-04). The runs recorded models and limitations | Live research probe; planner runs |
| Testing approach | A scripted-provider server running the real pipeline with canned replies; recorded browser runs with video; a budget-guarded live server with a dry-run mode | Used for every test suite and live run in the last two days of the POC |
| Live testing discipline | Approved budgets, hard call caps, rehearsals before spending, per-call logs, and stopping after repeated failure | Phase 4 used 32 calls and found 8 real bugs |
| Model routing | Cheap model for intent and data actions (Haiku/Luna low); stronger model for generation; no silent expensive fallback | Usage ledgers |

---

## 3. Issue catalogue

Status key:
- **D**, planned design mitigation: a structural control or automatic check is specified. Its implementation and regression evidence must still be established; the classification is not proof that the issue is impossible.
- **R**, planned risk reduction: a mitigation is specified, but residual behavior remains model-dependent or otherwise uncertain.
- **A**, accepted: an inherent limit, documented and monitored.

Issues L-64 to L-69 were added when the catalogue was reviewed against the finished spec. They sit in their category, so their numbers are not in order. IDs are never renumbered (`ENG-17`).

### 3.1 Engineering process

| ID | What happened | Root cause | Mitigation | Status |
| --- | --- | --- | --- | --- |
| L-01 | No version control for the whole POC. Any bad edit was permanent, and nothing could be compared or reverted. | Started as an experiment and never set up | ENG-01, ENG-02 | D |
| L-02 | The project lived in a OneDrive-synced folder. Sync can lock or replace files mid-write. | Default desktop location | ENG-03, PLAT-04 | D |
| L-03 | Core files were written as very long single lines (one function of more than 2,000 characters). They were hard to read and review, editing tools failed on them, and scripted edits broke on escaping, causing at least 8 failed or wrong edits this session. | No formatter, compact style | ENG-04, ENG-12, ENG-21 | D |
| L-04 | Data-shape mismatches between parts of the code, for example the action planner read data under `generatedViewState` while generated code read `viewState`, breaking in-place edits. | No types; contracts implicit and duplicated | CON-01, ENG-04 | D |
| L-05 | Model output schemas were hand-written in several places and drifted from validation code. | No single schema source | CON-01 | D |
| L-06 | Documentation drift. Dated reports kept outdated current-tense claims; the README said the UI standard was "not yet injected" after it was; there were 16 overlapping docs. | No documentation structure or ownership | ENG-08, ENG-17 | D |
| L-07 | Evidence and fixtures were local-only (`.artifacts/`, gitignored). Recorded checks needed files a fresh copy didn't have, so others could not reproduce results. | No portable fixtures or export | DATA-05, TEST-04, ENG-10, ENG-19 | D |
| L-08 | Offline tests passed while live runs failed on routing, feature fulfillment, gate policies and hidden requirements. The tests checked the host, not the model-facing behavior. | Test pyramid missing replay and live layers | TEST-03, TEST-04, TEST-05, EVAL-07, ENG-13 | R |
| L-09 | Test markers inside the request text changed product behavior: `[engine-sneaky]` contained "engine", so the look-only rule treated it as a behavior request. | Test data in the natural-language channel | ENG-11 | D |
| L-10 | Flaky browser tests: a viewport resize snapped back; the app's built-in browser pane could not mount sandboxed frames; clicks on native `<select>` popups didn't register in automation. | Environment and test-tooling assumptions | RUN-06, TEST-06, ENG-14, ENG-20 | D |
| L-11 | Fixes were often made during live runs, after a failure, instead of acceptance criteria being written first. | Exploratory process | ENG-06, ENG-07, ENG-09, ENG-13 | D |
| L-12 | Failure reasons were thrown away: a failed generation reported only "did not pass validation", so one live failure could never be explained. | Diagnostics not part of the result | GEN-10, OBS-01 | D |
| L-13 | Test-run output piled up, and safety checks blocked bulk deletion. | No retention policy | ENG-10 | D |
| L-14 | Several AI assistants (Codex, Claude) worked from long handoff documents of mixed age, re-deriving context and repeating mistakes. | No concise single source of rules for assistants | ENG-05, ENG-08, ENG-15 | D |
| L-15 | Recorded browser tests could not drive interfaces that were designed differently each time: generic clicking filled the wrong field and couldn't add stations. | No stable hooks to test against | VER-03, P5, ENG-14 | D |
| L-65 | The two assistant rule files (`CLAUDE.md` for Claude, `AGENTS.md` for Codex) were copies kept in sync by hand, so they could drift apart. | Two sources for one set of rules | ENG-05 (one file, the other only imports it, checked in CI) | D |
| L-66 | Prompt edits changed live outcomes, but nothing recorded which prompt version produced which result, so changes in behavior could not be traced. | Prompts treated as inline text, not code | ENG-16 | D |
| L-69 | The browser boundary and acceptance checks needed someone to open a diagnostic page and click to run them, so they were not part of automatic testing. | Browser tests not automated | TEST-03, ENG-02 | D |

### 3.2 AI pipeline

| ID | What happened | Root cause | Mitigation | Status |
| --- | --- | --- | --- | --- |
| L-16 | Style requests ("make it calmer") were classified as unsupported. | Intent classification without examples of style wording | GEN-01 | R |
| L-17 | Behavior statements ("guests arrive in groups of 2 to 4") got a clarifying question instead of a change. | Intent prompt treated statements as data | GEN-01 | R |
| L-18 | An unrelated request overwrote the current tool, and only English command prefixes were recognized. | Routing assumed every request edits the current tool | GEN-01, GEN-15 | D |
| L-19 | Mixed requests lost a part: the data was dropped, or the edit acted on the data instruction and deleted a tool feature. | One instruction sent to two steps | GEN-04 | D |
| L-20 | Keyword heuristics failed repeatedly: English-only style words; the engine section added only for "simulation words"; "easier to read" not counted as look-only; "waiting numbers" read as behavior. | Regular expressions used as the main decision | GEN-02, P4 | D |
| L-21 | Generated code tried to write data while starting up, before the bridge was active, and the message still claimed the data was added. | No rule or enforcement against startup writes | GEN-06, VER-01, GEN-08 | D |
| L-22 | Data stated in a creation request ("for 120 guests") was dropped, because tools had to start empty. | No channel for starting data | GEN-05 | D |
| L-23 | AI data changes replaced whole objects and lost unrelated records; a batched "delete then rename" renamed the wrong record. | Whole-object writes; IDs resolved against the original data | DATA-02 | D |
| L-24 | Missing action declarations, and calls to API methods that don't exist (`setBpm`), passed until runtime. | API documented only in prose | CON-03, VER-01 | D |
| L-25 | An edit that changed nothing was accepted as a success. | No change detection | GEN-07 | D |
| L-26 | Success was reported when a step had failed ("topics added" when saving failed). | Model text shown as the outcome | GEN-08, P2 | D |
| L-27 | Behavior checks enforced requirements the prompt never stated (an 18:00 evening rule, a visible helper). Live runs failed on them repeatedly. | Check and prompt defined separately | VER-04, P3 | D |
| L-28 | A check imposed a policy nobody asked for: element IDs alone triggered the no-Friday rule. | Check selection by markup only | VER-05 | D |
| L-29 | Vague check failures ("expected behavior was not observed") gave repairs nothing to work with. | Checks reported pass or fail only | VER-07 | D |
| L-30 | A unit mix-up (an engine reported 180 seconds where its check expected 3 minutes) was not fixed by the one repair. | No unit naming; no hint | CON-05, VER-07 | R |
| L-31 | Ambiguous output meanings: `files: null` meant "nothing changed", which discarded a valid engine-only change; "apply with no files" was shown as an error. | Overloaded null values | CON-02, GEN-07 | D |
| L-32 | First-attempt response-shape errors skipped the repair loop. | Repair only for later validation steps | GEN-09 | D |
| L-33 | Provider failures (timeouts, usage limits) were reported as "clarify" and sometimes sent to repair. | No failure classes | GEN-09, CLI-05 | D |
| L-34 | The prompt grew to about 18,000 characters, carrying every domain contract (heart solver, study IDs, flow hooks, engines) into every request. Creation took 105–131 s with 15–19k output tokens. | One monolithic prompt | GEN-03, GEN-17, VER-03, ENG-16 | R |
| L-35 | A 120 s stage limit was too short for a real creation (131 s observed). | Limits set before measurement | GEN-11, OBS-03, OBS-04 | D |
| L-36 | Internal words reached people ("viewState", "harness"), and a repair title ("Capability declaration fix") became a tool's name. | No message lint; repair output trusted for names | GEN-12, GEN-13 | D |
| L-37 | Model-judged flags were unreliable: a behavior change was marked "not new maths" and skipped research. | Trusting a self-reported flag | SIM-04 (host signal), P1 | D |
| L-38 | The model ignored "split reusable parts into separate engines" in all five planner runs. | Guidance without enforcement | SIM-06, D9 | A |
| L-39 | Domain contracts (heart solver API, study element IDs) were hard-coded into the global prompt and generator. That didn't scale past two examples. | No verification-profile registry | VER-03, GEN-03 | D |
| L-40 | Each generated design is different, so one generic test could never cover them, and most tools ended up "behavior unverified". | No verification profiles or hooks | VER-02, VER-03 | R |
| L-68 | Date-dependent behavior could only be tested with fixed fixture dates (the study check used fixed calendar days), while generated tools read the real clock. Default dates and "the next day" could not be tested. | No host-provided clock | RUN-07, VER-01 | D |

### 3.3 Research (relevant from the engines milestone)

| ID | What happened | Root cause | Mitigation | Status |
| --- | --- | --- | --- | --- |
| L-41 | Research was expensive and variable: 34–85 s and up to 90k input tokens per call. | Open-ended web reading | SIM-04 (budget, cache per engine) | R |
| L-42 | Research returned a malformed reference check, which rejected the whole result, and the generation model could not repair research checks. | Validation only at merge time | SIM-04 (validate and repair research checks before code; fail explicitly if required coverage cannot be recovered) | D |
| L-43 | Web pages can carry instructions (prompt injection). | Untrusted text in prompts | SEC-02, CLI-03 | R |
| L-44 | Claude's later engine/research session could not verify Codex web search. Earlier POC workflows did use Codex. | Feature-specific verification unavailable in that session | CLI-01 (product-provider research compatibility checked separately from Codex's development role) | D |

### 3.4 CLI provider

| ID | What happened | Root cause | Mitigation | Status |
| --- | --- | --- | --- | --- |
| L-45 | npm's `claude.cmd` shim cannot be spawned on Windows; the real `claude.exe` had to be configured. | Executable resolution | CLI-02, PLAT-03 | D |
| L-46 | Exact CLI flags mattered: `--tools ""`, safe mode, `--allowedTools` semantics, turn limits, `--json-schema`. Mistakes would give generation tools or break structured output. | Implicit CLI contract | CLI-03, TEST-02 | D |
| L-47 | Claude's input tokens left out cache writes, making totals unusable for the first calls of a run. | Provider-specific usage fields | CLI-04 | D |
| L-48 | Long silent waits (up to 2 minutes) with no progress. | No streaming or progress | GEN-16, CLI-07, APP-10 | R |
| L-49 | Usage was incomplete: action calls and failed calls were not recorded at first, and cancelled calls are unknown. | Ledger added late | OBS-01, CLI-04 | D |
| L-50 | Job control bugs: a newer request replacing a running one lost both; a request cancelled while queued still ran. | Ad hoc queue | CLI-06 | D |
| L-51 | The CLI version changed during the POC (2.1.211 to 2.1.296), and nothing checked compatibility. | No version gate | CLI-02, CLI-03, PLAT-03 | D |
| L-52 | API keys in the environment would silently switch billing from the plan to the API. | Inherited environment | CLI-08 | D |

### 3.5 Runtime, security and data

| ID | What happened | Root cause | Mitigation | Status |
| --- | --- | --- | --- | --- |
| L-53 | The first engine check design ran AI code in Node's `vm` module, which is not a security boundary. It was caught and moved to a permission-restricted process, but network access is still not blocked in Node 22. | Convenience over isolation | SEC-01 | R |
| L-54 | The static source scan was a token scanner, not a parser: it could not follow aliases or scopes. | No parser dependency (zero-dependency rule) | VER-01 | D |
| L-55 | Saved tools and data lived in one browser profile's IndexedDB. Demos were lost to anyone without that profile, and there was no export or backup. | Browser-only storage | DATA-01, DATA-05, DATA-08, PLAT-04 | D |
| L-56 | A single 32 KiB untyped data object per tool, with no schema or migration. | Prototype simplicity | DATA-03, DATA-06, ENG-18 | D |
| L-57 | Minimized mode was not restored after a reload, and once a restored version reported "stopped responding" for an unknown reason. | Lifecycle edge cases untested | UX-07, APP-03, TEST-03 | R |

### 3.6 Product and UX

| ID | What happened | Root cause | Mitigation | Status |
| --- | --- | --- | --- | --- |
| L-58 | Generated tools opened empty and needed several inputs before showing anything. In every party planner, pressing Run showed "no results" until room size, stations and positions were set. | "Start empty" rule plus no defaults guidance | UX-01, GEN-05, EVAL-03 (useful at first sight) | R |
| L-59 | Visual inconsistency between generated tools (before the UI standard). | No enforced design contract | VER-06, RUN-05 | D |
| L-60 | Accessibility gaps: unlabeled inputs, nameless buttons, removable focus outlines. | Not checked | VER-02, RUN-05, APP-11 | D |
| L-61 | Host status text was English-only, while requests came in Portuguese and Spanish too. | No language plan | UX-05 (translation layer from day one) | D |
| L-62 | Honesty: estimates and unverified behavior needed explicit labels to avoid overclaiming. | Model optimism | UX-03, VER-08 | D |
| L-63 | Scheduling defaults were in the past (a default date earlier than today). | No "sensible defaults" rule | UX-01, RUN-07 (host clock) | R |
| L-64 | "Save" meant saving the code only. Reusing a saved interface could reset its data, and what save, reopen and reuse meant was never defined. | Product concepts never defined | Glossary (spec §1.5), DATA-07, DATA-08 | D |
| L-67 | Saved tools could only be reopened from a menu dialog; asking for one in chat would build a new tool instead. | No "open saved" intent | GEN-18, APP-04 | D |

---

## 4. Patterns behind the issues

Most issues come from seven patterns. Fixing the pattern fixes the family.

1. **Trusting text instead of checking structure.** Model messages were taken as outcomes; regex did intent detection; self-reported flags were believed. Issues L-16, L-17, L-20, L-25, L-26, L-31, L-33, L-36, L-37, L-62. **Rule:** the model proposes structured data; the host verifies (P1, P2, P4).
2. **Two definitions of one thing.** The prompt said one thing and the check another; schemas were duplicated; contracts lived only in prose. Issues L-04, L-05, L-06, L-24, L-27, L-28, L-39, L-65. **Rule:** one definition, many uses (P3, CON-01, CON-03, VER-04, ENG-05).
3. **Untestable outputs.** Designs differed every run, so tests couldn't hold onto anything, and offline tests didn't predict live results. Issues L-08, L-10, L-15, L-40, L-68, L-69. **Rule:** verification profiles that ask matching tools for stable hooks (P5, VER-03), a host clock, and a test pyramid that includes automated browser tests, replays and live evaluations.
4. **No engineering baseline.** No version control, a synced folder, no formatter, local-only evidence, no retention policy, scattered handoffs. Issues L-01, L-02, L-03, L-07, L-11, L-13, L-14. **Rule:** the [engineering practices](04-engineering-practices.md), from the first commit.
5. **Implicit external contracts.** CLI flags, executable paths, token fields, versions, billing and time limits were all discovered by failure. Issues L-35, L-44, L-45, L-46, L-47, L-51, L-52. **Rule:** adapter contract tests and probes, and limits set from measurements (CLI-02, CLI-03, GEN-11, TEST-02).
6. **Invisible failures.** Diagnostics were dropped, usage was missing, check failures were vague, progress was silent. Issues L-12, L-29, L-48, L-49, L-66. **Rule:** nothing invisible (P6, OBS-01, GEN-10, VER-07, ENG-16).
7. **Undefined product concepts.** Nobody had defined what save, reopen and reuse meant, or how a person gets back to a tool they made. Issues L-64, L-67. **Rule:** a glossary in the spec (§1.5), and lifecycle requirements for each concept (DATA-07, DATA-08, DATA-09, GEN-18, APP-04).

---

## 5. Things the POC did not answer

These need evidence in Tessera, not assumptions:

- **Success rate at scale.** Every live result was a single run or two repeats. Measure first-attempt pass rates over the agreed real-life scenarios (TEST-05).
- **Cost per useful tool.** Calls and tokens are known per run, but not what "a working tool" costs on average.
- **Does verification generalize?** Two behavior suites existed (study, flow). Whether a small set of verification profiles covers most real requests is unknown.
- **Codex research integration.** Earlier student and generation workflows used Codex live. Claude could not verify its web-search/research integration in the later session; that feature remains unverified. Codex continues as a development, review, execution and testing assistant. A Tessera product adapter still needs its own contract tests and approved live probe.
- **Real users.** Every request was written by the team. Nobody outside it has used the product.
- **Plan allowance in daily use.** Tessera uses the signed-in Claude plan (A3). How far that allowance stretches with daily use is unknown; the internal alpha (A35) measures it.
- **Do people understand the lifecycle?** Observe the internal alpha and a few invited outside testers during M2/M3, then broader trials in M6. Test Continue, defaults-only Use again, incompatible restoration warnings, finding saved tools and trash without coaching.

---

## Coverage

| Status | Count | Share |
| --- | ---: | ---: |
| D: planned design mitigation | 55 | 80% |
| R: planned risk reduction | 13 | 19% |
| A: accepted, documented | 1 | 1% |
| **Total** | **69** | |

**68 of 69 issues (about 99%) have a mapped mitigation requirement; 55 (about 80%) target a structural control.** This measures planning coverage, not implemented protection, success rate or proven prevention. The earlier 90% ambition is a target to evaluate, not a result established by this table.

Track implementation separately for every lesson: **proposed → implemented → verified**, with its milestone, code/PR reference, regression evidence and remaining limits. Keep the historical D/R/A classification stable. The milestone report must not count deferred M5/M6 work as resolved for M4. Live evaluations measure residual failures; an offline test named after a requirement does not by itself prove semantic correctness across arbitrary requests.
