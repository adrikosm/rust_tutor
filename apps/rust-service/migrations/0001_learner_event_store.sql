CREATE TABLE content_release (
    release_id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    checksum TEXT NOT NULL UNIQUE,
    activated_at TEXT NOT NULL
) STRICT;

CREATE TABLE content_source (
    source_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES content_release(release_id),
    snapshot_hash TEXT NOT NULL,
    license_json TEXT NOT NULL CHECK (json_valid(license_json)),
    PRIMARY KEY (source_id, release_id)
) STRICT;

CREATE TABLE learner (
    learner_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE goal (
    goal_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    title TEXT NOT NULL,
    rank INTEGER NOT NULL CHECK (rank > 0),
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'complete')),
    UNIQUE (learner_id, rank)
) STRICT;

CREATE TABLE learning_session (
    session_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    goal_id TEXT REFERENCES goal(goal_id),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    run_id TEXT NOT NULL,
    request_id TEXT NOT NULL
) STRICT;

CREATE TABLE attempt (
    attempt_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES learning_session(session_id),
    item_id TEXT NOT NULL,
    item_version INTEGER NOT NULL CHECK (item_version > 0),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'submitted', 'evaluated', 'abandoned'))
) STRICT;

CREATE TABLE attempt_event (
    event_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    idempotency_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    occurred_at TEXT NOT NULL,
    run_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    UNIQUE (attempt_id, sequence)
) STRICT;

CREATE INDEX attempt_event_attempt_order_idx
    ON attempt_event (attempt_id, sequence, event_id);
CREATE INDEX attempt_event_trace_idx
    ON attempt_event (run_id, request_id, event_id);

CREATE TRIGGER attempt_event_no_update
BEFORE UPDATE ON attempt_event
BEGIN
    SELECT RAISE(ABORT, 'attempt_event is append-only');
END;

CREATE TRIGGER attempt_event_no_delete
BEFORE DELETE ON attempt_event
BEGIN
    SELECT RAISE(ABORT, 'attempt_event is append-only');
END;

CREATE TABLE artifact (
    artifact_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
    item_id TEXT NOT NULL,
    item_version INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    toolchain_json TEXT NOT NULL CHECK (json_valid(toolchain_json)),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE reflection (
    reflection_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE confidence (
    confidence_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
    phase TEXT NOT NULL CHECK (phase IN ('before', 'after')),
    value INTEGER NOT NULL CHECK (value BETWEEN 1 AND 5),
    recorded_at TEXT NOT NULL,
    UNIQUE (attempt_id, phase)
) STRICT;

CREATE TABLE evaluator_log (
    evaluator_run_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
    event_id TEXT REFERENCES attempt_event(event_id),
    run_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    status TEXT NOT NULL,
    toolchain_json TEXT NOT NULL CHECK (json_valid(toolchain_json)),
    detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
    created_at TEXT NOT NULL
) STRICT;

CREATE INDEX evaluator_log_trace_idx
    ON evaluator_log (run_id, request_id, attempt_id);

CREATE TABLE evidence (
    evidence_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE REFERENCES attempt_event(event_id),
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    concept_id TEXT NOT NULL,
    score REAL NOT NULL CHECK (score BETWEEN 0.0 AND 1.0),
    model_version TEXT NOT NULL,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE mastery_projection (
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    concept_id TEXT NOT NULL,
    score REAL NOT NULL CHECK (score BETWEEN 0.0 AND 1.0),
    model_version TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL CHECK (json_valid(evidence_ids_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (learner_id, concept_id)
) STRICT;

CREATE TABLE review_projection (
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    concept_id TEXT NOT NULL,
    due_at TEXT NOT NULL,
    model_version TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL CHECK (json_valid(evidence_ids_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (learner_id, concept_id)
) STRICT;

CREATE TABLE project_milestone_state (
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    project_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('locked', 'ready', 'active', 'submitted', 'accepted')),
    artifact_id TEXT REFERENCES artifact(artifact_id),
    evidence_ids_json TEXT NOT NULL CHECK (json_valid(evidence_ids_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (learner_id, project_id, stage_id)
) STRICT;

CREATE TABLE project_milestone_evidence (
    learner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
    PRIMARY KEY (learner_id, project_id, stage_id, evidence_id),
    FOREIGN KEY (learner_id, project_id, stage_id)
        REFERENCES project_milestone_state(learner_id, project_id, stage_id)
) STRICT;

CREATE TABLE projection_checkpoint (
    projection_name TEXT PRIMARY KEY,
    model_version TEXT NOT NULL,
    last_event_id TEXT,
    state_checksum TEXT NOT NULL,
    rebuilt_at TEXT NOT NULL
) STRICT;
