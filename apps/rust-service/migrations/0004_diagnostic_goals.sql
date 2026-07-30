CREATE TABLE diagnostic_session (
    diagnostic_session_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    release_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'complete')),
    answers_json TEXT NOT NULL CHECK (json_valid(answers_json)),
    placement_json TEXT CHECK (placement_json IS NULL OR json_valid(placement_json)),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    retake_of TEXT REFERENCES diagnostic_session(diagnostic_session_id)
) STRICT;

CREATE UNIQUE INDEX one_active_diagnostic_per_release
    ON diagnostic_session(learner_id, release_id) WHERE status = 'active';

CREATE TABLE learner_plan (
    learner_id TEXT PRIMARY KEY REFERENCES learner(learner_id),
    goal_id TEXT NOT NULL,
    goal_title TEXT NOT NULL,
    horizon_weeks INTEGER NOT NULL CHECK (horizon_weeks BETWEEN 1 AND 156),
    weekly_capacity_hours INTEGER NOT NULL CHECK (weekly_capacity_hours BETWEEN 1 AND 80),
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE gap_override (
    override_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    diagnostic_session_id TEXT NOT NULL REFERENCES diagnostic_session(diagnostic_session_id),
    outcome_id TEXT NOT NULL,
    requested_status TEXT NOT NULL CHECK (requested_status IN ('open', 'optional', 'priority')),
    explanation TEXT NOT NULL,
    created_at TEXT NOT NULL
) STRICT;
