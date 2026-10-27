---
type: Code Module
title: "Static check"
description: "Every candidate's and imported tool's code, read with real parsers before it can run: no frames, navigation, HTML or code made at run time, or names built at run time on the page's objects (ADR 0009); the first rules of VER-01."
resource: ../../../packages/server/src/checks/
implements: [SBX-06, SBX-07]
tests: [../../../packages/server/test/static-check.test.ts, ../../../packages/server/test/archives.test.ts]
tags: [code, server, checks, security, verification]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T04:21:07Z }
---

# Purpose

Reads a tool's code before it runs, with real parsers (`VER-01`): acorn for the JavaScript, parse5 for the HTML, which follows the HTML standard, as the browser does. Its first rules close the one way out the sandbox can't stop ([ADR 0009](../../decisions/adr/0009-frames-and-navigation-in-generated-tools.md)). A frame or navigation to an outside address is refused by the browser, but only after it looks up the name, which can carry data. A tool steered by pasted text could use that.

# Entry points

- `src/checks/static-check.ts`: `staticCheck` checks a tool's code and gives a `StaticCheckResult`. On failure it lists each `StaticFinding`: the part, the line, and a message saying what to do instead, for repair (`GEN-09`). `checkHtml` and `checkJs` check one part.

# Invariants

- **No frames, embedded objects or script tags** (`SBX-06`): `<iframe>`, `<frame>`, `<object>`, `<embed>`, `<script>` (in SVG too), `<base>` and `<meta>`, in the HTML, in fixed HTML text written from the JavaScript, and created with `createElement`.
- **No navigation** (`SBX-07`):
  - links whose address isn't `#` or empty;
  - form actions, meta refresh and `ping`;
  - `location`, `history`, `navigation`, `window.open` and a bare `open`;
  - an `href` set from the JavaScript.
- **No code or HTML made at run time.** The tool's policy forbids `eval` but allows inline scripts, so a script or handler built from text would run unread. The check therefore refuses:
  - `on…` attributes, in the HTML or set from JavaScript;
  - script elements;
  - `eval`, `Function` and string timers;
  - `import()`, `DOMParser` and `createContextualFragment` with text built at run time;
  - `innerHTML`, `outerHTML` and `insertAdjacentHTML` with anything but fixed text, which must itself pass the HTML rules;
  - `document.write`, and `srcdoc`.
- **No way around the names.** The page's objects (`window`, `document`, `self`, `globalThis`, `top`, `parent`, `frames`, `opener`) may only be used as `window.something`, with the name written out: never stored, passed, destructured or reached by a computed name. The check also refuses:
  - `this` outside a class, which can be the page itself;
  - `with`;
  - names that reach the page from an element (`ownerDocument`, `defaultView`, `contentWindow`);
  - `prototype`, `__proto__`, `Reflect`, and `Object`'s descriptor and prototype methods;
  - elements and attributes whose names are computed at run time.
- **The HTML is read in a body**, where the tool's HTML goes, so what the parser drops there (a `<frameset>`) makes no element and isn't reported.
- **Imported tools are checked too.** An archive whose tool fails is refused whole, and nothing is imported ([export and import](archives.md)).
- **Real tools pass.** The shopping-list fixture and every development sample pass: ordinary code (events, `textContent`, `items[i]`, `obj[key]`, `this` in a class, blob addresses for images) isn't refused.

# Depends on / used by

acorn and parse5, pinned exactly. The [export and import](archives.md) module refuses an archive whose tool fails it. The generation pipeline (#146) runs it on every candidate before staging, and its findings feed repair. The base prompt part tells the model these rules ([prompt assembly](prompts.md)).

# Pitfalls

- **These are `VER-01`'s first rules, not all of them.** Undeclared bridge actions and capabilities, unknown methods, writes at startup and reading the system clock come next (#148).
- **It runs on the server, before staging,** rather than as a staging check in the browser. It must also cover imports, which aren't staged, and code that fails never reaches the browser. #148's wording asked for the staging interface; the smoke check (#149) is the staging check.
- **A path nobody thought of keeps ADR 0006's limit open.** The rules are strict on purpose; a real tool that needs something they refuse is a reason to revisit ADR 0009, not to loosen a rule quietly.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `checkHtml`, `checkJs`, `staticCheck`, `StaticCheckResult` (type), `StaticFinding` (type)
- `static-check.ts`: `StaticFinding` (type), `StaticCheckResult` (type), `staticCheck`, `checkHtml`, `checkJs`
