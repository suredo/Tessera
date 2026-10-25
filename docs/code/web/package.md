---
type: Code Package
title: "Web package"
description: "@tessera/web: the host app in the browser, built with Vite and React 19 with the React Compiler, with all host text going through the translation layer."
resource: ../../../packages/web/
implements: [UX-05, ENG-04, TEST-06, RUN-06, APP-02, APP-03, APP-04, DATA-07, APP-05, APP-08, APP-06, APP-11]
tests: [../../../packages/web/test/translate.test.ts, ../../../packages/web/test/app.test.tsx, ../../../packages/web/test/lint.test.ts, ../../../packages/web/test/host-api.test.ts, ../../../packages/web/test/tool-start.test.ts, ../../../packages/web/e2e/shell.spec.ts, ../../../packages/web/e2e/app.spec.ts, ../../../packages/web/e2e/library.spec.ts, ../../../packages/web/e2e/history.spec.ts, ../../../packages/web/e2e/trash.spec.ts, ../../../packages/web/e2e/archives.spec.ts, ../../../packages/web/e2e/a11y.spec.ts, ../../../packages/web/test/archives.test.ts]
tags: [code, web, translation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-25T21:38:07Z }
---

# Purpose

The host app that runs in the browser. Vite builds it, and React 19 renders it with the React Compiler on (A15). The local server serves its build, with the [host API](../server/host-api.md) it talks to. Its main screen has the workspaces beside the open workspace's tool (`APP-01`, `APP-03`), and a first-run screen while there are none (`APP-02`). My tools, the saved-tools library, is the second section (`APP-04`), and the open workspace's history, with its versions and undo, sits under its tool (`APP-05`). The trash is the third section (`APP-08`). Each workspace and saved tool exports to a file, and a file imports from beside the workspaces or from the first-run screen (`APP-06`). The chat that makes tools comes with M2. Its text, like all host text, goes through the translation layer from the first component (`UX-05`), so adding a language needs a message file and no code changes. Only English ships at first (A10).

# Entry points

