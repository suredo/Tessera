---
type: Practice
title: "Tracking work"
description: "Where scope, briefs and progress are tracked: the roadmap, GitHub issues and milestones, the coverage report and new lessons (ENG-28 to ENG-30)."
tags: [practices, tracking]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-12T02:02:46Z }
---
# Tracking work

These rules stay a draft until they are reviewed at the end of M0, against the issues and pull requests M0 produced (A54).

| ID | Rule |
| --- | --- |
| ENG-28 | **The roadmap owns scope; GitHub tracks the work** (A54). What each milestone delivers, and its exit criteria, live only in [`docs/roadmap/`](../roadmap/index.md). GitHub milestones M0–M6 carry the roadmap's titles, and every issue and pull request belongs to one. An issue or pull request links to its roadmap row and requirement IDs and never restates them. Each gets one area label (`gen`, `runtime`, `data`, `ver`, `cli`, `ux`, `app`, `docs` or `eng`), plus `bug` for a defect. Threads on issues and pull requests are working context, like handoffs: a decision, rule or lesson reached there goes to its home in `docs/` ([`ENG-25`](checkpoint.md#what-goes-where)). Progress per requirement comes from the coverage report ([`ENG-17`](testing.md)); the share of closed issues in a milestone is only a rough guide. No project board while one or two tasks are in flight. |
| ENG-29 | **One brief per task, in its issue or its pull request** (A54). The brief follows the [task brief template](../../.github/ISSUE_TEMPLATE/task.md) (`ENG-06`). Work done in one session and one pull request keeps its brief in the pull request description. Work that waits, spans sessions or goes to the other assistant starts as an issue holding the brief, and its pull request says `Closes #N`. A milestone's deliverables become issues when the milestone starts, not before. An assistant may open an issue for follow-up work it finds, with a brief, a label and a milestone, and lists it in its pull request. |
| ENG-30 | **Closing a milestone reconciles its issues** (A54). Before the owner signs off a milestone's closing report, every issue still open in it is moved to a later milestone, closed as not planned with the reason, or turned into an open decision or a lesson. The report lists each one and where it went. A deliverable that moved is moved in the roadmap too, so the two never disagree. |

## Lessons

The lessons continue in [the issue catalogue](../lessons/issue-catalogue.md). New lessons get IDs and a mitigation requirement, just like the POC catalogue.
