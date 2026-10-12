---
type: Practice
title: "Task checkpoint"
description: "How to pause a task for a new session: route lasting findings to their docs, keep history apart, write one short handoff (ENG-25)."
tags: [practices, checkpoint, handoff]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-12T00:21:12Z }
---
# Task checkpoint

| ID | Rule |
| --- | --- |
| ENG-25 | **Checkpoint a task before changing sessions** (A52). When a task pauses, switches subject or the owner wants a fresh session, the assistant runs this procedure, only when asked: the `task-checkpoint` skill, or "follow `docs/practices/checkpoint.md`". It sends each lasting finding to its existing home in `docs/`, keeps useful history apart in `context/history/`, and writes one short handoff in `context/handoffs/<task-id>.md`. A checkpoint writes files; it does not clear or shorten the current conversation. Only a new session does that. |

Resuming in the new session is [`ENG-26`](resume.md). A checkpoint never runs by itself or after every small answer. Whether an assistant may suggest one is still open: [D12](../decisions/open/d12-checkpoint-suggestions.md).

## What goes where

Three kinds of content stay apart: **knowledge** in `docs/` says what is true or agreed now; **history** in `context/history/` says how an outcome was reached or what was rejected; a **handoff** in `context/handoffs/` says what to do next.

| Finding | Destination | Owner approval |
| --- | --- | --- |
| How the code works, a pitfall | Its code doc in `docs/code/` (`ENG-24`) | Not needed: code docs describe the code |
| Confirmed constraint or requirement | The owning spec area or practice | Needed when it changes accepted text |
| Accepted decision | The [decision log](../decisions/decision-log.md) before M0; an ADR from M0 on | Needed: the owner accepts it in the conversation |
| Proposed decision | The handoff, under "Pending approval" | Not applied until approved |
| Open question or blocker | The handoff; an [open decision](../decisions/open/index.md) or GitHub issue if it outlives the task | Needed for a new open decision |
| Failure that must not happen again | A new lesson in the [issue catalogue](../lessons/issue-catalogue.md) | Needed |
| Rejected alternative whose tradeoffs are worth keeping | A history note | Not needed: history is not authoritative |
| Progress: files changed, checks run, next step | The handoff | Not needed |
| A fact about the owner or their machine, not the project: which account is which, local paths | The assistant's own tool memory ([`ENG-27`](assistants.md)) | Not needed |
| Exploration with no lasting value | Nowhere | — |

**Authoritative** means `docs/product/`, `docs/spec/`, `docs/practices/`, `docs/roadmap/` (scope and exit criteria), the decision log and ADRs, and `AGENTS.md`. Changing them needs the owner's explicit approval in the conversation, unless that exact change was already approved for this task. The index entries, `generated` fields and `docs/log.md` lines that follow from an approved change need no separate approval.

## Procedure

1. **Bound the task.** Use a stable `task_id` of lowercase words and hyphens (`asset-store`), the same one again if the task already has a handoff. Its `subject` is the docs path it belongs to, without `.md` (`spec/data`, `practices`). Split unrelated subjects into separate tasks; a split-off task names its `parent`. If earlier parts of the conversation are no longer available, say so instead of reconstructing them.
2. **Collect candidates.** Keep only what is needed later, explains a decision, or saves repeating an investigation. Never save transcripts or step-by-step reasoning. Look in your own tool memory too: a project fact kept there belongs in the docs, where the other assistant can see it ([`ENG-27`](assistants.md)).
3. **Reconcile each candidate.** Find its home through the indexes or by ID (`grep -rn`), read only the relevant section, and decide: new, already covered, contradictory, superseding, unverified or irrelevant.
   - Already covered: don't repeat it; link to it if useful.
   - Contradicts an authoritative doc: never prefer the newer conversation silently. Surface the conflict and ask.
   - Supersedes an accepted decision: record a new decision that says what it replaces; never rewrite the old one.
   - Spans two subjects: file each part in its own subject and link between them; never copy one into the other.
   - Unverified: label it so wherever it is written.
4. **Plan, then apply.** Show the plan as `path → reason → section and edit`, with changes that need approval listed apart. Apply only what is allowed. Without approval, leave authoritative docs untouched and put the exact proposed change in the handoff. Follow each file's conventions: frontmatter, `generated`, its index and a `docs/log.md` line. Never delete earlier decisions or history to tidy up, and never record credentials or personal data.
5. **Write history only when it earns its place.** One note per subject per task, from the [history note template](#history-note-template), linking the canonical docs it relates to. A repeated checkpoint updates that note; it never adds a second one.
6. **Write or refresh the handoff** from the [handoff template](#handoff-template): one file per task, updated in place, never shared between tasks. Aim for 250–500 words; the check warns above 500 and fails above 700. Link to docs instead of copying them. A new session knows only the repository, so every reference must resolve from it: give the pull request URL once there is one, a URL for anything outside the repository, and the file that holds anything you mention, and don't use an ID the docs define differently (Tessera's `T1`–`T17` are test apps). If there is nothing to continue and nothing new, write no handoff.
7. **Verify and report.** Run `node scripts/okf-check.mjs`, which also checks handoffs and history notes, and look over the changed files for anything unrelated or duplicated. Report the canonical updates, the history saved, the handoff path, the changes awaiting approval, and how to resume. Say plainly that the current conversation is unchanged, and that a new session continues with `task-resume <task-id>`.

## Life of a handoff

- **Status:** `in-progress`, `blocked` or `ready-for-review`.
- **Where:** committed on the task's branch, so the next session finds it with Claude Code or Codex on any machine. Before a branch exists it may stay local.
- **Age:** `checkpoint_date` is the last checkpoint. The check warns once it is more than 14 days old, which also catches a handoff left behind on one machine: refresh it with a checkpoint, or end the task.
- **End:** the last commit before the task's pull request merges removes the handoff, and `node scripts/okf-check.mjs --merge-ready` fails until it does. Git and the pull request keep it; history notes stay. Handoffs never accumulate on `main` (L-14).
- **Dropped:** when the owner drops a task, first send anything lasting to its home (steps 2–5), then remove the handoff and close the pull request if there is one. The owner decides whether the branch is deleted.

## Handoff template

Paths are relative to the repository root, written in backticks; the check verifies they exist.

```markdown
---
task_id: asset-store
subject: spec/data
status: in-progress
checkpoint_date: 2026-11-02
---

# Task: <short title>

## Objective
<one or two sentences>

## Completed
- <verified progress, with the artifact or commit>

## Authoritative references
- `docs/spec/data.md` — <the section and why it matters>

## Decisions and approvals
- Accepted: <decision ID or link, or none>
- Pending approval: <the exact proposed change, or none>

## Open questions / blockers
- <question, and the evidence still missing>

## Next action
1. <one concrete first step>
2. <up to three follow-ups>

## Provenance
- Branch, commits, pull request and checks run
```

## History note template

Path: `context/history/<subject>/<date>-<task-id>.md`, where `<subject>` is the same docs path as above.

```markdown
---
subject: spec/data
task_id: asset-store
date: 2026-11-02
status: historical
---

# <Finding or rejected alternative>

## Context
<why the exploration happened, briefly>

## Outcome
<what was learned, or why it was rejected>

## Relationship to current knowledge
- Canonical: `docs/spec/data.md`
- Superseded by: <path, or none>

## Sources
- <files, sections, commits or pull requests>
```
