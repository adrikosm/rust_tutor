use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const EXAM: &str = include_str!("../../../content/final-exam.v1.json");
const REQUIRED: [&str; 15] = [
    "fundamentals",
    "ownership",
    "borrowing",
    "lifetimes",
    "traits",
    "generics",
    "errors",
    "cargo",
    "testing",
    "tooling",
    "concurrency",
    "tokio",
    "data_engineering",
    "algorithms",
    "production_engineering",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalExam {
    pub schema_version: u32,
    pub form_id: String,
    pub form_version: String,
    pub pass_threshold_percent: u32,
    pub support_policy: String,
    pub retry_policy: String,
    pub items: Vec<ExamItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExamItem {
    pub id: String,
    pub category: String,
    pub format: String,
    pub prompt: String,
    pub choices: Vec<String>,
    #[serde(skip_serializing)]
    pub answer_index: usize,
    pub item_checksum: String,
    pub primary_outcome_id: String,
    pub rubric: String,
    pub support: String,
    pub explanation: String,
    pub remediation_lesson_id: String,
    pub independent_practice_id: String,
    pub checkpoint_id: String,
}

impl ExamItem {
    /// SHA-256 over the canonical serialization of every scored field; the
    /// stored checksum must reproduce it, so item content and key cannot drift
    /// from the published identity.
    pub fn canonical_checksum(&self) -> String {
        let mut digest = Sha256::new();
        for part in [
            self.id.as_str(),
            self.category.as_str(),
            self.format.as_str(),
            self.prompt.as_str(),
        ] {
            digest.update(part.as_bytes());
            digest.update([0]);
        }
        for choice in &self.choices {
            digest.update(choice.as_bytes());
            digest.update([0]);
        }
        for part in [
            &self.answer_index.to_string(),
            &self.primary_outcome_id,
            &self.rubric,
            &self.support,
            &self.explanation,
            &self.remediation_lesson_id,
            &self.independent_practice_id,
            &self.checkpoint_id,
        ] {
            digest.update(part.as_bytes());
            digest.update([0]);
        }
        format!("{:x}", digest.finalize())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExamAnswer {
    pub answer_index: usize,
    #[serde(default)]
    pub commitment: String,
    #[serde(default)]
    pub accessibility_bypass: bool,
}

impl FinalExam {
    pub fn load_embedded(graph: &crate::graph::RuntimeGraph) -> Result<Self, String> {
        let exam: Self = serde_json::from_str(EXAM)
            .map_err(|error| format!("invalid embedded final exam: {error}"))?;
        exam.validate(graph)?;
        Ok(exam)
    }

    pub fn validate(&self, graph: &crate::graph::RuntimeGraph) -> Result<(), String> {
        if self.schema_version != 1
            || self.items.len() != 15
            || self.pass_threshold_percent != 80
            || self.form_id.is_empty()
            || self.form_version.is_empty()
        {
            return Err("final exam must be a versioned 15-item form with an 80% threshold".into());
        }
        let categories: HashSet<_> = self
            .items
            .iter()
            .map(|item| item.category.as_str())
            .collect();
        if categories.len() != 15
            || REQUIRED
                .iter()
                .any(|category| !categories.contains(category))
        {
            return Err("final exam must contain each required category exactly once".into());
        }
        let mut ids = HashSet::new();
        for item in &self.items {
            let node_kind = |id: &str| graph.node(id).map(|node| node.kind.as_str());
            if !ids.insert(item.id.as_str())
                || item.choices.len() < 2
                || item.answer_index >= item.choices.len()
                || item.item_checksum != item.canonical_checksum()
                || graph.node(&item.primary_outcome_id).is_none()
                || item.rubric.trim().is_empty()
                || node_kind(&item.remediation_lesson_id) != Some("concept")
                || node_kind(&item.independent_practice_id) != Some("exercise")
                || node_kind(&item.checkpoint_id) != Some("assessment")
            {
                return Err(format!("{} has an invalid exam contract", item.id));
            }
        }
        for required_format in [
            "compile_fail_repair",
            "fresh_algorithm",
            "system_design",
            "observability_diagnosis",
        ] {
            if !self.items.iter().any(|item| item.format == required_format) {
                return Err(format!("final exam is missing {required_format}"));
            }
        }
        Ok(())
    }

    pub fn score(&self, answers: &HashMap<String, ExamAnswer>) -> serde_json::Value {
        let results: Vec<_> = self
            .items
            .iter()
            .map(|item| {
                let answer = answers.get(&item.id);
                let correct = answer.is_some_and(|answer| answer.answer_index == item.answer_index);
                serde_json::json!({
                    "itemId":item.id,
                    "category":item.category,
                    "outcomeId":item.primary_outcome_id,
                    "correct":correct,
                    "support":item.support,
                    "rubric":item.rubric,
                    "explanation":item.explanation,
                    // Every scored exam item is a multiple-choice knowledge
                    // check; the format names the scenario style, not a
                    // performance artifact.
                    "evidenceKind":"knowledge_check_mcq",
                    "commitmentRecorded":answer.is_some_and(|answer| !answer.commitment.trim().is_empty()),
                    "nextProof":if correct { item.checkpoint_id.as_str() } else { item.independent_practice_id.as_str() },
                    "remediationLessonId":if correct { None } else { Some(item.remediation_lesson_id.as_str()) },
                    "accessibilityBypass":answer.is_some_and(|answer| answer.accessibility_bypass)
                })
            })
            .collect();
        let correct = results
            .iter()
            .filter(|result| result["correct"] == true)
            .count();
        let percent = u32::try_from(correct * 100 / self.items.len()).expect("bounded score");
        serde_json::json!({
            "formId":self.form_id,
            "formVersion":self.form_version,
            "correct":correct,
            "total":self.items.len(),
            "percent":percent,
            "passed":percent>=self.pass_threshold_percent,
            "passThresholdPercent":self.pass_threshold_percent,
            "results":results,
            "masteryAutomaticallyChanged":false,
            "evidenceModel":"Every scored item is a multiple-choice knowledge check. Committed reasoning is recorded verbatim but never graded; performance evidence comes only from evaluator-backed practice.",
            "reviewPolicy":"Misses schedule fresh transfer and prerequisite lessons; exact exam items are excluded from immediate review."
        })
    }
}
