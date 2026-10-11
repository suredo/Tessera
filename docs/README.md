# POC results: from Harness to Tessera

Status: **draft 0.3 · 2026-10-11 · reconciled after review and user decisions.** These are target requirements, not an implemented Tessera release. Remaining open decisions are listed in [05-open-decisions.md](05-open-decisions.md#questions-for-you); none blocks starting M0.

The Harness POC demonstrated that an AI can build and keep changing useful tools from everyday requests inside a sandbox, and recorded passing checks for specific boundaries and workflows. It did not establish general security or a reliable success rate across arbitrary requests. This folder turns those three days of evidence into the starting documents for **Tessera**: an environment where people get the interface they need by creating it or opening one they saved. Each tool is one piece of their environment, like a tile in a mosaic.

## Read in this order

| # | Document | What it gives you |
| --- | --- | --- |
| 1 | [01-lessons-learned.md](01-lessons-learned.md) | What worked and must be kept. Then 69 issues with root cause and proposed mitigation. 68 have a mapped mitigation; 55 target a structural control. These are planning counts, not demonstrated prevention rates. |
| 2 | [02-spec.md](02-spec.md) | The product and its rules: principles, architecture, and numbered requirements (contracts, generation, runtime, data, verification, CLI adapter, observability, security, UX, later simulations, testing), plus release acceptance criteria. |
| 3 | [03-roadmap.md](03-roadmap.md) | Milestones M0–M6 in build order, with deliverables, exit criteria, what to port from the POC, and live-call budgets (about 150 calls to the first release, mostly acceptance scenarios; internal alpha for you after M2). |
| 4 | [04-engineering-practices.md](04-engineering-practices.md) | How we work: GitHub and CI, TypeScript standards, AI-assistant rules and templates, the five-layer test pyramid, the live evaluation protocol, documentation structure. |
| 5 | [05-open-decisions.md](05-open-decisions.md) | Accepted decisions, including reuse, restoration, development roles and research order; remaining choices are progress streaming, engine modularity, simulation presentation and outside data sources. |
| 6 | [06-test-scenarios.md](06-test-scenarios.md) | Real-life test scenarios: what a scenario is, the eight journeys every set must cover (first run to hands-on), three platform scenarios, a catalogue of 17 test apps (simple, medium, advanced; modularity later), how replay stays honest, the scenario file format, judging (host facts, AI review, your verdict) and which scenarios run at each milestone. |
| — | [reference/](reference/) | Copies of the two POC designs Tessera ports: the [UI standard](reference/ui-standard.md) and the [simulation engines plan](reference/simulation-engines-plan.md), including the live run findings. |

## Decisions so far

Name: **Tessera** · an environment for UIs on demand: create one now or open a saved one · **no built-in tools: every tool is created by the person** · local-first web app, Windows first with a launcher and setup check · always auto-saved, named library, find saved tools by asking, saved tools follow their latest version, trash with 30-day restore · SQLite on the local server · signed-in CLIs, Claude Code first, default routing Haiku/Sonnet · Node 22, pnpm, Vite, zod, TypeScript, React 19 with the React Compiler · English first, translatable · two-pass generation for big tools (to measure) · hidden test hooks for verification · saved tools open as Continue or Use again · scenarios judged by host facts, an AI technical review (with screenshot access to its run folder) and your verdict, a few in Portuguese · a few vetted sandbox libraries (charts, then 3D) · image editor as the first editing app · fresh build using the POC as reference · a 3-call spike in M0, internal alpha after M2, sign-off after every milestone · simulation engines in a later milestone · private GitHub repo with CI, solo with Claude Code and Codex both writing and reviewing each other's work, small pull requests that you merge.

Still open: outside data sources (decided at the start of M4), and three later technical choices. See [05-open-decisions.md](05-open-decisions.md#questions-for-you).

**Clarified product rules:** Use again retains reusable defaults only, never original-session entries. Restoring an older interface preserves current data; incompatible conversions show a loss warning/preview and require confirmation, with a recovery snapshot retained. Research precedes engine implementation code. Codex and Claude Code both develop, review, run and test the project; Claude's inability to check a Codex feature is not evidence that Codex was absent or untested throughout the POC. Claude Code remains the first product provider, with Codex product integration scheduled separately.

## How the documents connect

- Every lesson (`L-xx`) names its proposed mitigation requirements; implementation and verification are tracked separately.
- Every requirement has an ID: spec `GEN-04`, `VER-03`, …; practices `ENG-07`, ….
- The roadmap lists which requirements each milestone delivers.
- Tests and pull requests use those IDs to show which control addresses a failure, what evidence exists and what remains unverified.

## This folder stands alone

These documents summarize the Harness POC and can be read without it. The reference copies distinguish historical implementation from Tessera's target requirements; the spec and accepted decisions take precedence. Recorded counts are historical summaries, not independently reproducible evidence in this folder. M0 should preserve a sanitized evidence index and available portable fixtures alongside these documents; missing raw evidence must remain identified as unavailable rather than reconstructed.
