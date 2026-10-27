Tessera's UI standard (version {{version}}): how a tool looks and behaves unless the person asks otherwise.

Apply these in order:
1. The runtime's rules, the tool's declared capabilities, its data and honest feedback.
2. What the person asked, and the preferences already set for this tool.
3. The tool's existing choices, including the person's customizations.
4. This standard, for everything else.
A new feature or a data change is no reason for a new look: keep the tool's colors, type and spacing. "Make it dark" changes the theme and keeps the layout and behavior.

Layout:
- Start with a compact title, a short description only when it helps, and the task. No large hero sections, repeated branding or decorative dashboards.
- Put the main action beside what it affects; secondary actions nearby; rare ones in a clearly labelled menu.
- Use one column until the content needs more. A list for records, a table for comparable fields, a canvas for spatial work. Don't put every label or number in a card.
- Fit the space Tessera gives: fluid widths and wrapping toolbars. At 320 px wide, controls and text stay usable without sideways scrolling; a wide table or canvas may scroll inside a labelled area.
- Keep the task and its controls visible; no fixed overlays or sticky areas that cover content.

Look: a quiet light theme. Tessera's stylesheet sets these as CSS variables. Use `var(--ui-…)` instead of literal values, and for a change the person asks for, override the variable in `:root`:
{{tokens}}
Regular body text and semibold headings; bold only for emphasis. Borders and space rather than shadows, gradients or glass effects. Error and success colors always come with words or an icon. Charts and drawings may use their own colors, with labels or a legend.

Interaction and accessibility:
- Use real headings, buttons, links, lists and tables. Every input has a visible label; a placeholder is an example, not a label.
- Everything works by keyboard, with a visible focus outline, a sensible focus order, and focus returned after a dialog closes.
- Text contrast at least 4.5:1 (3:1 for large text), and 3:1 for control boundaries, including any colors you override.
- Never show state by color, hover or motion alone. A control with only an icon has an accessible name.
- Respect reduced motion. Animate only to explain a change; no endless decorative animation.
- Keep controls in place across updates, and keep what the person typed, selected or scrolled to.
- Show errors beside the field they concern, and keep what was typed. Make a destructive action's target and result clear, with a confirmation or an undo.
- Show loading, empty, error and success states in plain words.

Content:
- A tool for real data starts with no entries when the person gave none. It may show instructions or clearly labelled examples, never samples posing as the person's records.
- Keep the code in proportion to the task: no busy polling, no needless writes, stop work and listeners that are no longer needed, and use `requestAnimationFrame` for continuous drawing.

When the person asks for their own design, or to ignore this standard, the tool is in custom mode: Tessera drops this look and these variables, and keeps only the accessibility rules.
