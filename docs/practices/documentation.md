# Documentation

| ID | Rule |
| --- | --- |
| ENG-08 | Documentation has four kinds, each with one job. |

| Kind | Location | Rule |
| --- | --- | --- |
| Reference | The planning set in `docs/` (01–06) now; `docs/reference/` for implementation references (contracts, architecture) once code exists | The spec labels target requirements and delivery status. Implementation references describe current behavior only. Historical POC copies live in `docs/poc/`, are labelled, and are subordinate to the spec and decisions. Update with code; version/status metadata is allowed, but dated execution reports stay separate. |
| Decisions | [the decision log](../decisions/decision-log.md) for A1–A49; `docs/adr/NNNN-title.md` for new decisions from M0 on | The decision log stays as it is. Each new decision gets one ADR: context, decision, consequences. Never edited afterwards; superseded by a new ADR. |
| Evaluations and milestone reports | `evals/reports/YYYY-MM-DD-name.md` | Dated results of live runs, and each milestone's closing report (delivered, exit criteria, live costs, open issues) with the product owner's sign-off. Historical: never updated to look current. |
| Changelog | `CHANGELOG.md` | What changed per release (`ENG-23`). |

CI checks links and anchors, as the POC did. The README stays short: what the project is, how to run it, where the docs are.

On import, preserve a sanitized evidence index (run/date, provider, scope, measured result and available portable report/fixture). Missing raw evidence stays marked unavailable. Never turn a proposed fix into a measured success claim. The UI-standard version remains contract metadata.
