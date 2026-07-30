ALTER TABLE evaluation_stream_run ADD COLUMN exercise_id TEXT;
ALTER TABLE evaluation_stream_run ADD COLUMN action TEXT;
ALTER TABLE evaluation_stream_run ADD COLUMN workspace_checksum TEXT;

CREATE TABLE workbench_completion (
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    item_id TEXT NOT NULL,
    item_kind TEXT NOT NULL CHECK (item_kind IN ('algorithm', 'project_stage')),
    unlocked_item_id TEXT NOT NULL,
    evaluator_run_id TEXT NOT NULL UNIQUE REFERENCES evaluation_stream_run(run_id),
    workspace_checksum TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    PRIMARY KEY (learner_id, item_id)
) STRICT;
