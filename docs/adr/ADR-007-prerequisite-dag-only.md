# ADR-007: Prerequisite DAG only

Status: Accepted — 2026-07-18

Only `prerequisite_of` must be acyclic. Semantic relationships such as `confusable_with`, `similar_to`, and `transfers_to` may form cycles and must retain their reviewed direction and rationale.
