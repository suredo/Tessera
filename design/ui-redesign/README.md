# UI redesign mockups

Static, self-contained HTML references for the approved host app redesign, from Codex's third design round on 2026-11-20. Scope and decisions live in `docs/roadmap/ui-redesign.md`; these pages do not establish implemented product behavior or accessibility compliance. Open `overview.html` first.

Render all seven states and the overview offline with `node design/ui-redesign/render.mjs design/ui-redesign test-output/ui-redesign`. The renderer creates the output folder. To select files, pass a JSON job list as the third argument, for example `'[["a-focus.html",1440,900]]'`. Desktop files use 1440x900, phone files 390x844, and the overview 1600x1000. Final product checks also cover 1280 and 320 px.

To compare the app with these mockups (`ENG-32`), run `pnpm build`, then `pnpm design:compare`, optionally followed by state names such as `c-chat-docked`. Each mockup and the app in the same state go side by side into `test-output/design-compare/<state>.png`: the app at 1280 px for desktop states and 320 px for phone states, each mockup at its own size above, scaled to the same width. That scaling hides differences in size, so the run also makes `<state>.same-size.png`, both at the mockup's own size, and `<state>.differences.txt`, what it measures there.
