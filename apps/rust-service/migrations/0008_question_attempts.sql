CREATE TABLE quiz_attempt_event (
    attempt_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    question_id TEXT NOT NULL,
    question_version INTEGER NOT NULL CHECK (question_version > 0),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    result_json TEXT NOT NULL CHECK (json_valid(result_json)),
    score REAL NOT NULL CHECK (score BETWEEN 0.0 AND 1.0),
    correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
    support_json TEXT NOT NULL CHECK (json_valid(support_json)),
    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 5),
    created_at TEXT NOT NULL
) STRICT;

CREATE INDEX quiz_attempt_question_history_idx
    ON quiz_attempt_event (learner_id, question_id, question_version, created_at, attempt_id);

CREATE TRIGGER quiz_attempt_event_no_update BEFORE UPDATE ON quiz_attempt_event BEGIN
    SELECT RAISE(ABORT, 'quiz_attempt_event is append-only');
END;

CREATE TRIGGER quiz_attempt_event_no_delete BEFORE DELETE ON quiz_attempt_event BEGIN
    SELECT RAISE(ABORT, 'quiz_attempt_event is append-only');
END;
