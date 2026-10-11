# Key concepts

| Term | Meaning |
| --- | --- |
| **Tessera** (the host) | The app: chat, panels, storage, checks, and the link to the model. It owns all data and decides what is allowed. |
| **Tool** | An interface the person asked for: generated HTML, CSS and JavaScript that runs in the sandbox. |
| **Workspace** | One working session with one tool: the tool's current version, its data, its versions and its conversation. Every workspace is saved automatically, all the time (`DATA-08`). |
| **Version** | An immutable snapshot of a tool's code. Every accepted change creates a new version; older versions can be restored (`DATA-04`, `APP-05`). |
| **Data** | What the person put into a tool (items, entries, settings), kept by the host in the tool's declared shape (`DATA-03`). |
| **Asset** | A binary file a tool works with, such as a photo or an exported image. Stored once by its content and referenced from data by ID (`DATA-11`). |
| **Reusable defaults** | The tool's declared starting configuration, such as categories, units and empty collection shapes. Separate from session entries, original-request data and examples; used by **Use again** (`DATA-07`). |
| **Saved tool** | A named entry in the person's library ("Weekly shopping"), created with **Save to my tools**. It can be opened with **Continue** (the same workspace and data) or **Use again** (the same tool, fresh data, a new workspace) (`DATA-07`), and found by asking (`GEN-18`). |
| **Trash** | Where deleted workspaces and saved tools wait for 30 days before being removed for good (`DATA-09`). |
| **Verification profile** | An internal pattern the host knows how to test, such as "a list of items". Never shown as a tool (`VER-03`). |
| **Host capability** | Something a tool can ask the host for, such as the date and time, outside data, files, or a vetted library (`CAP-*`). |
| **Stage** | One model call in the pipeline (intent, acceptance, create, edit, repair, review). Every stage is recorded in the ledger (`OBS-01`). |
