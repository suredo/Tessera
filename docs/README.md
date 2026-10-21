---
type: Overview
title: "Overview"
description: "What Tessera is, the key decisions and how to read these docs."
tags: [overview, README]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-21T05:40:05Z }
---
# POC results: from Harness to Tessera

These are target requirements, not an implemented Tessera release; [log.md](log.md) records how the docs have changed. Remaining [open decisions](decisions/open/index.md) are listed with when each is decided; none blocks starting M0.

The Harness POC demonstrated that an AI can build and keep changing useful tools from everyday requests inside a sandbox, and recorded passing checks for specific boundaries and workflows. It did not establish general security or a reliable success rate across arbitrary requests. This folder turns those three days of evidence into the starting documents for **Tessera**: an environment where people get the interface they need by creating it or opening one they saved. Each tool is one piece of their environment, like a tile in a mosaic.

## Read in this order

Each folder has an `index.md` listing its documents with a one-line description; [index.md](index.md) is the entry point for people and AI assistants.

| # | Folder | What it gives you |
| --- | --- | --- |
| 1 | [lessons/](lessons/index.md) | What worked and must be kept. Then 69 issues with root cause and proposed mitigation. 68 have a mapped mitigation; 55 target a structural control. |
| 2 | [product/](product/index.md) and [spec/](spec/index.md) | The product and its rules: principles, architecture, and numbered requirements by area (contracts, generation, runtime, data, verification, provider adapters, observability, security, UX, later simulations, testing), plus release acceptance criteria. |
| 3 | [roadmap/](roadmap/index.md) | Milestones M0–M6 in build order, with deliverables, exit criteria, what to port from the POC, and live-call budgets derived per scenario run (about 270 calls to the first release; internal alpha for you after M2). |
| 4 | [practices/](practices/index.md) | How we work: GitHub and CI, TypeScript standards, AI-assistant rules and templates, the five-layer test pyramid, the live evaluation protocol, documentation and evidence structure. |
| 5 | [decisions/](decisions/index.md) | The decision log (A1–A54) and the remaining choices: progress streaming, engine modularity, simulation presentation and outside data sources. Decisions from M0 on are ADRs. |
| 6 | [testing/](testing/index.md) | Real-life test scenarios: what a scenario is, the eight journeys every set must cover (first run to hands-on), three platform scenarios, a catalogue of 17 test apps (simple, medium, advanced; modularity later), how replay stays honest, the scenario file format, judging (host facts, AI review, your verdict) and which scenarios run at each milestone. |
| — | [poc/](poc/index.md) | Historical copies of the two POC designs Tessera ports: the [UI standard](poc/ui-standard.md) and the [simulation engines plan](poc/simulation-engines-plan.md), including the live run findings. |

## Key decisions

- **Product:** an environment for UIs on demand. No built-in tools: every tool is created by the person. A local-first web app, Windows first, with a launcher and a setup check.
- **Saving:** always auto-saved, a named library, saved tools found by asking and opened as Continue or Use again, trash with 30-day restore. SQLite holds records; images and other binary files live in a content-addressed file store beside it.
- **Models, for now:** the signed-in Claude Code CLI (from M2) and Codex CLI (from M3) on your machine, for local development and testing. Before anyone else runs Tessera, connections move to API keys or the person's own provider account; other providers (z.ai, Kimi, Grok and others) come later.
- **Stack:** Node 22, pnpm, Vite, zod, TypeScript, React 19 with the React Compiler. English first, translatable.
- **Way of working:** a public repository on GitHub Free ([ADR 0005](decisions/adr/0005-public-repository.md)) with CI on every pull request; solo, with Claude Code and Codex writing and reviewing each other's work; small pull requests that you merge.
- **Evaluation:** real-life scenarios judged by host facts, an AI technical review and your verdict, a few in Portuguese. Sign-off after every milestone.
- **Docs:** the [Open Knowledge Format](practices/documentation.md) (OKF v0.2): one file per area with frontmatter saying who wrote and who checked it, an index per folder, and code documented the same way and checked against the code.

All decisions, with their reasons, are in the [decision log](decisions/decision-log.md). Still open: outside data sources (decided at the start of M4) and three later technical choices.

## How the documents connect

The spec says **what** the product does and **which rules it must follow**. The [roadmap](roadmap/index.md) says in which order. The [engineering practices](practices/index.md) say how we work. The [test scenarios](testing/index.md) say how we check it the way people will use it.

- Every lesson (`L-xx`) names its proposed mitigation requirements; implementation and verification are tracked separately.
- Every requirement has an ID: spec `GEN-04`, `VER-03`, …; practices `ENG-07`, ….
- The roadmap lists which requirements each milestone delivers.
- Tests and pull requests use those IDs to show which control addresses a failure, what evidence exists and what remains unverified.

## How to read the numbers

Counts in these documents are planning figures or historical summaries. A mapped mitigation is a plan, not proof that the failure is prevented. A live-call budget is an envelope to reconcile before each run, not a promise of coverage. POC results summarize runs whose raw evidence is not in this folder. Tessera tracks every lesson and requirement as proposed → implemented → verified (`ENG-17`). Each document's frontmatter also says who checked it: no `verified` entry means nobody has yet.

## This folder stands alone

These documents summarize the Harness POC and can be read without it. The copies in [poc/](poc/) are historical; the spec and the decision log take precedence. POC results stay historical summaries, and their raw evidence is not carried over: Tessera's evidence comes from its own runs, starting with the M0 live spikes ([`ENG-10`](practices/evidence.md)).
