# Journeys every scenario set must cover

Each scenario covers several journeys. By M4 the set must cover all J0–J7. M2 intentionally omits automated hands-on `do` steps; M3 adds them. Earlier human exploratory sessions may exercise controls, with those observations labelled separately from automated evidence.

| | Journey | What it proves | POC evidence it guards against |
| --- | --- | --- | --- |
| J0 | **First run:** a clean Windows machine, the launcher, the setup check, the first tool | A tester gets from nothing to a first tool with plain guidance (`PLAT-02`, `PLAT-03`) | The POC needed manual CLI configuration (`claude.exe` path, sign-in) |
| J1 | **Create from nothing,** including stated starting data | A useful tool from one request (`GEN-05`, `UX-01`) | 120 stated guests were dropped; planners opened empty |
| J2 | **Grow it:** look-only, behavior, data and mixed requests | Each request goes to the right place and nothing else changes (`GEN-01`, `GEN-04`, `GEN-13`) | Style misrouted; behavior statements got questions; mixed requests lost a part |
| J3 | **Come back:** next day, reload, continue, use again, find a saved tool by asking ("open my shopping list") | Data, versions and the tool's place survive; saved tools are found, not rebuilt (`DATA-07`, `GEN-18`, `UX-07`) | Lost minimized state; browser-only storage |
| J4 | **A second, unrelated tool** | It opens separately; the first is untouched (`GEN-01`) | An unrelated request overwrote the current tool |
| J5 | **Mistakes:** undo interface, undo data, restore an older version, delete and restore from the trash | Undo and restore are safe and exact; nothing is lost (`DATA-04`, `DATA-09`) | Undo had to refuse overwriting newer work |
| J6 | **Limits:** ambiguous, impossible, cancel, very big | Honest answers, no invented data, recoverable (`GEN-08`, `GEN-17`, `UX-03`) | Fake success messages; 2-minute silent waits |
| J7 | **Hands-on:** use the tool's own controls, then change the same data through chat, and the reverse, including a chat change prepared while the person edits a different record | Controls and chat act on the same saved data and never contradict each other; unrelated edits never block each other (`DATA-02`) | Chat edits once changed the wrong record; a seeded write raced a user change |
