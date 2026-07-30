CREATE TABLE curriculum_node (
    release_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_text TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    checksum TEXT NOT NULL,
    PRIMARY KEY (release_id, node_id)
) STRICT;

CREATE TABLE curriculum_edge (
    release_id TEXT NOT NULL,
    edge_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    rationale TEXT NOT NULL,
    provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
    PRIMARY KEY (release_id, edge_id),
    FOREIGN KEY (release_id, source_id)
        REFERENCES curriculum_node(release_id, node_id) ON DELETE CASCADE,
    FOREIGN KEY (release_id, target_id)
        REFERENCES curriculum_node(release_id, node_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX curriculum_edge_source_idx
    ON curriculum_edge (release_id, source_id, kind, target_id);
CREATE INDEX curriculum_edge_target_idx
    ON curriculum_edge (release_id, target_id, kind, source_id);

CREATE VIRTUAL TABLE curriculum_search USING fts5(
    release_id UNINDEXED,
    node_id UNINDEXED,
    kind UNINDEXED,
    title,
    summary,
    source_text,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE content_import_checkpoint (
    release_id TEXT PRIMARY KEY,
    node_count INTEGER NOT NULL,
    edge_count INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    imported_at TEXT NOT NULL
) STRICT;
