---
type: Practice
title: "Definition of done"
description: "When a change counts as done (ENG-09)."
tags: [practices, definition-of-done]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Definition of done

| ID | Rule |
| --- | --- |
| ENG-09 | A change is done when: (1) its acceptance criteria pass in tests named by requirement ID; (2) CI is green; (3) the cross-assistant review is posted and its findings resolved or answered; (4) the docs it affects are updated, including code docs for the modules it changes (`ENG-24`), their frontmatter `generated` field and a line in `docs/log.md`, and the OKF check passes; (5) any lesson it addresses is marked in the lessons document; (6) no new warnings; (7) user-facing text is reviewed for plain language. Live-evaluation results, when used, are linked. |
