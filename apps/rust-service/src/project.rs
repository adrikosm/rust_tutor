use serde::{Deserialize, Serialize};

// The former parallel `evaluate_stage` gate was never called by the production
// endpoint; stage acceptance is now derived only from persisted evaluator runs
// (see `workbench_accept` in lib.rs) and checkpoint lineage is validated below.

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectCheckpoint {
    pub checkpoint_id: String,
    pub stage_id: String,
    pub parent_checkpoint_id: Option<String>,
    pub workspace_checksum: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorOverlay {
    pub schema_version: u32,
    pub stage_id: String,
    pub upstream_order: Option<usize>,
    pub imported_fields: Vec<&'static str>,
    pub upstream_instructions_imported: bool,
    pub rust_explanations: Vec<&'static str>,
    pub retrieval_prompts: Vec<&'static str>,
    pub hint_policy: &'static str,
    pub reflection_prompts: Vec<&'static str>,
    pub graph_links: Vec<&'static str>,
    pub transfer_work: Vec<&'static str>,
    pub evaluator_origin: &'static str,
}

pub fn tutor_overlay(stage_id: &str, ordered_position: usize) -> TutorOverlay {
    let imported = stage_id.starts_with("CC-");
    TutorOverlay {
        schema_version: 1,
        stage_id: stage_id.to_owned(),
        upstream_order: imported.then_some(ordered_position),
        imported_fields: if imported {
            vec!["stage slug", "stage name", "difficulty"]
        } else {
            Vec::new()
        },
        upstream_instructions_imported: false,
        rust_explanations: vec!["ownership/type boundary", "error and test interpretation"],
        retrieval_prompts: vec![
            "state a plan before opening help",
            "name the primary specification to consult",
        ],
        hint_policy: "seven-level local help ladder; action required between levels; full reveal cannot unlock",
        reflection_prompts: vec![
            "what failed and why",
            "what evidence changed the hypothesis",
        ],
        graph_links: vec![
            "prerequisite outcomes",
            "compiler errors",
            "project/application path",
        ],
        transfer_work: vec!["fresh local variant", "selected prior-stage regression"],
        evaluator_origin: "locally authored from public specifications; no private or upstream tester behavior",
    }
}

pub fn validate_lineage(checkpoints: &[ProjectCheckpoint]) -> Result<(), String> {
    let ids: std::collections::HashSet<_> = checkpoints
        .iter()
        .map(|checkpoint| checkpoint.checkpoint_id.as_str())
        .collect();
    if ids.len() != checkpoints.len() {
        return Err("duplicate checkpoint identity".into());
    }
    for checkpoint in checkpoints {
        if checkpoint.workspace_checksum.len() != 64
            || checkpoint
                .parent_checkpoint_id
                .as_ref()
                .is_some_and(|parent| !ids.contains(parent.as_str()))
        {
            return Err(format!(
                "invalid checkpoint lineage at {}",
                checkpoint.checkpoint_id
            ));
        }
    }
    Ok(())
}
