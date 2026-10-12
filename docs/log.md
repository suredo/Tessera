# Documentation log

## 2026-10-12

* **Update**: Closed gaps in task context handling. New [`ENG-27`](practices/assistants.md) (decision A53): an assistant's own tool memory holds only facts about the owner or their machine, never project rules. [`ENG-25`](practices/checkpoint.md) and [`ENG-26`](practices/resume.md) now cover old and dropped handoffs, and the OKF check warns on handoffs more than 5 days old and gains `--merge-ready` (`ENG-09` item 8, M0 CI). New open decision [D12](decisions/open/d12-checkpoint-suggestions.md): whether assistants may suggest a checkpoint. L-14 maps to `ENG-27` too.

## 2026-10-11

* **Creation**: Added the task [checkpoint](practices/checkpoint.md) and [resume](practices/resume.md) workflows (`ENG-25`, `ENG-26`, decision A52), the `task-checkpoint` and `task-resume` skills for Claude Code and Codex, and `context/` for handoffs and history notes. `ENG-05` now allows one short handoff per task continuing in a new session; L-14 maps to `ENG-25`.
* **Creation**: Wrote `AGENTS.md` (loaded by every assistant) with the protocol for using these docs, the checks and the non-negotiables, and `CLAUDE.md` importing it; pulled forward from M0. The non-negotiables now live only in `AGENTS.md`; `ENG-15` allows an assistant to merge when the owner explicitly asks.
* **Update**: Adopted the Open Knowledge Format (OKF v0.2) metadata: frontmatter on every document, an `index.md` per folder checked against it, this log, and the [OKF check](practices/documentation.md) with its tests; code docs may implement engineering rules as well as spec requirements. Added [code documentation](practices/code-docs.md) (`ENG-24`) and decisions A50–A51. Fixed the M5 budget heading (about 85 calls).
* **Restructure**: Split the six planning documents into one file per area under `product/`, `spec/`, `roadmap/`, `practices/`, `decisions/`, `lessons/` and `testing/`, text moved verbatim ([PR 2](https://github.com/suredo/Tessera/pull/2)).
* **Update**: Draft 0.4 after the first full review: GitHub Free, local CLI connections (Claude Code in M2, Codex in M3), binary assets (`DATA-11`), per-record revisions, acceptance checks from the request (`VER-09`), live budgets re-derived per scenario run, and assets kept by undo history ([PR 1](https://github.com/suredo/Tessera/pull/1)).
* **Creation**: Imported the draft 0.3 planning documents written from the Harness POC.
