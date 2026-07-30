CREATE TABLE evaluation_stream_run (
    run_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'cancelled', 'interrupted', 'failed')),
    chunks_json TEXT NOT NULL CHECK (json_valid(chunks_json)),
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;
