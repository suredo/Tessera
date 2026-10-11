---
type: Practice
title: "Evidence, secrets and data"
description: "Test outputs, evidence, secrets, data folders and the image and video rules (ENG-10, ENG-19)."
tags: [practices, evidence]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Evidence, secrets and data

| ID | Rule |
| --- | --- |
| ENG-10 | **Test outputs and evidence.** Test outputs (videos, screenshots, logs) go to a gitignored `test-output/` folder, and runs older than the last few are pruned automatically. Evidence worth keeping (live evaluation reports, replay fixtures) is committed in `evals/` in a sanitized, portable form. Nothing needed to reproduce a test lives only on one machine. Images and video follow the rules below, so the repository stays small (A48). |
| ENG-19 | **Secrets and data separation.** No credentials, API keys, tokens or personal data are ever committed; CLI sign-ins are never copied. Fixtures and replay exports are sanitized before committing. Development, automated tests and live evaluations each use their own data folder, chosen by configuration; none ever touches the real user data folder (`PLAT-04`). A pre-commit check and CI scan for likely secrets. |

## Images and video in the repository

| What | Where | Rule |
| --- | --- | --- |
| Screenshots cited by a report | `evals/reports/<report>/` | Only the ones the report cites, as WebP or optimized PNG, aimed at under 300 KB each |
| Videos and full screenshot sets | A GitHub release per milestone (`evidence-m2`, …) | Never committed. Zipped and attached to the release; the milestone report links to it |
| Test fixture images | `evals/fixtures/assets/` | Small, generated or owned by you, with metadata (such as photo location) stripped |
| Images in docs | `docs/images/` | Diagrams as SVG or Mermaid in Markdown where possible; screenshots as WebP |

The pre-commit check refuses video files and any image over 1 MB. Git LFS is not used for now. The running app's own images (photos people open in tools) never go in the repository: they live in the asset store in the user data folder (`DATA-11`).
