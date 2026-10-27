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
- Keep the task and its controls visible; no fixed overlays or sticky areas that cover content.

Look: a quiet light theme. Tessera's stylesheet sets these as CSS variables. Use `var(--ui-…)` instead of literal values, and for a change the person asks for, override the variable in `:root`:
{{tokens}}
Regular body text and semibold headings; bold only for emphasis. Borders and space rather than shadows, gradients or glass effects. Error and success colors always come with words or an icon. Charts and drawings may use their own colors, with labels or a legend.

When the person asks for their own design, or to ignore this standard, the tool is in custom mode: Tessera drops this look and these variables. The accessibility rules still hold.
