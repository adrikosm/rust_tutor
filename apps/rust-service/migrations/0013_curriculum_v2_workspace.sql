CREATE TABLE learner_support_event (
    learner_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    support TEXT NOT NULL CHECK (support IN ('full_reveal')),
    occurred_at TEXT NOT NULL,
    PRIMARY KEY (learner_id, item_id, support, occurred_at)
) STRICT;

CREATE TABLE project_workspace_revision (
    learner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    files_json TEXT NOT NULL CHECK (json_valid(files_json) AND json_type(files_json) = 'object'),
    workspace_checksum TEXT NOT NULL CHECK (length(workspace_checksum) = 64),
    checkpoint INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint IN (0, 1)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (learner_id, project_id, stage_id, revision)
) STRICT;

CREATE INDEX project_workspace_latest
ON project_workspace_revision(learner_id, project_id, stage_id, revision DESC);
