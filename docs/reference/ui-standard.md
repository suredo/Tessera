# Default UI standard

> **Reference copy from the Harness POC.** File, script and command names from the POC were replaced with plain component names, so this document stands alone; the POC repository is not needed. Where it says "the POC", it describes how the POC did it, as input for Tessera's own design.

**Tessera adoption:** the [spec](../02-spec.md) and [accepted decisions](../05-open-decisions.md) govern the new implementation. Defaults apply only where the user has not specified a style; explicit custom styles remain supported. The enforcement description below records the POC, not functionality already implemented in Tessera. Port the design and test the guarantees independently.

Version 1.2 · 2026-10-10 · Enforced design contract

## Purpose and adoption

Every generated interface should feel like part of Harness while adapting to its task. Use this standard for creation, edits and repairs unless the user explicitly changes the relevant preference. This defines presentation and interaction defaults, not a fixed app template: generate the controls, layout and behavior the task needs.

## Enforcement

The POC injected its source document automatically. Tessera must implement that integration under VER-06; merely copying this reference file does not enable it.

- **Prompts.** the UI standard module reads this file at startup and inserts the sections from "Priority and user control" through "LLM checklist" into every generation, edit and repair prompt. Strict CSS-only edits receive the priority rules and visual defaults. The planner is told to keep the standard unless the user asks otherwise. Editing this file changes the prompts after a server restart.
- **Host stylesheets.** The POC loaded accessibility styles and, in standard mode, default tokens/element styles before the interface CSS. Important layered declarations protect specified focus and reduced-motion properties; this alone does not prove focus visibility or all accessibility requirements. Tessera must test actual rendering, contrast and focus. Default `--ui-*` tokens and helpers use a lower cascade layer to allow explicit customization.
- **Static check.** Before activation, the host rejects clear violations: unlabeled inputs, buttons with no accessible name, buttons that duplicate host controls, text under 12px, control targets under 40px, non-system fonts, decorative gradients, glass effects, and unrequested `--ui-*` token changes. Global text/theme declarations on `html`, `body`, headings, `:root` and universal selectors must use tokens or equivalent defaults unless a visual change is requested. Domain-specific colors on chart/diagram elements remain allowed. Explicit visual requests permit theme changes, but compact/custom requests still retain the 40px control floor. Non-visual edits reject deletion of existing token overrides and changes/removal of authored global theme declarations, including custom designs. The violations go back to repair stages as diagnostics. Existing violations are grandfathered rather than forcing migration. This check compares source declarations conservatively; it does not compute cascade, prove contrast/target sizes, recognize equivalent CSS rewrites or guarantee every scoped/dynamic style follows the standard.
- **Custom layouts.** When the user explicitly asks for a custom/own design or to ignore the standard, the model starts `styles.css` with `/* ui-standard: custom */`. The host then skips the default stylesheet and the visual checks. Accessibility checks and the accessibility stylesheet still apply. The marker is rejected when the request did not ask for it, and is kept on later edits until the user asks to return to the standard.
- **Modes.** Each artifact records `generation.uiStandard = {version, mode}`. The mode is `standard`, `custom`, or `legacy`. Interfaces created before enforcement edit as `legacy`: they get no default stylesheet but are still checked for new violations. A request such as "apply the UI standard" switches them to `standard`. A setting chooses `enforce` (default), `warn` (record up to 10 violations in `generation.uiStandard.warnings` without blocking), or `off` (no prompt section, no check, no default stylesheet).

The POC synchronized this token table and its stylesheet through tests. Tessera should generate the stylesheet, prompt and checks from one token definition (P3), with the rendered documentation verified against it.

## Priority and user control

Apply requirements in this order:

1. Runtime contracts, declared capabilities, data integrity and truthful feedback.
2. The user's explicit request and previously established preferences for this interface.
3. The existing interface's choices, including intentional user customizations.
4. This standard for all remaining decisions.

A new task, data update or feature request does not authorize a new visual style. “Add flashcards” should preserve the palette, typography and spacing. “Make it dark” authorizes a theme change while preserving unrelated layout and behavior. “Make it easier to scan” permits relevant hierarchy and spacing changes without inventing other preferences.

An interface-specific change applies to that interface. Change the shared standard only when the user explicitly asks for a global/default change. Do not silently propagate a local preference to other workspaces. If a requested visual preference conflicts with accessibility, explain the concrete conflict and use the closest accessible treatment.

Future editing of the shared standard should version the rules and distinguish application to new interfaces from migration of existing ones. No settings editor or stored global preference profile exists. Per-interface preferences live in that interface's own CSS, for example token overrides in `:root`, and the host check preserves them on later edits.

## Ownership and layout

