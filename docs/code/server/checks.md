---
type: Code Module
title: "Static check"
description: "Every candidate's and imported tool's code, parsed before it runs: sandbox, bridge, host-clock and bounded startup-write checks (ADR 0009, VER-01)."
resource: ../../../packages/server/src/checks/
implements: [SBX-06, SBX-07, RUN-07, VER-01]
tests: [../../../packages/server/test/static-check.test.ts, ../../../packages/server/test/archives.test.ts]
tags: [code, server, checks, security, verification]
status: draft
generated: { by: codex/gpt-6.1-sol, at: 2026-10-30T04:21:46Z }
---

# Purpose

Reads a tool's code before it runs, with real parsers (`VER-01`): acorn for the JavaScript, parse5 for the HTML, which follows the HTML standard, as the browser does. Its first rules reduce the risk of the one way out the sandbox can't stop, as defence in depth ([ADR 0009](../../decisions/adr/0009-frames-and-navigation-in-generated-tools.md), amended). A frame or navigation to an outside address is refused by the browser, but only after it looks up the name, which can carry data. A tool steered by pasted text could use that.

# Entry points

- `src/checks/static-check.ts`: `staticCheck` checks a tool's code with its actual artifact capabilities and gives a `StaticCheckResult`. On failure it lists each `StaticFinding`: the part, the line, and a message saying what to do instead, for repair (`GEN-09`). `checkHtml` and `checkJs` check one part, and the HTML rules live here.
- `src/checks/js-check.ts`: the JavaScript rules, with the tracking of which values may be the page or its elements.

# Invariants

- **Recognized bridge calls use the shared manifest** (`VER-01`). For references recognized as the host's bridge, the accepted form is a direct `tessera.method(...)` call with a written-out method name. Methods come from contracts' `BRIDGE_METHODS`; action names and capability requirements come from `BRIDGE_ACTIONS`. `call` needs fixed action text, and its action must exist and have its capability declared. `assetUrl` accepts a computed image ID and checks its fixed underlying action; `send` takes a message and `onMessage` a listener, without treating either as an action name. Create, edit and import pass the artifact's actual capabilities before storage/staging.
- **Direct bridge aliases fail at their source.** Storing, passing, returning, destructuring or computing the global `tessera` reference or its methods is refused with repair guidance, including `bind`, `call` and `apply`. Access through a recognized page-object path is refused too. Existing shadowing/write guards remain. This is restricted syntax, not complete JavaScript alias analysis: normal local objects may still have methods such as `call` or a `tessera` property, and the inherited page-tracking gaps below can conceal indirect bridge access. Existing prompt fixtures, development samples and sanitized live replays use direct calls; they provide no evidence that bridge aliases need support. These checks reuse the existing parsed tree walk without another convergence pass or dependency.
- **Current time comes from the host** (`RUN-07`). Bare `Date` and `.Date` reached through recognized page values may only construct a date with an explicit input, or reach fixed `parse`/`UTC` methods. `Date.now` references (including computed keys and borrowing), `Date()` calls even with arguments, zero-argument construction, and constructor aliases fail at their source. A constructor needs at least one non-spread argument because spreads alone may be empty. The repair diagnostic points to `tessera.call("clock.now")` and its capability from `BRIDGE_ACTIONS`; explicit-input construction, arithmetic and instance formatting remain available. Unrelated local `.Date` and `.now` properties pass. This reuses the parsed walk and page tracking without another analysis pass. Bare `Date` is treated conservatively across scopes, including shadowed names; local constructor aliases are deliberately unsupported.
- **Startup must not write data** (bounded `VER-01` coverage; supports `GEN-06`). The shared manifest's `writes` flag decides which recognized bridge actions write; no action list is copied. A separate walk of the same parsed tree follows startup calls through named functions, local aliases, object methods, callback parameters and IIFEs. Async functions, read continuations, timers, collection callbacks, Promise executors, default expressions, inherited constructors and host-message listeners count as startup. Direct `addEventListener` registrations for the analyzer's listed interaction events defer the listener body; expressions evaluated while registering it still run. Startup calls to `click`, `dispatchEvent` or `requestSubmit` conservatively invoke every registered interaction listener. A handler called separately during startup is checked too. Reads and event-only writes remain available, with source-line repair guidance directing starting entries to host-installed `initialState` or `reusableDefaults`.
- **Startup analysis is conservative and bounded.** Names and fixed property names merge across scopes and objects. Branches are not evaluated; all accessors and instance-field expressions count as startup, even if unused. This can reject harmless code. At 50 fixed-point rounds or 50,000 visited nodes, every parsed call is treated as startup, including event handlers; the budget cannot turn a write into a pass.
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

- **Bounded `VER-01` coverage.** These bridge, Date and bounded startup checks do not establish general JavaScript safety. Startup reachability does not follow dynamically returned functions, generators resumed through their iterator, aliased synthetic-event methods, or every implicit callback convention. Event-registration syntax is not proof of trusted interaction: the independent runtime phase guard still rejects writes before real interaction and throughout staging. Only the recognized Date namespace is covered: the clock checks do not extend to performance, Intl or Temporal APIs.
- **It runs on the server, before staging,** rather than as a staging check in the browser. It must also cover imports, which aren't staged, and code that fails never reaches the browser. #148's original staging-interface criterion was corrected to this existing ADR 0009 gate; the smoke check (#149) keeps the browser staging interface.
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
- **The same page-tracking gaps can hide bridge and Date checks.** A local parser probe confirmed that `const box = {value: window.valueOf()}; box.value.tessera.call('unknown.action');` produces no static finding: the inherited plain-property classification loses the global object at `.value`. Direct `window.valueOf().tessera` and `window.valueOf().Date.now()` are recognized and refused; hiding Date behind the same plain-property gap remains a deliberate-obfuscation limit. This records a known deliberate-obfuscation limit, not supported bridge syntax or a guarantee that the example will keep passing. The independent runtime bridge action/capability guards still reject unknown actions and undeclared capabilities; this static slice does not replace them.
- **The rules are strict on purpose.** A real tool that needs something they refuse is a reason to revisit ADR 0009, not to loosen a rule quietly.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `checkHtml`, `checkJs`, `staticCheck`, `StaticCheckResult` (type), `StaticFinding` (type)
- `js-check.ts`: `JsFinding` (type), `checkJs`
- `static-check.ts`: `StaticFinding` (type), `StaticCheckResult` (type), `staticCheck`, `checkHtml`, `checkJs`
