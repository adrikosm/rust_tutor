-- From-zero course chapter progress. One row per (learner, chapter) holding the
-- set of cleared checkpoint stops and whether the chapter's terminal was run
-- and accepted. Durable across browser-storage clears; respects data resets via
-- the shared reset-baseline timestamp filter used by other progress reads.
CREATE TABLE course_chapter_progress (
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    chapter_id TEXT NOT NULL,
    cleared_stops TEXT NOT NULL DEFAULT '[]',
    ran INTEGER NOT NULL DEFAULT 0 CHECK (ran IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (learner_id, chapter_id)
) STRICT;
