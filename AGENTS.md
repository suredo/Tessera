# Tessera: rules for AI assistants

Codex loads this file automatically, and Claude Code loads it through `CLAUDE.md`. It is the single source of rules for every assistant working here (`ENG-05`). Keep it under about 100 lines; details live in `docs/`.

## The project

Tessera is a local-first web app where people get the interface they need by describing it: an AI writes a small tool that runs in a sandbox, and the host owns its data, versions and lifecycle. It is a fresh build that uses the Harness POC as reference.

Current state: planning documents only, no product code yet. Next milestone: M0, foundations (`docs/roadmap/m0-foundations.md`). The repository belongs to the personal GitHub account `suredo` (private, GitHub Free).

## Using the docs

`docs/` follows the Open Knowledge Format: one topic per file, YAML frontmatter, an `index.md` in every folder. Full rules: `docs/practices/documentation.md` (`ENG-08`) and `docs/practices/code-docs.md` (`ENG-24`).

1. **Start small.** Open `docs/index.md`, then the folder's `index.md`, then only the files your task needs. Each index line says what a file covers. Don't load whole folders.
2. **Search by ID.** Requirement, rule, decision and lesson IDs connect everything: `grep -rn "DATA-02" docs/` finds the requirement, the POC lesson behind it, its milestone and the journeys that test it, and code docs will show up too once they exist.
3. **Move between code and docs.** A `// Docs:` comment at the top of a code file names its doc; a code doc's `resource` names its code.
4. **Know what wins.** For what the code does, the code wins. For what it should do, the decision log (`docs/decisions/decision-log.md`) and the spec (`docs/spec/`) win. `docs/poc/` is history.
5. **Read the trust signals.** `status: draft` is a target that may change; `deprecated` is no longer current. No `verified` entry means nobody has checked the doc: confirm its claims against the code before acting on them. A past `stale_after` means recheck that fact before relying on it, and say so.
6. **Never settle a conflict silently.** If a doc and the code, or two docs, disagree, fix the wrong one in the same pull request, or ask.
7. **Leave the docs true.** When you change code or docs, update every affected doc (code docs too), set its `generated` to your actor (`claude-code/<model>` or `codex/<model>`) and the current UTC time, and add a line to `docs/log.md`. Never add `verified` for your own writing, and never add a `human:` entry.
8. **Say what you relied on.** In the pull request, list the docs you read and the docs you changed.

## Changing sessions

Only when the owner asks: pause a task with the `task-checkpoint` skill (Claude Code `/task-checkpoint`, Codex `$task-checkpoint`), and continue it in a new session with `task-resume <task-id>`. Without skills, follow `docs/practices/checkpoint.md` or `docs/practices/resume.md`. You may suggest a checkpoint in one line, saying why, but never run one unasked (ADR 0001). A checkpoint writes files; it does not clear the conversation. Read `context/` only while checkpointing or resuming.

## Checks

Run them before saying something is done, and report the results faithfully, including failures.

- `node scripts/okf-check.mjs` (after `pnpm install`): docs frontmatter, indexes, links, log, code docs and the symbols they name, and that `CLAUDE.md` only imports this file. `--fix` repairs index entries and rewrites code docs' generated symbol sections. `--merge-ready` also fails while a task handoff is left: run it before merging.
- `node --test scripts/okf-check.test.mjs`: whenever you change the checker.
- The workspace (Node from `.nvmrc`; pnpm through Corepack: `corepack enable` once, or prefix `corepack`): `pnpm install`, then `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (`pnpm format` fixes it), `pnpm test`, `pnpm secrets`, `pnpm build` (the web app) and `pnpm coverage` (the requirement and lesson report, `ENG-17`; it fails on an ID nothing defines, and its current milestone is set in `package.json`); `pnpm e2e` runs the browser tests in the installed Chrome and Edge, with videos in `test-output/` (once per machine: `pnpm exec playwright install ffmpeg`). After changing a contract in `packages/contracts`, run `pnpm contracts:schemas` and commit the result; a test fails until you do.
- CI (`.github/workflows/ci.yml`) runs all of these, plus `--merge-ready`, on every pull request and on `main`.
- Git hooks, turned on by `pnpm install` (or `node scripts/setup.mjs`): pre-commit refuses likely secrets, videos and images over 1 MB; pre-push refuses pushes to `main`. Skip one only deliberately, with `--no-verify`, and say why in the pull request.

## Non-negotiables

1. Never weaken a guard (validation, sandbox, check, budget) to make something pass. Fix the cause, or ask.
2. Never make live model calls, or run scripts marked LIVE, without explicit approval of a budget (`docs/practices/live-evaluation.md`).
3. Run the checks before saying something is done, and report results faithfully, including failures.
4. Keep one definition per contract (`P3`). If a prompt, check and type disagree, fix the source definition.
5. Keep user-facing text plain (`GEN-12`).
6. Update the docs touched by the change in the same pull request.
7. Never use the real user data folder; development, tests and evaluations each use their own (`ENG-19`).

## Way of working

- Work starts from a task brief with acceptance criteria and requirement IDs, kept in the task's issue, or in the pull request for work done in one session (`ENG-29`). Scope lives only in `docs/roadmap/`: issues and pull requests link to it and carry a milestone and an area label (`ENG-28`).
- One topic per branch (`feat/…`, `fix/…`, `docs/…`, `chore/…`), Conventional Commits, and small pull requests of about 400 changed lines.
- The other assistant reviews every pull request against the review checklist: Codex reviews Claude Code's work and the reverse.
- Never push to `main`. Merge only when the owner explicitly asks. Squash-merge, and before merging a pull request that another one is stacked on, retarget the stacked one to `main`.
- No long handoff documents: the pull request description is the handoff for finished work, and a task that continues in a new session gets one short handoff (`ENG-25`).
- Your tool's own memory, outside the repository, holds only facts about the owner or their machine. Project rules, decisions and lessons go in `docs/` or here, where both assistants see them (`ENG-27`).
