---
type: Practice
title: "Working with AI assistants"
description: "How Claude Code and Codex work on the project: rules file, briefs, review, pull request size, tool memory, templates and checklist."
tags: [practices, assistants]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-12T00:57:06Z }
stale_after: 2027-04-11T00:00:00Z
sources:
  - { id: gh-branch-protection, resource: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule, title: "GitHub Docs: managing a branch protection rule" }
---
# Working with AI assistants

Both Claude Code and Codex develop, review, run the app and execute tests/evaluations (A37). Approved live budgets apply equally to both.

| ID | Rule |
| --- | --- |
| ENG-05 | **One rules file for every assistant.** [`AGENTS.md`](../../AGENTS.md) is the single source of rules: what the project is, how to use the docs (with [`docs/index.md`](../index.md) as the entry point), how to run checks, the [non-negotiables](#non-negotiables-for-every-assistant) and the way of working. It stays under about 100 lines. `CLAUDE.md` contains only the import line `@AGENTS.md`, so Claude Code reads the same rules, and CI fails if `CLAUDE.md` contains anything else. No long handoff documents: the pull request description is the handoff for finished work, and a task that continues in a new session gets one short handoff ([`ENG-25`](checkpoint.md)). |
| ENG-06 | **Every task starts from a brief with acceptance criteria.** Use the [task brief template](#task-brief-template). The criteria name spec requirement IDs. Tests that show the criteria are met are written in the same pull request. |
| ENG-15 | **Review and merge** (A36). Every pull request gets an AI review by **the other assistant**: Codex reviews Claude Code's work and the reverse. If the other is unavailable, a fresh session of the same assistant reviews it. The review follows the [AI review checklist](#ai-review-checklist) and is posted on the pull request. The product owner reads the summary and review, then merges. GitHub Free offers no branch protection or rulesets for private repositories,[^gh-branch-protection] so the rules are kept by setup and habit: `main` changes only through pull requests; the repository allows squash merges only, which keeps history linear; a local pre-push hook, installed by the setup script, refuses direct pushes to `main`; and the product owner merges only when CI is green and the review is posted. Assistants never push to `main`, and merge only when the product owner explicitly asks. **Stacked pull requests:** before merging a parent, retarget the child to `main` (`gh pr edit <child> --base main`); deleting the parent's branch otherwise makes GitHub close the child. If that happens, push the parent's last commit back as its branch, reopen the child, retarget it, then delete the branch again. Afterwards, update the child by merging `main` into it, never by rebasing or force-pushing, so its review threads stay attached; when `main`'s squash commit has the same tree as a commit already in the child, use `git merge -s ours origin/main`, after checking that the trees match. |
| ENG-21 | **Small pull requests** (A39). One requirement or a small group per pull request, around 400 changed lines excluding tests, fixtures and generated files. Larger work is split, with a short plan in the first issue or pull request. |
| ENG-22 | **Model matched to task** (A38). Development assistants use lighter, cheaper models for bounded or mechanical work (renames, tests from a clear spec, docs updates) and stronger models for design, difficult bugs and reviews. This only affects development; the product's routing is `CLI-09`. |
| ENG-27 | **Tool memory holds only personal facts** (A53). Claude Code and Codex can keep their own notes outside the repository, such as memory and personal instruction files under `~/.claude/` and `~/.codex/`. Each tool sees only its own, on one machine, so those notes hold only what is about the owner or their machine and doesn't belong in the repository: which account is which, local paths, preferences that aren't specific to this project. A rule, decision, convention or lesson about the project goes to its home in `docs/` or `AGENTS.md` ([`ENG-25`](checkpoint.md#what-goes-where)), where both assistants see it; a note may point there but never restates it. When a note repeats or contradicts the repository, the repository wins: fix or remove the note. Never keep credentials there. |

## Non-negotiables for every assistant

The non-negotiables, and the protocol for reading and maintaining these docs, are in [`AGENTS.md`](../../AGENTS.md), the file every assistant loads automatically. They are kept only there, so two copies cannot drift apart (`P3`).

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
7. **Docs:** planning and code docs match the change (`ENG-24`), every "No doc change needed" reason holds, frontmatter `generated` is updated and `docs/log.md` has a line. The OKF check passes.
8. **Size:** within about 400 lines, or split as planned.

[^gh-branch-protection]: GitHub Docs: managing a branch protection rule
