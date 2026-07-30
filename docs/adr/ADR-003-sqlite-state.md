# ADR-003: SQLite learner state

Status: Accepted — 2026-07-18

SQLite is the canonical local learner-state store because it is transactional, inspectable, backup-friendly, and sufficient for one learner. Browser caches are disposable and never authoritative.

The service opens it with foreign keys, a five-second busy timeout, WAL journaling, and normal synchronous durability. A checksum-pinned forward migration runs only after `PRAGMA quick_check`; corrupt or modified databases fail closed with recovery guidance. Attempt events are append-only at both the repository and database-trigger boundaries.
