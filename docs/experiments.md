# Post-v1 experiment decisions

Reviewed 2026-07-18. These are explicit gate decisions, not hidden backlog. None is enabled in the local v1 runtime.

| Experiment | Current decision | Evidence gate before reconsideration |
|---|---|---|
| FSRS | Deferred | At least 1,000 versioned atomic-review responses across 100 items; held-out chronological replay must improve calibration or due-load without weakening retained transfer evidence. |
| Bayesian Knowledge Tracing | Deferred | Identifiable parameters, calibration data, an interpretable rules-model comparison, and no replacement of the evidence timeline. |
| Local generative Socratic help | Deferred | Separate opt-in threat/privacy design, offline model feasibility, provenance logging, and a hard prohibition on scoring or mastery awards. |
| Wasmtime evaluator | Deferred | A compatible exercise subset plus capability, resource-limit, advisory, and native-fallback tests. |
| Docker/OCI evaluator images | Rejected by owner | Reconsider only if native trusted-local execution becomes insufficient for a concrete supported exercise; image production is not part of the project build or release path. |
| Graph overview or fuzzy search | Deferred | Recorded search misses or navigation studies that the focused graph and SQLite FTS cannot satisfy within the measured latency budget. No second datastore is approved. |
| Windows package | Deferred | Named owner/use case, Windows CI hardware, toolchain/runner parity, installer recovery, and accessibility acceptance. |
| Live Kafka/Flink or multi-service Iceberg | Deferred | A project need that deterministic simulations and local fixtures cannot meet, plus acceptable install, resource, reset, and recovery cost. QUAY's local Iceberg stages remain in the core graph. |
| Public or multi-user operation | Rejected for current architecture | A separate isolation, authentication, privacy, abuse, tenancy, and operations architecture. The trusted local runner must never be exposed directly. |

The decision process is deliberately one-way for v1: unmet gates keep the feature absent. A future change requires an ADR, repeatable evidence, a rollback path, and updated threat/support matrices.
