---
type: Decision
title: "ADR 0006. DNS lookups from blocked frame navigations"
description: "A blocked frame navigation in the sandbox still makes Chrome and Edge resolve and connect to its address: accepted as a known limit of CSP for M1, with a partial runtime block to reconsider at the start of M2."
tags: [decisions, runtime, sandbox, security]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-21T23:14:08Z }
---
# ADR 0006. DNS lookups from blocked frame navigations

Decided by the owner on 2026-10-21, on [issue 72](https://github.com/suredo/Tessera/issues/72), found by the boundary checks of [issue 45](https://github.com/suredo/Tessera/issues/45). It sets how the [threat model](../../spec/threat-model.md) treats this limit, and what `SBX-06` and `SBX-07` check.

## Context

When a tool sends a frame to an address its policy blocks, Chrome and Edge resolve the address's name and open a TCP connection to it before refusing the navigation. This happens for a nested frame with a URL, and for the tool's own frame. No HTTP request is sent, and nothing else a tool tries opens anything (`SBX-01` to `SBX-05`). Because the tool chooses the name, the name can carry data to whoever runs that domain's DNS: a slow, one-way way out.

This is a known limit of CSP, not a new browser bug. CSP governs what a page loads, not which names the browser resolves. Data leaking through DNS lookups under a strict CSP was shown in 2016 ([Van Acker, Hausknecht and Sabelfeld, "Data Exfiltration in the Face of CSP"](https://www.cse.chalmers.se/~andrei/asiaccs16.pdf)). The standards work since has been about the browser hints for early lookups (`dns-prefetch`, `preconnect`; w3c/webappsec-csp issue 282, whatwg/fetch issue 683). A search found no Chromium bug for this exact path, a blocked frame navigation, as of 2026-10-21. Headers and settings a page controls don't stop it, and neither did Chrome's prediction switches.

## Options

1. **Accept it as a known limit,** listed with the other limits of trusting the browser.
2. **Report it to Chromium.**
3. **Block it partly in the runtime:** hooks in the tool's preamble that refuse creating frames with a URL or navigating away. A determined tool can get around hooks in its own script (ADR 0004), so this lowers the risk without closing it.

## Decision

Option 1 for M1. In M1, every tool is hand-written, so no tool chooses a name to leak. Reporting it (option 2) is left to the owner, since a report goes out under the owner's account; this record keeps the measurements and references for one. **Option 3 is reconsidered at the start of M2,** before generated tools run, together with the threat of a tool steered by data a person pastes in (`SEC-02`).

## Consequences

- `SBX-06` and `SBX-07` check that no request arrives, which holds; they don't require no connection. `SBX-01` to `SBX-05` require no connection at all, and pass.
- The threat model lists the limit and names this record. Tessera doesn't claim that a tool can cause no network activity: it can't send requests, but it can make the browser look up a name it chooses.
- **When to revisit:** at the start of M2 (option 3); if Chrome or Edge stop resolving blocked frame navigations, which the browser tests would show once they count connections again; or if CSP gains a way to block it.
