CREATE TABLE project_artifact_registration (
    registration_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    project_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    local_path TEXT,
    pasted_text TEXT,
    checksum TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK ((local_path IS NULL) <> (pasted_text IS NULL))
) STRICT;

CREATE TABLE project_checkpoint (
    checkpoint_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    project_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    parent_checkpoint_id TEXT REFERENCES project_checkpoint(checkpoint_id),
    workspace_checksum TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('starter', 'saved', 'submitted', 'accepted')),
    evaluator_run_id TEXT,
    regression_json TEXT NOT NULL CHECK (json_valid(regression_json)),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE journal_entry (
    entry_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    project_id TEXT,
    concept_id TEXT,
    error_id TEXT,
    support_json TEXT NOT NULL CHECK (json_valid(support_json)),
    confidence INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 5),
    reattempt_day INTEGER CHECK (reattempt_day IS NULL OR reattempt_day >= 0),
    created_at TEXT NOT NULL
) STRICT;

CREATE VIRTUAL TABLE journal_search USING fts5(
    entry_id UNINDEXED,
    title,
    body,
    project_id,
    concept_id,
    error_id,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE error_catalog (
    error_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    fingerprint TEXT NOT NULL,
    code TEXT NOT NULL,
    root_cause TEXT NOT NULL,
    correction TEXT NOT NULL,
    future_cue TEXT NOT NULL,
    concept_ids_json TEXT NOT NULL CHECK (json_valid(concept_ids_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (learner_id, fingerprint)
) STRICT;

CREATE TABLE error_occurrence (
    occurrence_id TEXT PRIMARY KEY,
    error_id TEXT NOT NULL REFERENCES error_catalog(error_id),
    attempt_id TEXT,
    evaluator_run_id TEXT,
    occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE focus_session (
    focus_session_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    mode TEXT NOT NULL CHECK (mode IN ('standard', 'deep_work', 'llm_free')),
    intention TEXT NOT NULL,
    interruption_notes_json TEXT NOT NULL CHECK (json_valid(interruption_notes_json)),
    end_review TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
) STRICT;

CREATE TABLE external_practice_bookmark (
    bookmark_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    platform TEXT NOT NULL,
    url_or_id TEXT NOT NULL,
    local_exercise_id TEXT,
    pattern_id TEXT,
    status TEXT NOT NULL,
    notes TEXT NOT NULL,
    support_json TEXT NOT NULL CHECK (json_valid(support_json)),
    confidence INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 5),
    reattempt_day INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;
