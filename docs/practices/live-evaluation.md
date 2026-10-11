# Live evaluation protocol

| ID | Rule |
| --- | --- |
| ENG-07 | Live model calls follow this protocol. |

1. **Plan:** list required scenarios, AI-dependent versus deterministic steps, calls per stage, repair reserves, reviewer calls and expected tokens. Reconcile with the roadmap envelope and approve the actual hard cap. Schedule large runs to fit the plan's usage windows. Freeze scoring denominators; blocked required steps remain counted. No automatic budget increase.
2. **Rehearse:** run the exact script in dry-run mode, with canned replies and zero cost (`OBS-02`). Fix script problems first.
3. **Run:** use a separate port and the evaluation data folder, never the person's real data (`ENG-19`). The budget guard refuses calls past the cap.
4. **Stop rules:**
   - **Step 1 fails:** stop the run. Later steps would only spend calls with nothing to build on.
   - **A step fails twice:** stop that step, fix the cause offline, and ask before spending more.
   - **Provider errors** (sign-in, unavailable model): stop.
   - **Usage limit reached:** pause. Resume the remaining scenarios after the limit resets, without re-running scenarios that already finished.
5. **Record:** keep the call ledger, request log, diagnostics, screenshots, video and a short written result, with the cost: calls, input tokens (cached), output tokens and model seconds.
6. **Learn:** every defect gets a lessons entry, a replay test (`ENG-13`) and a fix.

Reference costs from the POC (Claude Sonnet 5.5, medium effort):
- Creating a complex tool: about 105–131 s, 9–10k input and 15–19k output tokens.
- An edit: about 20–60 s.
- A data action (Haiku): 5–12 s.
- Research: 34–85 s, 13–90k input tokens.
