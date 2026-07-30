use std::collections::HashSet;

use serde::{Deserialize, Serialize};

const OWNERSHIP_SLICE: &str = include_str!("../../../content/ownership-slice.v1.json");

/// Stable release ID of the embedded tutor slice; the single content identity
/// the bootstrap, evaluator requests, and evidence records all reference.
pub fn embedded_release_id() -> String {
    load_embedded_release_id().unwrap_or_else(|| "REL-UNKNOWN".to_owned())
}

fn load_embedded_release_id() -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(OWNERSHIP_SLICE).ok()?;
    Some(value.get("releaseId")?.as_str()?.to_owned())
}

/// SHA-256 of the embedded tutor slice bytes: the canonical content checksum.
pub fn embedded_release_checksum() -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(OWNERSHIP_SLICE.as_bytes()))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TutorContent {
    pub schema_version: u32,
    pub release_id: String,
    pub sources: Vec<Source>,
    pub outcomes: Vec<Outcome>,
    pub prerequisites: Vec<Prerequisite>,
    pub misconceptions: Vec<Misconception>,
    pub diagnostic: Vec<DiagnosticItem>,
    pub lesson: Lesson,
    pub exercises: Vec<Exercise>,
    pub hint_ladder: Vec<HintStep>,
    pub review_intervals_days: Vec<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub id: String,
    pub title: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Outcome {
    pub id: String,
    pub concept_id: String,
    pub title: String,
    pub observable: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Prerequisite {
    pub source_id: String,
    pub target_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Misconception {
    pub id: String,
    pub title: String,
    pub diagnostic: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticItem {
    pub id: String,
    pub outcome_id: String,
    pub prompt: String,
    pub choices: Vec<String>,
    #[serde(skip_serializing)]
    answer_index: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lesson {
    pub id: String,
    pub title: String,
    pub recall_prompts: Vec<String>,
    pub summary: String,
    pub worked_trace: Vec<TraceStep>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraceStep {
    pub line: usize,
    pub binding: String,
    pub state: String,
    pub explanation: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Exercise {
    pub id: String,
    pub kind: String,
    pub outcome_ids: Vec<String>,
    pub primary_outcome_ids: Vec<String>,
    pub supporting_outcome_ids: Vec<String>,
    pub variant_group: String,
    pub title: String,
    pub prompt: String,
    pub starter: String,
    #[serde(skip_serializing)]
    solution: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HintStep {
    pub level: u8,
    pub requires: String,
    pub text: String,
    pub solution_reveal: bool,
}

impl TutorContent {
    pub fn load_embedded() -> Result<Self, String> {
        let content: Self = serde_json::from_str(OWNERSHIP_SLICE)
            .map_err(|error| format!("invalid embedded tutor content: {error}"))?;
        content.validate()?;
        Ok(content)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || !self.release_id.starts_with("REL-") {
            return Err("unsupported tutor content release".to_owned());
        }
        let outcomes: HashSet<_> = self
            .outcomes
            .iter()
            .map(|outcome| outcome.id.as_str())
            .collect();
        if outcomes.len() != 5 {
            return Err("ownership slice must define five distinct outcomes".to_owned());
        }
        if self.diagnostic.len() != outcomes.len()
            || self
                .diagnostic
                .iter()
                .map(|item| item.outcome_id.as_str())
                .collect::<HashSet<_>>()
                != outcomes
        {
            return Err("diagnostic must assess every outcome exactly once".to_owned());
        }
        for item in &self.diagnostic {
            if item.choices.len() < 2 || item.answer_index >= item.choices.len() {
                return Err(format!("{} has an invalid hidden answer", item.id));
            }
        }
        for edge in &self.prerequisites {
            if !outcomes.contains(edge.source_id.as_str())
                || !outcomes.contains(edge.target_id.as_str())
            {
                return Err("prerequisite references an unknown outcome".to_owned());
            }
        }
        if has_cycle(&self.prerequisites) {
            return Err("ownership prerequisite graph contains a cycle".to_owned());
        }
        if self.lesson.recall_prompts.is_empty() || self.lesson.worked_trace.is_empty() {
            return Err("lesson needs recall prompts and an annotated trace".to_owned());
        }
        for exercise in &self.exercises {
            let classified: HashSet<_> = exercise
                .primary_outcome_ids
                .iter()
                .chain(&exercise.supporting_outcome_ids)
                .map(String::as_str)
                .collect();
            let declared: HashSet<_> = exercise.outcome_ids.iter().map(String::as_str).collect();
            let overlap = exercise
                .primary_outcome_ids
                .iter()
                .any(|id| exercise.supporting_outcome_ids.contains(id));
            if exercise.outcome_ids.is_empty()
                || exercise.primary_outcome_ids.is_empty()
                || exercise
                    .outcome_ids
                    .iter()
                    .any(|id| !outcomes.contains(id.as_str()))
                || overlap
                || classified != declared
                || exercise.solution.is_empty()
            {
                return Err(format!("{} has an invalid exercise contract", exercise.id));
            }
        }
        for (index, hint) in self.hint_ladder.iter().enumerate() {
            let expected = u8::try_from(index + 1).map_err(|error| error.to_string())?;
            if hint.level != expected || hint.solution_reveal != (hint.level == 7) {
                return Err("hint ladder must be contiguous and reveal only at level 7".to_owned());
            }
        }
        if self.review_intervals_days != [1, 3, 7, 21] {
            return Err("review intervals must be 1/3/7/21 days".to_owned());
        }
        Ok(())
    }
}

fn has_cycle(edges: &[Prerequisite]) -> bool {
    fn visit<'a>(
        node: &'a str,
        edges: &'a [Prerequisite],
        active: &mut HashSet<&'a str>,
        done: &mut HashSet<&'a str>,
    ) -> bool {
        if active.contains(node) {
            return true;
        }
        if !done.insert(node) {
            return false;
        }
        active.insert(node);
        let cyclic = edges
            .iter()
            .filter(|edge| edge.source_id == node)
            .any(|edge| visit(&edge.target_id, edges, active, done));
        active.remove(node);
        cyclic
    }
    let mut active = HashSet::new();
    let mut done = HashSet::new();
    edges
        .iter()
        .any(|edge| visit(&edge.source_id, edges, &mut active, &mut done))
}
