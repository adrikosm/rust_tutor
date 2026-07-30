//! Integration tests around the trust and lifecycle boundaries: attempt
//! bundles, projection determinism, reset baselines, exam commitment,
//! portable import symmetry/conflicts, and evaluator run persistence.

use rust_tutor_service::db::{
    Database, ImportMode, NewAttemptEvent, NewProjectWorkspace, NewSession, RebuildMode,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const LEARNER: &str = "LEARNER-LOCAL-001";

fn session(suffix: &str, item: &str, at: &str) -> NewSession {
    NewSession {
        learner_id: LEARNER.to_owned(),
        session_id: format!("SESSION-{suffix}"),
        attempt_id: format!("ATTEMPT-{suffix}"),
        item_id: item.to_owned(),
        item_version: 1,
        started_at: at.to_owned(),
        run_id: format!("RUN-{suffix}"),
        request_id: format!("REQ-{suffix}"),
    }
}

fn assessment(suffix: &str, concept: &str, score: f64, day: u32, at: &str) -> NewAttemptEvent {
    NewAttemptEvent {
        event_id: format!("EVENT-{suffix}"),
        attempt_id: format!("ATTEMPT-{suffix}"),
        sequence: 0,
        idempotency_key: format!("IDEMP-{suffix}"),
        kind: "assessment_scored".to_owned(),
        payload_json: json!({
            "conceptId": concept,
            "score": score,
            "itemId": format!("ITEM-{suffix}"),
            "variantGroup": format!("VG-{suffix}"),
            "kind": "implement",
            "support": "none",
            "day": day,
            "criticalMisconception": false,
            "primaryOutcome": true
        })
        .to_string(),
        occurred_at: at.to_owned(),
        run_id: format!("RUN-{suffix}"),
        request_id: format!("REQ-{suffix}"),
    }
}

async fn record(db: &Database, suffix: &str, concept: &str, score: f64, day: u32, at: &str) {
    let new_session = session(suffix, &format!("ITEM-{suffix}"), at);
    let events = [assessment(suffix, concept, score, day, at)];
    db.record_attempt_bundle(&new_session, "evaluated", &events, None, "mastery-v1")
        .await
        .expect("attempt bundle records");
}

#[tokio::test]
async fn attempt_bundles_finalize_attempts_and_schedule_first_review_in_one_day() {
    let db = Database::open_memory().await.unwrap();
    record(&db, "A1", "CON-T-001", 1.0, 10, "1000").await;
    let export = db.portable_export(LEARNER).await.unwrap();
    let attempt = &export["payload"]["attempts"][0];
    assert_eq!(attempt["status"], "evaluated");
    assert!(attempt["completedAt"].is_string(), "attempt is finalized");
    let queue = db.review_queue(LEARNER, 11, 8).await.unwrap();
    assert_eq!(
        queue["items"][0]["dueDay"], 11,
        "first Good review is due one day later"
    );
    assert_eq!(queue["items"][0]["intervalIndex"], 0);
}

#[tokio::test]
async fn restart_rebuild_matches_incremental_state() {
    let db = Database::open_memory().await.unwrap();
    record(&db, "B1", "CON-T-001", 1.0, 1, "1001").await;
    record(&db, "B2", "CON-T-001", 1.0, 3, "1002").await;
    record(&db, "B3", "CON-T-001", 0.0, 6, "1003").await;
    let incremental = db
        .rebuild_projections("mastery-v1", RebuildMode::Resume)
        .await
        .unwrap();
    let restarted = db
        .rebuild_projections("mastery-v1", RebuildMode::Restart)
        .await
        .unwrap();
    assert_eq!(
        incremental.checksum, restarted.checksum,
        "the same event history must derive identical projections after a restart"
    );
}

#[tokio::test]
async fn review_ratings_fold_into_the_schedule() {
    let db = Database::open_memory().await.unwrap();
    record(&db, "C1", "CON-T-002", 1.0, 5, "1010").await;
    let rated = db
        .apply_review_rating(LEARNER, "CON-T-002", "good", 6, "RATING-1", "1011")
        .await
        .unwrap();
    assert_eq!(
        rated["dueDay"], 9,
        "second Good advances to the three-day band"
    );
    db.apply_review_rating(LEARNER, "CON-UNKNOWN", "good", 6, "RATING-2", "1012")
        .await
        .expect_err("ratings require an existing scheduled review");
}

#[tokio::test]
async fn all_progress_reset_establishes_a_real_baseline() {
    let db = Database::open_memory().await.unwrap();
    record(&db, "D1", "CON-T-003", 1.0, 2, "2000").await;
    db.save_project_workspace(&NewProjectWorkspace {
        learner_id: LEARNER,
        project_id: "PRJ-PULSE",
        stage_id: "PRJ-PULSE-01",
        files: &json!({"src/lib.rs":"before reset"}),
        checksum: &"a".repeat(64),
        checkpoint: true,
        created_at: "2001",
    })
    .await
    .unwrap();
    let before = db.dashboard_snapshot(LEARNER, 10, 3).await.unwrap();
    assert_eq!(before["counts"]["attempts"], 1);
    db.apply_reset(
        LEARNER,
        "RESET-1",
        "all_progress",
        None,
        &[],
        "b".repeat(64).as_str(),
        "3000",
    )
    .await
    .unwrap();
    let after = db.dashboard_snapshot(LEARNER, 10, 3).await.unwrap();
    assert_eq!(
        after["counts"]["attempts"], 0,
        "attempts fall behind the baseline"
    );
    assert_eq!(after["counts"]["evidenceEvents"], 0);
    assert_eq!(after["counts"]["scheduledReviews"], 0);
    assert!(
        db.latest_project_workspace(LEARNER, "PRJ-PULSE", "PRJ-PULSE-01")
            .await
            .unwrap()
            .is_none(),
        "project workspace revisions fall behind the reset baseline"
    );
    assert!(
        db.evidence_timeline(LEARNER, None)
            .await
            .unwrap()
            .is_empty(),
        "the timeline reflects the baseline"
    );
    // New work after the reset builds fresh state.
    record(&db, "D2", "CON-T-003", 1.0, 4, "4000").await;
    let renewed = db.dashboard_snapshot(LEARNER, 10, 5).await.unwrap();
    assert_eq!(renewed["counts"]["attempts"], 1);
}

#[tokio::test]
async fn scoped_reset_excludes_only_named_items() {
    let db = Database::open_memory().await.unwrap();
    record(&db, "E1", "CON-T-004", 1.0, 2, "2000").await;
    record(&db, "E2", "CON-T-005", 1.0, 2, "2001").await;
    db.apply_reset(
        LEARNER,
        "RESET-2",
        "lesson",
        Some("ITEM-E1"),
        &["ITEM-E1".to_owned()],
        "c".repeat(64).as_str(),
        "3000",
    )
    .await
    .unwrap();
    let timeline = db.evidence_timeline(LEARNER, None).await.unwrap();
    assert_eq!(timeline.len(), 1);
    assert_eq!(timeline[0]["itemId"], "ITEM-E2");
}

#[tokio::test]
async fn exam_answers_cannot_be_edited_and_retakes_abandon() {
    let db = Database::open_memory().await.unwrap();
    let graph = rust_tutor_service::graph::RuntimeGraph::load_embedded().unwrap();
    let exam = rust_tutor_service::exam::FinalExam::load_embedded(&graph).unwrap();
    db.open_exam_session(LEARNER, "EXAM-S1", &exam, false, "5000")
        .await
        .unwrap();
    let answer = serde_json::from_value::<rust_tutor_service::exam::ExamAnswer>(json!({
        "answerIndex": 0, "commitment": "", "accessibilityBypass": false
    }))
    .unwrap();
    db.save_exam_answer(LEARNER, "EXAM-S1", "EXAM-Q01", &answer)
        .await
        .unwrap();
    db.save_exam_answer(LEARNER, "EXAM-S1", "EXAM-Q01", &answer)
        .await
        .expect_err("a committed exam answer is immutable within the attempt");
    db.open_exam_session(LEARNER, "EXAM-S2", &exam, true, "5001")
        .await
        .unwrap();
    let export = db.portable_export(LEARNER).await.unwrap();
    let sessions = export["payload"]["examSessions"].as_array().unwrap();
    let abandoned = sessions
        .iter()
        .find(|entry| entry["sessionId"] == "EXAM-S1")
        .unwrap();
    assert_eq!(abandoned["status"], "abandoned");
    assert!(
        abandoned["result"].is_null(),
        "an abandoned attempt has no result"
    );
}

fn rechecksum(mut archive: Value) -> Value {
    let payload = archive["payload"].clone();
    let checksum = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&payload).unwrap())
    );
    archive["manifest"]["checksumSha256"] = Value::String(checksum);
    archive
}

