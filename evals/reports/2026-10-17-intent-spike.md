# Intent spike: live run, 2026-10-17

Issue [#20](https://github.com/suredo/Tessera/issues/20), decision A33. The request set (31 requests, 9 categories, 11 not in English), the draft prompt and the runner are in `evals/spikes/intent/` ([code doc](../../docs/code/evals/intent-spike.md)). The owner reviewed the request set and approved 31 calls with a hard cap of 31. The run was rehearsed first against the fake claude.

Model claude-haiku-5-5, effort low; CLI 2.1.296 (Claude Code). Calls 31 (cap 31), failed 0, refused 0. Input 107,149 tokens (82,500 from cache), output 10,830, 80.0 s of model time. Every call took 2 turns.

Rates are over the planned requests; a request with no answer would count as blocked, never as left out (`ENG-07`). After the run, the scoring gained a check that each split part keeps the request's words; the run was scored again from its request log, with no call (`--rescore`).

| Category | Requests | Correct | Misrouted | Blocked | Misroute rate |
| --- | --- | --- | --- | --- | --- |
| create | 5 | 5 | 0 | 0 | 0% |
| open-saved | 3 | 3 | 0 | 0 | 0% |
| style | 6 | 6 | 0 | 0 | 0% |
| behavior | 4 | 4 | 0 | 0 | 0% |
| data | 2 | 2 | 0 | 0 | 0% |
| mixed | 3 | 2 | 1 | 0 | 33% |
| unrelated | 3 | 3 | 0 | 0 | 0% |
| clarify | 2 | 2 | 0 | 0 | 0% |
| unsupported | 3 | 3 | 0 | 0 | 0% |

**Overall: 1 misroute in 31 (3%).** Every non-English request was routed right, and its language tagged right.

## Misroutes

| ID | Category | Language | Request | Expected | Got |
| --- | --- | --- | --- | --- | --- |
| r22 | mixed | en | Add a table for the kids and put Ana and Leo at it. | mixed | data |

## Other differences

- r19 (data): dataPart reworded (to, shopping, list, remove, from, it)
- r20 (data): dataPart reworded (add, and, to, the, shopping, list)
- r22 (mixed): no interface part, which follows from its kind.

No other part, interface or data, added words that weren't in its request.

## Findings

1. **The POC's failure families are routed right by a defined, example-led prompt.** Style wording (L-16, L-20, including "waiting numbers" and non-English style), behavior statements (L-17), unrelated requests (L-18), saved tools (L-67) and unsupported requests all scored 0 misroutes. Defining each kind mattered: the CLI spike's first answer, without definitions or context, chose `new_tool` where `create` fits.
2. **The one misroute is a judgment call.** The seating planner already keeps tables as records, so "add a table for the kids" is arguably a data change. The expectation is as debatable as the answer.
3. **The split parts are not kept in the request's words** (lesson L-75), although the prompt asks for that. r19's data part was reworded ("Add cheese to the shopping list; remove the apples from it."), and r20's was half translated: "Add 2 litros de leite and 1 pão to the shopping list." The mixed parts (r21, r23) were kept as written. The data stage acts on that text, so a reworded or translated part can change what is done (the L-19 family). The answers for r19, r20 and r23 are kept as a replay fixture (`evals/spikes/intent/replays/l-75.json`), and a test checks that the scorer flags r19 and r20 and not r23 (`ENG-13`).
4. **The sample is small:** one answer moves a category of 3 by 33%. These rates show the prompt's direction, not its accuracy across real requests; M2 measures the production stage.

## For a design note before M2

- **Mixed against data** (the only category with a misroute): say how the stage decides when a request adds a record of a kind the tool already has ("a table", "a column") together with records for it, and add such cases to the M2 fixtures.
- **Keeping the request's words in the split parts** (`GEN-04`, L-75): the host checks each part against the request before using it, as the spike's scorer does (each word of the part appears in the request), and asks the intent stage again or asks the person when a part fails. Sending the whole request along with each part is ruled out: `GEN-04` says neither step sees the other's instruction. The replay fixture is the M2 split's first test case.

## Errors

None.
