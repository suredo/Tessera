---
type: Open Decision
title: "D11. Outside data for medium apps"
description: "Which outside data sources tools can use (decide at the start of M4)."
tags: [decisions, outside-data]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# D11. Outside data for medium apps

Requirement: `CAP-02`. **Deferred, with a deadline: decided at the start of M4** (A42), before the movie finder (T7) is built and tested. Generated tools cannot use the network, so outside data always comes through host-owned providers. Which ones is open. There is a lot of content available, and the right sources depend on what the tests need.

Candidates noted so far:
- YouTube (Data API, needs a key). Its player needs a nested frame, which the sandbox blocks (`RUN-01`), so in the first release thumbnails arrive through the host as assets and videos open on YouTube (`CAP-02`)
- Internet Archive (free, no key; the POC's video provider)
- Public APIs for articles and papers (OpenAlex, Crossref, arXiv)
- Wikipedia and Wikidata

Rules any provider must follow are in `CAP-02`: host-owned, cached, records carry their source, and only the requested search terms/filters are sent. No unrelated workspace contents are forwarded. Part of this decision: whether host-proxied playback of a provider's media is worth adding later.
