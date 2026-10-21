---
type: Decision
title: "ADR 0005. A public repository"
description: "Tessera's repository is public from 2026-10-21, so CI's Actions minutes are free; replaces A16, and what it changes for CI, branch protection and the owner's details in the history."
tags: [decisions, repository, ci]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-21T05:40:05Z }
---
# ADR 0005. A public repository

Decided by the owner on 2026-10-21, and done the same day. It replaces A16 in the [decision log](../decision-log.md), which chose a private repository on GitHub Free, and it changes `ENG-01` and `ENG-02` in the [repository practices](../../practices/repository.md).

## Context

On a private repository, GitHub Free includes 2,000 Actions minutes a month, and a Windows minute counts as two. By 2026-10-21, M1's CI had used 1,425 Linux minutes and 352 Windows minutes in October, about 2,129 counted minutes in 173 runs, so CI stopped running until the allowance came back on November 1. Actions on standard runners are free and unlimited for public repositories.

A16 kept the repository private so that research sources and fixtures could be committed as they are. None are: sources are linked from documents' frontmatter, and the fixtures are Tessera's own.

## Options

1. **Stay private and use less CI:** one Linux job instead of nine, only the OKF check when a pull request's description changes, and no Windows job for documentation-only changes. That is about half the minutes, but still rationed.
2. **Stay private and pay for what goes over:** about US$0.006 a Linux minute and US$0.01 a Windows minute.
3. **Make the repository public.**

## Decision

Option 3. Before the switch, the whole history, the issues, the pull requests and their review comments were checked for secrets, personal paths, account details and third-party material. None were found.

## Consequences

- **CI isn't rationed any more.** The Windows job still runs only what depends on the platform, now to keep CI fast, not to save minutes. Milestone reports no longer need to report Actions usage against an allowance.
- **Everything is public**: the code, the documents, the history, issues, pull requests and reviews. Nothing secret or personal goes into any of them, which was already the rule (`ENG-19`, the secret scan and the pre-commit hook).
- **The owner's email address and name stay in the existing commits.** The owner accepted that. New commits can use GitHub's private no-reply address instead, set in the owner's GitHub and git settings.
- **No license yet.** People can read the code but have no right to reuse it until the owner adds one.
- **Branch protection and rulesets are now available** for a public repository on GitHub Free, and so are secret scanning and push protection. `ENG-15` still keeps the merge rules by setup and habit; requiring green CI on `main` through a ruleset, and turning on secret scanning, are the owner's settings to choose.
- **Pull requests from forks** run CI with a read-only token and no secrets, since the workflow uses `pull_request` and has none. GitHub asks the owner to approve CI runs for first-time contributors.
