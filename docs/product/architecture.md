# Architecture

```text
Launcher (Windows)                    starts the local server, opens the browser (PLAT-02)

Browser
├── Host app (React 19 + Compiler)    chat, tool panel, workspaces, saved tools, versions, trash, setup, details
└── Sandboxed tool runtime            generated code; talks to the host only through the bridge

Local server (Node.js 22 + TypeScript), bound to 127.0.0.1
├── Pipeline                          intent → find saved | generate/edit → checks → repair → result
├── Provider adapters                 Claude Code and Codex CLIs (process isolation, locked flags, usage);
│                                     API-key providers later (CLI-10)
├── Capabilities                      clock, data providers, files in and out, vetted libraries
├── Check runner                      static checks; behavior checks are driven in the browser
├── Storage (SQLite)                  workspaces, versions, data, saved tools, trash, ledger, asset index
├── Asset store (files)               images and other binary files, named by content hash (DATA-11)
├── Runtime server                    serves sandbox documents with strict CSP
└── Evaluation runner                 scenarios, budget guard, dry run, AI review, reports (dev only)

Shared package
└── Contracts (zod)                   schemas → TypeScript types + JSON Schema for model outputs
```

Tooling (decided, A14 and A15): Node.js 22 LTS, pnpm workspaces, Vite, zod, React 19 with the React Compiler.

Repository layout (proposal): a pnpm workspace with `packages/contracts`, `packages/server`, `packages/web` (React host app) and `packages/runtime`, plus `evals/` for the evaluation runner, scenarios and reports. The sandboxed runtime stays framework-free: generated tools are plain HTML, CSS and JS, whatever the host uses.
