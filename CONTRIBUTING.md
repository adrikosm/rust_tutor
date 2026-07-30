# Contributing to Rust Tutor

## Before changing code

Read `PROJECT.md`, `docs/architecture.md`, `docs/content-authoring.md`, and the ADRs relevant to the
surface you are changing. Preserve unrelated working-tree changes and stable curriculum IDs.

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm all-checks
```

Use the existing React, Axum, SQLite, and standard-library patterns before adding a dependency. Keep
Monaco route-lazy and all learner execution offline. New API responses require a Rust DTO and a Zod
decoder; answer keys, hidden tests, and reference solutions must never appear in ordinary lesson or
practice responses.

## Curriculum contributions

1. Add or update the source ledger entry with canonical URL, pinned version or hash, license, use
   decision, attribution, import date, and change notes.
2. Author the lesson/exercise/project record in `content/curriculum-v2/`.
3. Connect it to outcomes and the graph with stable IDs, reviewed direction, rationale, and
   provenance.
4. Add visible, hidden, and regression evidence for anything marked runnable or scored.
5. Run the curriculum-v2 validator and the full quality gate.

Rust Book material may be synthesized with attribution under MIT/Apache-2.0. Mainmatter material is
CC BY-NC 4.0 and may only enter the noncommercial content pack. LeetCode content is link-only:
prompts, examples, constraints, tests, editorials, solution structure, and assets must be independently
authored locally.

## Review checklist

- The learner can tell what to do, why now, and what evidence proves completion.
- Keyboard, screen-reader, 200% zoom, forced-colors, reduced-motion, light, dark, and narrow layouts
  remain usable.
- Graph and curriculum references resolve and prerequisite edges remain acyclic.
- Existing learner progress and export/import remain compatible.
- Tests fail before the change and pass after it; no solution or hidden-test data leaks through API
  fixtures, logs, or UI state.