- Harness owns chat, workspace switching, minimize/expand/fullscreen, resume, save/reuse, version undo, code inspection, usage and provider selection. Never duplicate these controls inside generated content.
- Generated content owns task controls: filters, forms, comparison, study navigation, playback-related task controls or simulation settings supported by its declared APIs.
- Start with a compact title, a short description only when useful, and the primary task area. Avoid oversized hero sections, repeated app branding and ornamental dashboards.
- Put the primary action beside the content it affects. Group secondary actions nearby; place rare actions in a clearly labeled menu when necessary.
- Use one column until the content genuinely benefits from columns. Prefer a list for records, a table for comparable fields and a canvas for spatial work. Do not wrap every label or metric in a card.
- Size to the host's available space. Use fluid widths, wrapping toolbars and content-driven breakpoints. At roughly 320 CSS pixels wide, ordinary controls and text must remain usable without horizontal page scrolling. Wide tables/canvases may use a labeled local scroll region or fit controls.
- Keep the active task and relevant controls visible; avoid fixed overlays or sticky regions that cover content. Let the host determine the interface's placement relative to chat.

## Visual defaults

Use a quiet light theme that follows the host's warm neutral and green direction. The following values are generated-content defaults; they do not claim that every current host style already follows these rules.

| Token | Default |
| --- | --- |
| Font | `"Segoe UI", Arial, sans-serif`; no downloaded fonts |
| Background / surface | `#f9faf8` / `#ffffff` |
| Main / secondary text | `#28312b` / `#586153` |
| Decorative divider | `#e4e7e1`; not sufficient alone for input boundaries |
| Control boundary | `#81867e` |
| Accent / soft accent | `#526947` / `#ddebcc` |
| Error / success text | `#a12622` / `#35613d`; accompany with text or an icon |
| Body / secondary / section / title | `16px` / `14px` / `18px` / `22px` |
| Body line height | `1.5` |
| Spacing scale | `4, 8, 12, 16, 24, 32px` |
| Panel / control radius | `12px` / `8px` |
| Typical content padding | `16px`; `12px` in narrow containers |
| Interactive target | At least `40px` high; prefer `44px` for touch |

The host stylesheet provides these values as `--ui-*` variables. Use `var(--ui-*)` rather than literal values, and override a token in `:root` for a user-requested change, so later changes stay small and consistent. Use regular body text and semibold headings; reserve bold for emphasis. Use borders before shadows. Avoid decorative gradients, glass effects, large animations and unrelated accent colors by default. Use system/native controls where practical, with clear hover, focus, disabled and selected states.

Charts and anatomical/spatial views may need domain-specific colors. Provide labels or legends and preserve the surrounding UI style. Do not sacrifice meaningful visualization to force every data series into green.

## Interaction and accessibility

- Use semantic headings, buttons, links, lists and tables. Associate a visible label with each input; placeholders are examples, not labels.
- Every action must work with keyboard input. Show a visible focus outline on all interactive controls. Use logical focus order and return focus appropriately after closing a dialog.
- Aim for text contrast of at least 4.5:1, or 3:1 for large text, and 3:1 for meaningful control indicators. Verify actual foreground/background combinations, including overrides; token values alone are not proof.
- Never communicate state solely through color, hover or animation. Give icon-only controls accessible names and a discoverable label.
- Respect reduced-motion preferences. Animate only when motion explains state or serves the task; avoid perpetual decorative animation.
- Keep controls stable across updates. Preserve input drafts, selection, navigation and scroll where compatible with the requested change.
- Use inline validation beside the relevant field. Keep entered values on failure. For destructive actions, make the target and consequence clear and provide confirmation or a reliable undo proportionate to the action.
- Show loading, empty, error and success states in plain language. Say what happened and what the user can do next. Do not claim an action succeeded before the host accepts it.
- Task UI and chat must operate the same host-held data. Use declared host actions for persistence; do not invent a separate durable store or hide writes in rendering callbacks.

## Content and performance

Use the user's requested language; otherwise follow the conversation language. Keep labels short and consistent. Hide internal field names, model routes and implementation details from task UI unless explicitly requested for a developer tool.

Keep real-data collections empty when the user supplies no entries. A useful initial screen can still show instructions, meaningful reusable defaults or clearly labelled examples (UX-01); never present samples as the person's actual records. Use again retains reusable defaults only, excluding session entries and samples (DATA-07). Never present generated claims or simulated results as verified observations. Educational simulations must state their simplifications and limits.

Keep dependencies and DOM size proportionate to the task. Do not add remote assets or libraries outside the runtime contract. Avoid busy polling and redundant state writes. Use `requestAnimationFrame` for continuous rendering, stop work when disposed, clean up listeners/resources and offer pause for simulations. Preserve the one-active-runtime lifecycle. Browser rendering still has CPU/GPU cost; this standard does not promise browser-independent performance.

## LLM checklist

Before returning a generated candidate:

1. Identify the task, existing user preferences and the exact requested changes.
2. Preserve unrelated code, data, permissions and customized appearance.
3. Apply the default tokens and interaction rules only where no override exists.
4. Include usable narrow layouts, keyboard/focus behavior and relevant failure states.
5. Keep host controls outside the task UI and use the declared runtime APIs.
6. Check that visible controls perform their advertised actions and feedback reflects accepted results.
7. State any unverified behavior honestly. This checklist does not replace runtime validation or behavior checks.

The host inserts the priority rules, token table and interaction rules into generation prompts and carries existing overrides through the current source, so repairs do not erase user choices.
