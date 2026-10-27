---
type: Code Module
title: "Static check"
description: "Every candidate's and imported tool's code, read with real parsers before it can run: no frames, navigation, HTML or code made at run time, or names built at run time on the page's objects (ADR 0009); the first rules of VER-01."
resource: ../../../packages/server/src/checks/
implements: [SBX-06, SBX-07]
tests: [../../../packages/server/test/static-check.test.ts, ../../../packages/server/test/archives.test.ts]
tags: [code, server, checks, security, verification]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T08:54:46Z }
---

# Purpose

Reads a tool's code before it runs, with real parsers (`VER-01`): acorn for the JavaScript, parse5 for the HTML, which follows the HTML standard, as the browser does. Its first rules reduce the risk of the one way out the sandbox can't stop, as defence in depth ([ADR 0009](../../decisions/adr/0009-frames-and-navigation-in-generated-tools.md), amended). A frame or navigation to an outside address is refused by the browser, but only after it looks up the name, which can carry data. A tool steered by pasted text could use that.

# Entry points

- `src/checks/static-check.ts`: `staticCheck` checks a tool's code and gives a `StaticCheckResult`. On failure it lists each `StaticFinding`: the part, the line, and a message saying what to do instead, for repair (`GEN-09`). `checkHtml` and `checkJs` check one part, and the HTML rules live here.
- `src/checks/js-check.ts`: the JavaScript rules, with the tracking of which values may be the page or its elements.

# Invariants

- **No frames, embedded objects or script tags** (`SBX-06`): `<iframe>`, `<frame>`, `<object>`, `<embed>`, `<script>` (in SVG too), `<base>` and `<meta>`, in the HTML, in fixed HTML text written from the JavaScript, and created with `createElement`.
- **No navigation** (`SBX-07`):
  - links whose address isn't `#` or empty;
  - form actions, meta refresh and `ping`;
  - `location`, `history`, `navigation`, `window.open` and a bare `open`;
  - writing an address or a part of one (`href`, `host`, `hostname`, `protocol`, `pathname`, `action`, …), directly, in a pattern, or with `setAttribute`.
- **No code or HTML made at run time.** The tool's policy forbids `eval` but allows inline scripts, so a script or handler built from text would run unread. The check therefore refuses:
  - `on…` attributes, in the HTML or set from JavaScript;
  - script elements;
  - `eval`, `Function` and string timers;
  - `import()`, `DOMParser` and `createContextualFragment` with text built at run time;
  - `innerHTML`, `outerHTML` and `insertAdjacentHTML` with anything but fixed text, which must itself pass the HTML rules;
  - `document.write`, and `srcdoc`.
- **No name made at run time on the page or its elements.** The check follows which values may be the page or one of its elements, by name across the script, over-approximating:
  - the page's objects, and anything reached from them;
  - callbacks given to them (events, observers, `forEach` over elements), and the loop variables over them;
  - functions called with them, and functions that return them;
  - arrays, objects and maps that hold them;
  - `this` in a class that stores them;
  - if the tracking is still finding more after many rounds, everything, so it fails closed;
  - names the script never declares, since an element with an `id` is a global of that name.

  What crosses the bridge is plain data: the bridge's own calls (`tessera.call`, `send` and `assetUrl`, with the name written out) copy their arguments and results, and the page's objects can't be copied, so nothing given to or returned by them counts as the page. Nothing else reached through `tessera` is trusted. A tool may not declare a name `tessera` of its own, nor write anything onto `tessera`, which could pass the page off as the bridge.

  A property reached on any of these by a name made at run time is refused, and so are `Object.assign`, `keys`, `values` and `entries` on them, spreading them and `for…in` over them. Properties that only hold text, numbers or flags (`value`, `checked`, `textContent`, `dataset`, …) leave the page behind, so ordinary code isn't refused; plain data keeps its ordinary indexing (`totals[name]`, `records[i][field]`).
- **No way around the names.** The page's objects (`window`, `document`, `self`, `globalThis`, `top`, `parent`, `frames`, `opener`) may only be used as `window.something`, with the name written out: never stored, passed or destructured. The check also refuses:
  - `createElement` and `setAttribute` other than by a direct call with the name written out, so no `bind`, `call` or stored copy;
  - the forbidden APIs on any object (`window.eval`, `new window.DOMParser()`);
  - attribute nodes (`createAttribute`);
  - names that reach the page from an element (`ownerDocument`, `defaultView`, `contentWindow`, `getRootNode`);
  - `prototype`, `__proto__`, `Reflect`, and Object's descriptor and prototype methods;
  - classes extending the page's own;
  - `with`;
  - elements and attributes whose names are computed at run time.
- **`this` is the page except in a class's methods and fields.** A computed key in a class, an ordinary function nested in a method, and an object's method all run with a `this` that can be the page, and are refused.
- **The HTML is read in a body**, where the tool's HTML goes, so what the parser drops there (a `<frameset>`) makes no element and isn't reported.
- **Imported tools are checked too.** An archive whose tool fails is refused whole, and nothing is imported ([export and import](archives.md)).
- **Real tools pass.** The shopping-list fixture and every development sample pass: ordinary code (events, `textContent`, `items[i]`, `obj[key]`, `this` in a class, blob addresses for images) isn't refused.

# Depends on / used by

acorn and parse5, pinned exactly. The [export and import](archives.md) module refuses an archive whose tool fails it. The generation pipeline (#146) runs it on every candidate before staging, and its findings feed repair. The base prompt part tells the model these rules ([prompt assembly](prompts.md)).

# Pitfalls

- **These are `VER-01`'s first rules, not all of them.** Undeclared bridge actions and capabilities, unknown methods, writes at startup and reading the system clock come next (#148).
- **It runs on the server, before staging,** rather than as a staging check in the browser. It must also cover imports, which aren't staged, and code that fails never reaches the browser. #148's wording asked for the staging interface; the smoke check (#149) is the staging check.
- **It can refuse ordinary code.** Over-approximating is the safe direction: indexing a list of elements with a variable, or a value that only might be the page, is refused, and repair rewrites it (loop with `for…of` or `forEach`, reach elements by id). The base prompt says so.
- **It is defence in depth, not a closure** (ADR 0009, amended). A deliberately obfuscated leak can pass. Known gaps, from Codex's review of pull request 168, recorded rather than patched one by one:
  - properties and methods counted as plain by their name (such as `value` or `data`) whose value is an element the tool stored there;
  - a function passed by name as a callback, or called inline, receiving the page's objects;
  - `createElement` or `setAttribute` taken out of an object by destructuring, then called with `call`;
  - `Object` reached through an alias;
  - a name declared in one scope and used undeclared in another;
  - an attribute's value changed through its attribute node (`a.attributes.item(0).value = …`);
  - native copies of the page's objects (`{...document}`) read back without a computed name.

  A gap is fixed when the fix is cheap and simple; the closure is at the platform.
- **The rules are strict on purpose.** A real tool that needs something they refuse is a reason to revisit ADR 0009, not to loosen a rule quietly.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `checkHtml`, `checkJs`, `staticCheck`, `StaticCheckResult` (type), `StaticFinding` (type)
- `js-check.ts`: `JsFinding` (type), `checkJs`
- `static-check.ts`: `StaticFinding` (type), `StaticCheckResult` (type), `staticCheck`, `checkHtml`, `checkJs`