- `src/App.tsx`: `App`, the main screen: it loads the workspaces and the library through the host API, keeps which workspace is open for the tab, and shows `EmptyState`, the first-run screen, while there are none, with the trash notice when the last one was just deleted, a way to the trash while it holds something, and importing from a file. The workspaces come most recently used first when the app opens, and keep their places after that.
- `src/Workspaces.tsx`: the workspaces list, each with its name, when it was last used and whether it is saved, with opening, renaming, saving to my tools under a name, and moving to the trash (`APP-03`).
- `src/Library.tsx`: my tools, the saved-tools library (`APP-04`): each saved tool with its name, when it was last updated (the entry or the workspace it follows, whichever changed later, A32) and the workspace Continue opens, searchable by name, with Continue, Use again (`DATA-07`), Save as a new tool, renaming and moving to the trash.
- `src/History.tsx`: the open workspace's history (`APP-05`): its tool versions, newest first, with restore; undo of its last data change (`DATA-04`); and the copies kept before a restore that lost data, which can be brought back (`DATA-10`). After a restore or an undo, the app starts the tool again with the changed data.
- `src/Trash.tsx`: the trash (`APP-08`, `DATA-09`): each deleted workspace and saved tool, with the saved tools that went with a workspace, when it was deleted and when it goes for good, and restore. Emptying it early first lists everything that goes.
- `src/archives.ts`: the app's side of the archive routes ([export and import](../server/archives.md)): `exportArchive` asks for a workspace's or saved tool's file and gives its name and bytes, `saveFile` has the browser save it as a download, and `importArchive` sends a file and gives back the report of what came in, checked against the contracts.
- `src/ImportFile.tsx`: `ImportFile`, the control that picks a `.tessera` file to import.
- `src/NameForm.tsx`: the small form that names something, for renaming, saving and Save as a new tool.
- `src/ToolPanel.tsx`: the open workspace's tool, run through the [runtime](../runtime/package.md) with the bridge to its saved data, with minimize, show again and full screen (`APP-01`).
- `src/tool-start.ts`: `startTool` opens the workspace through the host API, then starts its tool and serves it the bridge, and says after each change the tool saved (`StartOptions`); `rememberedState` and `rememberState` keep, for the tab, how each workspace's tool was left.
- `src/host-api.ts`: `ask`, the app's side of the host API: it sends an action and checks the answer against the contracts (`CON-01`); a refusal is a `HostError` with the server's plain words, and an answer it can't read is one with the host's own, from the translation layer.
- `src/app.css`: the host's look, from the UI standard's tokens, which `main.tsx` sets as `--ui-*` variables from the same tokens the tools use (the runtime's UI standard).
- `src/main.tsx`: starts the app in `index.html`, sets the page title and the UI tokens, and loads the styles.
- `src/i18n/translate.ts`: `t`, the host's translator, and `createTranslator`, which builds one for a language.
- `src/i18n/en.ts`: `en`, the English host text by key. `MessageKey` is its list of keys.
- `vite.config.ts`: the build, with the React Compiler as a Babel preset. Run it as `pnpm build`.
- `e2e/shell.spec.ts` and `e2e/app.spec.ts`: the app's browser tests, run as `pnpm e2e` with the repository's `playwright.config.ts`, against a real Tessera that `e2e/support/app-host.ts` starts through the launcher on a temporary data folder, serving the built app (which Playwright's web server builds first). They open the app in the installed Chrome and Edge at 320 px and 1280 px wide and records a video into `test-output/playwright/` (`TEST-06`). `e2e/prune-runs.ts` keeps the last 3 runs there. A failed test also keeps a light trace there, with its actions and console, and the runtime's test host page logs any task that blocks it for a second or more, so a stalled page can be told from a slow browser (#83, #98). The trace has no snapshots, and so no network: Playwright takes snapshots inside every frame, which counts as the person's activation there and would let a tool write before any click (`GEN-06`). The [CI workflow](../ci/workflow.md) runs it in its Windows job on every pull request.

# Invariants

- **No host text in components** (`UX-05`). A component asks `t("key")` for every word it shows, including `aria-label`, `title`, `alt`, `placeholder`, `label`, and the `value` of a submit, button or reset input. The lint rule `tessera/no-host-text` (`scripts/eslint/no-host-text.mjs`) fails on text written in a component, also when it is reached through a condition, a fallback, a concatenation, a template or a list. It never looks inside a function call, so `t("key")` passes.
- **Chrome and Edge are the supported browsers** (`RUN-06`): the browser tests run in both, and CI runs them. Firefox is best effort and isn't tested. Embedded browser panes that can't load nested sandboxed frames are unsupported; the Claude desktop app's built-in pane couldn't mount the POC's tools.
- **A missing key is visible, never silent.** The translator falls back to English for a key another language lacks; a key no language has shows as the key itself. Either way it reports the gap through its `onMissing` handler, which warns in the console by default.
- **Exactly one tool runs** (`RUN-02`): the tool panel makes a runtime for the open workspace and closes it when another opens, and its frames go with it.
- **The open workspace survives a reload** (`UX-07`): which one is open is kept in the tab's session storage, and the app opens it again, or the most recently used one if it is gone.
- **A minimized or stopped tool stays so** (`UX-07`): the tool panel keeps each workspace's runtime state in the tab's session storage, so after a reload, or switching away and back, it shows the tool as it was left instead of starting it.
- **A closed panel never starts its tool** (`RUN-02`). Starting waits for the server's answer before opening the tool; if the panel closed meanwhile, as React's development mode does once to every new panel, `startTool` stops at whichever step it is, so no tool runs in a runtime nobody can close.
- **"Last used" means opened or changed** (`APP-03`): the app tells the server each time a workspace opens, picked or opened by default, whether or not its tool starts, and shows the server's answer at once: whichever is later. The list is sorted by it when the app opens; after that, rows keep their places, so none moves under a click or takes the keyboard focus with it.
- **One start at a time** (`RUN-02`). "Show again" goes while its start runs, and the panel ignores a second one, so two starts never race for one runtime and leave a tool running without its bridge.
- **Continue opens exactly the linked workspace** (`DATA-07`), and says which before: its accessible name names the workspace. Use again opens a new workspace from the tool's starting data, and the entry still continues the first. Save as a new tool does the same under a new name and saves it as its own entry, so the variant changes apart from the original (`DATA-08`).
- **A restore is planned, then confirmed** (`DATA-10`). Restore asks the server for its plan first and shows it: the data stays, or exactly these values would be lost, each with where it was, and a copy is kept. Only the confirmation runs it, against the data revision the plan was made with, so data that changed meanwhile makes the server refuse it rather than lose something unseen. Cancel changes nothing.
- **The history shows the tool's changes at once** (`APP-05`). A change the running tool saves goes straight to the server; the tool panel hears each one that was saved, never one refused, and the history loads again, so it can be undone without leaving the tool.
- **Undo undoes the change the person sees** (`DATA-04`). A running tool may change the data after the history loaded; Undo checks that the change it shows is still the newest, and if not, shows the newer one and undoes nothing. An interface change is undone by restoring the version before it.
- **Emptying the trash removes only what the person was shown** (`DATA-09`). The confirmation lists every entry, and the server empties the trash only if it still holds exactly those; if something was deleted meanwhile, it refuses, nothing goes, and the trash shows what it holds now.
- **The trash is never out of reach.** After the last workspace is deleted, the first-run screen offers the trash while it holds something, so that workspace can come back.
- **An import says what came in, then opens it** (`APP-06`): the workspace by name, with its saved tools, and when something with the same IDs was already here, that it came in as a copy and nothing here changed. A refused file shows the server's plain reason, and nothing comes in.
- **The host is accessible** (`APP-11`). `e2e/a11y.spec.ts` runs axe (`@axe-core/playwright`) on every host screen, form and confirmation, on the sample workspaces (the [development data](../scripts/dev-data.md)): the first-run screen, the main screen with a running tool, full screen, a restore that would lose data, a workspace's rename and save forms, my tools and its two naming forms, and the trash with its emptying confirmation. It fails on any WCAG 2.2 A or AA violation, leaving out a tool's own frame, which has its own floor (`RUN-05`). It also checks directly what a checker can't judge: on each of those screens nothing moves when reduced motion is asked for, and the app works by keyboard alone, reaching each control with Tab and Shift+Tab, into a form and a confirmation, with the focus showing a 3 px outline on each.
- **Buttons say which workspace they act on.** Their visible labels are short ("Rename", "Move to trash"); their accessible names include the workspace's name.
- **The React Compiler does the memoizing** (A15). No hand-written `useMemo`, `useCallback` or `React.memo` unless profiling shows the compiler missed a case, with a comment saying so. ESLint runs the hooks rules and the compiler's rules (`eslint-plugin-react-hooks`, `recommended-latest`) on every component.

# Depends on / used by

Depends on React 19, the [contracts](../contracts/package.md) and the [runtime](../runtime/package.md), and, to build, Vite with `@vitejs/plugin-react` and the React Compiler's Babel plugin. The [local server](../server/local-server.md) serves its build.

# Pitfalls

- **Versions have no change summary or check results yet.** `APP-05` asks for both, but a version records neither until generation and the checks exist ([issue 121](https://github.com/suredo/Tessera/issues/121)).
- **A saved tool has no description yet.** `APP-04` asks for a short one, but nothing stores one until generation can write it ([issue 119](https://github.com/suredo/Tessera/issues/119)); search matches names only.
- **Keys are typed.** `t` accepts only keys that exist in `en.ts`, so a new string starts there. Another language's file may leave keys out; they fall back to English.
- **The title in `index.html` is empty on purpose.** `src/main.tsx` sets it from the translation layer.
- **The package's TypeScript settings include Node's types,** for its tests and build config. `src/` must still use only browser APIs.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `src/App.tsx`: `EmptyState`, `App`
- `src/History.tsx`: `History`
- `src/ImportFile.tsx`: `ImportFile`
- `src/Library.tsx`: `Library`
- `src/NameForm.tsx`: `NameForm`
- `src/ToolPanel.tsx`: `ToolPanel`
- `src/Trash.tsx`: `Trash`
- `src/Workspaces.tsx`: `Workspaces`
- `src/archives.ts`: `exportArchive`, `importArchive`, `saveFile`
- `src/host-api.ts`: `HostError`, `Send` (type), `ask`
- `src/i18n/en.ts`: `en`, `MessageKey` (type)
- `src/i18n/translate.ts`: `Messages` (type), `Params` (type), `Translate` (type), `MissingHandler` (type), `createTranslator`, `t`
- `src/index.ts`: `App`, `EmptyState`, `ask`, `HostError`, `Send` (type), `en`, `MessageKey` (type), `createTranslator`, `t`, `Messages` (type), `MissingHandler` (type), `Params` (type), `Translate` (type)
- `src/tool-start.ts`: `StartDeps` (type), `StartOptions` (type), `startTool`, `rememberedState`, `rememberState`
- `vite.config.ts`: `default`
