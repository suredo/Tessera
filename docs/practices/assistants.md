# Working with AI assistants

Both Claude Code and Codex develop, review, run the app and execute tests/evaluations (A37). Approved live budgets apply equally to both.

| ID | Rule |
| --- | --- |
| ENG-05 | **One rules file for every assistant.** `AGENTS.md` is the single source of rules: what the project is, how to run checks, the [non-negotiables](#non-negotiables-for-every-assistant), where the spec and ADRs live. It stays under about 100 lines. `CLAUDE.md` contains only the import line `@AGENTS.md`, so Claude Code reads the same rules, and CI fails if `CLAUDE.md` contains anything else. No long handoff documents: the pull request description is the handoff. |
| ENG-06 | **Every task starts from a brief with acceptance criteria.** Use the [task brief template](#task-brief-template). The criteria name spec requirement IDs. Tests that show the criteria are met are written in the same pull request. |
| ENG-15 | **Review and merge** (A36). Every pull request gets an AI review by **the other assistant**: Codex reviews Claude Code's work and the reverse. If the other is unavailable, a fresh session of the same assistant reviews it. The review follows the [AI review checklist](#ai-review-checklist) and is posted on the pull request. The product owner reads the summary and review, then merges. GitHub Free offers no branch protection or rulesets for private repositories, so the rules are kept by setup and habit: `main` changes only through pull requests; the repository allows squash merges only, which keeps history linear; a local pre-push hook, installed by the setup script, refuses direct pushes to `main`; and the product owner merges only when CI is green and the review is posted. Assistants never push to `main` and never merge. |
| ENG-21 | **Small pull requests** (A39). One requirement or a small group per pull request, around 400 changed lines excluding tests, fixtures and generated files. Larger work is split, with a short plan in the first issue or pull request. |
| ENG-22 | **Model matched to task** (A38). Development assistants use lighter, cheaper models for bounded or mechanical work (renames, tests from a clear spec, docs updates) and stronger models for design, difficult bugs and reviews. This only affects development; the product's routing is `CLI-09`. |

## Non-negotiables for every assistant

1. Never weaken a guard (validation, sandbox, check, budget) to make something pass. Fix the cause, or ask.
2. Never make live model calls, or run scripts marked LIVE, without explicit approval of a budget ([live evaluation protocol](live-evaluation.md)).
3. Run typecheck, lint and the relevant tests before saying something is done, and report results faithfully, including failures.
4. Keep one definition per contract (`P3`). If a prompt, check and type disagree, fix the source definition.
5. Keep user-facing text plain (`GEN-12`).
6. Update the reference docs touched by the change in the same pull request ([documentation](documentation.md)).
7. Never use the real user data folder; development, tests and evaluations each use their own (`ENG-19`).

## Task brief template

```markdown
## Goal
One or two sentences, in user terms.

## Requirements
Spec IDs this implements or changes (e.g. GEN-04, DATA-02).

## Acceptance criteria
- Observable result 1 (how it is tested)
- Observable result 2
- What must NOT change

## Out of scope
…

## Size and plan
Expected size; if over ~400 lines, how it is split.

## Live budget
None / N calls, with the reason (needs approval).
```

## Pull request template

```markdown
## What and why
## Requirements touched (IDs)
## Tests added or changed (named by requirement ID)
## Prompt parts changed (if any), with replay results
## Docs updated
## Live calls used (if any): count, tokens, ledger link
## Risks / follow-ups
## Written by: Claude Code / Codex · Reviewed by: the other
```

## AI review checklist

The reviewing assistant checks, and reports each item as fine or a finding with evidence:

1. **Fulfils the brief:** every acceptance criterion is met and tested; nothing out of scope slipped in.
2. **Spec rules:** the touched requirement IDs are honored, and no other requirement is broken (especially `P1`–`P7`, `GEN-06`, `GEN-08`, `DATA-02`, `SEC-*`).
3. **Guards intact:** no validation, check, budget or sandbox rule was weakened.
4. **One definition:** no duplicated schema, prompt text or rule.
5. **Tests:** they would fail without the change; they are named by requirement ID; nothing is flaky.
6. **Plain text:** user-facing messages use no internal terms.
7. **Docs:** reference docs match the change.
8. **Size:** within about 400 lines, or split as planned.
