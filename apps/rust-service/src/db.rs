use std::{
    collections::HashSet,
    ffi::OsStr,
    path::{Path, PathBuf},
    str::FromStr,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{
    Row, Sqlite, SqlitePool, Transaction,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use tracing::Instrument;

use crate::learning::{self, EvidenceKind, MasteryState, Observation, Support};

const MIGRATION_1: &str = include_str!("../migrations/0001_learner_event_store.sql");
const MIGRATION_2: &str = include_str!("../migrations/0002_learning_models.sql");
const MIGRATION_3: &str = include_str!("../migrations/0003_curriculum_graph_search.sql");
const MIGRATION_4: &str = include_str!("../migrations/0004_diagnostic_goals.sql");
const MIGRATION_5: &str = include_str!("../migrations/0005_projects_journal.sql");
const MIGRATION_6: &str = include_str!("../migrations/0006_final_exam.sql");
const MIGRATION_7: &str = include_str!("../migrations/0007_data_lifecycle.sql");
const MIGRATION_8: &str = include_str!("../migrations/0008_question_attempts.sql");
const MIGRATION_9: &str = include_str!("../migrations/0009_evaluation_streams.sql");
const MIGRATION_10: &str = include_str!("../migrations/0010_workbench_progress.sql");
const MIGRATION_11: &str = include_str!("../migrations/0011_review_ratings_reset_baseline.sql");
const MIGRATION_12: &str = include_str!("../migrations/0012_course_progress.sql");
const MIGRATION_13: &str = include_str!("../migrations/0013_curriculum_v2_workspace.sql");
const RECOVERY: &str = "The learner database is unreadable. Keep the file for recovery, restore a known-good backup, or move it aside before restarting; no mutation was attempted.";

#[derive(Debug)]
pub struct DbError(String);

impl std::fmt::Display for DbError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for DbError {}

fn db_error(context: &str, error: impl std::fmt::Display) -> DbError {
    DbError(format!("{context}: {error}. {RECOVERY}"))
}

pub fn default_database_path() -> Result<PathBuf, DbError> {
    if let Some(directory) = std::env::var_os("RUST_TUTOR_DATA_DIR") {
        let directory = PathBuf::from(directory);
        if !directory.is_absolute() {
            return Err(DbError(
                "RUST_TUTOR_DATA_DIR must be an absolute private path".to_owned(),
            ));
        }
        return Ok(directory.join("rust-tutor.sqlite3"));
    }
    database_path_for(
        std::env::consts::OS,
        std::env::var_os("HOME").as_deref(),
        std::env::var_os("LOCALAPPDATA").as_deref(),
        std::env::var_os("XDG_DATA_HOME").as_deref(),
    )
}

fn database_path_for(
    os: &str,
    home: Option<&OsStr>,
    local_app_data: Option<&OsStr>,
    xdg_data_home: Option<&OsStr>,
) -> Result<PathBuf, DbError> {
    let path = match os {
        "macos" => PathBuf::from(home.ok_or_else(|| DbError("HOME is unavailable".to_owned()))?)
            .join("Library/Application Support/Rust Tutor"),
        "windows" => PathBuf::from(
            local_app_data.ok_or_else(|| DbError("LOCALAPPDATA is unavailable".to_owned()))?,
        )
        .join("Rust Tutor"),
        _ => xdg_data_home
            .map_or_else(
                || {
                    home.map(PathBuf::from)
                        .map(|path| path.join(".local/share/rust-tutor"))
                },
                |path| Some(PathBuf::from(path).join("rust-tutor")),
            )
            .ok_or_else(|| DbError("HOME and XDG_DATA_HOME are unavailable".to_owned()))?,
    };
    Ok(path.join("rust-tutor.sqlite3"))
}

#[derive(Clone)]
pub struct Database {
    pool: SqlitePool,
    path: Option<PathBuf>,
}

impl Database {
    pub async fn open(path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| db_error("cannot create application-data directory", error))?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(5));
        Self::connect(options, 4, Some(path.to_path_buf())).await
    }

    pub async fn open_memory() -> Result<Self, DbError> {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .map_err(|error| db_error("invalid in-memory database URL", error))?
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Memory)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(5));
        Self::connect(options, 1, None).await
    }

    async fn connect(
        options: SqliteConnectOptions,
        max_connections: u32,
        path: Option<PathBuf>,
    ) -> Result<Self, DbError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await
            .map_err(|error| db_error("cannot open learner database", error))?;
        let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&pool)
            .await
            .map_err(|error| db_error("learner database integrity check failed", error))?;
        if integrity != "ok" {
            return Err(DbError(format!(
                "learner database integrity check returned {integrity}. {RECOVERY}"
            )));
        }
        if let Some(database_path) = path.as_deref() {
            backup_before_schema_upgrade(&pool, database_path).await?;
        }
        run_migrations(&pool).await?;
        sqlx::query("UPDATE evaluation_stream_run SET state='interrupted',updated_at=CURRENT_TIMESTAMP WHERE state IN ('queued','running')")
            .execute(&pool)
            .await
            .map_err(query_error)?;
        Ok(Self { pool, path })
    }

    pub async fn import_runtime_graph(
        &self,
        graph: &crate::graph::RuntimeGraph,
    ) -> Result<Value, DbError> {
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT checksum FROM content_import_checkpoint WHERE release_id = ?",
        )
        .bind(&graph.release_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(query_error)?;
        if existing.as_deref() == Some(graph.checksum.as_str()) {
            return Ok(serde_json::json!({
                "releaseId":graph.release_id,
                "nodeCount":graph.nodes.len(),
                "edgeCount":graph.edges.len(),
                "changed":false
            }));
        }

        let mut transaction = self.pool.begin().await.map_err(query_error)?;
        sqlx::query(
            "INSERT INTO content_release(release_id, version, checksum, activated_at) VALUES (?, '0.1.0', ?, CURRENT_TIMESTAMP) ON CONFLICT(release_id) DO UPDATE SET version=excluded.version, checksum=excluded.checksum, activated_at=excluded.activated_at",
        )
        .bind(&graph.release_id)
        .bind(&graph.checksum)
        .execute(&mut *transaction)
        .await
        .map_err(query_error)?;

        let node_ids: HashSet<_> = graph.nodes.iter().map(|node| node.id.as_str()).collect();
        let edge_ids: HashSet<_> = graph
            .edges
            .iter()
            .map(|edge| edge.edge_id.as_str())
            .collect();
        let existing_edges: Vec<String> =
            sqlx::query_scalar("SELECT edge_id FROM curriculum_edge WHERE release_id = ?")
                .bind(&graph.release_id)
                .fetch_all(&mut *transaction)
                .await
                .map_err(query_error)?;
        for edge_id in existing_edges {
            if !edge_ids.contains(edge_id.as_str()) {
                sqlx::query("DELETE FROM curriculum_edge WHERE release_id = ? AND edge_id = ?")
                    .bind(&graph.release_id)
                    .bind(edge_id)
                    .execute(&mut *transaction)
                    .await
                    .map_err(query_error)?;
            }
        }
        let existing_nodes: Vec<String> =
            sqlx::query_scalar("SELECT node_id FROM curriculum_node WHERE release_id = ?")
                .bind(&graph.release_id)
                .fetch_all(&mut *transaction)
                .await
                .map_err(query_error)?;
        for node_id in existing_nodes {
            if !node_ids.contains(node_id.as_str()) {
                sqlx::query("DELETE FROM curriculum_search WHERE release_id = ? AND node_id = ?")
                    .bind(&graph.release_id)
                    .bind(&node_id)
                    .execute(&mut *transaction)
                    .await
                    .map_err(query_error)?;
                sqlx::query("DELETE FROM curriculum_node WHERE release_id = ? AND node_id = ?")
                    .bind(&graph.release_id)
                    .bind(node_id)
                    .execute(&mut *transaction)
                    .await
                    .map_err(query_error)?;
            }
        }

        for node in &graph.nodes {
            let payload =
                serde_json::to_string(node).map_err(|error| DbError(error.to_string()))?;
            let checksum = format!("{:x}", Sha256::digest(payload.as_bytes()));
            let prior: Option<String> = sqlx::query_scalar(
                "SELECT checksum FROM curriculum_node WHERE release_id = ? AND node_id = ?",
            )
            .bind(&graph.release_id)
            .bind(&node.id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(query_error)?;
            let source_text = std::iter::once(node.id.as_str())
                .chain(node.provenance_ids.iter().map(String::as_str))
                .collect::<Vec<_>>()
                .join(" ");
            sqlx::query(
                "INSERT INTO curriculum_node(release_id,node_id,kind,title,summary,source_text,payload_json,checksum) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(release_id,node_id) DO UPDATE SET kind=excluded.kind,title=excluded.title,summary=excluded.summary,source_text=excluded.source_text,payload_json=excluded.payload_json,checksum=excluded.checksum WHERE curriculum_node.checksum <> excluded.checksum",
            )
            .bind(&graph.release_id)
            .bind(&node.id)
            .bind(&node.kind)
            .bind(&node.title)
            .bind(&node.summary)
            .bind(&source_text)
            .bind(&payload)
            .bind(&checksum)
            .execute(&mut *transaction)
            .await
            .map_err(query_error)?;
            if prior.as_deref() != Some(checksum.as_str()) {
                sqlx::query("DELETE FROM curriculum_search WHERE release_id = ? AND node_id = ?")
                    .bind(&graph.release_id)
                    .bind(&node.id)
                    .execute(&mut *transaction)
                    .await
                    .map_err(query_error)?;
                sqlx::query("INSERT INTO curriculum_search(release_id,node_id,kind,title,summary,source_text) VALUES (?,?,?,?,?,?)")
                    .bind(&graph.release_id)
                    .bind(&node.id)
                    .bind(&node.kind)
                    .bind(&node.title)
                    .bind(&node.summary)
                    .bind(&source_text)
                    .execute(&mut *transaction)
                    .await
                    .map_err(query_error)?;
            }
        }
        for edge in &graph.edges {
            sqlx::query(
                "INSERT INTO curriculum_edge(release_id,edge_id,source_id,target_id,kind,rationale,provenance_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(release_id,edge_id) DO UPDATE SET source_id=excluded.source_id,target_id=excluded.target_id,kind=excluded.kind,rationale=excluded.rationale,provenance_json=excluded.provenance_json",
            )
            .bind(&graph.release_id)
            .bind(&edge.edge_id)
            .bind(&edge.source_id)
            .bind(&edge.target_id)
            .bind(&edge.kind)
            .bind(&edge.rationale)
            .bind(serde_json::to_string(&edge.provenance_ids).expect("provenance JSON"))
            .execute(&mut *transaction)
            .await
            .map_err(query_error)?;
        }
        sqlx::query(
            "INSERT INTO content_import_checkpoint(release_id,node_count,edge_count,checksum,imported_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(release_id) DO UPDATE SET node_count=excluded.node_count,edge_count=excluded.edge_count,checksum=excluded.checksum,imported_at=excluded.imported_at",
        )
        .bind(&graph.release_id)
        .bind(i64::try_from(graph.nodes.len()).expect("node count fits i64"))
        .bind(i64::try_from(graph.edges.len()).expect("edge count fits i64"))
        .bind(&graph.checksum)
        .execute(&mut *transaction)
        .await
        .map_err(query_error)?;
        transaction.commit().await.map_err(query_error)?;
        Ok(serde_json::json!({
            "releaseId":graph.release_id,
            "nodeCount":graph.nodes.len(),
            "edgeCount":graph.edges.len(),
            "changed":true
        }))
    }

    pub async fn portable_export(&self, learner_id: &str) -> Result<Value, DbError> {
        async fn rows(
            pool: &SqlitePool,
            sql: &'static str,
            learner_id: &str,
        ) -> Result<Value, DbError> {
            let encoded: String = sqlx::query_scalar(sql)
                .bind(learner_id)
                .fetch_one(pool)
                .await
                .map_err(query_error)?;
            serde_json::from_str(&encoded)
                .map_err(|error| DbError(format!("portable export JSON failed: {error}")))
        }
        let sessions = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('sessionId',session_id,'goalId',goal_id,'startedAt',started_at,'endedAt',ended_at,'runId',run_id,'requestId',request_id)),'[]') FROM learning_session WHERE learner_id=? ORDER BY session_id", learner_id).await?;
        let attempts = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('attemptId',a.attempt_id,'sessionId',a.session_id,'itemId',a.item_id,'itemVersion',a.item_version,'startedAt',a.started_at,'completedAt',a.completed_at,'status',a.status)),'[]') FROM attempt a JOIN learning_session s ON s.session_id=a.session_id WHERE s.learner_id=? ORDER BY a.attempt_id", learner_id).await?;
        let events = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('eventId',e.event_id,'attemptId',e.attempt_id,'sequence',e.sequence,'idempotencyKey',e.idempotency_key,'kind',e.kind,'payload',json(e.payload_json),'occurredAt',e.occurred_at,'runId',e.run_id,'requestId',e.request_id)),'[]') FROM attempt_event e JOIN attempt a ON a.attempt_id=e.attempt_id JOIN learning_session s ON s.session_id=a.session_id WHERE s.learner_id=? ORDER BY e.attempt_id,e.sequence,e.event_id", learner_id).await?;
        let artifacts = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('artifactId',r.artifact_id,'attemptId',r.attempt_id,'itemId',r.item_id,'itemVersion',r.item_version,'checksum',r.checksum,'toolchain',json(r.toolchain_json),'createdAt',r.created_at)),'[]') FROM artifact r JOIN attempt a ON a.attempt_id=r.attempt_id JOIN learning_session s ON s.session_id=a.session_id WHERE s.learner_id=? ORDER BY r.artifact_id", learner_id).await?;
        let reflections = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('reflectionId',r.reflection_id,'attemptId',r.attempt_id,'body',r.body,'createdAt',r.created_at)),'[]') FROM reflection r JOIN attempt a ON a.attempt_id=r.attempt_id JOIN learning_session s ON s.session_id=a.session_id WHERE s.learner_id=? ORDER BY r.reflection_id", learner_id).await?;
        let plans = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('goalId',goal_id,'goalTitle',goal_title,'horizonWeeks',horizon_weeks,'weeklyCapacityHours',weekly_capacity_hours,'updatedAt',updated_at)),'[]') FROM learner_plan WHERE learner_id=? ORDER BY goal_id", learner_id).await?;
        let journal = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('entryId',entry_id,'kind',kind,'title',title,'body',body,'projectId',project_id,'conceptId',concept_id,'errorId',error_id,'support',json(support_json),'confidence',confidence,'reattemptDay',reattempt_day,'createdAt',created_at)),'[]') FROM journal_entry WHERE learner_id=? ORDER BY created_at,entry_id", learner_id).await?;
        let errors = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('errorId',error_id,'fingerprint',fingerprint,'code',code,'rootCause',root_cause,'correction',correction,'futureCue',future_cue,'conceptIds',json(concept_ids_json),'createdAt',created_at,'updatedAt',updated_at)),'[]') FROM error_catalog WHERE learner_id=? ORDER BY error_id", learner_id).await?;
        let error_occurrences = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('occurrenceId',o.occurrence_id,'errorId',o.error_id,'attemptId',o.attempt_id,'evaluatorRunId',o.evaluator_run_id,'occurredAt',o.occurred_at)),'[]') FROM error_occurrence o JOIN error_catalog e ON e.error_id=o.error_id WHERE e.learner_id=? ORDER BY o.occurrence_id", learner_id).await?;
        let focus_sessions = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('focusSessionId',focus_session_id,'mode',mode,'intention',intention,'interruptionNotes',json(interruption_notes_json),'endReview',end_review,'startedAt',started_at,'endedAt',ended_at)),'[]') FROM focus_session WHERE learner_id=? ORDER BY focus_session_id", learner_id).await?;
        let project_artifacts = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('registrationId',registration_id,'projectId',project_id,'stageId',stage_id,'kind',kind,'localPath',NULL,'localPathRedacted',local_path IS NOT NULL,'pastedText',pasted_text,'checksum',checksum,'createdAt',created_at)),'[]') FROM project_artifact_registration WHERE learner_id=? ORDER BY registration_id", learner_id).await?;
        let exams = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('sessionId',session_id,'formId',form_id,'formVersion',form_version,'itemChecksums',json(item_checksums_json),'answers',json(answers_json),'result',CASE WHEN result_json IS NULL THEN NULL ELSE json(result_json) END,'status',status,'startedAt',started_at,'completedAt',completed_at)),'[]') FROM final_exam_session WHERE learner_id=? ORDER BY started_at,session_id", learner_id).await?;
        let quiz_attempts = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('attemptId',attempt_id,'idempotencyKey',idempotency_key,'questionId',question_id,'questionVersion',question_version,'response',json(response_json),'result',json(result_json),'score',score,'correct',json(correct),'support',json(support_json),'confidence',confidence,'createdAt',created_at)),'[]') FROM quiz_attempt_event WHERE learner_id=? ORDER BY created_at,attempt_id", learner_id).await?;
        let diagnostic_sessions = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('sessionId',diagnostic_session_id,'releaseId',release_id,'modelVersion',model_version,'status',status,'answers',json(answers_json),'placement',CASE WHEN placement_json IS NULL THEN NULL ELSE json(placement_json) END,'startedAt',started_at,'completedAt',completed_at,'retakeOf',retake_of)),'[]') FROM diagnostic_session WHERE learner_id=? ORDER BY started_at,diagnostic_session_id", learner_id).await?;
        let gap_overrides = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('overrideId',override_id,'sessionId',diagnostic_session_id,'outcomeId',outcome_id,'requestedStatus',requested_status,'explanation',explanation,'createdAt',created_at)),'[]') FROM gap_override WHERE learner_id=? ORDER BY override_id", learner_id).await?;
        let project_checkpoints = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('checkpointId',checkpoint_id,'projectId',project_id,'stageId',stage_id,'parentCheckpointId',parent_checkpoint_id,'workspaceChecksum',workspace_checksum,'status',status,'evaluatorRunId',evaluator_run_id,'regressions',json(regression_json),'createdAt',created_at)),'[]') FROM project_checkpoint WHERE learner_id=? ORDER BY created_at,checkpoint_id", learner_id).await?;
        let external_bookmarks = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('bookmarkId',bookmark_id,'platform',platform,'urlOrId',url_or_id,'localExerciseId',local_exercise_id,'patternId',pattern_id,'status',status,'notes',notes,'support',json(support_json),'confidence',confidence,'reattemptDay',reattempt_day,'createdAt',created_at,'updatedAt',updated_at)),'[]') FROM external_practice_bookmark WHERE learner_id=? ORDER BY bookmark_id", learner_id).await?;
        let workbench_completions = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('itemId',item_id,'itemKind',item_kind,'unlockedItemId',unlocked_item_id,'evaluatorRunId',evaluator_run_id,'workspaceChecksum',workspace_checksum,'acceptedAt',accepted_at)),'[]') FROM workbench_completion WHERE learner_id=? ORDER BY item_id", learner_id).await?;
        let acceptance_runs = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('runId',run_id,'state',state,'exerciseId',exercise_id,'action',action,'workspaceChecksum',workspace_checksum,'createdAt',created_at,'updatedAt',updated_at)),'[]') FROM evaluation_stream_run WHERE run_id IN (SELECT evaluator_run_id FROM workbench_completion WHERE learner_id=?) ORDER BY run_id", learner_id).await?;
        let review_ratings = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('ratingId',rating_id,'conceptId',concept_id,'rating',rating,'day',day,'createdAt',created_at)),'[]') FROM review_rating WHERE learner_id=? ORDER BY day,created_at,rating_id", learner_id).await?;
        let reset_events = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('resetId',reset_id,'scope',scope,'targetId',target_id,'backupChecksum',backup_checksum,'createdAt',created_at)),'[]') FROM data_reset_event WHERE learner_id=? ORDER BY created_at,reset_id", learner_id).await?;
        let reset_items = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('resetId',reset_id,'itemId',item_id)),'[]') FROM data_reset_item WHERE reset_id IN (SELECT reset_id FROM data_reset_event WHERE learner_id=?) ORDER BY reset_id,item_id", learner_id).await?;
        let support_events = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('itemId',item_id,'support',support,'occurredAt',occurred_at)),'[]') FROM learner_support_event WHERE learner_id=? ORDER BY occurred_at,item_id,support", learner_id).await?;
        let workspace_revisions = rows(&self.pool, "SELECT COALESCE(json_group_array(json_object('projectId',project_id,'stageId',stage_id,'revision',revision,'files',json(files_json),'workspaceChecksum',workspace_checksum,'checkpoint',json(checkpoint),'createdAt',created_at)),'[]') FROM project_workspace_revision WHERE learner_id=? ORDER BY project_id,stage_id,revision", learner_id).await?;
        let releases: String = sqlx::query_scalar("SELECT COALESCE(json_group_array(json_object('releaseId',release_id,'version',version,'checksum',checksum,'activatedAt',activated_at)),'[]') FROM content_release ORDER BY release_id")
            .fetch_one(&self.pool).await.map_err(query_error)?;
        let payload = serde_json::json!({
            "learnerId":learner_id,"learningSessions":sessions,"attempts":attempts,"events":events,"artifacts":artifacts,"reflections":reflections,
            "plans":plans,"journal":journal,"errors":errors,"errorOccurrences":error_occurrences,"focusSessions":focus_sessions,"projectArtifacts":project_artifacts,"examSessions":exams,"quizAttempts":quiz_attempts,
            "diagnosticSessions":diagnostic_sessions,"gapOverrides":gap_overrides,"projectCheckpoints":project_checkpoints,"projectWorkspaceRevisions":workspace_revisions,"supportEvents":support_events,"externalBookmarks":external_bookmarks,"workbenchCompletions":workbench_completions,"acceptanceRuns":acceptance_runs,"reviewRatings":review_ratings,"resetEvents":reset_events,"resetItems":reset_items,
            "contentReleases":serde_json::from_str::<Value>(&releases).map_err(|error| DbError(format!("release export JSON failed: {error}")))?,
            "excluded":["session tokens","evaluator run logs and stream output","temporary workspaces","compiler environment","machine paths","cache data"]
        });
        let canonical = serde_json::to_vec(&payload).expect("portable export serialization");
        let checksum = format!("{:x}", Sha256::digest(&canonical));
        let counts = payload
            .as_object()
            .expect("export object")
            .iter()
            .filter_map(|(key, value)| value.as_array().map(|rows| (key.clone(), rows.len())))
            .collect::<std::collections::BTreeMap<_, _>>();
        Ok(serde_json::json!({
            "manifest":{
                "schemaVersion":1,"format":"rust-tutor-portable-json","checksumSha256":checksum,"rowCounts":counts,
                "canonicalOrdering":"table arrays are ordered by stable identity/time",
                "redactionPolicy":"tokens, logs, environment, temp/cache, and machine paths are excluded or redacted",
                "tables":{
                    "portable":["learningSessions","attempts","events","artifacts","reflections","plans","journal","errors","errorOccurrences","focusSessions","projectArtifacts","examSessions","quizAttempts","diagnosticSessions","gapOverrides","projectCheckpoints","projectWorkspaceRevisions","supportEvents","externalBookmarks","workbenchCompletions","acceptanceRuns","reviewRatings","resetEvents","resetItems","contentReleases"],
                    "reconstructable":["evidence","mastery_projection","review_projection","projection_checkpoint","curriculum_node","curriculum_edge","curriculum_search","journal_search"],
                    "intentionallyExcluded":["evaluator_log","evaluation_stream_run","data_import_ledger","goal","confidence","scheduler_snapshot","project_milestone_state","project_milestone_evidence","content_source","schema_migration"]
                }
            },
            "payload":payload
        }))
    }

    pub async fn consistent_backup(&self, target: &Path) -> Result<Value, DbError> {
        let Some(source) = &self.path else {
            return Err(DbError(
                "file backup is unavailable for an in-memory database".into(),
            ));
        };
        if !target.is_absolute() || target == source || target.exists() {
            return Err(DbError(
                "backup target must be a new absolute file distinct from the live database".into(),
            ));
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| db_error("cannot create backup directory", error))?;
        }
        sqlx::query("VACUUM INTO ?")
            .bind(target.to_string_lossy().as_ref())
            .execute(&self.pool)
            .await
            .map_err(|error| db_error("online-consistent backup failed", error))?;
        let options = SqliteConnectOptions::new()
            .filename(target)
            .read_only(true)
            .create_if_missing(false)
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(5));
        let check_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|error| db_error("backup verification open failed", error))?;
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&check_pool)
            .await
            .map_err(|error| db_error("backup integrity check failed", error))?;
        check_pool.close().await;
        if integrity != "ok" {
            return Err(DbError(format!(
                "backup integrity check returned {integrity}"
            )));
        }
        let bytes =
            std::fs::read(target).map_err(|error| db_error("cannot checksum backup", error))?;
        Ok(
            serde_json::json!({"source":source.file_name().and_then(|name|name.to_str()).unwrap_or("learner.sqlite3"),"backupPath":target,"bytes":bytes.len(),"checksumSha256":format!("{:x}",Sha256::digest(&bytes)),"integrity":"ok","method":"SQLite VACUUM INTO"}),
        )
    }

    pub async fn apply_portable_import(
        &self,
        archive: &Value,
        mode: ImportMode<'_>,
    ) -> Result<Value, DbError> {
        let validated = crate::data_lifecycle::validate_portable_archive(archive)
            .map_err(|error| DbError(format!("portable import validation failed: {error}")))?;
        let payload = archive
            .get("payload")
            .and_then(Value::as_object)
            .ok_or_else(|| DbError("portable import payload is not an object".into()))?;
        let learner_id = payload
            .get("learnerId")
            .and_then(Value::as_str)
            .ok_or_else(|| DbError("portable import learner ID is missing".into()))?;
        fn values<'a>(
            payload: &'a serde_json::Map<String, Value>,
            key: &str,
        ) -> Result<&'a [Value], DbError> {
            match payload.get(key) {
                None => Ok(&[]),
                Some(value) => value
                    .as_array()
                    .map(Vec::as_slice)
                    .ok_or_else(|| DbError(format!("portable import {key} must be an array"))),
            }
        }
        fn text<'a>(row: &'a Value, key: &str) -> Result<&'a str, DbError> {
            row.get(key)
                .and_then(Value::as_str)
                .ok_or_else(|| DbError(format!("portable import row is missing {key}")))
        }
        fn integer(row: &Value, key: &str) -> Result<i64, DbError> {
            row.get(key)
                .and_then(Value::as_i64)
                .ok_or_else(|| DbError(format!("portable import row is missing integer {key}")))
        }
        /// A stable ID that already exists must describe the identical canonical
        /// row; a mismatch aborts the whole import instead of silently keeping
        /// the local row while reporting idempotent success.
        async fn verify_ignored_row(
            tx: &mut Transaction<'_, Sqlite>,
            table: &str,
            select_json: &'static str,
            id: &str,
            incoming: &Value,
        ) -> Result<(), DbError> {
            let stored: Option<String> = sqlx::query_scalar(select_json)
                .bind(id)
                .fetch_optional(&mut **tx)
                .await
                .map_err(query_error)?;
            let stored = stored
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .ok_or_else(|| {
                    DbError(format!(
                        "portable import conflict: {table} {id} was ignored but cannot be read back"
                    ))
                })?;
            let matches = stored.as_object().is_some_and(|fields| {
                fields
                    .iter()
                    .all(|(key, value)| incoming.get(key).unwrap_or(&Value::Null) == value)
            });
            if matches {
                Ok(())
            } else {
                Err(DbError(format!(
                    "portable import conflict: existing {table} {id} differs from the archive; nothing was applied"
                )))
            }
        }
        let mut tx = self.pool.begin().await.map_err(query_error)?;
        sqlx::query("INSERT OR IGNORE INTO learner VALUES (?,?)")
            .bind(learner_id)
            .bind("portable-import")
            .execute(&mut *tx)
            .await
            .map_err(query_error)?;
        let mut applied = 0_u64;
        for row in values(payload, "learningSessions")?.iter() {
            let id = text(row, "sessionId")?;
            let changed =
                sqlx::query("INSERT OR IGNORE INTO learning_session VALUES (?,?,?,?,?,?,?)")
                    .bind(id)
                    .bind(learner_id)
                    .bind(row.get("goalId").and_then(Value::as_str))
                    .bind(text(row, "startedAt")?)
                    .bind(row.get("endedAt").and_then(Value::as_str))
                    .bind(text(row, "runId")?)
                    .bind(text(row, "requestId")?)
                    .execute(&mut *tx)
                    .await
                    .map_err(query_error)?
                    .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "learning_session", "SELECT json_object('sessionId',session_id,'goalId',goal_id,'startedAt',started_at,'endedAt',ended_at,'runId',run_id,'requestId',request_id) FROM learning_session WHERE session_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "attempts")?.iter() {
            let id = text(row, "attemptId")?;
            let changed = sqlx::query("INSERT OR IGNORE INTO attempt VALUES (?,?,?,?,?,?,?)")
                .bind(id)
                .bind(text(row, "sessionId")?)
                .bind(text(row, "itemId")?)
                .bind(integer(row, "itemVersion")?)
                .bind(text(row, "startedAt")?)
                .bind(row.get("completedAt").and_then(Value::as_str))
                .bind(text(row, "status")?)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?
                .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "attempt", "SELECT json_object('attemptId',attempt_id,'sessionId',session_id,'itemId',item_id,'itemVersion',item_version,'startedAt',started_at,'completedAt',completed_at,'status',status) FROM attempt WHERE attempt_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "events")?.iter() {
            let id = text(row, "eventId")?;
            let changed =
                sqlx::query("INSERT OR IGNORE INTO attempt_event VALUES (?,?,?,?,?,?,?,?,?)")
                    .bind(id)
                    .bind(text(row, "attemptId")?)
                    .bind(integer(row, "sequence")?)
                    .bind(text(row, "idempotencyKey")?)
                    .bind(text(row, "kind")?)
                    .bind(
                        row.get("payload")
                            .cloned()
                            .unwrap_or(Value::Null)
                            .to_string(),
                    )
                    .bind(text(row, "occurredAt")?)
                    .bind(text(row, "runId")?)
                    .bind(text(row, "requestId")?)
                    .execute(&mut *tx)
                    .await
                    .map_err(query_error)?
                    .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "attempt_event", "SELECT json_object('eventId',event_id,'attemptId',attempt_id,'sequence',sequence,'idempotencyKey',idempotency_key,'kind',kind,'payload',json(payload_json),'occurredAt',occurred_at,'runId',run_id,'requestId',request_id) FROM attempt_event WHERE event_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "artifacts")?.iter() {
            let id = text(row, "artifactId")?;
            let changed = sqlx::query("INSERT OR IGNORE INTO artifact VALUES (?,?,?,?,?,?,?)")
                .bind(id)
                .bind(text(row, "attemptId")?)
                .bind(text(row, "itemId")?)
                .bind(integer(row, "itemVersion")?)
                .bind(text(row, "checksum")?)
                .bind(
                    row.get("toolchain")
                        .cloned()
                        .unwrap_or(Value::Null)
                        .to_string(),
                )
                .bind(text(row, "createdAt")?)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?
                .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "artifact", "SELECT json_object('artifactId',artifact_id,'attemptId',attempt_id,'itemId',item_id,'itemVersion',item_version,'checksum',checksum,'toolchain',json(toolchain_json),'createdAt',created_at) FROM artifact WHERE artifact_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "reflections")?.iter() {
            let id = text(row, "reflectionId")?;
            let changed = sqlx::query("INSERT OR IGNORE INTO reflection VALUES (?,?,?,?)")
                .bind(id)
                .bind(text(row, "attemptId")?)
                .bind(text(row, "body")?)
                .bind(text(row, "createdAt")?)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?
                .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "reflection", "SELECT json_object('reflectionId',reflection_id,'attemptId',attempt_id,'body',body,'createdAt',created_at) FROM reflection WHERE reflection_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "plans")?.iter() {
            let changed = sqlx::query("INSERT OR IGNORE INTO learner_plan VALUES (?,?,?,?,?,?)")
                .bind(learner_id)
                .bind(text(row, "goalId")?)
                .bind(text(row, "goalTitle")?)
                .bind(integer(row, "horizonWeeks")?)
                .bind(integer(row, "weeklyCapacityHours")?)
                .bind(text(row, "updatedAt")?)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?
                .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "learner_plan", "SELECT json_object('goalId',goal_id,'goalTitle',goal_title,'horizonWeeks',horizon_weeks,'weeklyCapacityHours',weekly_capacity_hours,'updatedAt',updated_at) FROM learner_plan WHERE learner_id=?", learner_id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "journal")?.iter() {
            let id = text(row, "entryId")?;
            let changed =
                sqlx::query("INSERT OR IGNORE INTO journal_entry VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
                    .bind(id)
                    .bind(learner_id)
                    .bind(text(row, "kind")?)
                    .bind(text(row, "title")?)
                    .bind(text(row, "body")?)
                    .bind(row.get("projectId").and_then(Value::as_str))
                    .bind(row.get("conceptId").and_then(Value::as_str))
                    .bind(row.get("errorId").and_then(Value::as_str))
                    .bind(
                        row.get("support")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!({}))
                            .to_string(),
                    )
                    .bind(row.get("confidence").and_then(Value::as_i64))
                    .bind(row.get("reattemptDay").and_then(Value::as_i64))
                    .bind(text(row, "createdAt")?)
                    .execute(&mut *tx)
                    .await
                    .map_err(query_error)?
                    .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "journal_entry", "SELECT json_object('entryId',entry_id,'kind',kind,'title',title,'body',body,'projectId',project_id,'conceptId',concept_id,'errorId',error_id,'support',json(support_json),'confidence',confidence,'reattemptDay',reattempt_day,'createdAt',created_at) FROM journal_entry WHERE entry_id=?", id, row).await?;
            }
            applied += changed;
            if changed == 1 {
                sqlx::query("INSERT INTO journal_search VALUES (?,?,?,?,?,?)")
                    .bind(id)
                    .bind(text(row, "title")?)
                    .bind(text(row, "body")?)
                    .bind(
                        row.get("projectId")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                    )
                    .bind(
                        row.get("conceptId")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                    )
                    .bind(
                        row.get("errorId")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                    )
                    .execute(&mut *tx)
                    .await
                    .map_err(query_error)?;
            }
        }
        for row in values(payload, "errors")?.iter() {
            let id = text(row, "errorId")?;
            let changed =
                sqlx::query("INSERT OR IGNORE INTO error_catalog VALUES (?,?,?,?,?,?,?,?,?,?)")
                    .bind(id)
                    .bind(learner_id)
                    .bind(text(row, "fingerprint")?)
                    .bind(text(row, "code")?)
                    .bind(text(row, "rootCause")?)
                    .bind(text(row, "correction")?)
                    .bind(text(row, "futureCue")?)
                    .bind(
                        row.get("conceptIds")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!([]))
                            .to_string(),
                    )
                    .bind(text(row, "createdAt")?)
                    .bind(text(row, "updatedAt")?)
                    .execute(&mut *tx)
                    .await
                    .map_err(query_error)?
                    .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "error_catalog", "SELECT json_object('errorId',error_id,'fingerprint',fingerprint,'code',code,'rootCause',root_cause,'correction',correction,'futureCue',future_cue,'conceptIds',json(concept_ids_json),'createdAt',created_at,'updatedAt',updated_at) FROM error_catalog WHERE error_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "errorOccurrences")?.iter() {
            let id = text(row, "occurrenceId")?;
            let changed = sqlx::query("INSERT OR IGNORE INTO error_occurrence VALUES (?,?,?,?,?)")
                .bind(id)
                .bind(text(row, "errorId")?)
                .bind(row.get("attemptId").and_then(Value::as_str))
                .bind(row.get("evaluatorRunId").and_then(Value::as_str))
                .bind(text(row, "occurredAt")?)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?
                .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "error_occurrence", "SELECT json_object('occurrenceId',occurrence_id,'errorId',error_id,'attemptId',attempt_id,'evaluatorRunId',evaluator_run_id,'occurredAt',occurred_at) FROM error_occurrence WHERE occurrence_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "focusSessions")?.iter() {
            let id = text(row, "focusSessionId")?;
            let changed =
                sqlx::query("INSERT OR IGNORE INTO focus_session VALUES (?,?,?,?,?,?,?,?)")
                    .bind(id)
                    .bind(learner_id)
                    .bind(text(row, "mode")?)
                    .bind(text(row, "intention")?)
                    .bind(
                        row.get("interruptionNotes")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!([]))
                            .to_string(),
                    )
                    .bind(row.get("endReview").and_then(Value::as_str))
                    .bind(text(row, "startedAt")?)
                    .bind(row.get("endedAt").and_then(Value::as_str))
                    .execute(&mut *tx)
                    .await
                    .map_err(query_error)?
                    .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "focus_session", "SELECT json_object('focusSessionId',focus_session_id,'mode',mode,'intention',intention,'interruptionNotes',json(interruption_notes_json),'endReview',end_review,'startedAt',started_at,'endedAt',ended_at) FROM focus_session WHERE focus_session_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "projectArtifacts")?.iter() {
            if row.get("localPath").is_some_and(|value| !value.is_null()) {
                return Err(DbError(
                    "portable project artifact contains a machine path".into(),
                ));
            }
            if row.get("localPathRedacted").and_then(Value::as_bool) == Some(true)
                && row.get("pastedText").is_none_or(Value::is_null)
            {
                continue;
            }
            let id = text(row, "registrationId")?;
            let changed = sqlx::query(
                "INSERT OR IGNORE INTO project_artifact_registration VALUES (?,?,?,?,?,NULL,?,?,?)",
            )
            .bind(id)
            .bind(learner_id)
            .bind(text(row, "projectId")?)
            .bind(text(row, "stageId")?)
            .bind(text(row, "kind")?)
            .bind(row.get("pastedText").and_then(Value::as_str))
            .bind(text(row, "checksum")?)
            .bind(text(row, "createdAt")?)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?
            .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "project_artifact_registration", "SELECT json_object('registrationId',registration_id,'projectId',project_id,'stageId',stage_id,'kind',kind,'localPath',NULL,'localPathRedacted',local_path IS NOT NULL,'pastedText',pasted_text,'checksum',checksum,'createdAt',created_at) FROM project_artifact_registration WHERE registration_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "examSessions")?.iter() {
            let id = text(row, "sessionId")?;
            let changed = sqlx::query(
                "INSERT OR IGNORE INTO final_exam_session VALUES (?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(id)
            .bind(learner_id)
            .bind(text(row, "formId")?)
            .bind(text(row, "formVersion")?)
            .bind(
                row.get("itemChecksums")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}))
                    .to_string(),
            )
            .bind(
                row.get("answers")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}))
                    .to_string(),
            )
            .bind(
                row.get("result")
                    .filter(|value| !value.is_null())
                    .map(Value::to_string),
            )
            .bind(text(row, "status")?)
            .bind(text(row, "startedAt")?)
            .bind(row.get("completedAt").and_then(Value::as_str))
            .execute(&mut *tx)
            .await
            .map_err(query_error)?
            .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "final_exam_session", "SELECT json_object('sessionId',session_id,'formId',form_id,'formVersion',form_version,'itemChecksums',json(item_checksums_json),'answers',json(answers_json),'result',CASE WHEN result_json IS NULL THEN NULL ELSE json(result_json) END,'status',status,'startedAt',started_at,'completedAt',completed_at) FROM final_exam_session WHERE session_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "quizAttempts")?.iter() {
            let id = text(row, "attemptId")?;
            let changed = sqlx::query(
                "INSERT OR IGNORE INTO quiz_attempt_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(id)
            .bind(text(row, "idempotencyKey")?)
            .bind(learner_id)
            .bind(text(row, "questionId")?)
            .bind(integer(row, "questionVersion")?)
            .bind(
                row.get("response")
                    .cloned()
                    .unwrap_or(Value::Null)
                    .to_string(),
            )
            .bind(
                row.get("result")
                    .cloned()
                    .unwrap_or(Value::Null)
                    .to_string(),
            )
            .bind(row.get("score").and_then(Value::as_f64).unwrap_or(0.0))
            .bind(row.get("correct").and_then(Value::as_i64).unwrap_or(0))
            .bind(
                row.get("support")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!("none"))
                    .to_string(),
            )
            .bind(integer(row, "confidence")?)
            .bind(text(row, "createdAt")?)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?
            .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "quiz_attempt_event", "SELECT json_object('attemptId',attempt_id,'idempotencyKey',idempotency_key,'questionId',question_id,'questionVersion',question_version,'response',json(response_json),'result',json(result_json),'score',score,'correct',json(correct),'support',json(support_json),'confidence',confidence,'createdAt',created_at) FROM quiz_attempt_event WHERE attempt_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "diagnosticSessions")?.iter() {
            let id = text(row, "sessionId")?;
            let changed = sqlx::query(
                "INSERT OR IGNORE INTO diagnostic_session VALUES (?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(id)
            .bind(learner_id)
            .bind(text(row, "releaseId")?)
            .bind(text(row, "modelVersion")?)
            .bind(text(row, "status")?)
            .bind(
                row.get("answers")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}))
                    .to_string(),
            )
            .bind(
                row.get("placement")
                    .filter(|value| !value.is_null())
                    .map(Value::to_string),
            )
            .bind(text(row, "startedAt")?)
            .bind(row.get("completedAt").and_then(Value::as_str))
            .bind(row.get("retakeOf").and_then(Value::as_str))
            .execute(&mut *tx)
            .await
            .map_err(query_error)?
            .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "diagnostic_session", "SELECT json_object('sessionId',diagnostic_session_id,'releaseId',release_id,'modelVersion',model_version,'status',status,'answers',json(answers_json),'placement',CASE WHEN placement_json IS NULL THEN NULL ELSE json(placement_json) END,'startedAt',started_at,'completedAt',completed_at,'retakeOf',retake_of) FROM diagnostic_session WHERE diagnostic_session_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "gapOverrides")?.iter() {
            let id = text(row, "overrideId")?;
            let changed = sqlx::query("INSERT OR IGNORE INTO gap_override VALUES (?,?,?,?,?,?,?)")
                .bind(id)
                .bind(learner_id)
                .bind(text(row, "sessionId")?)
                .bind(text(row, "outcomeId")?)
                .bind(text(row, "requestedStatus")?)
                .bind(text(row, "explanation")?)
                .bind(text(row, "createdAt")?)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?
                .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "gap_override", "SELECT json_object('overrideId',override_id,'sessionId',diagnostic_session_id,'outcomeId',outcome_id,'requestedStatus',requested_status,'explanation',explanation,'createdAt',created_at) FROM gap_override WHERE override_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "projectCheckpoints")?.iter() {
            let id = text(row, "checkpointId")?;
            let changed = sqlx::query(
                "INSERT OR IGNORE INTO project_checkpoint VALUES (?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(id)
            .bind(learner_id)
            .bind(text(row, "projectId")?)
            .bind(text(row, "stageId")?)
            .bind(row.get("parentCheckpointId").and_then(Value::as_str))
            .bind(text(row, "workspaceChecksum")?)
            .bind(text(row, "status")?)
            .bind(row.get("evaluatorRunId").and_then(Value::as_str))
            .bind(
                row.get("regressions")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([]))
                    .to_string(),
            )
            .bind(text(row, "createdAt")?)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?
            .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "project_checkpoint", "SELECT json_object('checkpointId',checkpoint_id,'projectId',project_id,'stageId',stage_id,'parentCheckpointId',parent_checkpoint_id,'workspaceChecksum',workspace_checksum,'status',status,'evaluatorRunId',evaluator_run_id,'regressions',json(regression_json),'createdAt',created_at) FROM project_checkpoint WHERE checkpoint_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "projectWorkspaceRevisions")?.iter() {
            let project_id = text(row, "projectId")?;
            let stage_id = text(row, "stageId")?;
            let revision = integer(row, "revision")?;
            let files = row
                .get("files")
                .cloned()
                .ok_or_else(|| DbError("portable workspace revision is missing files".into()))?;
            if !files.is_object() {
                return Err(DbError("portable workspace files must be an object".into()));
            }
            let checkpoint = row
                .get("checkpoint")
                .and_then(Value::as_bool)
                .map(i64::from)
                .or_else(|| row.get("checkpoint").and_then(Value::as_i64))
                .ok_or_else(|| DbError("portable workspace checkpoint must be boolean".into()))?;
            let changed = sqlx::query(
                "INSERT OR IGNORE INTO project_workspace_revision VALUES (?,?,?,?,?,?,?,?)",
            )
            .bind(learner_id)
            .bind(project_id)
            .bind(stage_id)
            .bind(revision)
            .bind(files.to_string())
            .bind(text(row, "workspaceChecksum")?)
            .bind(checkpoint)
            .bind(text(row, "createdAt")?)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?
            .rows_affected();
            if changed == 0 {
                let stored: Option<String> = sqlx::query_scalar("SELECT json_object('projectId',project_id,'stageId',stage_id,'revision',revision,'files',json(files_json),'workspaceChecksum',workspace_checksum,'checkpoint',json(checkpoint),'createdAt',created_at) FROM project_workspace_revision WHERE learner_id=? AND project_id=? AND stage_id=? AND revision=?")
                    .bind(learner_id).bind(project_id).bind(stage_id).bind(revision).fetch_optional(&mut *tx).await.map_err(query_error)?;
                if stored
                    .and_then(|value| serde_json::from_str::<Value>(&value).ok())
                    .as_ref()
                    != Some(row)
                {
                    return Err(DbError(format!(
                        "portable import conflict: workspace {project_id}/{stage_id} revision {revision} differs locally"
                    )));
                }
            }
            applied += changed;
        }
        for row in values(payload, "supportEvents")?.iter() {
            applied += sqlx::query("INSERT OR IGNORE INTO learner_support_event VALUES (?,?,?,?)")
                .bind(learner_id)
                .bind(text(row, "itemId")?)
                .bind(text(row, "support")?)
                .bind(text(row, "occurredAt")?)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?
                .rows_affected();
        }
        for row in values(payload, "externalBookmarks")?.iter() {
            let id = text(row, "bookmarkId")?;
            let changed = sqlx::query(
                "INSERT OR IGNORE INTO external_practice_bookmark VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(id)
            .bind(learner_id)
            .bind(text(row, "platform")?)
            .bind(text(row, "urlOrId")?)
            .bind(row.get("localExerciseId").and_then(Value::as_str))
            .bind(row.get("patternId").and_then(Value::as_str))
            .bind(text(row, "status")?)
            .bind(text(row, "notes")?)
            .bind(
                row.get("support")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}))
                    .to_string(),
            )
            .bind(row.get("confidence").and_then(Value::as_i64))
            .bind(row.get("reattemptDay").and_then(Value::as_i64))
            .bind(text(row, "createdAt")?)
            .bind(text(row, "updatedAt")?)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?
            .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "external_practice_bookmark", "SELECT json_object('bookmarkId',bookmark_id,'platform',platform,'urlOrId',url_or_id,'localExerciseId',local_exercise_id,'patternId',pattern_id,'status',status,'notes',notes,'support',json(support_json),'confidence',confidence,'reattemptDay',reattempt_day,'createdAt',created_at,'updatedAt',updated_at) FROM external_practice_bookmark WHERE bookmark_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "acceptanceRuns")?.iter() {
            let id = text(row, "runId")?;
            let changed = sqlx::query(
                "INSERT OR IGNORE INTO evaluation_stream_run(run_id,learner_id,state,chunks_json,result_json,created_at,updated_at,exercise_id,action,workspace_checksum) VALUES (?,?,?,'[]',NULL,?,?,?,?,?)",
            )
            .bind(id)
            .bind(learner_id)
            .bind(text(row, "state")?)
            .bind(text(row, "createdAt")?)
            .bind(text(row, "updatedAt")?)
            .bind(row.get("exerciseId").and_then(Value::as_str))
            .bind(row.get("action").and_then(Value::as_str))
            .bind(row.get("workspaceChecksum").and_then(Value::as_str))
            .execute(&mut *tx)
            .await
            .map_err(query_error)?
            .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "evaluation_stream_run", "SELECT json_object('runId',run_id,'state',state,'exerciseId',exercise_id,'action',action,'workspaceChecksum',workspace_checksum,'createdAt',created_at,'updatedAt',updated_at) FROM evaluation_stream_run WHERE run_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "workbenchCompletions")?.iter() {
            let id = text(row, "itemId")?;
            let changed =
                sqlx::query("INSERT OR IGNORE INTO workbench_completion VALUES (?,?,?,?,?,?,?)")
                    .bind(learner_id)
                    .bind(id)
                    .bind(text(row, "itemKind")?)
                    .bind(text(row, "unlockedItemId")?)
                    .bind(text(row, "evaluatorRunId")?)
                    .bind(text(row, "workspaceChecksum")?)
                    .bind(text(row, "acceptedAt")?)
                    .execute(&mut *tx)
                    .await
                    .map_err(query_error)?
                    .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "workbench_completion", "SELECT json_object('itemId',item_id,'itemKind',item_kind,'unlockedItemId',unlocked_item_id,'evaluatorRunId',evaluator_run_id,'workspaceChecksum',workspace_checksum,'acceptedAt',accepted_at) FROM workbench_completion WHERE item_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "reviewRatings")?.iter() {
            let id = text(row, "ratingId")?;
            let changed = sqlx::query("INSERT OR IGNORE INTO review_rating VALUES (?,?,?,?,?,?)")
                .bind(id)
                .bind(learner_id)
                .bind(text(row, "conceptId")?)
                .bind(text(row, "rating")?)
                .bind(integer(row, "day")?)
                .bind(text(row, "createdAt")?)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?
                .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "review_rating", "SELECT json_object('ratingId',rating_id,'conceptId',concept_id,'rating',rating,'day',day,'createdAt',created_at) FROM review_rating WHERE rating_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "resetEvents")?.iter() {
            let id = text(row, "resetId")?;
            let changed =
                sqlx::query("INSERT OR IGNORE INTO data_reset_event VALUES (?,?,?,?,?,?)")
                    .bind(id)
                    .bind(learner_id)
                    .bind(text(row, "scope")?)
                    .bind(row.get("targetId").and_then(Value::as_str))
                    .bind(text(row, "backupChecksum")?)
                    .bind(text(row, "createdAt")?)
                    .execute(&mut *tx)
                    .await
                    .map_err(query_error)?
                    .rows_affected();
            if changed == 0 {
                verify_ignored_row(&mut tx, "data_reset_event", "SELECT json_object('resetId',reset_id,'scope',scope,'targetId',target_id,'backupChecksum',backup_checksum,'createdAt',created_at) FROM data_reset_event WHERE reset_id=?", id, row).await?;
            }
            applied += changed;
        }
        for row in values(payload, "resetItems")?.iter() {
            applied += sqlx::query("INSERT OR IGNORE INTO data_reset_item VALUES (?,?)")
                .bind(text(row, "resetId")?)
                .bind(text(row, "itemId")?)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?
                .rows_affected();
        }
        for row in values(payload, "contentReleases")?.iter() {
            let id = text(row, "releaseId")?;
            let changed = sqlx::query("INSERT OR IGNORE INTO content_release VALUES (?,?,?,?)")
                .bind(id)
                .bind(text(row, "version")?)
                .bind(text(row, "checksum")?)
                .bind(text(row, "activatedAt")?)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?
                .rows_affected();
            if changed == 0 {
                let stored: Option<String> =
                    sqlx::query_scalar("SELECT checksum FROM content_release WHERE release_id=?")
                        .bind(id)
                        .fetch_optional(&mut *tx)
                        .await
                        .map_err(query_error)?;
                if stored.as_deref() != row.get("checksum").and_then(Value::as_str) {
                    return Err(DbError(format!(
                        "portable import conflict: content release {id} has a different checksum locally"
                    )));
                }
            }
            applied += changed;
        }
        let failures: Vec<(String, i64, String, i64)> = sqlx::query_as("PRAGMA foreign_key_check")
            .fetch_all(&mut *tx)
            .await
            .map_err(query_error)?;
        if !failures.is_empty() {
            return Err(DbError(
                "portable import failed foreign-key integrity".into(),
            ));
        }
        let checksum = validated["checksumSha256"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        match mode {
            ImportMode::DryRun => {
                // Full parsing, conflict, and referential validation ran against
                // real tables; the transaction is discarded without committing.
                drop(tx);
                Ok(serde_json::json!({
                    "valid":true,"checksumSha256":checksum,"rowCounts":validated["rowCounts"],
                    "conflicts":"none: every stable ID is new or byte-identical to the local row",
                    "canonicalRowsChanged":applied,"mode":"dry_run"
                }))
            }
            ImportMode::Apply {
                backup_checksum,
                now,
            } => {
                let projection =
                    rebuild_projections_in(&mut tx, "mastery-v1", RebuildMode::Restart).await?;
                sqlx::query("INSERT OR IGNORE INTO data_import_ledger VALUES (?,?,?,?,?,?,?)")
                    .bind(format!("IMPORT-{checksum}"))
                    .bind(learner_id)
                    .bind(&checksum)
                    .bind(i64::try_from(applied).unwrap_or(i64::MAX))
                    .bind(backup_checksum)
                    .bind(&projection.checksum)
                    .bind(now)
                    .execute(&mut *tx)
                    .await
                    .map_err(query_error)?;
                tx.commit().await.map_err(query_error)?;
                Ok(serde_json::json!({
                    "appliedRows":applied,"checksumSha256":checksum,"integrity":"ok",
                    "projectionChecksum":projection.checksum,"idempotentIdentityRules":true,
                    "ledger":{"archiveChecksum":checksum,"backupChecksum":backup_checksum,"projectionChecksum":projection.checksum,"appendOnly":true}
                }))
            }
        }
    }

    /// Records the append-only reset baseline and immediately rebuilds every
    /// projection so mastery, review, evidence, and dashboard surfaces reflect
    /// the new baseline. Scoped resets store their resolved item IDs so the
    /// baseline filter can exclude exactly those attempts.
    #[allow(clippy::too_many_arguments)] // Mirrors the append-only audit row at this DB boundary.
    pub async fn apply_reset(
        &self,
        learner_id: &str,
        reset_id: &str,
        scope: &str,
        target_id: Option<&str>,
        item_ids: &[String],
        backup_checksum: &str,
        now: &str,
    ) -> Result<Value, DbError> {
        let mut tx = self.pool.begin().await.map_err(query_error)?;
        sqlx::query("INSERT OR IGNORE INTO learner VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?;
        sqlx::query("INSERT INTO data_reset_event VALUES (?,?,?,?,?,?)")
            .bind(reset_id)
            .bind(learner_id)
            .bind(scope)
            .bind(target_id)
            .bind(backup_checksum)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?;
        for item_id in item_ids {
            sqlx::query("INSERT OR IGNORE INTO data_reset_item VALUES (?,?)")
                .bind(reset_id)
                .bind(item_id)
                .execute(&mut *tx)
                .await
                .map_err(query_error)?;
        }
        let projection =
            rebuild_projections_in(&mut tx, "mastery-v1", RebuildMode::Restart).await?;
        tx.commit().await.map_err(query_error)?;
        Ok(serde_json::json!({
            "resetId":reset_id,"scope":scope,"targetId":target_id,"backupChecksum":backup_checksum,
            "createdAt":now,"canonicalDataDeleted":false,"auditHistoryPreserved":true,
            "effectiveBaseline":"after this reset event","resetItemCount":item_ids.len(),
            "projectionsRebuilt":true,"projectionChecksum":projection.checksum
        }))
    }

    pub async fn dashboard_snapshot(
        &self,
        learner_id: &str,
        total_outcomes: usize,
        today: u32,
    ) -> Result<Value, DbError> {
        let state_rows = sqlx::query("SELECT state,COUNT(*) AS count FROM mastery_projection WHERE learner_id=? GROUP BY state ORDER BY state")
            .bind(learner_id).fetch_all(&self.pool).await.map_err(query_error)?;
        let mut distribution = state_rows
            .into_iter()
            .map(|row| (row.get::<String, _>("state"), row.get::<i64, _>("count")))
            .collect::<std::collections::BTreeMap<_, _>>();
        distribution.remove("not_started");
        let projected: i64 = distribution.values().sum();
        let retained = *distribution.get("retained").unwrap_or(&0);
        let counts_sql = format!(
            "SELECT (SELECT COUNT(DISTINCT a.item_id) FROM attempt a JOIN learning_session s ON s.session_id=a.session_id WHERE s.learner_id=?1 AND {filter}),(SELECT COUNT(*) FROM attempt a JOIN learning_session s ON s.session_id=a.session_id WHERE s.learner_id=?1 AND {filter}),(SELECT COUNT(*) FROM evidence WHERE learner_id=?1),(SELECT COUNT(*) FROM review_projection WHERE learner_id=?1),(SELECT COUNT(*) FROM review_projection WHERE learner_id=?1 AND due_day<=?2),(SELECT COUNT(*) FROM project_artifact_registration WHERE learner_id=?1 AND {after_baseline}),(SELECT COUNT(*) FROM focus_session WHERE learner_id=?1 AND CAST(started_at AS INTEGER) > {baseline})",
            filter = RESET_BASELINE_ATTEMPT_FILTER,
            after_baseline =
                format_args!("CAST(created_at AS INTEGER) > {}", RESET_BASELINE_SUBQUERY),
            baseline = RESET_BASELINE_SUBQUERY,
        );
        let counts: (i64, i64, i64, i64, i64, i64, i64) =
            sqlx::query_as(sqlx::AssertSqlSafe(counts_sql))
                .bind(learner_id)
                .bind(i64::from(today))
                .fetch_one(&self.pool)
                .await
                .map_err(query_error)?;
        let study_days_sql = format!(
            "SELECT COUNT(DISTINCT CASE WHEN instr(event.occurred_at,'-')>0 THEN substr(event.occurred_at,1,10) ELSE CAST(CAST(event.occurred_at AS INTEGER)/86400 AS TEXT) END) FROM attempt_event event JOIN attempt ON attempt.attempt_id=event.attempt_id JOIN learning_session session ON session.session_id=attempt.session_id WHERE session.learner_id=?1 AND {RESET_BASELINE_EVENT_FILTER}"
        );
        let study_days: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(study_days_sql))
            .bind(learner_id)
            .fetch_one(&self.pool)
            .await
            .map_err(query_error)?;
        let recent_sql = format!(
            "SELECT l.evaluator_run_id,l.status,l.created_at,a.item_id FROM evaluator_log l JOIN attempt a ON a.attempt_id=l.attempt_id JOIN learning_session s ON s.session_id=a.session_id WHERE s.learner_id=?1 AND {RESET_BASELINE_ATTEMPT_FILTER} ORDER BY CAST(l.created_at AS INTEGER) DESC,l.evaluator_run_id LIMIT 5"
        );
        let recent_rows = sqlx::query(sqlx::AssertSqlSafe(recent_sql))
            .bind(learner_id)
            .fetch_all(&self.pool)
            .await
            .map_err(query_error)?;
        let recent = recent_rows.into_iter().map(|row|serde_json::json!({"evaluatorRunId":row.get::<String,_>("evaluator_run_id"),"status":row.get::<String,_>("status"),"createdAt":row.get::<String,_>("created_at"),"itemId":row.get::<String,_>("item_id")})).collect::<Vec<_>>();
        let exam_sql = format!(
            "SELECT form_version,status,started_at,completed_at,result_json FROM final_exam_session WHERE learner_id=?1 AND CAST(started_at AS INTEGER) > {RESET_BASELINE_SUBQUERY} ORDER BY CAST(started_at AS INTEGER) DESC,session_id DESC LIMIT 1"
        );
        let exam = sqlx::query(sqlx::AssertSqlSafe(exam_sql))
            .bind(learner_id).fetch_optional(&self.pool).await.map_err(query_error)?
            .map(|row|serde_json::json!({"formVersion":row.get::<String,_>("form_version"),"status":row.get::<String,_>("status"),"startedAt":row.get::<String,_>("started_at"),"completedAt":row.get::<Option<String>,_>("completed_at"),"result":row.get::<Option<String>,_>("result_json").and_then(|raw|serde_json::from_str::<Value>(&raw).ok())}));
        Ok(serde_json::json!({
            "outcomeDistribution":{"not_started":i64::try_from(total_outcomes).unwrap_or(i64::MAX)-projected,"states":distribution},
            "retainedCoverage":{"numerator":retained,"denominator":total_outcomes,"fraction":if total_outcomes==0 {0.0} else {retained as f64/total_outcomes as f64}},
            "counts":{"distinctAttemptedItems":counts.0,"attempts":counts.1,"evidenceEvents":counts.2,"scheduledReviews":counts.3,"dueReviews":counts.4,"projectArtifacts":counts.5,"focusSessions":counts.6,"studyDayCount":study_days},
            "recentCompilerActivity":recent,"exam":exam,
            "metricGlossary":{"outcomeDistribution":"mastery_projection plus released outcome count; absent rows mean not started","retainedCoverage":"retained projection rows divided by all released outcomes","scheduledReviews":"every scheduled review row","dueReviews":"rows whose due day has arrived, using the same predicate as the review queue","studyDayCount":"informational distinct event days; never affects mastery or recommendations","empty":"zero means no canonical record exists, not service failure"}
        }))
    }

    pub async fn search_curriculum(
        &self,
        raw_query: &str,
        kind: Option<&str>,
        limit: usize,
    ) -> Result<Vec<Value>, DbError> {
        let Some(query) = crate::graph::safe_fts_query(raw_query) else {
            return Ok(Vec::new());
        };
        let rows = sqlx::query(
            "SELECT node_id,kind,title,snippet(curriculum_search,4,'<mark>','</mark>',' … ',18) AS result_snippet,source_text,bm25(curriculum_search) AS rank FROM curriculum_search WHERE curriculum_search MATCH ? AND (? IS NULL OR kind = ?) ORDER BY rank,node_id LIMIT ?",
        )
        .bind(query)
        .bind(kind)
        .bind(kind)
        .bind(i64::try_from(limit.clamp(1, 50)).expect("search limit fits i64"))
        .fetch_all(&self.pool)
        .await
        .map_err(query_error)?;
        Ok(rows
            .into_iter()
            .map(|row| {
                serde_json::json!({
                    "id":row.get::<String,_>("node_id"),
                    "kind":row.get::<String,_>("kind"),
                    "title":row.get::<String,_>("title"),
                    "snippet":row.get::<String,_>("result_snippet"),
                    "source":row.get::<String,_>("source_text")
                })
            })
            .collect())
    }

    pub async fn mastery_overlay(&self, learner_id: &str) -> Result<Vec<Value>, DbError> {
        let rows = sqlx::query(
            "SELECT concept_id,state,model_version,evidence_ids_json,updated_at FROM mastery_projection WHERE learner_id = ? ORDER BY concept_id",
        )
        .bind(learner_id)
        .fetch_all(&self.pool)
        .await
        .map_err(query_error)?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let evidence: String = row.get("evidence_ids_json");
                serde_json::json!({
                    "nodeId":row.get::<String,_>("concept_id"),
                    "state":row.get::<String,_>("state"),
                    "modelVersion":row.get::<String,_>("model_version"),
                    "evidenceIds":serde_json::from_str::<Value>(&evidence).unwrap_or(Value::Array(Vec::new())),
                    "updatedAt":row.get::<String,_>("updated_at")
                })
            })
            .collect())
    }

    pub async fn open_diagnostic_session(
        &self,
        learner_id: &str,
        session_id: &str,
        release_id: &str,
        model_version: &str,
        retake: bool,
        now: &str,
    ) -> Result<Value, DbError> {
        sqlx::query("INSERT OR IGNORE INTO learner(learner_id,created_at) VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        let resume_sql = format!(
            "SELECT diagnostic_session_id,answers_json,started_at FROM diagnostic_session WHERE learner_id=?1 AND release_id=?2 AND status='active' AND CAST(started_at AS INTEGER) > {RESET_BASELINE_SUBQUERY} ORDER BY started_at DESC LIMIT 1"
        );
        if !retake
            && let Some(row) = sqlx::query(sqlx::AssertSqlSafe(resume_sql.clone()))
                .bind(learner_id)
                .bind(release_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(query_error)?
        {
            let answers: String = row.get("answers_json");
            return Ok(serde_json::json!({
                "sessionId":row.get::<String,_>("diagnostic_session_id"),
                "releaseId":release_id,
                "modelVersion":model_version,
                "resumed":true,
                "answers":serde_json::from_str::<Value>(&answers).unwrap_or_else(|_| serde_json::json!({})),
                "startedAt":row.get::<String,_>("started_at")
            }));
        }
        let retake_of: Option<String> = if retake {
            sqlx::query_scalar("SELECT diagnostic_session_id FROM diagnostic_session WHERE learner_id=? ORDER BY started_at DESC LIMIT 1")
                .bind(learner_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(query_error)?
        } else {
            None
        };
        // Close any active session that predates the current reset baseline so
        // the one-active-session index does not block a fresh start.
        let close_stale = format!(
            "UPDATE diagnostic_session SET status='complete',completed_at=?2 WHERE learner_id=?1 AND status='active' AND CAST(started_at AS INTEGER) <= {RESET_BASELINE_SUBQUERY}"
        );
        sqlx::query(sqlx::AssertSqlSafe(close_stale))
            .bind(learner_id)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        sqlx::query("INSERT INTO diagnostic_session(diagnostic_session_id,learner_id,release_id,model_version,status,answers_json,started_at,retake_of) VALUES (?,?,?,?,'active','{}',?,?)")
            .bind(session_id)
            .bind(learner_id)
            .bind(release_id)
            .bind(model_version)
            .bind(now)
            .bind(retake_of)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        Ok(serde_json::json!({
            "sessionId":session_id,
            "releaseId":release_id,
            "modelVersion":model_version,
            "resumed":false,
            "answers":{},
            "startedAt":now
        }))
    }

    pub async fn save_diagnostic_answer(
        &self,
        learner_id: &str,
        session_id: &str,
        item_id: &str,
        answer: &crate::diagnostic::DiagnosticAnswer,
    ) -> Result<Value, DbError> {
        let current: Option<String> = sqlx::query_scalar("SELECT answers_json FROM diagnostic_session WHERE diagnostic_session_id=? AND learner_id=? AND status='active'")
            .bind(session_id)
            .bind(learner_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(query_error)?;
        let Some(current) = current else {
            return Err(DbError(
                "diagnostic session is missing or complete".to_owned(),
            ));
        };
        let mut answers: serde_json::Map<String, Value> = serde_json::from_str::<Value>(&current)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        answers.insert(
            item_id.to_owned(),
            serde_json::to_value(answer).map_err(|error| DbError(error.to_string()))?,
        );
        let payload = Value::Object(answers);
        sqlx::query("UPDATE diagnostic_session SET answers_json=? WHERE diagnostic_session_id=?")
            .bind(payload.to_string())
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        Ok(payload)
    }

    pub async fn complete_diagnostic_session(
        &self,
        learner_id: &str,
        session_id: &str,
        placement: &Value,
        now: &str,
    ) -> Result<(), DbError> {
        let result = sqlx::query("UPDATE diagnostic_session SET status='complete',placement_json=?,completed_at=? WHERE diagnostic_session_id=? AND learner_id=? AND status='active'")
            .bind(placement.to_string())
            .bind(now)
            .bind(session_id)
            .bind(learner_id)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        if result.rows_affected() != 1 {
            return Err(DbError(
                "diagnostic session is missing or already complete".to_owned(),
            ));
        }
        Ok(())
    }

    pub async fn diagnostic_answers(
        &self,
        learner_id: &str,
        session_id: &str,
    ) -> Result<Value, DbError> {
        let payload: Option<String> = sqlx::query_scalar("SELECT answers_json FROM diagnostic_session WHERE diagnostic_session_id=? AND learner_id=?")
            .bind(session_id)
            .bind(learner_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(query_error)?;
        payload
            .and_then(|payload| serde_json::from_str(&payload).ok())
            .ok_or_else(|| DbError("diagnostic session not found".to_owned()))
    }

    pub async fn save_learner_plan(
        &self,
        learner_id: &str,
        goal_id: &str,
        goal_title: &str,
        horizon_weeks: u32,
        weekly_capacity_hours: u32,
        now: &str,
    ) -> Result<Value, DbError> {
        sqlx::query("INSERT OR IGNORE INTO learner(learner_id,created_at) VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        sqlx::query("INSERT INTO learner_plan VALUES (?,?,?,?,?,?) ON CONFLICT(learner_id) DO UPDATE SET goal_id=excluded.goal_id,goal_title=excluded.goal_title,horizon_weeks=excluded.horizon_weeks,weekly_capacity_hours=excluded.weekly_capacity_hours,updated_at=excluded.updated_at")
            .bind(learner_id)
            .bind(goal_id)
            .bind(goal_title)
            .bind(i64::from(horizon_weeks))
            .bind(i64::from(weekly_capacity_hours))
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        Ok(serde_json::json!({
            "goalId":goal_id,
            "goalTitle":goal_title,
            "horizonWeeks":horizon_weeks,
            "weeklyCapacityHours":weekly_capacity_hours,
            "updatedAt":now
        }))
    }

    pub async fn learner_plan(&self, learner_id: &str) -> Result<Option<Value>, DbError> {
        let row = sqlx::query("SELECT goal_id,goal_title,horizon_weeks,weekly_capacity_hours,updated_at FROM learner_plan WHERE learner_id=?")
            .bind(learner_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(query_error)?;
        Ok(row.map(|row| {
            serde_json::json!({
                "goalId":row.get::<String,_>("goal_id"),
                "goalTitle":row.get::<String,_>("goal_title"),
                "horizonWeeks":row.get::<i64,_>("horizon_weeks"),
                "weeklyCapacityHours":row.get::<i64,_>("weekly_capacity_hours"),
                "updatedAt":row.get::<String,_>("updated_at")
            })
        }))
    }

    #[allow(clippy::too_many_arguments)] // Mirrors the append-only audit row at this DB boundary.
    pub async fn record_gap_override(
        &self,
        learner_id: &str,
        session_id: &str,
        override_id: &str,
        outcome_id: &str,
        requested_status: &str,
        explanation: &str,
        now: &str,
    ) -> Result<Value, DbError> {
        // An override may only annotate an outcome that appeared in this
        // learner's completed placement for the named session.
        let placement: Option<Option<String>> = sqlx::query_scalar(
            "SELECT placement_json FROM diagnostic_session WHERE diagnostic_session_id=? AND learner_id=? AND status='complete'",
        )
        .bind(session_id)
        .bind(learner_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(query_error)?;
        let placement = placement
            .flatten()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .ok_or_else(|| {
                DbError("the diagnostic session is missing, not yours, or not complete".into())
            })?;
        let in_gap_map = placement["gapMap"].as_array().is_some_and(|entries| {
            entries
                .iter()
                .any(|entry| entry["outcomeId"].as_str() == Some(outcome_id))
        });
        if !in_gap_map {
            return Err(DbError(
                "the outcome is not part of this session's placement gap map".into(),
            ));
        }
        sqlx::query("INSERT INTO gap_override VALUES (?,?,?,?,?,?,?)")
            .bind(override_id)
            .bind(learner_id)
            .bind(session_id)
            .bind(outcome_id)
            .bind(requested_status)
            .bind(explanation)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        Ok(serde_json::json!({
            "overrideId":override_id,
            "outcomeId":outcome_id,
            "requestedStatus":requested_status,
            "explanation":explanation,
            "recordedAt":now,
            "masteryChanged":false
        }))
    }

    pub async fn create_journal_entry(
        &self,
        learner_id: &str,
        entry_id: &str,
        input: &NewJournalEntry,
        now: &str,
    ) -> Result<Value, DbError> {
        sqlx::query("INSERT OR IGNORE INTO learner(learner_id,created_at) VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        let mut transaction = self.pool.begin().await.map_err(query_error)?;
        sqlx::query("INSERT INTO journal_entry VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(entry_id)
            .bind(learner_id)
            .bind(&input.kind)
            .bind(&input.title)
            .bind(&input.body)
            .bind(&input.project_id)
            .bind(&input.concept_id)
            .bind(&input.error_id)
            .bind(&input.support_json)
            .bind(input.confidence)
            .bind(input.reattempt_day)
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(query_error)?;
        sqlx::query("INSERT INTO journal_search VALUES (?,?,?,?,?,?)")
            .bind(entry_id)
            .bind(&input.title)
            .bind(&input.body)
            .bind(input.project_id.as_deref().unwrap_or_default())
            .bind(input.concept_id.as_deref().unwrap_or_default())
            .bind(input.error_id.as_deref().unwrap_or_default())
            .execute(&mut *transaction)
            .await
            .map_err(query_error)?;
        transaction.commit().await.map_err(query_error)?;
        Ok(serde_json::json!({"entryId":entry_id,"createdAt":now}))
    }

    #[allow(clippy::too_many_arguments)] // Optional search facets map directly to the query contract.
    pub async fn journal_entries(
        &self,
        learner_id: &str,
        query: Option<&str>,
        project_id: Option<&str>,
        concept_id: Option<&str>,
        error_id: Option<&str>,
        from: Option<i64>,
        to: Option<i64>,
        limit: usize,
    ) -> Result<Vec<Value>, DbError> {
        let rows = if let Some(query) = query.and_then(crate::graph::safe_fts_query) {
            sqlx::query("SELECT j.* FROM journal_search JOIN journal_entry j ON j.entry_id=journal_search.entry_id WHERE journal_search MATCH ? AND j.learner_id=? AND (? IS NULL OR j.project_id=?) AND (? IS NULL OR j.concept_id=?) AND (? IS NULL OR j.error_id=?) AND (? IS NULL OR CAST(j.created_at AS INTEGER)>=?) AND (? IS NULL OR CAST(j.created_at AS INTEGER)<=?) ORDER BY CAST(j.created_at AS INTEGER) DESC,j.entry_id LIMIT ?")
                .bind(query)
                .bind(learner_id)
                .bind(project_id).bind(project_id)
                .bind(concept_id).bind(concept_id)
                .bind(error_id).bind(error_id)
                .bind(from).bind(from)
                .bind(to).bind(to)
                .bind(i64::try_from(limit.clamp(1, 100)).expect("journal limit"))
                .fetch_all(&self.pool).await.map_err(query_error)?
        } else {
            sqlx::query("SELECT * FROM journal_entry WHERE learner_id=? AND (? IS NULL OR project_id=?) AND (? IS NULL OR concept_id=?) AND (? IS NULL OR error_id=?) AND (? IS NULL OR CAST(created_at AS INTEGER)>=?) AND (? IS NULL OR CAST(created_at AS INTEGER)<=?) ORDER BY CAST(created_at AS INTEGER) DESC,entry_id LIMIT ?")
                .bind(learner_id)
                .bind(project_id).bind(project_id)
                .bind(concept_id).bind(concept_id)
                .bind(error_id).bind(error_id)
                .bind(from).bind(from)
                .bind(to).bind(to)
                .bind(i64::try_from(limit.clamp(1, 100)).expect("journal limit"))
                .fetch_all(&self.pool).await.map_err(query_error)?
        };
        Ok(rows.into_iter().map(|row| serde_json::json!({
            "entryId":row.get::<String,_>("entry_id"),
            "kind":row.get::<String,_>("kind"),
            "title":row.get::<String,_>("title"),
            "body":row.get::<String,_>("body"),
            "projectId":row.get::<Option<String>,_>("project_id"),
            "conceptId":row.get::<Option<String>,_>("concept_id"),
            "errorId":row.get::<Option<String>,_>("error_id"),
            "support":serde_json::from_str::<Value>(&row.get::<String,_>("support_json")).unwrap_or_else(|_| serde_json::json!("unknown")),
            "confidence":row.get::<Option<i64>,_>("confidence"),
            "reattemptDay":row.get::<Option<i64>,_>("reattempt_day"),
            "createdAt":row.get::<String,_>("created_at")
        })).collect())
    }

    pub async fn record_error(
        &self,
        learner_id: &str,
        error_id: &str,
        occurrence_id: &str,
        input: &NewErrorRecord,
        now: &str,
    ) -> Result<Value, DbError> {
        sqlx::query("INSERT OR IGNORE INTO learner(learner_id,created_at) VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                format!(
                    "{}\0{}",
                    input.code.trim(),
                    input.root_cause.trim().to_lowercase()
                )
                .as_bytes()
            )
        );
        let mut transaction = self.pool.begin().await.map_err(query_error)?;
        sqlx::query("INSERT INTO error_catalog VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(learner_id,fingerprint) DO UPDATE SET correction=excluded.correction,future_cue=excluded.future_cue,concept_ids_json=excluded.concept_ids_json,updated_at=excluded.updated_at")
            .bind(error_id).bind(learner_id).bind(&fingerprint).bind(&input.code).bind(&input.root_cause).bind(&input.correction).bind(&input.future_cue).bind(&input.concept_ids_json).bind(now).bind(now)
            .execute(&mut *transaction).await.map_err(query_error)?;
        let canonical_id: String = sqlx::query_scalar(
            "SELECT error_id FROM error_catalog WHERE learner_id=? AND fingerprint=?",
        )
        .bind(learner_id)
        .bind(&fingerprint)
        .fetch_one(&mut *transaction)
        .await
        .map_err(query_error)?;
        sqlx::query("INSERT INTO error_occurrence VALUES (?,?,?,?,?)")
            .bind(occurrence_id)
            .bind(&canonical_id)
            .bind(&input.attempt_id)
            .bind(&input.evaluator_run_id)
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(query_error)?;
        transaction.commit().await.map_err(query_error)?;
        Ok(
            serde_json::json!({"errorId":canonical_id,"occurrenceId":occurrence_id,"fingerprint":fingerprint}),
        )
    }

    pub async fn error_catalog(&self, learner_id: &str) -> Result<Vec<Value>, DbError> {
        let rows = sqlx::query("SELECT e.*,COUNT(o.occurrence_id) AS occurrence_count,MAX(o.occurred_at) AS latest_occurrence FROM error_catalog e LEFT JOIN error_occurrence o ON o.error_id=e.error_id WHERE e.learner_id=? GROUP BY e.error_id ORDER BY latest_occurrence DESC,e.error_id")
            .bind(learner_id).fetch_all(&self.pool).await.map_err(query_error)?;
        Ok(rows.into_iter().map(|row| serde_json::json!({
            "errorId":row.get::<String,_>("error_id"),"code":row.get::<String,_>("code"),"rootCause":row.get::<String,_>("root_cause"),"correction":row.get::<String,_>("correction"),"futureCue":row.get::<String,_>("future_cue"),"conceptIds":serde_json::from_str::<Value>(&row.get::<String,_>("concept_ids_json")).unwrap_or_else(|_| serde_json::json!([])),"occurrenceCount":row.get::<i64,_>("occurrence_count"),"latestOccurrence":row.get::<Option<String>,_>("latest_occurrence")
        })).collect())
    }

    pub async fn register_project_artifact(
        &self,
        learner_id: &str,
        registration_id: &str,
        input: &NewProjectArtifact,
        now: &str,
    ) -> Result<Value, DbError> {
        sqlx::query("INSERT OR IGNORE INTO learner(learner_id,created_at) VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        sqlx::query("INSERT INTO project_artifact_registration VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(registration_id)
            .bind(learner_id)
            .bind(&input.project_id)
            .bind(&input.stage_id)
            .bind(&input.kind)
            .bind(&input.local_path)
            .bind(&input.pasted_text)
            .bind(&input.checksum)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        Ok(
            serde_json::json!({"registrationId":registration_id,"checksum":input.checksum,"executed":false,"createdAt":now}),
        )
    }

    pub async fn project_checkpoints(
        &self,
        learner_id: &str,
        project_id: &str,
    ) -> Result<Vec<Value>, DbError> {
        let rows = sqlx::query("SELECT * FROM project_checkpoint WHERE learner_id=? AND project_id=? ORDER BY created_at,checkpoint_id")
            .bind(learner_id).bind(project_id).fetch_all(&self.pool).await.map_err(query_error)?;
        Ok(rows.into_iter().map(|row| serde_json::json!({
            "checkpointId":row.get::<String,_>("checkpoint_id"),
            "projectId":row.get::<String,_>("project_id"),
            "stageId":row.get::<String,_>("stage_id"),
            "parentCheckpointId":row.get::<Option<String>,_>("parent_checkpoint_id"),
            "workspaceChecksum":row.get::<String,_>("workspace_checksum"),
            "status":row.get::<String,_>("status"),
            "evaluatorRunId":row.get::<Option<String>,_>("evaluator_run_id"),
            "regressions":serde_json::from_str::<Value>(&row.get::<String,_>("regression_json")).unwrap_or_else(|_| serde_json::json!([])),
            "createdAt":row.get::<String,_>("created_at")
        })).collect())
    }

    pub async fn create_project_checkpoint(
        &self,
        learner_id: &str,
        checkpoint_id: &str,
        input: &NewProjectCheckpoint,
        now: &str,
    ) -> Result<Value, DbError> {
        let mut tx = self.pool.begin().await.map_err(query_error)?;
        sqlx::query("INSERT OR IGNORE INTO learner VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?;
        if let Some(parent) = input.parent_checkpoint_id.as_deref() {
            let valid_parent: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM project_checkpoint WHERE checkpoint_id=? AND learner_id=? AND project_id=?")
                .bind(parent).bind(learner_id).bind(&input.project_id).fetch_one(&mut *tx).await.map_err(query_error)?;
            if valid_parent != 1 {
                return Err(DbError(
                    "checkpoint parent is missing or belongs to another project".into(),
                ));
            }
        }
        let lineage_rows = sqlx::query(
            "SELECT checkpoint_id, stage_id, parent_checkpoint_id, workspace_checksum, status FROM project_checkpoint WHERE learner_id=? AND project_id=?",
        )
        .bind(learner_id)
        .bind(&input.project_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(query_error)?;
        let mut lineage: Vec<crate::project::ProjectCheckpoint> = lineage_rows
            .into_iter()
            .map(|row| crate::project::ProjectCheckpoint {
                checkpoint_id: row.get("checkpoint_id"),
                stage_id: row.get("stage_id"),
                parent_checkpoint_id: row.get("parent_checkpoint_id"),
                workspace_checksum: row.get("workspace_checksum"),
                status: row.get("status"),
            })
            .collect();
        lineage.push(crate::project::ProjectCheckpoint {
            checkpoint_id: checkpoint_id.to_owned(),
            stage_id: input.stage_id.clone(),
            parent_checkpoint_id: input.parent_checkpoint_id.clone(),
            workspace_checksum: input.workspace_checksum.clone(),
            status: input.status.clone(),
        });
        crate::project::validate_lineage(&lineage).map_err(DbError)?;
        sqlx::query("INSERT INTO project_checkpoint VALUES (?,?,?,?,?,?,?,?,?,?)")
            .bind(checkpoint_id)
            .bind(learner_id)
            .bind(&input.project_id)
            .bind(&input.stage_id)
            .bind(&input.parent_checkpoint_id)
            .bind(&input.workspace_checksum)
            .bind(&input.status)
            .bind(&input.evaluator_run_id)
            .bind(&input.regression_json)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?;
        tx.commit().await.map_err(query_error)?;
        Ok(serde_json::json!({
            "checkpointId":checkpoint_id,"projectId":input.project_id,"stageId":input.stage_id,
            "parentCheckpointId":input.parent_checkpoint_id,"workspaceChecksum":input.workspace_checksum,
            "status":input.status,"createdAt":now,"canonicalEvidencePreserved":true
        }))
    }

    pub async fn project_portfolio_evidence(
        &self,
        learner_id: &str,
        project_id: &str,
    ) -> Result<Value, DbError> {
        let artifacts: String = sqlx::query_scalar("SELECT COALESCE(json_group_array(json_object('registrationId',registration_id,'stageId',stage_id,'kind',kind,'checksum',checksum,'createdAt',created_at)),'[]') FROM project_artifact_registration WHERE learner_id=? AND project_id=? ORDER BY created_at,registration_id")
            .bind(learner_id).bind(project_id).fetch_one(&self.pool).await.map_err(query_error)?;
        let checkpoints = self.project_checkpoints(learner_id, project_id).await?;
        let journal: String = sqlx::query_scalar("SELECT COALESCE(json_group_array(json_object('entryId',entry_id,'kind',kind,'title',title,'conceptId',concept_id,'errorId',error_id,'confidence',confidence,'reattemptDay',reattempt_day,'createdAt',created_at)),'[]') FROM journal_entry WHERE learner_id=? AND project_id=? ORDER BY created_at,entry_id")
            .bind(learner_id).bind(project_id).fetch_one(&self.pool).await.map_err(query_error)?;
        let payload = serde_json::json!({
            "projectId":project_id,
            "artifacts":serde_json::from_str::<Value>(&artifacts).map_err(|error|DbError(error.to_string()))?,
            "checkpoints":checkpoints,
            "journalMetadata":serde_json::from_str::<Value>(&journal).map_err(|error|DbError(error.to_string()))?,
            "excluded":["learner source files","pasted artifact bodies","machine paths","session tokens","environment"]
        });
        let checksum = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&payload).expect("portfolio JSON"))
        );
        Ok(serde_json::json!({
            "manifest":{"schemaVersion":1,"format":"rust-tutor-portfolio-evidence","checksumSha256":checksum,"privacy":"metadata and checksums only"},
            "payload":payload
        }))
    }

    pub async fn start_focus_session(
        &self,
        learner_id: &str,
        session_id: &str,
        mode: &str,
        intention: &str,
        now: &str,
    ) -> Result<Value, DbError> {
        sqlx::query("INSERT OR IGNORE INTO learner(learner_id,created_at) VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        sqlx::query("INSERT INTO focus_session VALUES (?,?,?,?, '[]',NULL,?,NULL)")
            .bind(session_id)
            .bind(learner_id)
            .bind(mode)
            .bind(intention)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        Ok(
            serde_json::json!({"focusSessionId":session_id,"mode":mode,"intention":intention,"startedAt":now,"timeIsMasteryEvidence":false,"surveillance":false}),
        )
    }

    pub async fn finish_focus_session(
        &self,
        learner_id: &str,
        session_id: &str,
        interruption_notes: &[String],
        end_review: &str,
        now: &str,
    ) -> Result<Value, DbError> {
        let changed = sqlx::query("UPDATE focus_session SET interruption_notes_json=?,end_review=?,ended_at=? WHERE focus_session_id=? AND learner_id=? AND ended_at IS NULL")
            .bind(serde_json::to_string(interruption_notes).expect("interruption JSON"))
            .bind(end_review).bind(now).bind(session_id).bind(learner_id)
            .execute(&self.pool).await.map_err(query_error)?.rows_affected();
        if changed != 1 {
            return Err(DbError("focus session is missing or already ended".into()));
        }
        Ok(serde_json::json!({
            "focusSessionId":session_id,"endedAt":now,"interruptionNotes":interruption_notes,
            "endReview":end_review,"timeIsMasteryEvidence":false,"surveillance":false
        }))
    }

    pub async fn hint_dependence(&self, learner_id: &str) -> Result<Value, DbError> {
        let rows = sqlx::query("SELECT a.item_id,a.item_version,e.payload_json,e.occurred_at FROM attempt_event e JOIN attempt a ON a.attempt_id=e.attempt_id JOIN learning_session s ON s.session_id=a.session_id WHERE s.learner_id=? AND e.kind='support_used' ORDER BY a.item_id,a.item_version,CAST(e.occurred_at AS INTEGER),e.event_id")
            .bind(learner_id).fetch_all(&self.pool).await.map_err(query_error)?;
        let mut groups = std::collections::BTreeMap::<(String, i64), Vec<f64>>::new();
        for row in rows {
            let payload = serde_json::from_str::<Value>(&row.get::<String, _>("payload_json"))
                .unwrap_or(Value::Null);
            let score = match payload.get("support") {
                Some(Value::String(value))
                    if value == "none" || value == "compiler" || value == "official_docs" =>
                {
                    0.0
                }
                Some(Value::String(value))
                    if value == "solution_viewed" || value == "external_help" =>
                {
                    7.0
                }
                Some(Value::Object(_)) => payload
                    .get("hintLevel")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
                _ => payload
                    .get("hintLevel")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
            };
            groups
                .entry((row.get("item_id"), row.get("item_version")))
                .or_default()
                .push(score);
        }
        let comparable = groups.into_iter().filter_map(|((item_id,item_version),scores)| {
            if scores.len() < 4 { return None; }
            let midpoint = scores.len()/2;
            let first = scores[..midpoint].iter().sum::<f64>()/midpoint as f64;
            let last = scores[midpoint..].iter().sum::<f64>()/(scores.len()-midpoint) as f64;
            Some(serde_json::json!({"itemId":item_id,"itemVersion":item_version,"sample":scores.len(),"firstHalfAverageSupportLevel":first,"secondHalfAverageSupportLevel":last,"declining":last<first}))
        }).collect::<Vec<_>>();
        Ok(serde_json::json!({
            "status":if comparable.is_empty(){"insufficient_evidence"}else{"measured"},
            "minimumComparableAttempts":4,"comparisonClass":"same item ID and version only",
            "groups":comparable,"crossDifficultyComparison":false
        }))
    }

    pub async fn record_question_attempt(
        &self,
        learner_id: &str,
        input: &NewQuestionAttempt,
        now: &str,
    ) -> Result<Value, DbError> {
        let mut tx = self.pool.begin().await.map_err(query_error)?;
        sqlx::query("INSERT OR IGNORE INTO learner(learner_id,created_at) VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?;
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO quiz_attempt_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(&input.attempt_id)
        .bind(&input.idempotency_key)
        .bind(learner_id)
        .bind(&input.question_id)
        .bind(input.question_version)
        .bind(&input.response_json)
        .bind(&input.result_json)
        .bind(input.score)
        .bind(input.correct)
        .bind(&input.support_json)
        .bind(input.confidence)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(query_error)?
        .rows_affected();
        let canonical = sqlx::query("SELECT * FROM quiz_attempt_event WHERE idempotency_key=?")
            .bind(&input.idempotency_key)
            .fetch_one(&mut *tx)
            .await
            .map_err(query_error)?;
        if canonical.get::<String, _>("learner_id") != learner_id
            || canonical.get::<String, _>("question_id") != input.question_id
            || canonical.get::<i64, _>("question_version") != input.question_version
            || canonical.get::<String, _>("response_json") != input.response_json
        {
            return Err(DbError(
                "idempotency key was already used for a different question submission".into(),
            ));
        }
        let history_sql = format!(
            "SELECT score,correct,support_json,confidence,created_at,attempt_id FROM quiz_attempt_event WHERE learner_id=?1 AND question_id=?2 AND question_version=?3 AND CAST(created_at AS INTEGER) > {RESET_BASELINE_SUBQUERY} ORDER BY CAST(created_at AS INTEGER),attempt_id"
        );
        let history = sqlx::query(sqlx::AssertSqlSafe(history_sql))
            .bind(learner_id)
            .bind(&input.question_id)
            .bind(input.question_version)
            .fetch_all(&mut *tx)
            .await
            .map_err(query_error)?;
        let first = history
            .first()
            .expect("the canonical insert or retry exists");
        let best_score = history
            .iter()
            .map(|row| row.get::<f64, _>("score"))
            .fold(0.0_f64, f64::max);
        tx.commit().await.map_err(query_error)?;
        Ok(serde_json::json!({
            "attemptId":canonical.get::<String,_>("attempt_id"),
            "idempotentRetry":inserted == 0,
            "firstResult":{
                "score":first.get::<f64,_>("score"),
                "correct":first.get::<i64,_>("correct") == 1,
                "support":serde_json::from_str::<Value>(&first.get::<String,_>("support_json")).unwrap_or(Value::Null),
                "confidence":first.get::<i64,_>("confidence")
            },
            "bestResult":{"score":best_score,"correct":best_score >= 1.0},
            "attemptCount":history.len(),
            "support":serde_json::from_str::<Value>(&canonical.get::<String,_>("support_json")).unwrap_or(Value::Null),
            "confidence":canonical.get::<i64,_>("confidence")
        }))
    }

    /// Persists a finished non-streaming evaluator run so later evidence
    /// recording can verify the run server-side. Run IDs are single-use.
    #[allow(clippy::too_many_arguments)] // Mirrors the persisted run row at this DB boundary.
    pub async fn record_completed_run(
        &self,
        learner_id: &str,
        run_id: &str,
        exercise_id: &str,
        action: &str,
        workspace_checksum: &str,
        state: &str,
        result: &Value,
        now: &str,
    ) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await.map_err(query_error)?;
        sqlx::query("INSERT OR IGNORE INTO learner VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?;
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO evaluation_stream_run(run_id,learner_id,state,chunks_json,result_json,created_at,updated_at,exercise_id,action,workspace_checksum) VALUES (?,?,?,'[]',?,?,?,?,?,?)",
        )
        .bind(run_id)
        .bind(learner_id)
        .bind(state)
        .bind(result.to_string())
        .bind(now)
        .bind(now)
        .bind(exercise_id)
        .bind(action)
        .bind(workspace_checksum)
        .execute(&mut *tx)
        .await
        .map_err(query_error)?
        .rows_affected();
        if inserted != 1 {
            return Err(DbError(
                "the evaluator run ID was already recorded; run IDs are single-use".into(),
            ));
        }
        tx.commit().await.map_err(query_error)
    }

    /// Records an explicit review rating and refolds the concept's schedule.
    pub async fn apply_review_rating(
        &self,
        learner_id: &str,
        concept_id: &str,
        rating: &str,
        day: u32,
        rating_id: &str,
        now: &str,
    ) -> Result<Value, DbError> {
        let mut tx = self.pool.begin().await.map_err(query_error)?;
        let scheduled: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM review_projection WHERE learner_id=? AND concept_id=?",
        )
        .bind(learner_id)
        .bind(concept_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(query_error)?;
        if scheduled != 1 {
            return Err(DbError(
                "no scheduled review exists for that concept; ratings require scored evidence"
                    .into(),
            ));
        }
        sqlx::query("INSERT INTO review_rating VALUES (?,?,?,?,?,?)")
            .bind(rating_id)
            .bind(learner_id)
            .bind(concept_id)
            .bind(rating)
            .bind(i64::from(day))
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?;
        rebuild_concept(
            &mut tx,
            learner_id,
            concept_id,
            learning::MASTERY_MODEL_VERSION,
        )
        .await?;
        let row = sqlx::query(
            "SELECT due_day, interval_index, reason FROM review_projection WHERE learner_id=? AND concept_id=?",
        )
        .bind(learner_id)
        .bind(concept_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(query_error)?;
        tx.commit().await.map_err(query_error)?;
        Ok(serde_json::json!({
            "ratingId":rating_id,"conceptId":concept_id,"rating":rating,"day":day,
            "dueDay":row.get::<i64,_>("due_day"),"intervalIndex":row.get::<i64,_>("interval_index"),
            "reason":row.get::<String,_>("reason"),"modelVersion":learning::SCHEDULER_MODEL_VERSION
        }))
    }

    pub async fn create_evaluation_stream(
        &self,
        learner_id: &str,
        run_id: &str,
        exercise_id: &str,
        action: &str,
        workspace_checksum: &str,
        now: &str,
    ) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await.map_err(query_error)?;
        sqlx::query("INSERT OR IGNORE INTO learner VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?;
        sqlx::query("INSERT INTO evaluation_stream_run(run_id,learner_id,state,chunks_json,result_json,created_at,updated_at,exercise_id,action,workspace_checksum) VALUES (?,?,'queued','[]',NULL,?,?,?,?,?)")
            .bind(run_id)
            .bind(learner_id)
            .bind(now)
            .bind(now)
            .bind(exercise_id)
            .bind(action)
            .bind(workspace_checksum)
            .execute(&mut *tx)
            .await
            .map_err(query_error)?;
        tx.commit().await.map_err(query_error)
    }

    pub async fn mark_evaluation_stream_running(
        &self,
        run_id: &str,
        now: &str,
    ) -> Result<(), DbError> {
        let changed = sqlx::query("UPDATE evaluation_stream_run SET state='running',updated_at=? WHERE run_id=? AND state='queued'")
            .bind(now).bind(run_id).execute(&self.pool).await.map_err(query_error)?.rows_affected();
        if changed != 1 {
            return Err(DbError("evaluation stream is missing or not queued".into()));
        }
        Ok(())
    }

    pub async fn append_evaluation_stream_chunk(
        &self,
        run_id: &str,
        chunk: &crate::evaluator::OutputChunk,
        now: &str,
    ) -> Result<(), DbError> {
        let current: String =
            sqlx::query_scalar("SELECT chunks_json FROM evaluation_stream_run WHERE run_id=?")
                .bind(run_id)
                .fetch_one(&self.pool)
                .await
                .map_err(query_error)?;
        let mut chunks = serde_json::from_str::<Vec<crate::evaluator::OutputChunk>>(&current)
            .map_err(|error| DbError(error.to_string()))?;
        chunks.push(chunk.clone());
        let encoded = serde_json::to_string(&chunks).expect("stream chunks JSON");
        if encoded.len() > 512 * 1024 {
            return Err(DbError(
                "evaluation stream persistence limit exceeded".into(),
            ));
        }
        sqlx::query("UPDATE evaluation_stream_run SET chunks_json=?,updated_at=? WHERE run_id=? AND state='running'")
            .bind(encoded).bind(now).bind(run_id).execute(&self.pool).await.map_err(query_error)?;
        Ok(())
    }

    pub async fn finish_evaluation_stream(
        &self,
        run_id: &str,
        state: &str,
        result: &Value,
        now: &str,
    ) -> Result<(), DbError> {
        let changed = sqlx::query("UPDATE evaluation_stream_run SET state=?,result_json=?,updated_at=? WHERE run_id=? AND state IN ('queued','running')")
            .bind(state).bind(result.to_string()).bind(now).bind(run_id).execute(&self.pool).await.map_err(query_error)?.rows_affected();
        if changed != 1 {
            return Err(DbError(
                "evaluation stream is missing or already final".into(),
            ));
        }
        Ok(())
    }

    pub async fn evaluation_stream(
        &self,
        learner_id: &str,
        run_id: &str,
    ) -> Result<Option<Value>, DbError> {
        let row =
            sqlx::query("SELECT * FROM evaluation_stream_run WHERE learner_id=? AND run_id=?")
                .bind(learner_id)
                .bind(run_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(query_error)?;
        Ok(row.map(|row| serde_json::json!({
            "runId":row.get::<String,_>("run_id"),"state":row.get::<String,_>("state"),
            "exerciseId":row.get::<Option<String>,_>("exercise_id"),"action":row.get::<Option<String>,_>("action"),
            "workspaceChecksum":row.get::<Option<String>,_>("workspace_checksum"),
            "chunks":serde_json::from_str::<Value>(&row.get::<String,_>("chunks_json")).unwrap_or_else(|_|serde_json::json!([])),
            "result":row.get::<Option<String>,_>("result_json").and_then(|value|serde_json::from_str::<Value>(&value).ok()),
            "createdAt":row.get::<String,_>("created_at"),"updatedAt":row.get::<String,_>("updated_at"),
            "recoverable":true
        })))
    }

    pub async fn accept_workbench_item(
        &self,
        learner_id: &str,
        item_id: &str,
        item_kind: &str,
        unlocked_item_id: &str,
        run_id: &str,
        now: &str,
    ) -> Result<Value, DbError> {
        let stream = self
            .evaluation_stream(learner_id, run_id)
            .await?
            .ok_or_else(|| DbError("the evaluator run does not exist".into()))?;
        if stream["state"] != "completed"
            || stream["exerciseId"] != item_id
            || stream["action"] != "test"
            || stream["result"]["status"] != "ACCEPTED"
        {
            return Err(DbError(
                "unlock requires this item's completed accepted Submit run".into(),
            ));
        }
        let checksum = stream["workspaceChecksum"]
            .as_str()
            .ok_or_else(|| DbError("the evaluator run has no workspace checksum".into()))?;
        sqlx::query("INSERT INTO workbench_completion(learner_id,item_id,item_kind,unlocked_item_id,evaluator_run_id,workspace_checksum,accepted_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(learner_id,item_id) DO UPDATE SET item_kind=excluded.item_kind,unlocked_item_id=excluded.unlocked_item_id,evaluator_run_id=excluded.evaluator_run_id,workspace_checksum=excluded.workspace_checksum,accepted_at=excluded.accepted_at")
            .bind(learner_id).bind(item_id).bind(item_kind).bind(unlocked_item_id).bind(run_id).bind(checksum).bind(now)
            .execute(&self.pool).await.map_err(query_error)?;
        let row =
            sqlx::query("SELECT * FROM workbench_completion WHERE learner_id=? AND item_id=?")
                .bind(learner_id)
                .bind(item_id)
                .fetch_one(&self.pool)
                .await
                .map_err(query_error)?;
        Ok(serde_json::json!({
            "itemId":row.get::<String,_>("item_id"),"itemKind":row.get::<String,_>("item_kind"),
            "unlockedItemId":row.get::<String,_>("unlocked_item_id"),"evaluatorRunId":row.get::<String,_>("evaluator_run_id"),
            "workspaceChecksum":row.get::<String,_>("workspace_checksum"),"acceptedAt":row.get::<String,_>("accepted_at")
        }))
    }

    pub async fn workbench_progress(&self, learner_id: &str) -> Result<Vec<Value>, DbError> {
        let sql = format!(
            "SELECT * FROM workbench_completion WHERE learner_id=?1 AND CAST(accepted_at AS INTEGER) > {RESET_BASELINE_SUBQUERY} ORDER BY accepted_at,item_id"
        );
        let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(learner_id)
            .fetch_all(&self.pool)
            .await
            .map_err(query_error)?;
        Ok(rows.into_iter().map(|row| serde_json::json!({
            "itemId":row.get::<String,_>("item_id"),"itemKind":row.get::<String,_>("item_kind"),
            "unlockedItemId":row.get::<String,_>("unlocked_item_id"),"evaluatorRunId":row.get::<String,_>("evaluator_run_id"),
            "workspaceChecksum":row.get::<String,_>("workspace_checksum"),"acceptedAt":row.get::<String,_>("accepted_at")
        })).collect())
    }

    /// Durable per-chapter course progress, filtered by the reset baseline so a
    /// learner's data reset drops stale rows exactly like other progress reads.
    pub async fn course_progress(&self, learner_id: &str) -> Result<Vec<Value>, DbError> {
        let sql = format!(
            "SELECT chapter_id,cleared_stops,ran,updated_at FROM course_chapter_progress WHERE learner_id=?1 AND CAST(updated_at AS INTEGER) > {RESET_BASELINE_SUBQUERY} ORDER BY chapter_id"
        );
        let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(learner_id)
            .fetch_all(&self.pool)
            .await
            .map_err(query_error)?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let stops: Vec<String> =
                    serde_json::from_str(&row.get::<String, _>("cleared_stops"))
                        .unwrap_or_default();
                serde_json::json!({
                    "chapterId": row.get::<String, _>("chapter_id"),
                    "clearedStops": stops,
                    "ran": row.get::<i64, _>("ran") != 0,
                    "updatedAt": row.get::<String, _>("updated_at"),
                })
            })
            .collect())
    }

    /// Merge an incremental chapter update. Cleared stops union with any prior
    /// (post-reset) set and `ran` is monotonic, so a stale client can never
    /// erase progress; a row predating the last reset is revived fresh.
    pub async fn upsert_course_progress(
        &self,
        learner_id: &str,
        chapter_id: &str,
        cleared_stops: &[String],
        ran: bool,
        now: &str,
    ) -> Result<Value, DbError> {
        sqlx::query("INSERT OR IGNORE INTO learner VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        let mut transaction = self.pool.begin().await.map_err(query_error)?;
        let existing = sqlx::query(sqlx::AssertSqlSafe(format!(
            "SELECT cleared_stops,ran FROM course_chapter_progress WHERE learner_id=?1 AND chapter_id=?2 AND CAST(updated_at AS INTEGER) > {RESET_BASELINE_SUBQUERY}"
        )))
        .bind(learner_id)
        .bind(chapter_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(query_error)?;
        let mut merged: std::collections::BTreeSet<String> =
            cleared_stops.iter().cloned().collect();
        let mut merged_ran = ran;
        if let Some(row) = existing {
            let prior: Vec<String> =
                serde_json::from_str(&row.get::<String, _>("cleared_stops")).unwrap_or_default();
            merged.extend(prior);
            merged_ran = merged_ran || row.get::<i64, _>("ran") != 0;
        }
        let stops: Vec<&String> = merged.iter().collect();
        let stops_json =
            serde_json::to_string(&stops).map_err(|error| db_error("serialize stops", error))?;
        sqlx::query(
            "INSERT INTO course_chapter_progress (learner_id,chapter_id,cleared_stops,ran,updated_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(learner_id,chapter_id) DO UPDATE SET cleared_stops=?3,ran=?4,updated_at=?5",
        )
        .bind(learner_id)
        .bind(chapter_id)
        .bind(&stops_json)
        .bind(i64::from(merged_ran))
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(query_error)?;
        transaction.commit().await.map_err(query_error)?;
        Ok(serde_json::json!({
            "chapterId": chapter_id,
            "clearedStops": stops,
            "ran": merged_ran,
            "updatedAt": now,
        }))
    }

    #[allow(clippy::too_many_arguments)] // Mirrors the immutable bookmark evidence row at this DB boundary.
    pub async fn save_external_bookmark(
        &self,
        learner_id: &str,
        bookmark_id: &str,
        platform: &str,
        url_or_id: &str,
        local_exercise_id: Option<&str>,
        pattern_id: Option<&str>,
        status: &str,
        notes: &str,
        support_json: &str,
        confidence: Option<i64>,
        reattempt_day: Option<i64>,
        now: &str,
    ) -> Result<Value, DbError> {
        sqlx::query("INSERT OR IGNORE INTO learner VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        sqlx::query("INSERT INTO external_practice_bookmark VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(bookmark_id)
            .bind(learner_id)
            .bind(platform)
            .bind(url_or_id)
            .bind(local_exercise_id)
            .bind(pattern_id)
            .bind(status)
            .bind(notes)
            .bind(support_json)
            .bind(confidence)
            .bind(reattempt_day)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        Ok(
            serde_json::json!({"bookmarkId":bookmark_id,"createdAt":now,"externalContentFetched":false,"masteryChanged":false}),
        )
    }

    pub async fn open_exam_session(
        &self,
        learner_id: &str,
        session_id: &str,
        exam: &crate::exam::FinalExam,
        retake: bool,
        now: &str,
    ) -> Result<Value, DbError> {
        sqlx::query("INSERT OR IGNORE INTO learner(learner_id,created_at) VALUES (?,?)")
            .bind(learner_id)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(query_error)?;
        let resume_sql = format!(
            "SELECT session_id,answers_json,started_at FROM final_exam_session WHERE learner_id=?1 AND status='active' AND CAST(started_at AS INTEGER) > {RESET_BASELINE_SUBQUERY}"
        );
        if !retake
            && let Some(row) = sqlx::query(sqlx::AssertSqlSafe(resume_sql.clone()))
                .bind(learner_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(query_error)?
        {
            return Ok(serde_json::json!({
                "sessionId":row.get::<String,_>("session_id"),"resumed":true,
                "answers":serde_json::from_str::<Value>(&row.get::<String,_>("answers_json")).unwrap_or_else(|_| serde_json::json!({})),
                "startedAt":row.get::<String,_>("started_at"),"formId":exam.form_id,"formVersion":exam.form_version
            }));
        }
        let mut transaction = self.pool.begin().await.map_err(query_error)?;
        if retake {
            // An unfinished attempt is abandoned, never reported as completed,
            // and its result stays NULL.
            sqlx::query("UPDATE final_exam_session SET status='abandoned',completed_at=COALESCE(completed_at,?) WHERE learner_id=? AND status='active'")
                .bind(now).bind(learner_id).execute(&mut *transaction).await.map_err(query_error)?;
        } else {
            let close_stale = format!(
                "UPDATE final_exam_session SET status='abandoned',completed_at=COALESCE(completed_at,?2) WHERE learner_id=?1 AND status='active' AND CAST(started_at AS INTEGER) <= {RESET_BASELINE_SUBQUERY}"
            );
            sqlx::query(sqlx::AssertSqlSafe(close_stale))
                .bind(learner_id)
                .bind(now)
                .execute(&mut *transaction)
                .await
                .map_err(query_error)?;
        }
        let checksums = exam
            .items
            .iter()
            .map(|item| (&item.id, &item.item_checksum))
            .collect::<std::collections::BTreeMap<_, _>>();
        sqlx::query("INSERT INTO final_exam_session VALUES (?,?,?,?,?,'{}',NULL,'active',?,NULL)")
            .bind(session_id)
            .bind(learner_id)
            .bind(&exam.form_id)
            .bind(&exam.form_version)
            .bind(serde_json::to_string(&checksums).expect("exam checksums JSON"))
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(query_error)?;
        transaction.commit().await.map_err(query_error)?;
        Ok(
            serde_json::json!({"sessionId":session_id,"resumed":false,"answers":{},"startedAt":now,"formId":exam.form_id,"formVersion":exam.form_version}),
        )
    }

    pub async fn save_exam_answer(
        &self,
        learner_id: &str,
        session_id: &str,
        item_id: &str,
        answer: &crate::exam::ExamAnswer,
    ) -> Result<Value, DbError> {
        let raw: String = sqlx::query_scalar("SELECT answers_json FROM final_exam_session WHERE session_id=? AND learner_id=? AND status='active'")
            .bind(session_id).bind(learner_id).fetch_one(&self.pool).await.map_err(query_error)?;
        let mut answers: serde_json::Map<String, Value> = serde_json::from_str(&raw)
            .map_err(|error| DbError(format!("invalid stored exam answers: {error}")))?;
        if answers.contains_key(item_id) {
            return Err(DbError(
                "this exam item is already committed and cannot be edited within the attempt"
                    .into(),
            ));
        }
        answers.insert(
            item_id.to_owned(),
            serde_json::to_value(answer).expect("exam answer JSON"),
        );
        sqlx::query("UPDATE final_exam_session SET answers_json=? WHERE session_id=? AND learner_id=? AND status='active'")
            .bind(Value::Object(answers.clone()).to_string()).bind(session_id).bind(learner_id)
            .execute(&self.pool).await.map_err(query_error)?;
        Ok(
            serde_json::json!({"sessionId":session_id,"savedItemId":item_id,"answerCount":answers.len(),"answers":answers}),
        )
    }

    pub async fn exam_answers(
        &self,
        learner_id: &str,
        session_id: &str,
    ) -> Result<std::collections::HashMap<String, crate::exam::ExamAnswer>, DbError> {
        let raw: String = sqlx::query_scalar("SELECT answers_json FROM final_exam_session WHERE session_id=? AND learner_id=? AND status='active'")
            .bind(session_id).bind(learner_id).fetch_one(&self.pool).await.map_err(query_error)?;
        serde_json::from_str(&raw)
            .map_err(|error| DbError(format!("invalid stored exam answers: {error}")))
    }

    pub async fn finish_exam_session(
        &self,
        learner_id: &str,
        session_id: &str,
        result: &Value,
        now: &str,
    ) -> Result<(), DbError> {
        let changed = sqlx::query("UPDATE final_exam_session SET result_json=?,status='completed',completed_at=? WHERE session_id=? AND learner_id=? AND status='active'")
            .bind(result.to_string()).bind(now).bind(session_id).bind(learner_id)
            .execute(&self.pool).await.map_err(query_error)?.rows_affected();
        if changed != 1 {
            return Err(DbError("final exam session is not active".into()));
        }
        Ok(())
    }

    /// Records a completed attempt atomically: session (ended), attempt
    /// (completed with a final status), its events, the optional evaluator log,
    /// and the projection resume rebuild all commit or fail together.
    pub async fn record_attempt_bundle(
        &self,
        session: &NewSession,
        final_status: &str,
        events: &[NewAttemptEvent],
        evaluator_log: Option<&NewEvaluatorLog>,
        model_version: &str,
    ) -> Result<ProjectionSnapshot, DbError> {
        let span = tracing::info_span!(
            "db.record_attempt_bundle",
            run_id = %session.run_id,
            request_id = %session.request_id,
            session_id = %session.session_id,
            attempt_id = %session.attempt_id,
            event_count = events.len()
        );
        async {
            let mut transaction = self.pool.begin().await.map_err(query_error)?;
            sqlx::query("INSERT OR IGNORE INTO learner (learner_id, created_at) VALUES (?, ?)")
                .bind(&session.learner_id)
                .bind(&session.started_at)
                .execute(&mut *transaction)
                .await
                .map_err(query_error)?;
            sqlx::query(
                "INSERT INTO learning_session (session_id, learner_id, started_at, ended_at, run_id, request_id) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&session.session_id)
            .bind(&session.learner_id)
            .bind(&session.started_at)
            .bind(&session.started_at)
            .bind(&session.run_id)
            .bind(&session.request_id)
            .execute(&mut *transaction)
            .await
            .map_err(query_error)?;
            sqlx::query(
                "INSERT INTO attempt (attempt_id, session_id, item_id, item_version, started_at, completed_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&session.attempt_id)
            .bind(&session.session_id)
            .bind(&session.item_id)
            .bind(session.item_version)
            .bind(&session.started_at)
            .bind(&session.started_at)
            .bind(final_status)
            .execute(&mut *transaction)
            .await
            .map_err(query_error)?;
            for event in events {
                insert_event(&mut transaction, event).await?;
            }
            if let Some(log) = evaluator_log {
                sqlx::query(
                    "INSERT INTO evaluator_log (evaluator_run_id, attempt_id, event_id, run_id, request_id, status, toolchain_json, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(&log.evaluator_run_id)
                .bind(&log.attempt_id)
                .bind(&log.event_id)
                .bind(&log.run_id)
                .bind(&log.request_id)
                .bind(&log.status)
                .bind(&log.toolchain_json)
                .bind(&log.detail_json)
                .bind(&log.created_at)
                .execute(&mut *transaction)
                .await
                .map_err(query_error)?;
            }
            let snapshot =
                rebuild_projections_in(&mut transaction, model_version, RebuildMode::Resume)
                    .await?;
            transaction.commit().await.map_err(query_error)?;
            Ok(snapshot)
        }
        .instrument(span)
        .await
    }

    pub async fn events_for_attempt(
        &self,
        attempt_id: &str,
    ) -> Result<Vec<StoredAttemptEvent>, DbError> {
        let rows = sqlx::query(
            "SELECT event_id, attempt_id, sequence, idempotency_key, kind, payload_json, occurred_at, run_id, request_id FROM attempt_event WHERE attempt_id = ? ORDER BY sequence, event_id",
        )
        .bind(attempt_id)
        .fetch_all(&self.pool)
        .await
        .map_err(query_error)?;
        Ok(rows
            .into_iter()
            .map(|row| StoredAttemptEvent {
                event_id: row.get("event_id"),
                attempt_id: row.get("attempt_id"),
                sequence: row.get("sequence"),
                idempotency_key: row.get("idempotency_key"),
                kind: row.get("kind"),
                payload_json: row.get("payload_json"),
                occurred_at: row.get("occurred_at"),
                run_id: row.get("run_id"),
                request_id: row.get("request_id"),
            })
            .collect())
    }

    pub async fn rebuild_projections(
        &self,
        model_version: &str,
        mode: RebuildMode,
    ) -> Result<ProjectionSnapshot, DbError> {
        let mut transaction = self.pool.begin().await.map_err(query_error)?;
        let snapshot = rebuild_projections_in(&mut transaction, model_version, mode).await?;
        transaction.commit().await.map_err(query_error)?;
        Ok(snapshot)
    }

    pub async fn mastery_explanation(
        &self,
        learner_id: &str,
        concept_id: &str,
    ) -> Result<Option<Value>, DbError> {
        let row = sqlx::query(
            "SELECT state, score, model_version, evidence_ids_json, explanation_json, updated_at FROM mastery_projection WHERE learner_id = ? AND concept_id = ?",
        )
        .bind(learner_id)
        .bind(concept_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(query_error)?;
        Ok(row.map(|row| {
            serde_json::json!({
                "conceptId": concept_id,
                "state": row.get::<String, _>("state"),
                "score": row.get::<f64, _>("score"),
                "modelVersion": row.get::<String, _>("model_version"),
                "evidenceIds": serde_json::from_str::<Value>(&row.get::<String, _>("evidence_ids_json")).expect("stored evidence JSON"),
                "explanation": serde_json::from_str::<Value>(&row.get::<String, _>("explanation_json")).expect("stored explanation JSON"),
                "updatedAt": row.get::<String, _>("updated_at")
            })
        }))
    }

    pub async fn evidence_timeline(
        &self,
        learner_id: &str,
        concept_id: Option<&str>,
    ) -> Result<Vec<Value>, DbError> {
        let rows = sqlx::query(
            "SELECT evidence.evidence_id, evidence.concept_id, evidence.score, evidence.model_version, evidence.created_at, evidence.item_id, evidence.variant_group, evidence.kind, evidence.support_json, evidence.observed_day, evidence.primary_outcome, event.kind AS event_kind FROM evidence JOIN attempt_event event ON event.event_id = evidence.event_id WHERE evidence.learner_id = ? AND (? IS NULL OR evidence.concept_id = ?) ORDER BY evidence.observed_day, evidence.created_at, evidence.evidence_id",
        )
        .bind(learner_id)
        .bind(concept_id)
        .bind(concept_id)
        .fetch_all(&self.pool)
        .await
        .map_err(query_error)?;
        Ok(rows
            .into_iter()
            .map(|row| {
                serde_json::json!({
                    "evidenceId": row.get::<String, _>("evidence_id"),
                    "conceptId": row.get::<String, _>("concept_id"),
                    "score": row.get::<f64, _>("score"),
                    "modelVersion": row.get::<String, _>("model_version"),
                    "createdAt": row.get::<String, _>("created_at"),
                    "itemId": row.get::<String, _>("item_id"),
                    "variantGroup": row.get::<String, _>("variant_group"),
                    "kind": row.get::<String, _>("kind"),
                    "support": serde_json::from_str::<Value>(&row.get::<String, _>("support_json")).expect("stored support JSON"),
                    "day": row.get::<i64, _>("observed_day"),
                    "primaryOutcome": row.get::<bool, _>("primary_outcome"),
                    "sourceEvent": row.get::<String, _>("event_kind")
                })
            })
            .collect())
    }

    pub async fn review_queue(
        &self,
        learner_id: &str,
        day: u32,
        limit: usize,
    ) -> Result<Value, DbError> {
        let rows = sqlx::query(
            "SELECT concept_id, due_day, interval_index, reason, model_version, evidence_ids_json FROM review_projection WHERE learner_id = ? AND due_day <= ? ORDER BY due_day, concept_id",
        )
        .bind(learner_id)
        .bind(i64::from(day))
        .fetch_all(&self.pool)
        .await
        .map_err(query_error)?;
        let overflow = rows.len().saturating_sub(limit);
        let items: Vec<Value> = rows
            .into_iter()
            .take(limit)
            .map(|row| {
                serde_json::json!({
                    "conceptId": row.get::<String, _>("concept_id"),
                    "dueDay": row.get::<i64, _>("due_day"),
                    "intervalIndex": row.get::<i64, _>("interval_index"),
                    "reason": row.get::<String, _>("reason"),
                    "modelVersion": row.get::<String, _>("model_version"),
                    "evidenceIds": serde_json::from_str::<Value>(&row.get::<String, _>("evidence_ids_json")).expect("stored evidence JSON"),
                    "estimatedMode": "recall_then_fresh_variant",
                    "supportPolicy": "compiler_and_official_docs_allowed"
                })
            })
            .collect();
        Ok(serde_json::json!({
            "day": day,
            "limit": limit,
            "overflow": overflow,
            "modelVersion": learning::SCHEDULER_MODEL_VERSION,
            "items": items
        }))
    }

    pub async fn confidence_calibration(
        &self,
        learner_id: &str,
        minimum: usize,
    ) -> Result<Vec<learning::ConfidenceCalibration>, DbError> {
        // Pair each confidence commitment with the next assessment in the same
        // attempt; a bare cross join would duplicate or mismatch samples when an
        // attempt records several of either event.
        let rows = sqlx::query(
            "SELECT confidence.payload_json AS confidence_json, assessment.payload_json AS assessment_json FROM attempt_event confidence JOIN attempt_event assessment ON assessment.attempt_id = confidence.attempt_id AND assessment.kind = 'assessment_scored' AND assessment.sequence = (SELECT MIN(candidate.sequence) FROM attempt_event candidate WHERE candidate.attempt_id = confidence.attempt_id AND candidate.kind = 'assessment_scored' AND candidate.sequence > confidence.sequence) JOIN attempt ON attempt.attempt_id = confidence.attempt_id JOIN learning_session session ON session.session_id = attempt.session_id WHERE session.learner_id = ? AND confidence.kind = 'confidence_committed' ORDER BY confidence.occurred_at, confidence.event_id",
        )
        .bind(learner_id)
        .fetch_all(&self.pool)
        .await
        .map_err(query_error)?;
        let samples = rows
            .into_iter()
            .filter_map(|row| {
                let confidence: Value =
                    serde_json::from_str(&row.get::<String, _>("confidence_json")).ok()?;
                let assessment: Value =
                    serde_json::from_str(&row.get::<String, _>("assessment_json")).ok()?;
                Some(learning::ConfidenceSample {
                    confidence: u8::try_from(confidence["value"].as_u64()?).ok()?,
                    success: assessment["score"].as_f64()? >= 1.0,
                })
            })
            .collect::<Vec<_>>();
        Ok(learning::calibrate_confidence(&samples, minimum))
    }

    pub async fn record_support_reveal(
        &self,
        learner_id: &str,
        item_id: &str,
        support: &str,
        occurred_at: &str,
    ) -> Result<(), DbError> {
        sqlx::query("INSERT OR IGNORE INTO learner_support_event(learner_id,item_id,support,occurred_at) VALUES (?,?,?,?)")
            .bind(learner_id).bind(item_id).bind(support).bind(occurred_at)
            .execute(&self.pool).await.map_err(query_error)?;
        Ok(())
    }

    pub async fn latest_project_workspace(
        &self,
        learner_id: &str,
        project_id: &str,
        stage_id: &str,
    ) -> Result<Option<Value>, DbError> {
        let row = sqlx::query("SELECT w.revision,w.files_json,w.workspace_checksum,w.checkpoint,w.created_at FROM project_workspace_revision w WHERE w.learner_id=? AND w.project_id=? AND w.stage_id=? AND CAST(w.created_at AS INTEGER) > COALESCE((SELECT MAX(CAST(r.created_at AS INTEGER)) FROM data_reset_event r WHERE r.learner_id=w.learner_id AND r.scope='all_progress'),-1) AND NOT EXISTS (SELECT 1 FROM data_reset_event r JOIN data_reset_item i ON i.reset_id=r.reset_id WHERE r.learner_id=w.learner_id AND i.item_id=w.stage_id AND CAST(r.created_at AS INTEGER)>=CAST(w.created_at AS INTEGER)) ORDER BY w.revision DESC LIMIT 1")
            .bind(learner_id).bind(project_id).bind(stage_id).fetch_optional(&self.pool).await.map_err(query_error)?;
        Ok(row.map(|row| serde_json::json!({
            "projectId":project_id,"stageId":stage_id,
            "revision":row.get::<i64,_>("revision"),
            "files":serde_json::from_str::<Value>(&row.get::<String,_>("files_json")).expect("stored workspace JSON"),
            "workspaceChecksum":row.get::<String,_>("workspace_checksum"),
            "checkpoint":row.get::<bool,_>("checkpoint"),
            "createdAt":row.get::<String,_>("created_at")
        })))
    }

    pub async fn save_project_workspace(
        &self,
        workspace: &NewProjectWorkspace<'_>,
    ) -> Result<Value, DbError> {
        let mut tx = self.pool.begin().await.map_err(query_error)?;
        let revision: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(revision),0)+1 FROM project_workspace_revision WHERE learner_id=? AND project_id=? AND stage_id=?")
            .bind(workspace.learner_id).bind(workspace.project_id).bind(workspace.stage_id).fetch_one(&mut *tx).await.map_err(query_error)?;
        sqlx::query("INSERT INTO project_workspace_revision(learner_id,project_id,stage_id,revision,files_json,workspace_checksum,checkpoint,created_at) VALUES (?,?,?,?,?,?,?,?)")
            .bind(workspace.learner_id).bind(workspace.project_id).bind(workspace.stage_id).bind(revision)
            .bind(serde_json::to_string(workspace.files).expect("workspace JSON")).bind(workspace.checksum)
            .bind(workspace.checkpoint).bind(workspace.created_at).execute(&mut *tx).await.map_err(query_error)?;
        tx.commit().await.map_err(query_error)?;
        Ok(
            serde_json::json!({"projectId":workspace.project_id,"stageId":workspace.stage_id,"revision":revision,"files":workspace.files,"workspaceChecksum":workspace.checksum,"checkpoint":workspace.checkpoint,"createdAt":workspace.created_at}),
        )
    }
}

fn query_error(error: sqlx::Error) -> DbError {
    DbError(format!("learner database operation failed: {error}"))
}

async fn run_migrations(pool: &SqlitePool) -> Result<(), DbError> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT",
    )
    .execute(pool)
    .await
    .map_err(|error| db_error("cannot create schema migration table", error))?;
    for (version, migration) in [
        (1_i64, MIGRATION_1),
        (2_i64, MIGRATION_2),
        (3_i64, MIGRATION_3),
        (4_i64, MIGRATION_4),
        (5_i64, MIGRATION_5),
        (6_i64, MIGRATION_6),
        (7_i64, MIGRATION_7),
        (8_i64, MIGRATION_8),
        (9_i64, MIGRATION_9),
        (10_i64, MIGRATION_10),
        (11_i64, MIGRATION_11),
        (12_i64, MIGRATION_12),
        (13_i64, MIGRATION_13),
    ] {
        let checksum = format!("{:x}", Sha256::digest(migration.as_bytes()));
        let recorded = sqlx::query_scalar::<_, String>(
            "SELECT checksum FROM schema_migration WHERE version = ?",
        )
        .bind(version)
        .fetch_optional(pool)
        .await
        .map_err(query_error)?;
        if let Some(recorded) = recorded {
            if recorded != checksum {
                return Err(DbError(format!(
                    "migration {version} checksum changed after application. {RECOVERY}"
                )));
            }
            continue;
        }
        let mut transaction = pool.begin().await.map_err(query_error)?;
        sqlx::raw_sql(migration)
            .execute(&mut *transaction)
            .await
            .map_err(|error| db_error(&format!("migration {version} failed"), error))?;
        sqlx::query("INSERT INTO schema_migration (version, checksum) VALUES (?, ?)")
            .bind(version)
            .bind(checksum)
            .execute(&mut *transaction)
            .await
            .map_err(query_error)?;
        transaction.commit().await.map_err(query_error)?;
    }
    Ok(())
}

async fn backup_before_schema_upgrade(pool: &SqlitePool, source: &Path) -> Result<(), DbError> {
    let has_ledger: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migration'",
    )
    .fetch_one(pool)
    .await
    .map_err(query_error)?;
    if has_ledger == 0 {
        return Ok(());
    }
    let current: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(version),0) FROM schema_migration")
        .fetch_one(pool)
        .await
        .map_err(query_error)?;
    if current == 0 || current >= 7 {
        return Ok(());
    }
    let parent = source
        .parent()
        .ok_or_else(|| DbError("database path has no backup parent".into()))?;
    let directory = parent.join("backups");
    std::fs::create_dir_all(&directory)
        .map_err(|error| db_error("cannot create schema backup directory", error))?;
    let target = directory.join(format!(
        "before-schema-v7-{}-{}.sqlite3",
        std::process::id(),
        current
    ));
    if target.exists() {
        return Err(DbError(format!(
            "pre-upgrade backup already exists at {}; preserve or move it before retrying",
            target.display()
        )));
    }
    sqlx::query("VACUUM INTO ?")
        .bind(target.to_string_lossy().as_ref())
        .execute(pool)
        .await
        .map_err(|error| {
            db_error(
                "pre-upgrade online backup failed; migration was not started",
                error,
            )
        })?;
    let bytes = std::fs::read(&target)
        .map_err(|error| db_error("cannot verify pre-upgrade backup", error))?;
    if bytes.is_empty() {
        return Err(DbError(
            "pre-upgrade backup is empty; migration was not started".into(),
        ));
    }
    Ok(())
}

#[derive(Debug)]
pub struct NewSession {
    pub learner_id: String,
    pub session_id: String,
    pub attempt_id: String,
    pub item_id: String,
    pub item_version: i64,
    pub started_at: String,
    pub run_id: String,
    pub request_id: String,
}

#[derive(Debug)]
pub struct NewAttemptEvent {
    pub event_id: String,
    pub attempt_id: String,
    pub sequence: i64,
    pub idempotency_key: String,
    pub kind: String,
    pub payload_json: String,
    pub occurred_at: String,
    pub run_id: String,
    pub request_id: String,
}

#[derive(Debug)]
pub struct NewEvaluatorLog {
    pub evaluator_run_id: String,
    pub attempt_id: String,
    pub event_id: Option<String>,
    pub run_id: String,
    pub request_id: String,
    pub status: String,
    pub toolchain_json: String,
    pub detail_json: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct NewJournalEntry {
    pub kind: String,
    pub title: String,
    pub body: String,
    pub project_id: Option<String>,
    pub concept_id: Option<String>,
    pub error_id: Option<String>,
    pub support_json: String,
    pub confidence: Option<i64>,
    pub reattempt_day: Option<i64>,
}

#[derive(Debug)]
pub struct NewErrorRecord {
    pub code: String,
    pub root_cause: String,
    pub correction: String,
    pub future_cue: String,
    pub concept_ids_json: String,
    pub attempt_id: Option<String>,
    pub evaluator_run_id: Option<String>,
}

#[derive(Debug)]
pub struct NewProjectArtifact {
    pub project_id: String,
    pub stage_id: String,
    pub kind: String,
    pub local_path: Option<String>,
    pub pasted_text: Option<String>,
    pub checksum: String,
}

pub struct NewProjectWorkspace<'a> {
    pub learner_id: &'a str,
    pub project_id: &'a str,
    pub stage_id: &'a str,
    pub files: &'a Value,
    pub checksum: &'a str,
    pub checkpoint: bool,
    pub created_at: &'a str,
}

#[derive(Debug)]
pub struct NewProjectCheckpoint {
    pub project_id: String,
    pub stage_id: String,
    pub parent_checkpoint_id: Option<String>,
    pub workspace_checksum: String,
    pub status: String,
    pub evaluator_run_id: Option<String>,
    pub regression_json: String,
}

#[derive(Debug)]
pub struct NewQuestionAttempt {
    pub attempt_id: String,
    pub idempotency_key: String,
    pub question_id: String,
    pub question_version: i64,
    pub response_json: String,
    pub result_json: String,
    pub score: f64,
    pub correct: i64,
    pub support_json: String,
    pub confidence: i64,
}

#[derive(Debug, Serialize)]
pub struct StoredAttemptEvent {
    pub event_id: String,
    pub attempt_id: String,
    pub sequence: i64,
    pub idempotency_key: String,
    pub kind: String,
    pub payload_json: String,
    pub occurred_at: String,
    pub run_id: String,
    pub request_id: String,
}

async fn insert_event(
    transaction: &mut Transaction<'_, Sqlite>,
    event: &NewAttemptEvent,
) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO attempt_event (event_id, attempt_id, sequence, idempotency_key, kind, payload_json, occurred_at, run_id, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&event.event_id)
    .bind(&event.attempt_id)
    .bind(event.sequence)
    .bind(&event.idempotency_key)
    .bind(&event.kind)
    .bind(&event.payload_json)
    .bind(&event.occurred_at)
    .bind(&event.run_id)
    .bind(&event.request_id)
    .execute(&mut **transaction)
    .await
    .map_err(query_error)?;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RebuildMode {
    Restart,
    Resume,
}

#[derive(Clone, Copy, Debug)]
pub enum ImportMode<'a> {
    /// Runs the full apply — inserts, conflict checks, and integrity checks —
    /// then rolls the transaction back, so dry-run validation cannot diverge
    /// from a later apply.
    DryRun,
    Apply {
        backup_checksum: &'a str,
        now: &'a str,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssessmentPayload {
    concept_id: String,
    score: f64,
    #[serde(default)]
    item_id: String,
    #[serde(default)]
    variant_group: String,
    #[serde(default = "default_evidence_kind")]
    kind: EvidenceKind,
    #[serde(default = "default_support")]
    support: Support,
    #[serde(default)]
    day: u32,
    #[serde(default)]
    critical_misconception: bool,
    #[serde(default = "default_true")]
    primary_outcome: bool,
}

fn default_evidence_kind() -> EvidenceKind {
    EvidenceKind::Recall
}

fn default_support() -> Support {
    Support::None
}

fn default_true() -> bool {
    true
}

fn evidence_kind_name(kind: EvidenceKind) -> &'static str {
    match kind {
        EvidenceKind::Recall => "recall",
        EvidenceKind::Trace => "trace",
        EvidenceKind::Implement => "implement",
        EvidenceKind::Debug => "debug",
        EvidenceKind::Test => "test",
        EvidenceKind::Explain => "explain",
        EvidenceKind::Design => "design",
        EvidenceKind::Transfer => "transfer",
        EvidenceKind::Project => "project",
    }
}

fn mastery_state_name(state: MasteryState) -> &'static str {
    match state {
        MasteryState::NotStarted => "not_started",
        MasteryState::Exposed => "exposed",
        MasteryState::Practicing => "practicing",
        MasteryState::Provisional => "provisional",
        MasteryState::Retained => "retained",
        MasteryState::NeedsConfirmation => "needs_confirmation",
    }
}

/// Rebuilds evidence and the mastery/review projections inside the caller's
/// transaction so callers can make projection state atomic with the write that
/// invalidated it (attempt recording, import, reset).
async fn rebuild_projections_in(
    transaction: &mut Transaction<'_, Sqlite>,
    model_version: &str,
    mode: RebuildMode,
) -> Result<ProjectionSnapshot, DbError> {
    let checkpoint = if mode == RebuildMode::Resume {
        // The stored checkpoint is nullable: an empty restart persists NULL.
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT last_event_id FROM projection_checkpoint WHERE projection_name = 'learning'",
        )
        .fetch_optional(&mut **transaction)
        .await
        .map_err(query_error)?
        .flatten()
    } else {
        None
    };
    if mode == RebuildMode::Restart {
        for statement in [
            "DELETE FROM review_projection",
            "DELETE FROM mastery_projection",
            "DELETE FROM evidence",
            "DELETE FROM projection_checkpoint",
        ] {
            sqlx::query(statement)
                .execute(&mut **transaction)
                .await
                .map_err(query_error)?;
        }
    }
    let rows = projection_events(transaction, checkpoint.as_deref()).await?;
    let mut touched = HashSet::new();
    let mut last_event_id = checkpoint;
    for row in rows {
        let payload: AssessmentPayload = serde_json::from_str(row.get("payload_json"))
            .map_err(|error| DbError(format!("invalid assessment event payload: {error}")))?;
        let event_id: String = row.get("event_id");
        let learner_id: String = row.get("learner_id");
        let occurred_at: String = row.get("occurred_at");
        sqlx::query(
            "INSERT INTO evidence (evidence_id, event_id, learner_id, concept_id, score, model_version, created_at, item_id, variant_group, kind, support_json, observed_day, critical_misconception, primary_outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(format!("EVID-{event_id}"))
        .bind(&event_id)
        .bind(&learner_id)
        .bind(&payload.concept_id)
        .bind(payload.score)
        .bind(model_version)
        .bind(&occurred_at)
        .bind(&payload.item_id)
        .bind(&payload.variant_group)
        .bind(evidence_kind_name(payload.kind))
        .bind(serde_json::to_string(&payload.support).expect("serialize support"))
        .bind(i64::from(payload.day))
        .bind(payload.critical_misconception)
        .bind(payload.primary_outcome)
        .execute(&mut **transaction)
        .await
        .map_err(query_error)?;
        touched.insert((learner_id, payload.concept_id));
        last_event_id = Some(event_id);
    }
    if mode == RebuildMode::Restart {
        let all: Vec<(String, String)> = sqlx::query(
            "SELECT DISTINCT learner_id, concept_id FROM evidence ORDER BY learner_id, concept_id",
        )
        .fetch_all(&mut **transaction)
        .await
        .map_err(query_error)?
        .into_iter()
        .map(|row| (row.get("learner_id"), row.get("concept_id")))
        .collect();
        touched.extend(all);
    }
    for (learner_id, concept_id) in touched {
        rebuild_concept(transaction, &learner_id, &concept_id, model_version).await?;
    }
    let snapshot = projection_snapshot(transaction).await?;
    sqlx::query(
        "INSERT INTO projection_checkpoint (projection_name, model_version, last_event_id, state_checksum, rebuilt_at) VALUES ('learning', ?, ?, ?, ?) ON CONFLICT(projection_name) DO UPDATE SET model_version=excluded.model_version, last_event_id=excluded.last_event_id, state_checksum=excluded.state_checksum, rebuilt_at=excluded.rebuilt_at",
    )
    .bind(model_version)
    .bind(last_event_id)
    .bind(&snapshot.checksum)
    .bind(&snapshot.updated_at)
    .execute(&mut **transaction)
    .await
    .map_err(query_error)?;
    Ok(snapshot)
}

/// Filter used by every reset-aware surface: an event is inside the effective
/// baseline when it is newer than the latest all-progress reset and not covered
/// by a scoped reset naming its attempt's item.
const RESET_BASELINE_EVENT_FILTER: &str = "CAST(event.occurred_at AS INTEGER) > COALESCE((SELECT MAX(CAST(r.created_at AS INTEGER)) FROM data_reset_event r WHERE r.learner_id = session.learner_id AND r.scope = 'all_progress'), -1) AND NOT EXISTS (SELECT 1 FROM data_reset_event r2 JOIN data_reset_item ri ON ri.reset_id = r2.reset_id WHERE r2.learner_id = session.learner_id AND ri.item_id = attempt.item_id AND CAST(r2.created_at AS INTEGER) >= CAST(event.occurred_at AS INTEGER))";

/// Same baseline rule at attempt granularity, for queries aliased `a`/`s`.
const RESET_BASELINE_ATTEMPT_FILTER: &str = "CAST(a.started_at AS INTEGER) > COALESCE((SELECT MAX(CAST(r.created_at AS INTEGER)) FROM data_reset_event r WHERE r.learner_id = s.learner_id AND r.scope = 'all_progress'), -1) AND NOT EXISTS (SELECT 1 FROM data_reset_event r2 JOIN data_reset_item ri ON ri.reset_id = r2.reset_id WHERE r2.learner_id = s.learner_id AND ri.item_id = a.item_id AND CAST(r2.created_at AS INTEGER) >= CAST(a.started_at AS INTEGER))";

/// Scalar all-progress baseline for the learner bound as `?1`.
const RESET_BASELINE_SUBQUERY: &str = "COALESCE((SELECT MAX(CAST(created_at AS INTEGER)) FROM data_reset_event WHERE data_reset_event.learner_id = ?1 AND scope = 'all_progress'), -1)";

async fn projection_events(
    transaction: &mut Transaction<'_, Sqlite>,
    after_event: Option<&str>,
) -> Result<Vec<sqlx::sqlite::SqliteRow>, DbError> {
    let after_rowid = if let Some(event_id) = after_event {
        sqlx::query_scalar::<_, i64>("SELECT rowid FROM attempt_event WHERE event_id = ?")
            .bind(event_id)
            .fetch_optional(&mut **transaction)
            .await
            .map_err(query_error)?
            .unwrap_or(0)
    } else {
        0
    };
    let sql = format!(
        "SELECT event.rowid, event.event_id, event.payload_json, event.occurred_at, session.learner_id FROM attempt_event event JOIN attempt ON attempt.attempt_id = event.attempt_id JOIN learning_session session ON session.session_id = attempt.session_id WHERE event.kind = 'assessment_scored' AND event.rowid > ? AND {RESET_BASELINE_EVENT_FILTER} ORDER BY event.rowid"
    );
    sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(after_rowid)
        .fetch_all(&mut **transaction)
        .await
        .map_err(query_error)
}

async fn rebuild_concept(
    transaction: &mut Transaction<'_, Sqlite>,
    learner_id: &str,
    concept_id: &str,
    model_version: &str,
) -> Result<(), DbError> {
    let rows = sqlx::query(
        "SELECT evidence_id, score, created_at, item_id, variant_group, kind, support_json, observed_day, critical_misconception, primary_outcome FROM evidence WHERE learner_id = ? AND concept_id = ? ORDER BY observed_day, created_at, evidence_id",
    )
    .bind(learner_id)
    .bind(concept_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(query_error)?;
    if rows.is_empty() {
        return Ok(());
    }
    let observations: Vec<Observation> = rows
        .iter()
        .map(|row| {
            let kind = match row.get::<String, _>("kind").as_str() {
                "trace" => EvidenceKind::Trace,
                "implement" => EvidenceKind::Implement,
                "debug" => EvidenceKind::Debug,
                "test" => EvidenceKind::Test,
                "explain" => EvidenceKind::Explain,
                "design" => EvidenceKind::Design,
                "transfer" => EvidenceKind::Transfer,
                "project" => EvidenceKind::Project,
                _ => EvidenceKind::Recall,
            };
            Observation {
                evidence_id: row.get("evidence_id"),
                item_id: row.get("item_id"),
                variant_group: row.get("variant_group"),
                kind,
                success: row.get::<f64, _>("score") >= 1.0,
                support: serde_json::from_str(&row.get::<String, _>("support_json"))
                    .unwrap_or(Support::ExternalHelp),
                day: u32::try_from(row.get::<i64, _>("observed_day")).unwrap_or(0),
                critical_misconception: row.get::<bool, _>("critical_misconception"),
                primary_outcome: row.get::<bool, _>("primary_outcome"),
            }
        })
        .collect();
    // Mastery is a pure fold over the ordered evidence history, so an
    // incremental resume and a from-scratch restart derive identical state.
    let explanation = learning::derive_mastery_history(&observations);
    let score = match explanation.state {
        MasteryState::NotStarted => 0.0,
        MasteryState::Exposed => 0.1,
        MasteryState::Practicing => 0.35,
        MasteryState::Provisional => 0.65,
        MasteryState::Retained => 1.0,
        MasteryState::NeedsConfirmation => 0.45,
    };
    let evidence_ids = &explanation.evidence_ids;
    let updated_at: String = rows
        .last()
        .expect("at least one evidence row")
        .get("created_at");
    let evidence_json = serde_json::to_string(evidence_ids).expect("serialize evidence IDs");
    let explanation_json = serde_json::to_string(&explanation).expect("serialize explanation");
    sqlx::query(
        "INSERT INTO mastery_projection (learner_id, concept_id, score, model_version, evidence_ids_json, updated_at, state, explanation_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(learner_id, concept_id) DO UPDATE SET score=excluded.score, model_version=excluded.model_version, evidence_ids_json=excluded.evidence_ids_json, updated_at=excluded.updated_at, state=excluded.state, explanation_json=excluded.explanation_json",
    )
    .bind(learner_id)
    .bind(concept_id)
    .bind(score)
    .bind(model_version)
    .bind(&evidence_json)
    .bind(&updated_at)
    .bind(mastery_state_name(explanation.state))
    .bind(&explanation_json)
    .execute(&mut **transaction)
    .await
    .map_err(query_error)?;
    // The review schedule folds the full rating history: implicit ratings from
    // scored evidence plus explicit Again/Hard/Good/Easy review submissions.
    let rating_rows = sqlx::query(
        "SELECT rating, day, created_at FROM review_rating WHERE learner_id = ? AND concept_id = ? ORDER BY day, created_at, rating_id",
    )
    .bind(learner_id)
    .bind(concept_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(query_error)?;
    let mut history: Vec<(u32, String, learning::ReviewRating)> = observations
        .iter()
        .zip(rows.iter())
        .map(|(observation, row)| {
            (
                observation.day,
                row.get::<String, _>("created_at"),
                if observation.success {
                    learning::ReviewRating::Good
                } else {
                    learning::ReviewRating::Again
                },
            )
        })
        .collect();
    for row in &rating_rows {
        let rating = match row.get::<String, _>("rating").as_str() {
            "again" => learning::ReviewRating::Again,
            "hard" => learning::ReviewRating::Hard,
            "easy" => learning::ReviewRating::Easy,
            _ => learning::ReviewRating::Good,
        };
        history.push((
            u32::try_from(row.get::<i64, _>("day")).unwrap_or(0),
            row.get::<String, _>("created_at"),
            rating,
        ));
    }
    history.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.len().cmp(&right.1.len()))
            .then_with(|| left.1.cmp(&right.1))
    });
    let mut interval: Option<usize> = None;
    let mut review = None;
    for (day, _, rating) in &history {
        let decision = learning::schedule_review(*day, interval, *rating);
        interval = Some(decision.interval_index);
        review = Some(decision);
    }
    let review = review.expect("at least one rating entry exists");
    sqlx::query(
        "INSERT INTO review_projection (learner_id, concept_id, due_at, model_version, evidence_ids_json, updated_at, due_day, interval_index, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(learner_id, concept_id) DO UPDATE SET due_at=excluded.due_at, model_version=excluded.model_version, evidence_ids_json=excluded.evidence_ids_json, updated_at=excluded.updated_at, due_day=excluded.due_day, interval_index=excluded.interval_index, reason=excluded.reason",
    )
    .bind(learner_id)
    .bind(concept_id)
    .bind(review.due_day.to_string())
    .bind(model_version)
    .bind(&evidence_json)
    .bind(&updated_at)
    .bind(i64::from(review.due_day))
    .bind(i64::try_from(review.interval_index).expect("interval index fits"))
    .bind(review.reason)
    .execute(&mut **transaction)
    .await
    .map_err(query_error)?;
    Ok(())
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct ProjectionSnapshot {
    pub checksum: String,
    pub updated_at: String,
    pub rows: Value,
}

async fn projection_snapshot(
    transaction: &mut Transaction<'_, Sqlite>,
) -> Result<ProjectionSnapshot, DbError> {
    let rows = sqlx::query(
        "SELECT learner_id, concept_id, score, model_version, evidence_ids_json, updated_at, state, explanation_json FROM mastery_projection ORDER BY learner_id, concept_id",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(query_error)?;
    let values: Vec<Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "learnerId": row.get::<String, _>("learner_id"),
                "conceptId": row.get::<String, _>("concept_id"),
                "score": row.get::<f64, _>("score"),
                "modelVersion": row.get::<String, _>("model_version"),
                "evidenceIds": serde_json::from_str::<Value>(&row.get::<String, _>("evidence_ids_json")).expect("stored JSON"),
                "updatedAt": row.get::<String, _>("updated_at"),
                "state": row.get::<String, _>("state"),
                "explanation": serde_json::from_str::<Value>(&row.get::<String, _>("explanation_json")).expect("stored explanation JSON"),
            })
        })
        .collect();
    let bytes = serde_json::to_vec(&values).expect("serialize projection");
    let updated_at = values
        .last()
        .and_then(|row| row["updatedAt"].as_str())
        .unwrap_or("1970-01-01T00:00:00Z")
        .to_owned();
    Ok(ProjectionSnapshot {
        checksum: format!("{:x}", Sha256::digest(bytes)),
        updated_at,
        rows: Value::Array(values),
    })
}
