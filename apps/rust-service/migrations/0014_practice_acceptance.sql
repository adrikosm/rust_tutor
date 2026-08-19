PRAGMA defer_foreign_keys = ON;

CREATE TABLE workbench_completion_v14 (
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    item_id TEXT NOT NULL,
    item_kind TEXT NOT NULL CHECK (item_kind IN ('algorithm', 'project_stage', 'exercise')),
    unlocked_item_id TEXT NOT NULL,
    evaluator_run_id TEXT NOT NULL UNIQUE REFERENCES evaluation_stream_run(run_id),
    workspace_checksum TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    PRIMARY KEY (learner_id, item_id)
) STRICT;

INSERT INTO workbench_completion_v14 (
    learner_id,
    item_id,
    item_kind,
    unlocked_item_id,
    evaluator_run_id,
    workspace_checksum,
    accepted_at
)
SELECT
    learner_id,
    item_id,
    item_kind,
    unlocked_item_id,
    evaluator_run_id,
    workspace_checksum,
    accepted_at
FROM workbench_completion;

DROP TABLE workbench_completion;
ALTER TABLE workbench_completion_v14 RENAME TO workbench_completion;
