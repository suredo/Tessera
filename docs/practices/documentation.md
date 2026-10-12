---
type: Practice
title: "Documentation"
description: "How the docs follow the Open Knowledge Format: kinds, frontmatter, indexes, log and links (ENG-08)."
tags: [practices, documentation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-12T00:21:12Z }
sources:
  - { id: okf-spec, resource: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md, title: "Open Knowledge Format specification v0.2" }
---
# Documentation

| ID | Rule |
| --- | --- |
| ENG-08 | **Documentation follows the Open Knowledge Format** (OKF v0.2, A50). `docs/` is one OKF bundle: every document is a concept file with frontmatter, every folder has an `index.md`, and `docs/log.md` records changes. Google's specification is the rulebook;[^okf-spec] the rules below add what OKF leaves to each project. The OKF check (`node scripts/okf-check.mjs`) enforces them; its own tests run with `node --test scripts/okf-check.test.mjs`. |

## Kinds of documentation

| Kind | Location | Rule |
| --- | --- | --- |
| Planning | `docs/product/`, `spec/`, `roadmap/`, `practices/`, `testing/`, `lessons/` | The spec labels target requirements and delivery status. Updated in the same pull request as the change it describes. |
| Code docs | `docs/code/`, mirroring the packages | One concept per module or subsystem, checked against the code (`ENG-24`). They describe current behavior only. |
| Decisions | [the decision log](../decisions/decision-log.md) for A1–A53; `docs/decisions/adr/NNNN-title.md` for new decisions from M0 on | The decision log stays as it is. Each new decision gets one ADR (`type: Decision`): context, decision, consequences. Never edited afterwards; superseded by a new ADR. |
| POC references | `docs/poc/` | Historical copies, labelled, and subordinate to the spec and decisions. |
| Evaluations and milestone reports | `evals/reports/YYYY-MM-DD-name.md` | Dated results of live runs, and each milestone's closing report (delivered, exit criteria, live costs, open issues) with the product owner's sign-off. Historical: never updated to look current. Same frontmatter (`type: Evaluation Report`), kept outside the `docs/` bundle. |
| Task context | `context/handoffs/`, `context/history/` | Outside the OKF bundle and not authoritative. A handoff says what to do next for one in-progress task; a history note keeps rejected alternatives under the subject they belong to (`ENG-25`, `ENG-26`). The OKF check validates both. |
| Changelog | `CHANGELOG.md` | What changed per release (`ENG-23`). |

## Frontmatter

Every concept file starts with YAML frontmatter:

| Field | Required | Rule |
| --- | --- | --- |
| `type` | Yes | One of the project types below. |
| `title` | Yes | The display name; the folder's `index.md` uses it as the link text. |
| `description` | Yes | One sentence; the folder's `index.md` repeats it. |
| `status` | Yes | `draft`, `stable` or `deprecated`. |
| `generated` | Yes | `{ by: <actor>, at: <datetime> }`: who last wrote the content, and when. Updated on every meaningful change. |
| `verified` | No | A list of `{ by, at }`: who checked the content against its sources or the code. You add `human:suredo` when you sign a doc off; a reviewing assistant may add itself for docs it checked. Readers derive a trust level: no entry is unverified, assistants only is machine-checked, a `human:` entry is human-reviewed. |
| `tags` | No | Short lowercase words for search across folders. |
| `stale_after` | No | A datetime after which the doc must be rechecked. Use it for facts that change outside the project: provider policies, CLI versions and flags, model routing, GitHub plan limits. The check warns once it has passed. |
| `sources` | No | Sources the doc relies on, each `{ id, resource, title }`. Cite a specific claim with a footnote whose label is the source `id`. |
| `resource`, `implements`, `tests` | Code docs | See `ENG-24`. |

Actors: `claude-code/<model>` and `codex/<model>` for the assistants, `human:<github-user>` for people, and `process:<name>` for automation such as `process:ci`. Datetimes are ISO 8601 with an explicit offset, for example `2026-10-11T20:21:39Z`.

Frontmatter uses a simple YAML subset, so the check needs no dependencies: `key: value`, `key: [a, b]`, `key: { k: v }`, and a key followed by indented `- ` items that are values or `{ k: v }` maps. Quote any value containing `: ` or ` #`.

**Project types:** Overview, Product, Glossary, Principles, Architecture, Requirement Area, Acceptance Criteria, Roadmap, Milestone, Budget, Practice, Decision Log, Decision, Open Decision, Lesson, Test Design, POC Reference, Code Package, Code Module, Evaluation Report. A new type is added here and in the check first.

## Indexes, log and links

- **`index.md`** in every folder lists each concept as `* [title](file.md) - description`, grouped under headings written by hand, and each subfolder by its `index.md`. Only the root `index.md` has frontmatter (`okf_version`). The check fails when an entry is missing or its title or description differs from the concept's frontmatter; `node scripts/okf-check.mjs --fix` rewrites them.
- **`log.md`** at the root lists documentation changes under `## YYYY-MM-DD` headings, newest first. Every pull request that changes docs adds a line.
- **Links are relative** (`../spec/data.md`). OKF prefers links starting with `/` from the bundle root, but GitHub resolves those from the repository root, so they would break with `docs/` as the bundle.
- **Entry point:** `docs/index.md`. How assistants find, trust and maintain the docs (start from the indexes, search by ID, what wins in a conflict, the trust signals, what to update) is the "Using the docs" protocol in [`AGENTS.md`](../../AGENTS.md), which every assistant loads automatically.

The README stays short: what the project is, how to run it, where the docs are.

On import, preserve a sanitized evidence index (run/date, provider, scope, measured result and available portable report/fixture). Missing raw evidence stays marked unavailable. Never turn a proposed fix into a measured success claim. The UI-standard version remains contract metadata.

[^okf-spec]: Open Knowledge Format specification v0.2
