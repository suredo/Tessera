# Decisions from M0 on

* [ADR 0001. Suggesting a checkpoint](0001-checkpoint-suggestions.md) - An assistant may suggest a checkpoint in one line, saying why; it never runs one unasked (decides D12).
* [ADR 0002. The Claude Code CLI contract](0002-claude-code-cli-contract.md) - What the M0 CLI spike found on Claude Code 2.1.296, and the rules it sets for passing schemas, flags, environment and sign-in to the CLI.
* [ADR 0003. The SQLite access layer](0003-sqlite-access-layer.md) - Tessera reaches its SQLite database through Node's built-in node:sqlite, with plain SQL, rows checked by the zod contracts, and numbered migration files.
* [ADR 0004. Nested frames in the sandbox](0004-nested-frames-in-the-sandbox.md) - Frames a tool nests inside its own: those from URLs, data:, blob:, objects and embeds don't load; srcdoc and javascript: frames may run, and must be exactly as confined as the tool (changes SBX-06).
