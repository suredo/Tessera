---
type: Code Module
title: "Git hooks"
description: "Local git hooks, turned on by pnpm install: pre-commit refuses likely secrets, videos and images over 1 MB; pre-push refuses pushes to main."
resource: ../../../scripts/hooks/
implements: [ENG-01, ENG-10, ENG-15, ENG-19]
tests: [../../../scripts/test/hooks.test.mjs]
tags: [code, scripts, git]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T07:21:34Z }
---

# Purpose

Catches mistakes on the owner's machine before they reach GitHub. `scripts/setup.mjs` points git at `.githooks/` on every `pnpm install`, so each checkout gets the hooks from its first commit (`ENG-01`). The pre-commit hook refuses likely secrets in what is being committed (the secrets part of `ENG-19`), and video files and images over 1 MB (`ENG-10`). The pre-push hook refuses any push to `main`, which changes only through pull requests (`ENG-15`). CI runs the same secrets scan over the whole repository, so for secrets the hooks are an early warning, not the only guard; for videos, large images and pushes to `main` they are the only automated one.

# Entry points

- `scripts/setup.mjs`: turns the hooks on by setting `core.hooksPath` to `.githooks`. It runs as the package's prepare script, and does nothing outside a git checkout.
- `.githooks/pre-commit` and `.githooks/pre-push`: shell shims that run the Node hooks.
- `scripts/hooks/pre-commit.mjs`: reads the staged files, refuses videos by extension and images over 1 MB by size, then runs secretlint on the staged content.
- `scripts/hooks/pre-push.mjs`: reads the refs git passes on stdin and refuses any to `refs/heads/main`.

# Invariants

- **The staged content is checked, not the working copy.** A secret removed only from the working copy is still refused.
- **Setup is idempotent:** running it again changes nothing.
- **Fake secrets in tests are put together at run time,** so no text that looks like a secret is ever committed.
- **A hook is skipped only deliberately,** with `--no-verify`, and the pull request says why (`AGENTS.md`).

# Depends on / used by

Depends on git, Node, and `secretlint` with its rules in `.secretlintrc.json`. Used on every commit and push in a checkout where `pnpm install` has run. `pnpm secrets` and CI run the same secretlint rules over the whole repository.

# Pitfalls

- **MPEG transport streams (`.ts`, `.mts`) aren't treated as video,** because here those are TypeScript files.
- **Large files are scanned too:** a secret inside a file of several megabytes is still refused.
- **The tests copy the hooks into a throwaway repository** and link the workspace's `node_modules`, so a new file the hooks need must be added to the test's list of files to copy.
- **This doc's `resource` is the hooks folder,** so the drift check doesn't watch `scripts/setup.mjs` or the shims in `.githooks/`; update the doc by hand when they change.
