---
type: Decision
title: "ADR 0004. Nested frames in the sandbox"
description: "Frames a tool nests inside its own: those from URLs, data:, blob:, objects and embeds don't load; srcdoc and javascript: frames may run, and must be exactly as confined as the tool (changes SBX-06)."
tags: [decisions, runtime, sandbox, security]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T09:17:46Z }
---
# ADR 0004. Nested frames in the sandbox

Decided by the owner on 2026-10-19, after Codex's review of [pull request 64](https://github.com/suredo/Tessera/pull/64) ([issue 45](https://github.com/suredo/Tessera/issues/45)). It changes the expected result of the boundary check `SBX-06` in the [threat model](../../spec/threat-model.md) and the wording of `RUN-01` in the [runtime spec](../../spec/runtime.md). Code: the [runtime package](../../code/runtime/package.md).

## Context

`SBX-06` said that no nested document loads inside a tool's frame, whether from a URL, `srcdoc`, `data:` or `blob:`. The runtime blocks frames from URLs with its CSP (`frame-src 'none'`, `child-src 'none'`, `object-src 'none'`). In Chrome and Edge, two kinds of nested frame still run a script, because CSP's fetch directives don't govern them:

- **`srcdoc`**: no URL is fetched, so `frame-src` doesn't apply.
- **`javascript:`**: governed by `script-src`, which must allow inline code (`'unsafe-inline'`), because a tool's code is inline, and ordinary generated tools use inline event handlers.

Both inherit the tool's sandbox flags and its CSP, and each gets an opaque origin of its own. A nested blank frame loads too, and the tool can't write into it.

The only partial blocks are Trusted Types and a script nonce. Trusted Types would forbid setting `innerHTML` from a string, which ordinary tools need. A nonce would break inline handlers, and a tool's script can read its own nonce. Neither stops a determined tool.

## Options

1. **Keep "no nested document loads" and enforce it.** Not possible in Chrome and Edge without breaking ordinary tools, and still not complete.
2. **Accept the nested frames the browser runs, and prove they are exactly as confined as the tool.** The boundary that matters is what code in the sandbox can reach, not how many documents it has.

## Decision

Option 2. `SBX-06` now expects two results:

- **Frames that must not load:** `<iframe>` from a URL (outside, or a runtime document), from `data:` and from `blob:`, `<frame>`, `<object>` and `<embed>`. Nothing in them runs, and nothing reaches the probe server.
- **Frames that may run:** `srcdoc` and `javascript:` frames. Code in them must be exactly as confined as the tool's own:
  - an opaque origin;
  - no `tessera` bridge;
  - fetch and images blocked, with the tool's CSP reporting each violation;
  - no storage or cookies;
  - no popups;
  - no access to the host page, and the host page doesn't move;
  - a bridge hello to the wrapper is ignored.

  A nested blank frame can't be written into by the tool.

## Consequences

- The browser checks in `packages/web/e2e/sandbox.spec.ts` test both lists in Chrome and Edge. A browser change that lets a nested frame load from a URL, or gives a nested frame more than the tool has, fails them.
- Anything a later check proves about the tool, such as the device features in `SBX-13` or the bridge in `SBX-12`, should also be tried from a nested `srcdoc` frame.
- **When to revisit:** if a browser stops passing the sandbox flags or the CSP down to these frames, or if Tessera ever relaxes the tool's CSP.
