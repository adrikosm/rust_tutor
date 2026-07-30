use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

const BLUEPRINTS: &str = include_str!("../../../content/diagnostic-blueprints.v1.json");

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticBlueprints {
    pub schema_version: u32,
    pub release_id: String,
    pub model_version: String,
    pub minimum_performance_items_per_domain: usize,
    pub packets: Vec<DiagnosticPacket>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticPacket {
    pub id: String,
    pub domain: String,
    pub title: String,
    pub items: Vec<DiagnosticItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticItem {
    pub id: String,
    pub format: String,
    pub prompt: String,
    pub outcome_id: String,
    pub placement_decision: String,
    pub choices: Vec<String>,
    #[serde(skip_serializing)]
    pub answer_index: usize,
    pub justification_required: bool,
    pub profile_only: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticAnswer {
    pub answer_index: Option<usize>,
    #[serde(default)]
    pub unknown: bool,
    #[serde(default)]
    pub accessibility_bypass: bool,
    #[serde(default)]
    pub justification: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementResult {
    pub release_id: String,
    pub model_version: String,
    pub performance: Vec<ItemPlacement>,
    pub profile_context: Vec<ItemPlacement>,
    pub decisions: Vec<DomainDecision>,
    pub gap_map: Vec<GapMapEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPlacement {
    pub item_id: String,
    pub outcome_id: String,
    pub correct: Option<bool>,
    pub unknown: bool,
    pub accessibility_bypass: bool,
    pub decision: String,
    pub justification_recorded: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainDecision {
    pub domain: String,
    pub demonstrated: usize,
    pub attempted: usize,
    pub optional_decisions: Vec<String>,
    pub explanation: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GapMapEntry {
    pub outcome_id: String,
    pub status: &'static str,
    pub evidence: String,
    pub learner_override_allowed: bool,
}

impl DiagnosticBlueprints {
    pub fn load_embedded(graph: &crate::graph::RuntimeGraph) -> Result<Self, String> {
        let blueprints: Self = serde_json::from_str(BLUEPRINTS)
            .map_err(|error| format!("invalid embedded diagnostic blueprints: {error}"))?;
        blueprints.validate(graph)?;
        Ok(blueprints)
    }

    pub fn validate(&self, graph: &crate::graph::RuntimeGraph) -> Result<(), String> {
        if self.schema_version != 1
            || self.release_id.is_empty()
            || self.model_version != "placement-v1"
            || self.minimum_performance_items_per_domain < 2
        {
            return Err("unsupported diagnostic blueprint contract".to_owned());
        }
        let required_domains = HashSet::from([
            "rust",
            "algorithms",
            "data_engineering",
            "independent_debugging",
        ]);
        let domains: HashSet<_> = self
            .packets
            .iter()
            .map(|packet| packet.domain.as_str())
            .collect();
        if !required_domains.is_subset(&domains) {
            return Err("diagnostic must cover all four required domains".to_owned());
        }
        let mut ids = HashSet::new();
        let mut has_repair = false;
        let mut performance_per_domain: BTreeMap<&str, usize> = BTreeMap::new();
        let mut answer_positions: HashSet<usize> = HashSet::new();
        for packet in &self.packets {
            if packet.items.is_empty() {
                return Err(format!("{} has no diagnostic items", packet.id));
            }
            for item in &packet.items {
                has_repair |= item.format == "repair_decision";
                if !ids.insert(item.id.as_str())
                    || item.choices.len() < 2
                    || item.answer_index >= item.choices.len()
                    || graph.node(&item.outcome_id).is_none()
                {
                    return Err(format!("{} has an invalid diagnostic contract", item.id));
                }
                if !item.profile_only {
                    *performance_per_domain
                        .entry(packet.domain.as_str())
                        .or_default() += 1;
                    answer_positions.insert(item.answer_index);
                }
            }
        }
        if !has_repair {
            return Err("diagnostic must contain a repair-decision knowledge check".to_owned());
        }
        // Item-quality gates: enough real performance items per required
        // domain, and the answer key must not sit in one position throughout.
        for domain in [
            "rust",
            "algorithms",
            "data_engineering",
            "independent_debugging",
        ] {
            if performance_per_domain.get(domain).copied().unwrap_or(0)
                < self.minimum_performance_items_per_domain
            {
                return Err(format!(
                    "domain {domain} has fewer than {} performance items",
                    self.minimum_performance_items_per_domain
                ));
            }
        }
        if answer_positions.len() < 3 {
            return Err(
                "diagnostic answer keys are position-biased; correct answers must vary across at least three positions"
                    .to_owned(),
            );
        }
        Ok(())
    }

    pub fn item(&self, item_id: &str) -> Option<(&DiagnosticPacket, &DiagnosticItem)> {
        self.packets.iter().find_map(|packet| {
            packet
                .items
                .iter()
                .find(|item| item.id == item_id)
                .map(|item| (packet, item))
        })
    }

    pub fn score(&self, answers: &HashMap<String, DiagnosticAnswer>) -> PlacementResult {
        let mut performance = Vec::new();
        let mut profile_context = Vec::new();
        let mut by_domain = BTreeMap::<String, Vec<ItemPlacement>>::new();
        for packet in &self.packets {
            for item in &packet.items {
                let answer = answers.get(&item.id);
                let unknown = answer.is_some_and(|answer| answer.unknown);
                let correct = if item.profile_only || unknown {
                    None
                } else {
                    answer
                        .and_then(|answer| answer.answer_index)
                        .map(|answer| answer == item.answer_index)
                };
                let placement = ItemPlacement {
                    item_id: item.id.clone(),
                    outcome_id: item.outcome_id.clone(),
                    correct,
                    unknown,
                    accessibility_bypass: answer.is_some_and(|answer| answer.accessibility_bypass),
                    decision: item.placement_decision.clone(),
                    justification_recorded: answer
                        .is_some_and(|answer| !answer.justification.trim().is_empty()),
                };
                if item.profile_only {
                    profile_context.push(placement);
                } else {
                    by_domain
                        .entry(packet.domain.clone())
                        .or_default()
                        .push(placement.clone());
                    performance.push(placement);
                }
            }
        }
        let decisions = by_domain
            .iter()
            .map(|(domain, items)| {
                let demonstrated = items
                    .iter()
                    .filter(|item| item.correct == Some(true))
                    .count();
                let optional_decisions = if demonstrated
                    >= self.minimum_performance_items_per_domain
                {
                    items
                        .iter()
                        .filter(|item| {
                            item.correct == Some(true) && item.decision.ends_with("_optional")
                        })
                        .map(|item| item.decision.clone())
                        .collect()
                } else {
                    Vec::new()
                };
                DomainDecision {
                    domain: domain.clone(),
                    demonstrated,
                    attempted: items.iter().filter(|item| item.correct.is_some()).count(),
                    optional_decisions,
                    explanation: format!(
                        "Performance evidence only: {demonstrated} correct of {} mapped items; profile confidence cannot skip outcomes.",
                        items.len()
                    ),
                }
            })
            .collect();
        let gap_map = performance
            .iter()
            .map(|item| GapMapEntry {
                outcome_id: item.outcome_id.clone(),
                status: if item.correct == Some(true) {
                    "demonstrated"
                } else if item.unknown {
                    "uncertain"
                } else {
                    "open"
                },
                evidence: format!(
                    "{} under {} from {}",
                    item.item_id, self.model_version, self.release_id
                ),
                learner_override_allowed: true,
            })
            .collect();
        PlacementResult {
            release_id: self.release_id.clone(),
            model_version: self.model_version.clone(),
            performance,
            profile_context,
            decisions,
            gap_map,
        }
    }
}