#[tokio::test]
async fn portable_import_round_trips_and_detects_conflicts() {
    let source = Database::open_memory().await.unwrap();
    record(&source, "F1", "CON-T-006", 1.0, 2, "6000").await;
    source
        .save_learner_plan(LEARNER, "PRJ-QUAY", "Build QUAY", 24, 10, "6001")
        .await
        .unwrap();
    source
        .record_support_reveal(LEARNER, "EX-V2", "full_reveal", "6001")
        .await
        .unwrap();
    source
        .save_project_workspace(&NewProjectWorkspace {
            learner_id: LEARNER,
            project_id: "PRJ-PULSE",
            stage_id: "PRJ-PULSE-01",
            files: &json!({"src/lib.rs":"portable"}),
            checksum: &"e".repeat(64),
            checkpoint: true,
            created_at: "6001",
        })
        .await
        .unwrap();
    let export = source.portable_export(LEARNER).await.unwrap();
    assert_eq!(
        export["payload"]["supportEvents"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        export["payload"]["projectWorkspaceRevisions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // Round trip into a fresh database preserves every exported collection.
    let target = Database::open_memory().await.unwrap();
    target
        .apply_portable_import(
            &export,
            ImportMode::Apply {
                backup_checksum: &"d".repeat(64),
                now: "6002",
            },
        )
        .await
        .unwrap();
    let reexport = target.portable_export(LEARNER).await.unwrap();
    assert_eq!(
        export["manifest"]["rowCounts"], reexport["manifest"]["rowCounts"],
        "an exported archive must reproduce identical row counts after import"
    );
    assert_eq!(
        reexport["payload"]["supportEvents"],
        export["payload"]["supportEvents"]
    );
    assert_eq!(
        reexport["payload"]["projectWorkspaceRevisions"],
        export["payload"]["projectWorkspaceRevisions"]
    );

    // A second apply of the same archive is idempotent.
    let repeat = target
        .apply_portable_import(
            &export,
            ImportMode::Apply {
                backup_checksum: &"d".repeat(64),
                now: "6003",
            },
        )
        .await
        .unwrap();
    assert_eq!(repeat["appliedRows"], 0);

    // A conflicting row under an existing stable ID aborts the whole import.
    let mut conflicted = export.clone();
    conflicted["payload"]["plans"][0]["goalTitle"] = Value::String("Different goal".to_owned());
    let conflicted = rechecksum(conflicted);
    let error = target
        .apply_portable_import(
            &conflicted,
            ImportMode::Apply {
                backup_checksum: &"d".repeat(64),
                now: "6004",
            },
        )
        .await
        .expect_err("mismatched identities must block the import");
    assert!(error.to_string().contains("conflict"), "{error}");

    // Dry run reports without changing state.
    let fresh = Database::open_memory().await.unwrap();
    let dry = fresh
        .apply_portable_import(&export, ImportMode::DryRun)
        .await
        .unwrap();
    assert!(dry["canonicalRowsChanged"].as_u64().unwrap() > 0);
    let untouched = fresh.portable_export(LEARNER).await.unwrap();
    assert_eq!(
        untouched["payload"]["attempts"].as_array().unwrap().len(),
        0
    );
}

#[tokio::test]
async fn evaluator_run_ids_are_single_use_and_server_resolved() {
    let db = Database::open_memory().await.unwrap();
    let result = json!({"status": "ACCEPTED", "replay": {"action": "test"}});
    db.record_completed_run(
        LEARNER,
        "RUN-ONCE",
        "EX-OWNERSHIP-INDEPENDENT-001",
        "test",
        &"e".repeat(64),
        "completed",
        &result,
        "7000",
    )
    .await
    .unwrap();
    db.record_completed_run(
        LEARNER,
        "RUN-ONCE",
        "EX-OWNERSHIP-INDEPENDENT-001",
        "test",
        &"e".repeat(64),
        "completed",
        &result,
        "7001",
    )
    .await
    .expect_err("run IDs are single-use");
    let stream = db
        .evaluation_stream(LEARNER, "RUN-ONCE")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stream["state"], "completed");
    assert_eq!(stream["exerciseId"], "EX-OWNERSHIP-INDEPENDENT-001");
    assert_eq!(stream["action"], "test");
    assert_eq!(stream["result"]["status"], "ACCEPTED");
}

#[tokio::test]
async fn gap_overrides_require_a_completed_owned_placement() {
    let db = Database::open_memory().await.unwrap();
    db.open_diagnostic_session(LEARNER, "DS-1", "REL-D", "placement-v1", false, "8000")
        .await
        .unwrap();
    db.record_gap_override(LEARNER, "DS-1", "OV-1", "OUT-X", "open", "why", "8001")
        .await
        .expect_err("an active session cannot take overrides");
    let placement = json!({"gapMap": [{"outcomeId": "OUT-X", "status": "open"}]});
    db.complete_diagnostic_session(LEARNER, "DS-1", &placement, "8002")
        .await
        .unwrap();
    db.record_gap_override(LEARNER, "DS-1", "OV-2", "OUT-Y", "open", "why", "8003")
        .await
        .expect_err("outcomes outside the gap map are rejected");
    db.record_gap_override(LEARNER, "DS-1", "OV-3", "OUT-X", "priority", "why", "8004")
        .await
        .expect("gap-map outcomes accept audited overrides");
}

#[tokio::test]
async fn curriculum_v2_reveals_and_workspace_revisions_are_durable() {
    let db = Database::open_memory().await.unwrap();
    db.record_support_reveal(LEARNER, "EX-V2", "full_reveal", "9000")
        .await
        .unwrap();
    let first = db
        .save_project_workspace(&NewProjectWorkspace {
            learner_id: LEARNER,
            project_id: "PRJ-PULSE",
            stage_id: "PRJ-PULSE-01",
            files: &json!({"src/lib.rs":"first"}),
            checksum: &"a".repeat(64),
            checkpoint: false,
            created_at: "9001",
        })
        .await
        .unwrap();
    let checkpoint = db
        .save_project_workspace(&NewProjectWorkspace {
            learner_id: LEARNER,
            project_id: "PRJ-PULSE",
            stage_id: "PRJ-PULSE-01",
            files: &json!({"src/lib.rs":"second"}),
            checksum: &"b".repeat(64),
            checkpoint: true,
            created_at: "9002",
        })
        .await
        .unwrap();
    assert_eq!(first["revision"], 1);
    assert_eq!(checkpoint["revision"], 2);
    let latest = db
        .latest_project_workspace(LEARNER, "PRJ-PULSE", "PRJ-PULSE-01")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(latest["files"]["src/lib.rs"], "second");
    assert_eq!(latest["checkpoint"], true);
}
