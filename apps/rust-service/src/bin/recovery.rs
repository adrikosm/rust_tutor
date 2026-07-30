use std::path::PathBuf;

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sqlx::{
    ConnectOptions, Row,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

#[tokio::main]
async fn main() -> Result<(), String> {
    let mut arguments = std::env::args().skip(1);
    let usage =
        "usage: cargo run --bin recovery -- /absolute/source.sqlite3 /absolute/recovery.json";
    let source = arguments.next().map(PathBuf::from).ok_or(usage)?;
    let output = arguments.next().map(PathBuf::from).ok_or(usage)?;
    if arguments.next().is_some()
        || !source.is_absolute()
        || !output.is_absolute()
        || source == output
        || !source.is_file()
        || output.exists()
    {
        return Err("source must be an existing absolute database; output must be a new, distinct absolute JSON file".into());
    }
    let options = SqliteConnectOptions::new()
        .filename(&source)
        .read_only(true)
        .create_if_missing(false)
        .foreign_keys(false)
        .disable_statement_logging();
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("read-only recovery open failed: {error}"))?;
    let integrity = sqlx::query_scalar::<_, String>("PRAGMA integrity_check")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| format!("unavailable: {error}"));
    let queries = [
        (
            "learners",
            "SELECT json_group_array(json_object('learnerId',learner_id,'createdAt',created_at)) AS body FROM learner",
        ),
        (
            "sessions",
            "SELECT json_group_array(json_object('sessionId',session_id,'learnerId',learner_id,'goalId',goal_id,'startedAt',started_at,'endedAt',ended_at,'runId',run_id,'requestId',request_id)) AS body FROM learning_session",
        ),
        (
            "attempts",
            "SELECT json_group_array(json_object('attemptId',attempt_id,'sessionId',session_id,'itemId',item_id,'itemVersion',item_version,'startedAt',started_at,'completedAt',completed_at,'status',status)) AS body FROM attempt",
        ),
        (
            "events",
            "SELECT json_group_array(json_object('eventId',event_id,'attemptId',attempt_id,'sequence',sequence,'idempotencyKey',idempotency_key,'kind',kind,'payload',json(payload_json),'occurredAt',occurred_at,'runId',run_id,'requestId',request_id)) AS body FROM attempt_event",
        ),
        (
            "evidence",
            "SELECT json_group_array(json_object('evidenceId',evidence_id,'eventId',event_id,'learnerId',learner_id,'conceptId',concept_id,'score',score,'modelVersion',model_version,'createdAt',created_at)) AS body FROM evidence",
        ),
        (
            "reflections",
            "SELECT json_group_array(json_object('reflectionId',reflection_id,'attemptId',attempt_id,'body',body,'createdAt',created_at)) AS body FROM reflection",
        ),
        (
            "journal",
            "SELECT json_group_array(json_object('entryId',entry_id,'learnerId',learner_id,'kind',kind,'title',title,'body',body,'projectId',project_id,'conceptId',concept_id,'errorId',error_id,'support',json(support_json),'confidence',confidence,'reattemptDay',reattempt_day,'createdAt',created_at)) AS body FROM journal_entry",
        ),
        (
            "quizAttempts",
            "SELECT json_group_array(json_object('attemptId',attempt_id,'learnerId',learner_id,'questionId',question_id,'questionVersion',question_version,'response',json(response_json),'result',json(result_json),'score',score,'correct',json(correct),'support',json(support_json),'confidence',confidence,'createdAt',created_at)) AS body FROM quiz_attempt_event",
        ),
        (
            "evaluationStreams",
            "SELECT json_group_array(json_object('runId',run_id,'learnerId',learner_id,'state',state,'chunks',json(chunks_json),'result',CASE WHEN result_json IS NULL THEN NULL ELSE json(result_json) END,'createdAt',created_at,'updatedAt',updated_at)) AS body FROM evaluation_stream_run",
        ),
    ];
    let mut recovered = Map::new();
    let mut failures = Map::new();
    for (name, query) in queries {
        match sqlx::query(query).fetch_one(&pool).await {
            Ok(row) => {
                let body: String = row.try_get("body").unwrap_or_else(|_| "[]".into());
                recovered.insert(
                    name.into(),
                    serde_json::from_str(&body).unwrap_or(Value::Array(Vec::new())),
                );
            }
            Err(error) => {
                failures.insert(name.into(), Value::String(error.to_string()));
            }
        }
    }
    pool.close().await;
    let payload = json!({
        "manifest":{"schemaVersion":1,"format":"rust-tutor-read-only-recovery","sourceFileName":source.file_name().and_then(|name|name.to_str()),"integrity":integrity,"warning":"Best-effort recovery output is not a verified portable import. Inspect and preserve the source and a backup before repair."},
        "recovered":recovered,"failures":failures
    });
    let bytes = serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?;
    std::fs::write(&output, &bytes)
        .map_err(|error| format!("recovery output write failed: {error}"))?;
    println!(
        "{} {} bytes sha256={:x}",
        output.display(),
        bytes.len(),
        Sha256::digest(&bytes)
    );
    Ok(())
}
