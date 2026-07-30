ALTER TABLE evidence ADD COLUMN item_id TEXT NOT NULL DEFAULT '';
ALTER TABLE evidence ADD COLUMN variant_group TEXT NOT NULL DEFAULT '';
ALTER TABLE evidence ADD COLUMN kind TEXT NOT NULL DEFAULT 'recall';
ALTER TABLE evidence ADD COLUMN support_json TEXT NOT NULL DEFAULT '"none"' CHECK (json_valid(support_json));
ALTER TABLE evidence ADD COLUMN observed_day INTEGER NOT NULL DEFAULT 0 CHECK (observed_day >= 0);
ALTER TABLE evidence ADD COLUMN critical_misconception INTEGER NOT NULL DEFAULT 0 CHECK (critical_misconception IN (0, 1));
ALTER TABLE evidence ADD COLUMN primary_outcome INTEGER NOT NULL DEFAULT 1 CHECK (primary_outcome IN (0, 1));

ALTER TABLE mastery_projection ADD COLUMN state TEXT NOT NULL DEFAULT 'not_started'
    CHECK (state IN ('not_started', 'exposed', 'practicing', 'provisional', 'retained', 'needs_confirmation'));
ALTER TABLE mastery_projection ADD COLUMN explanation_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(explanation_json));

ALTER TABLE review_projection ADD COLUMN due_day INTEGER NOT NULL DEFAULT 0 CHECK (due_day >= 0);
ALTER TABLE review_projection ADD COLUMN interval_index INTEGER NOT NULL DEFAULT 0 CHECK (interval_index BETWEEN 0 AND 3);
ALTER TABLE review_projection ADD COLUMN reason TEXT NOT NULL DEFAULT 'Awaiting evidence';

CREATE TABLE scheduler_snapshot (
    snapshot_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id),
    model_version TEXT NOT NULL,
    generated_day INTEGER NOT NULL CHECK (generated_day >= 0),
    recommendations_json TEXT NOT NULL CHECK (json_valid(recommendations_json)),
    created_at TEXT NOT NULL
) STRICT;

CREATE INDEX evidence_learning_model_idx
    ON evidence (learner_id, concept_id, observed_day, evidence_id);
