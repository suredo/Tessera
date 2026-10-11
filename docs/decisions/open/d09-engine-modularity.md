# D9. Engine modularity

Milestone M5, requirement `SIM-06`.

In five live runs Claude always built one combined engine, ignoring the guidance to split reusable parts (L-38).

| Option | Meaning |
| --- | --- |
| a. Guidance only | Accept combined engines; reuse happens when it happens |
| **b. Host-enforced split for known building blocks** | The library ships a few base engines (queue, arrivals). Creating a new engine that duplicates one is rejected, and the model is told to use the base engine |
| c. Always ask the model to plan modules first | An extra planning call before any engine creation |

**Recommendation: b**, decided properly when M5 starts.
