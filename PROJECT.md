# Rust Tutor project guide

Rust Tutor is a private, offline-first learning workbench. The product is successful when a learner
can move from a source-backed mental model to compiler evidence, delayed recall, and a cumulative
project artifact without leaving the local application.

## Product boundaries

- One local learner; no accounts, telemetry, cloud dependency, or runtime LLM.
- Real Rust tools run locally. This is trusted local execution with resource limits, not a hostile
  code sandbox.
- Curriculum facts are immutable release data. Learner attempts, evidence, notes, and workspaces are
  local mutable state.
- Completion and mastery are separate: opening a page never produces mastery evidence.
- Source licenses and provenance are part of the content contract, not release-note decoration.

## Architecture

The React application consumes handwritten, Zod-validated `/api/v1` contracts from one Axum
service. The service embeds the reviewed curriculum release, runs Cargo/rustc/rust-analyzer in
bounded temporary workspaces, and stores learner events plus rebuildable projections in SQLite.

The canonical curriculum lives in `content/curriculum-v2/`. It owns modules, lessons, exercises,
project stages, evaluator contracts, and graph relationships. The generated release must be
reproducible from tracked inputs and must not depend on ignored local research files.

## Learning-path contract

Every published lesson contains observable objectives, prerequisites, a mental model, worked code,
misconceptions, recall-before-reveal checks, practice, project transfer, sources, completion rules,
and review metadata. Every runnable exercise has editable starter files, an allowlisted manifest,
visible and service-owned tests, progressive hints, an explanation, and a reference solution.

PULSE, QUAY, and TESSERA are the flagship sequence. Each stage evolves one learner workspace and
defines boundaries, non-goals, readiness, visible/hidden/regression evidence, required artifacts,
rubric, hints, checkpoint lineage, and unlock evidence.

## Definition of done

Run `pnpm all-checks`. A release is not complete if content counts, graph references, license
metadata, hidden-answer secrecy, offline evaluation, data export/import, keyboard use, reduced
motion, responsive layouts, or package verification fail.
