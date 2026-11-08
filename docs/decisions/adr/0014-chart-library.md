---
type: Decision
title: "ADR 0014. The chart library: a host helper over Chart.js"
description: "The first vetted library (CAP-04, A25): tools draw charts through a small declarative host helper, which renders with a pinned Chart.js, styles charts by the UI standard, gives screen readers the data, and records what it drew so the chart profile's check can verify it."
tags: [decisions, capabilities, charts, verification]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-08T22:10:06Z }
---
# ADR 0014. The chart library: a host helper over Chart.js

M3's first vetted library (`CAP-04`, A25), needed by T3's spending chart and the chart profile (`VER-03`). The approach is the owner's choice of 2026-11-08, from three options put to them.

## Context

A tool runs in a sandbox with no network (`RUN-01`), so a library has to be injected by the host. A25 settled that there would be a few pinned, reviewed libraries, a chart library first, each added by an ADR, styled by the UI standard where it draws (`VER-06`) and updated deliberately. Three things shape the choice beyond that:

- **The chart profile must check what was drawn** (`VER-03`). A chart drawn on a canvas is pixels: nothing on the page says which values it shows, so a check can only look at numbers shown elsewhere.
- **Screen readers must get the data,** as the smoke check's accessibility floor asks of every tool's fields, buttons and images (`VER-02`). A canvas chart is invisible to them unless the tool adds text.
- **The UI standard must style it** in standard mode, with colors and type from the standard's tokens rather than whatever a model picks; a tool in custom mode, made for an explicit design request, styles itself (`VER-06`), and its stylesheet layer isn't loaded (`RUN-05`).

## Options

| Option | For | Against |
| --- | --- | --- |
| **A host helper over Chart.js** (chosen) | Tools call a small declarative API; the host draws, styles, describes and records the chart. The check can verify it, and the library can be swapped later without changing tools | The model learns a small API from a prompt part; only the chart types the helper offers |
| Chart.js used directly | Models already write Chart.js fluently; least prompt text, most flexible | Canvas output the check can't verify; styling and accessibility depend on the model; tools tied to Chart.js's API |
| A host SVG helper, no library | No dependency; accessible and inspectable | More host code to build and maintain; only basic chart types |

## Decision

1. **Tools draw charts only through the host's helper.** A tool that declares the `chart` capability gets `tessera.chart(element, spec)`, a method beside the bridge's others, where `spec` is declarative: the chart's type (bar, line, pie or doughnut to start), its title, its labels and one or more named series of numbers, with bounds on how many of each. A tool never reaches Chart.js itself; the static check (`VER-01`) refuses code that names it, so the library stays the host's to change.
2. **The host renders with a pinned Chart.js 4**, installed through the lockfile at an exact version and loaded into the tool's page only when the tool declares `chart`. Animation is off, so a chart is drawn when the call returns.
3. **Styling follows the tool's mode** (`VER-06`, `RUN-05`). The spec carries no colors or fonts. In standard mode, a chart's colors, type and spacing come from the standard's tokens in the standard stylesheet. In custom mode that stylesheet isn't loaded, so the helper reads chart colors and type from CSS custom properties the tool sets for its own design (named in the capability's prompt text, such as a series palette, text and grid colors), and falls back to the standard's palette, which the helper carries itself, for any the tool leaves unset. Contrast in custom mode is the tool's design, as for the rest of a custom-mode tool; the hidden data table (4) is there in both modes.
4. **Screen readers get the data:** beside each chart the helper keeps a visually hidden table of its labels and series.
5. **The helper records what it drew,** so a behavior check can ask, through the driver, which spec each hooked element's chart shows (`VER-03`). The page's answer is the page's word, like every check's (`checks.ts`).
6. **Updates are deliberate:** a new Chart.js version comes in its own pull request, reviewed like any change, with the chart tests rerun in Chrome and Edge.

## Consequences

- **New pieces:** the `chart` capability in the bridge contract and its prompt text, generated from one definition (`CON-03`, `P3`); the helper in the runtime; the static check's rule; a chart step in the driver; and the chart profile with its check, built on them, in later pull requests.
- **Security:** Chart.js runs inside the tool's sandbox with the tool's own privileges, so it widens nothing the tool could already do; it makes no requests. The threat model's note that vetted libraries weren't covered in M1 is updated when the helper lands.
- **Size:** Chart.js is about 70 KB gzipped (to be confirmed at the pinned version), paid only by tools that draw charts.
- **Limits:** chart types beyond the helper's need a change to the helper, not just a prompt. Animation and interaction (tooltips on hover) are left out at first.
