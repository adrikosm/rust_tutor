CREATE TABLE final_exam_session (
    session_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    form_id TEXT NOT NULL,
    form_version TEXT NOT NULL,
    item_checksums_json TEXT NOT NULL CHECK (json_valid(item_checksums_json)),
    answers_json TEXT NOT NULL CHECK (json_valid(answers_json)),
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
    started_at TEXT NOT NULL,
    completed_at TEXT
) STRICT;

CREATE UNIQUE INDEX one_active_final_exam
ON final_exam_session(learner_id)
WHERE status = 'active';
