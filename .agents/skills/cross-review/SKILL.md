---
name: cross-review
description: "Review a Tessera pull request written by the other assistant: run the checks, report every item of the AI review checklist, and post the review on the pull request. Use when asked to review a pull request."
---

Follow the cross-review procedure in `docs/practices/assistants.md#cross-review` (ENG-15). It is the only definition of this workflow; these lines only point to it.

- The pull request is the one given with the command or named by the user. Without one, list the open pull requests and ask which is meant.
- If you wrote the pull request yourself, say so: ENG-15 has a fresh session of the same assistant review only when the other is unavailable.
- Change no files, push nothing and never merge. Post the review only in the format the procedure gives.
