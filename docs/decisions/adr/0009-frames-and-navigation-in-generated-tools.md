---
type: Decision
title: "ADR 0009. Frames and navigation in generated tools"
description: "Before generated tools run, ADR 0006's open limit is decided again: a tool steered by pasted data could leak a person's data through the names a blocked frame navigation makes the browser look up. The static check refuses frames, navigation, property names built at run time and code made at run time before any candidate or imported tool runs."
tags: [decisions, runtime, sandbox, security, generation]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T04:01:22Z }
---
# ADR 0009. Frames and navigation in generated tools

Proposed by Claude Code and decided by the owner on 2026-10-27 (option 3), for [issue 147](https://github.com/suredo/Tessera/issues/147). [ADR 0006](0006-dns-lookups-from-blocked-frame-navigations.md) accepted, for M1's hand-written tools, that a blocked frame navigation still makes Chrome and Edge look up the address's name, and asked for the question to be decided again before any generated tool runs.

## The risk with generated tools

A frame or navigation to an outside address is refused, but the browser first looks up its name (`SBX-06`, `SBX-07`). A tool that chooses the name can put data in it, for whoever runs that domain's name server: a slow, one-way way out. Nothing else leaves the sandbox: no request, no storage, no other frame (`SBX-01` to `SBX-05`).

In M1 no tool chose a name. A generated tool's code is written by the model, so the question is who could make the model write such a leak:
- **The model on its own:** unlikely. No request needs a frame or a navigation, and the base rules say the tool can't open other pages.
- **A request steered by pasted text** (`SEC-02`): the person pastes a web page, a document or an earlier answer, and hidden text asks the model to write code that sends the tool's data into a frame's address. This is the real threat. What could leak is that tool's own data: the person's records, which may be private (a budget, health notes).

The tool's CSP has no `unsafe-eval`, so `eval`, `Function` and string timers can't run code built from strings. It does allow `unsafe-inline`, which the tool's own code needs: a `<script>` element or an `on…` event handler made at run time, from text decoded at run time, would still run, and the check couldn't read it. So checking the source means something only if the check also refuses every way of making executable text at run time (below).

## Options

1. **Keep accepting it,** as in M1, relying on the prompt's rules.
2. **Hooks in the tool's preamble** (ADR 0006's option 3): replace frame creation, frame addresses and navigation with versions that refuse. A deliberate leak gets around them easily: frames inserted as HTML start loading before any hook can react, and a `srcdoc` frame has fresh, unhooked objects. They stop accidents, which are unlikely, and not a steered model, which is the threat.
3. **Refuse frames and navigation in the static check** (`VER-01`, #148), before any candidate runs:
   - **HTML:** `<iframe>`, `<frame>`, `<object>`, `<embed>`, `<meta http-equiv="refresh">`, and links whose address isn't `#` or empty.
   - **JavaScript:** creating or addressing those elements, assigning or calling `location`, `window.open`, `document.write`, and writing HTML that contains them (`innerHTML`, `outerHTML`, `insertAdjacentHTML`).
   - **Names built at run time:** reaching a property by a name computed at run time on `window`, `document`, `location` or an element, where the check can't see the name.
   - **Code made at run time:** creating a `script` element or setting a script's text or source; `on…` event handler attributes, in the HTML or set from JavaScript (`setAttribute`, or assigning a string to an `on…` property); and writing HTML that contains a `<script>` or an `on…` attribute. A tool listens with `addEventListener` and keeps all its code in its JavaScript, where the check reads it.

   No tool Tessera makes needs any of these, and a candidate that uses one is refused like any other failed check, so repair can fix it.
4. **Options 3 and 2 together:** the static check as the guard, and the hooks as a second, cheap layer for what the check can't see.

## Decision

**Option 3**, as recommended. It stops the steered-model case where the threat is, before the code runs, and every candidate passes it anyway (`RUN-03`). The rule against names built at run time closes the obvious ways around it. Option 4's hooks add maintenance and tests for little gain: anything that gets past the check can also get past the hooks.

What remains: the limit stays real for a tool whose source passes the check through a path nobody thought of. The threat model keeps listing it, now with this check in front of it, and the boundary suite gains cases where candidates are refused.

## Consequences

- #148's first version, needed for the first generated tool, includes these rules, with negative tests: each form in HTML and in JavaScript is refused, code made at run time included (a decoded script element, a string event handler), and an ordinary tool passes.
- **Imported tools too.** An imported tool is generated code from an unknown author (the threat model's imports limit), so #148 runs the same check on a version brought in by import before it can run. Until #148 lands, the limit stays open for imported tools, as it was in M1.
- **Until #148 lands, no generated tool runs.** The first one runs in the end-to-end slice, behind these checks.
- The threat model's entries for `SBX-06` and `SBX-07` name this ADR. ADR 0006 is marked as revisited.
- The base prompt already tells the model that tools open no other pages. It gains no new rule unless the live pilot shows candidates refused for this.
- **When to revisit:** if a real tool needs frames or links out; if the check is shown to be bypassed; or if the browsers stop resolving blocked navigations.
