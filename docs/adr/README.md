# Architecture decision records

These accepted decisions define the product baseline. Changes append a new ADR that supersedes an earlier record; released history is not rewritten.

| ADR | Decision |
|---|---|
| [ADR-001](ADR-001-spa-and-rust-backend.md) | Static TanStack SPA with one Rust backend |
| [ADR-002](ADR-002-one-axum-service.md) | One modular loopback Axum service |
| [ADR-003](ADR-003-sqlite-state.md) | SQLite is canonical learner state |
| [ADR-004](ADR-004-versioned-curriculum.md) | Versioned Markdown and manifests are curriculum source |
| [ADR-005](ADR-005-append-only-events.md) | Append-only events and rebuildable projections |
| [ADR-006](ADR-006-sqlite-learning-graph.md) | SQLite adjacency-list learning graph |
| [ADR-007](ADR-007-prerequisite-dag-only.md) | Only prerequisites must be acyclic |
| [ADR-008](ADR-008-fixed-review-intervals.md) | Fixed review intervals precede adaptive scheduling |
| [ADR-009](ADR-009-trusted-local-runner.md) | MVP runner is local trusted-content execution |
| [ADR-010](ADR-010-no-runtime-llm.md) | No runtime LLM requirement in MVP |
| [ADR-011](ADR-011-sqlite-fts5.md) | Search starts with SQLite FTS5 |
| [ADR-012](ADR-012-handwritten-dtos.md) | Handwritten narrow API DTOs first |
| [ADR-013](ADR-013-validation-boundaries.md) | Rust validates content; Zod validates browser boundaries |
| [ADR-014](ADR-014-four-knowledge-layers.md) | Four durable research and learning layers |
| [ADR-015](ADR-015-authoring-tools-noncanonical.md) | Wiki/graph authoring tools are noncanonical |
| [ADR-016](ADR-016-restricted-workbench.md) | Monaco and rust-analyzer form a restricted workbench |
| [ADR-017](ADR-017-cumulative-original-projects.md) | Cumulative projects use original or separately licensed content |
| [ADR-018](ADR-018-separate-capacity-plans.md) | Product and learner progression have separate plans |
