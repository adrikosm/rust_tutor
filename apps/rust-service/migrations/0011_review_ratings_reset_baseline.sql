CREATE TABLE review_rating (
    rating_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    concept_id TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
    day INTEGER NOT NULL CHECK (day >= 0),
    created_at TEXT NOT NULL
) STRICT;

CREATE INDEX review_rating_history_idx
    ON review_rating (learner_id, concept_id, day, created_at, rating_id);

CREATE TABLE data_reset_item (
    reset_id TEXT NOT NULL REFERENCES data_reset_event(reset_id),
    item_id TEXT NOT NULL,
    PRIMARY KEY (reset_id, item_id)
) STRICT;

CREATE TABLE final_exam_session_v2 (
    session_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    form_id TEXT NOT NULL,
    form_version TEXT NOT NULL,
    item_checksums_json TEXT NOT NULL CHECK (json_valid(item_checksums_json)),
    answers_json TEXT NOT NULL CHECK (json_valid(answers_json)),
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
    started_at TEXT NOT NULL,
    completed_at TEXT
) STRICT;
INSERT INTO final_exam_session_v2 SELECT * FROM final_exam_session;
DROP INDEX one_active_final_exam;
DROP TABLE final_exam_session;
ALTER TABLE final_exam_session_v2 RENAME TO final_exam_session;
CREATE UNIQUE INDEX one_active_final_exam
ON final_exam_session(learner_id)
WHERE status = 'active';

CREATE TABLE workbench_completion_v2 (
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    item_id TEXT NOT NULL,
    item_kind TEXT NOT NULL CHECK (item_kind IN ('algorithm', 'project_stage', 'lesson')),
    unlocked_item_id TEXT NOT NULL,
    evaluator_run_id TEXT NOT NULL UNIQUE REFERENCES evaluation_stream_run(run_id),
    workspace_checksum TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    PRIMARY KEY (learner_id, item_id)
) STRICT;
INSERT INTO workbench_completion_v2 SELECT * FROM workbench_completion;
DROP TABLE workbench_completion;
ALTER TABLE workbench_completion_v2 RENAME TO workbench_completion;
