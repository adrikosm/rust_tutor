# ADR-002: One Axum service

Status: Accepted — 2026-07-18

Run one loopback-only Axum process, organized into modules inside one crate. Split crates or processes only when a tested ownership, deployment, or compile-time boundary requires it.
