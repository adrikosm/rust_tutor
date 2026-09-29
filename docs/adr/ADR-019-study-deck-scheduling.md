# ADR-019: Study deck scheduling and randomised segment tests

Status: Accepted — 2026-09-29

The `/study` surface adds per-chapter, per-strand, and mixed tests plus an authored flashcard deck.
It is separate from the concept review queue governed by ADR-008, which is unchanged.

**Tests.** Each chapter owns a compiler-verified question bank (`apps/web/src/features/study/bank`)
of static items and parameterised generators. A form is a pure function of segment, seed, and
local item history: stratified by topic (chapter tests) or by chapter (strand and mixed tests,
which interleave), preferring unseen and previously missed items, excluding the previous form's
items when the pool allows, with about a third freshly generated variants and shuffled options.
Pass mark is 80%, matching the final exam. Test scores are practice evidence only; they never
write mastery evidence.

**Flashcards.** Successive relearning over fixed, expanding intervals of 1 · 3 · 7 · 21 · 45 · 90
days. New cards need two correct first-session retrievals before graduating; a failed card
re-enters the session and restarts at one day; only the first grade of a day moves a card, so
same-day repetition never inflates an interval. The ladder extends ADR-008's bands to 45 and 90
days because the deck holds atomic facts meant for long-term retention. An adaptive (FSRS-style)
model stays deferred under the same evidence gate as ADR-008.

**Persistence.** Study state is stored in versioned, Zod-validated browser storage with JSON
export/import, the same local-cache pattern the from-zero course uses. This is a recorded
exception to ADR-003: moving study attempts and card schedules into SQLite (so they join the
service's backup, export, and reset lifecycle) is the planned follow-up.

**Verification.** `pnpm content:verify-study-bank` compiles every code item with rustc, runs
output items, checks declared error codes and panics, and samples every generator. Answer keys
ship in the web bundle, like chapter stops, because these are self-assessment items rather than
scored exam evidence.
