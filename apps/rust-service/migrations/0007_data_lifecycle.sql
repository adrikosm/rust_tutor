CREATE TABLE data_reset_event (
    reset_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    scope TEXT NOT NULL CHECK (scope IN ('module', 'lesson', 'all_progress')),
    target_id TEXT,
    backup_checksum TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK ((scope = 'all_progress' AND target_id IS NULL) OR (scope <> 'all_progress' AND target_id IS NOT NULL))
) STRICT;

CREATE TRIGGER data_reset_event_no_update BEFORE UPDATE ON data_reset_event BEGIN
    SELECT RAISE(ABORT, 'data_reset_event is append-only');
END;

CREATE TRIGGER data_reset_event_no_delete BEFORE DELETE ON data_reset_event BEGIN
    SELECT RAISE(ABORT, 'data_reset_event is append-only');
END;

CREATE TABLE data_import_ledger (
    import_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    archive_checksum TEXT NOT NULL,
    applied_rows INTEGER NOT NULL CHECK (applied_rows >= 0),
    backup_checksum TEXT NOT NULL,
    projection_checksum TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (learner_id, archive_checksum)
) STRICT;
