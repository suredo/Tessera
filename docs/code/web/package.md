---
type: Code Package
title: "Web package"
description: "@tessera/web: the host app in the browser, built with Vite and React 19 with the React Compiler, with all host text going through the translation layer."
resource: ../../../packages/web/
implements: [UX-05, ENG-04, TEST-06, RUN-06]
tests: [../../../packages/web/test/translate.test.ts, ../../../packages/web/test/app.test.tsx, ../../../packages/web/test/lint.test.ts, ../../../packages/web/e2e/shell.spec.ts]
tags: [code, web, translation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-25T06:23:26Z }
---

# Purpose

The host app that runs in the browser. Vite builds it, and React 19 renders it with the React Compiler on (A15). For now it is one placeholder screen; M1 brings the chat and the tool panel (`APP-01`). Its text, like all host text, goes through the translation layer from the first component (`UX-05`), so adding a language needs a message file and no code changes. Only English ships at first (A10).

# Entry points

- `src/App.tsx`: `App`, the first screen.
- `src/main.tsx`: starts the app in `index.html` and sets the page title.
- `src/i18n/translate.ts`: `t`, the host's translator, and `createTranslator`, which builds one for a language.
- `src/i18n/en.ts`: `en`, the English host text by key. `MessageKey` is its list of keys.
- `vite.config.ts`: the build, with the React Compiler as a Babel preset. Run it as `pnpm build`.
- `e2e/shell.spec.ts`: the browser test, run as `pnpm e2e` with the repository's `playwright.config.ts`. It opens the built app in the installed Chrome and Edge at 320 px and 1280 px wide and records a video into `test-output/playwright/` (`TEST-06`). `e2e/prune-runs.ts` keeps the last 3 runs there. A failed test also keeps a light trace there, with its actions and console, and the runtime's test host page logs any task that blocks it for a second or more, so a stalled page can be told from a slow browser (#83, #98). The trace has no snapshots, and so no network: Playwright takes snapshots inside every frame, which counts as the person's activation there and would let a tool write before any click (`GEN-06`). The [CI workflow](../ci/workflow.md) runs it in its Windows job on every pull request.

# Invariants

- **No host text in components** (`UX-05`). A component asks `t("key")` for every word it shows, including `aria-label`, `title`, `alt`, `placeholder`, `label`, and the `value` of a submit, button or reset input. The lint rule `tessera/no-host-text` (`scripts/eslint/no-host-text.mjs`) fails on text written in a component, also when it is reached through a condition, a fallback, a concatenation, a template or a list. It never looks inside a function call, so `t("key")` passes.
- **Chrome and Edge are the supported browsers** (`RUN-06`): the browser tests run in both, and CI runs them. Firefox is best effort and isn't tested. Embedded browser panes that can't load nested sandboxed frames are unsupported; the Claude desktop app's built-in pane couldn't mount the POC's tools.
- **A missing key is visible, never silent.** The translator falls back to English for a key another language lacks; a key no language has shows as the key itself. Either way it reports the gap through its `onMissing` handler, which warns in the console by default.
- **The React Compiler does the memoizing** (A15). No hand-written `useMemo`, `useCallback` or `React.memo` unless profiling shows the compiler missed a case, with a comment saying so. ESLint runs the hooks rules and the compiler's rules (`eslint-plugin-react-hooks`, `recommended-latest`) on every component.

# Depends on / used by

Depends on React 19 and, to build, Vite with `@vitejs/plugin-react` and the React Compiler's Babel plugin. Nothing imports it yet; the local server will serve its build (M1).

# Pitfalls

- **Keys are typed.** `t` accepts only keys that exist in `en.ts`, so a new string starts there. Another language's file may leave keys out; they fall back to English.
- **The title in `index.html` is empty on purpose.** `src/main.tsx` sets it from the translation layer.
- **The package's TypeScript settings include Node's types,** for its tests and build config. `src/` must still use only browser APIs.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `src/App.tsx`: `App`
- `src/i18n/en.ts`: `en`, `MessageKey` (type)
- `src/i18n/translate.ts`: `Messages` (type), `Params` (type), `Translate` (type), `MissingHandler` (type), `createTranslator`, `t`
- `src/index.ts`: `App`, `en`, `MessageKey` (type), `createTranslator`, `t`, `Messages` (type), `MissingHandler` (type), `Params` (type), `Translate` (type)
- `vite.config.ts`: `default`
