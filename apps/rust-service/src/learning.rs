use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};

pub const MASTERY_MODEL_VERSION: &str = "mastery-v1";
pub const SCHEDULER_MODEL_VERSION: &str = "review-v1";
pub const REVIEW_INTERVALS_DAYS: [u32; 4] = [1, 3, 7, 21];

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    Recall,
    Trace,
    Implement,
    Debug,
    Test,
    Explain,
    Design,
    Transfer,
    Project,
}

impl EvidenceKind {
    pub fn rubric(self) -> &'static str {
        match self {
            Self::Recall => "Retrieve the rule before reading or feedback.",
            Self::Trace => "Name the relevant state transition and justify each step.",
            Self::Implement => "Produce code that satisfies the declared contract and tests.",
            Self::Debug => "Identify the root cause, repair it, and explain the causal change.",
            Self::Test => "Design a case that distinguishes correct from plausible-wrong behavior.",
            Self::Explain => "State the rule, mechanism, boundary, and a concrete consequence.",
            Self::Design => "Compare options against explicit constraints and defend a trade-off.",
            Self::Transfer => "Apply the outcome in a materially different surface context.",
            Self::Project => {
                "Produce a cumulative artifact linked to independently checked outcomes."
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Support {
    None,
    Compiler,
    OfficialDocs,
    Hint { level: u8 },
    SolutionViewed,
    ExternalHelp,
}

impl Support {
    pub fn can_advance_mastery(&self) -> bool {
        matches!(self, Self::None | Self::Compiler | Self::OfficialDocs)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HintEvent {
    pub from_level: u8,
    pub to_level: u8,
    pub required_action: String,
    pub action_completed: bool,
    pub accessibility_bypass: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HintState {
    pub level: u8,
    pub events: Vec<HintEvent>,
    pub assisted: bool,
    pub fresh_variant_required: bool,
}

impl HintState {
    pub fn advance(
        &mut self,
        target_level: u8,
        required_action: &str,
        action_completed: bool,
        accessibility_bypass: bool,
    ) -> Result<(), &'static str> {
        if target_level != self.level + 1 || !(1..=7).contains(&target_level) {
            return Err("hint levels must advance exactly one step");
        }
        if !action_completed && !accessibility_bypass {
            return Err("the configured learner action is required before the next hint");
        }
        self.events.push(HintEvent {
            from_level: self.level,
            to_level: target_level,
            required_action: required_action.to_owned(),
            action_completed,
            accessibility_bypass,
        });
        self.level = target_level;
        if target_level == 7 {
            self.assisted = true;
            self.fresh_variant_required = true;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observation {
    pub evidence_id: String,
    pub item_id: String,
    pub variant_group: String,
    pub kind: EvidenceKind,
    pub success: bool,
    pub support: Support,
    pub day: u32,
    pub critical_misconception: bool,
    pub primary_outcome: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MasteryState {
    #[default]
    NotStarted,
    Exposed,
    Practicing,
    Provisional,
    Retained,
    NeedsConfirmation,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasteryExplanation {
    pub state: MasteryState,
    pub model_version: &'static str,
    pub evidence_ids: Vec<String>,
    pub missing_gate: Option<String>,
    pub next_proof: String,
}

/// Pure fold over the full ordered evidence history: the state after `n`
/// observations feeds the retained/needs-confirmation logic for observation
/// `n + 1`. Incremental and restart rebuilds therefore derive identical state.
pub fn derive_mastery_history(observations: &[Observation]) -> MasteryExplanation {
    // O(n²) over a learner's per-concept evidence, which stays tiny;
    // an incremental accumulator would only matter at thousands of rows.
    let mut previous = MasteryState::NotStarted;
    let mut explanation = derive_mastery(previous, &[]);
    for end in 1..=observations.len() {
        explanation = derive_mastery(previous, &observations[..end]);
        previous = explanation.state;
    }
    explanation
}

pub fn derive_mastery(previous: MasteryState, observations: &[Observation]) -> MasteryExplanation {
    if observations.is_empty() {
        return explanation(
            MasteryState::NotStarted,
            observations,
            Some("first exposure"),
            "Open the reviewed lesson and commit a recall response.",
        );
    }
    let primary: Vec<_> = observations
        .iter()
        .filter(|item| item.primary_outcome)
        .collect();
    if primary.is_empty() {
        return explanation(
            MasteryState::Exposed,
            observations,
            Some("scored primary evidence"),
            "Attempt a primary-outcome item after committing confidence.",
        );
    }
    let eligible_successes: Vec<_> = primary
        .iter()
        .copied()
        .filter(|item| {
            item.success && item.support.can_advance_mastery() && !item.critical_misconception
        })
        .collect();
    let variants: HashSet<_> = eligible_successes
        .iter()
        .map(|item| item.variant_group.as_str())
        .collect();
    let latest = primary.iter().max_by_key(|item| item.day).copied();
    if matches!(
        previous,
        MasteryState::Retained | MasteryState::NeedsConfirmation
    ) && latest.is_some_and(|item| !item.success)
    {
        return explanation(
            MasteryState::NeedsConfirmation,
            observations,
            Some("fresh delayed confirmation"),
            "Relearn the failed rule, then solve a fresh delayed variant without support.",
        );
    }
    if variants.len() < 2 {
        return explanation(
            MasteryState::Practicing,
            observations,
            Some("two distinct unassisted variants"),
            "Solve a fresh isomorphic variant without hints or a solution reveal.",
        );
    }
    let first_day = eligible_successes
        .iter()
        .map(|item| item.day)
        .min()
        .unwrap_or(0);
    let delayed = eligible_successes.iter().any(|item| item.day > first_day);
    let transfer = eligible_successes
        .iter()
        .any(|item| matches!(item.kind, EvidenceKind::Transfer | EvidenceKind::Project));
    if delayed && transfer {
        explanation(
            MasteryState::Retained,
            observations,
            None,
            "Maintain with bounded delayed review and project application.",
        )
    } else {
        let gate = match (delayed, transfer) {
            (false, false) => "delayed success and transfer/project evidence",
            (false, true) => "delayed unassisted success",
            (true, false) => "transfer or project evidence",
            (true, true) => unreachable!(),
        };
        explanation(
            MasteryState::Provisional,
            observations,
            Some(gate),
            "Complete the missing retained-evidence gate on a fresh item.",
        )
    }
}

fn explanation(
    state: MasteryState,
    observations: &[Observation],
    missing_gate: Option<&str>,
    next_proof: &str,
) -> MasteryExplanation {
    MasteryExplanation {
        state,
        model_version: MASTERY_MODEL_VERSION,
        evidence_ids: observations
            .iter()
            .map(|item| item.evidence_id.clone())
            .collect(),
        missing_gate: missing_gate.map(str::to_owned),
        next_proof: next_proof.to_owned(),
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewRating {
    Again,
    Hard,
    Good,
    Easy,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDecision {
    pub due_day: u32,
    pub interval_index: usize,
    pub interval_days: u32,
    pub relearn_first: bool,
    pub reason: String,
    pub model_version: &'static str,
}

/// `current_index` is `None` before the first successful review, so the first
/// Good rating schedules the advertised one-day interval instead of jumping
/// straight to the three-day band.
pub fn schedule_review(
    day: u32,
    current_index: Option<usize>,
    rating: ReviewRating,
) -> ReviewDecision {
    let top = REVIEW_INTERVALS_DAYS.len() - 1;
    let (index, relearn, reason) = match rating {
        ReviewRating::Again => (0, true, "Again: relearn before a fresh one-day review."),
        ReviewRating::Hard => (
            current_index.map_or(0, |index| index.saturating_sub(1)),
            false,
            "Hard: use the prior interval band.",
        ),
        ReviewRating::Good => (
            current_index.map_or(0, |index| (index + 1).min(top)),
            false,
            "Good: advance one fixed interval band.",
        ),
        ReviewRating::Easy => (
            current_index.map_or(1, |index| (index + 2).min(top)),
            false,
            "Easy: advance at most two fixed interval bands.",
        ),
    };
    let interval = REVIEW_INTERVALS_DAYS[index];
    ReviewDecision {
        due_day: day.saturating_add(interval),
        interval_index: index,
        interval_days: interval,
        relearn_first: relearn,
        reason: reason.to_owned(),
        model_version: SCHEDULER_MODEL_VERSION,
    }
}

pub fn choose_fresh_variant<'a>(
    candidates: &'a [Observation],
    seen_items: &HashSet<&str>,
    recent_variant_groups: &HashSet<&str>,
) -> Option<&'a Observation> {
    candidates
        .iter()
        .find(|candidate| {
            !seen_items.contains(candidate.item_id.as_str())
                && !recent_variant_groups.contains(candidate.variant_group.as_str())
        })
        .or_else(|| {
            candidates
                .iter()
                .find(|candidate| !seen_items.contains(candidate.item_id.as_str()))
        })
}

pub fn eligible_confusable_siblings(
    focus: &str,
    explicit_pairs: &[(String, String)],
    prerequisite_ready: &HashSet<&str>,
) -> Vec<String> {
    let mut eligible: BTreeSet<_> = explicit_pairs
        .iter()
        .filter_map(|(left, right)| {
            let sibling = if left == focus {
                right
            } else if right == focus {
                left
            } else {
                return None;
            };
            (prerequisite_ready.contains(focus) && prerequisite_ready.contains(sibling.as_str()))
                .then(|| sibling.clone())
        })
        .collect();
    eligible.remove(focus);
    eligible.into_iter().collect()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub id: String,
    pub score: i32,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyChoice {
    pub kind: &'static str,
    pub id: String,
    pub reasons: Vec<String>,
    pub override_warning: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPlan {
    pub model_version: &'static str,
    pub choices: Vec<DailyChoice>,
    pub overflow: usize,
}

pub fn build_daily_plan(
    ranked: &[Recommendation],
    due_id: Option<&str>,
    goal_id: &str,
    overflow: usize,
) -> DailyPlan {
    let due_id = due_id.unwrap_or("NO-DUE-REVIEW");
    let due = DailyChoice {
        kind: "due_review",
        id: due_id.to_owned(),
        reasons: ranked
            .iter()
            .find(|item| item.id == due_id)
            .map(|item| item.reasons.clone())
            .unwrap_or_else(|| {
                vec![
                    if due_id == "NO-DUE-REVIEW" {
                        "due: no scored evidence has reached its fixed interval"
                    } else {
                        "due: fixed review interval reached"
                    }
                    .to_owned(),
                ]
            }),
        override_warning: (due_id != "NO-DUE-REVIEW").then(|| {
            "Skipping due work keeps it in the bounded backlog; no mastery is removed.".to_owned()
        }),
    };
    let goal = ranked
        .iter()
        .find(|item| item.id == goal_id)
        .cloned()
        .unwrap_or(Recommendation {
            id: goal_id.to_owned(),
            score: 0,
            reasons: vec!["goal: current ownership path".to_owned()],
        });
    let mut choices = vec![due];
    choices.push(DailyChoice {
        kind: "goal_aligned_next",
        id: goal.id,
        reasons: goal.reasons,
        override_warning: None,
    });
    choices.push(DailyChoice {
        kind: "browse_or_continue",
        id: "CURRICULUM-BROWSE".to_owned(),
        reasons: vec!["learner choice: browse or continue without a hard lock".to_owned()],
        override_warning: None,
    });
    DailyPlan {
        model_version: SCHEDULER_MODEL_VERSION,
        choices,
        overflow,
    }
}

pub fn rank_recommendations(
    candidates: &[(String, HashMap<&str, i32>)],
    recently_seen: &HashSet<&str>,
) -> Vec<Recommendation> {
    let mut ranked: Vec<_> = candidates
        .iter()
        .filter(|(id, _)| !recently_seen.contains(id.as_str()))
        .map(|(id, components)| Recommendation {
            id: id.clone(),
            score: components.values().sum(),
            reasons: components
                .iter()
                .filter(|(_, value)| **value != 0)
                .map(|(name, value)| format!("{name}: {value:+}"))
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
        })
        .collect();
    ranked.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.id.cmp(&right.id))
    });
    ranked
}

#[derive(Clone, Debug)]
pub struct ConfidenceSample {
    pub confidence: u8,
    pub success: bool,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceCalibration {
    pub band: String,
    pub sample_count: usize,
    pub accuracy: Option<f64>,
    pub confidence_midpoint: Option<f64>,
    pub gap: Option<f64>,
    pub message: String,
}

pub fn calibrate_confidence(
    samples: &[ConfidenceSample],
    minimum: usize,
) -> Vec<ConfidenceCalibration> {
    [
        ("low", 1_u8, 2_u8, 0.3_f64),
        ("medium", 3, 3, 0.6),
        ("high", 4, 5, 0.9),
    ]
    .into_iter()
    .map(|(band, minimum_value, maximum_value, midpoint)| {
        let values: Vec<_> = samples
            .iter()
            .filter(|sample| (minimum_value..=maximum_value).contains(&sample.confidence))
            .collect();
        if values.len() < minimum {
            return ConfidenceCalibration {
                band: band.to_owned(),
                sample_count: values.len(),
                accuracy: None,
                confidence_midpoint: None,
                gap: None,
                message: "Insufficient evidence for this confidence band.".to_owned(),
            };
        }
        let accuracy =
            values.iter().filter(|sample| sample.success).count() as f64 / values.len() as f64;
        ConfidenceCalibration {
            band: band.to_owned(),
            sample_count: values.len(),
            accuracy: Some(accuracy),
            confidence_midpoint: Some(midpoint),
            gap: Some(accuracy - midpoint),
            message: "Observed accuracy compared with the declared confidence band.".to_owned(),
        }
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation(
        id: &str,
        variant: &str,
        day: u32,
        success: bool,
        kind: EvidenceKind,
    ) -> Observation {
        Observation {
            evidence_id: id.to_owned(),
            item_id: format!("ITEM-{id}"),
            variant_group: variant.to_owned(),
            kind,
            success,
            support: Support::None,
            day,
            critical_misconception: false,
            primary_outcome: true,
        }
    }

    #[test]
    fn first_good_review_uses_the_one_day_interval() {
        let decision = schedule_review(10, None, ReviewRating::Good);
        assert_eq!(decision.interval_index, 0);
        assert_eq!(decision.interval_days, 1);
        assert_eq!(decision.due_day, 11);
    }

    #[test]
    fn good_ratings_advance_one_band_and_cap_at_the_top() {
        let mut index = None;
        let mut days = Vec::new();
        for day in [0, 1, 4, 11, 32] {
            let decision = schedule_review(day, index, ReviewRating::Good);
            index = Some(decision.interval_index);
            days.push(decision.interval_days);
        }
        assert_eq!(days, vec![1, 3, 7, 21, 21]);
    }

    #[test]
    fn again_resets_to_relearn_and_one_day() {
        let decision = schedule_review(9, Some(3), ReviewRating::Again);
        assert!(decision.relearn_first);
        assert_eq!(decision.interval_days, 1);
    }

    #[test]
    fn mastery_history_fold_reaches_retained_then_needs_confirmation() {
        let mut observations = vec![
            observation("E1", "VG-A", 0, true, EvidenceKind::Implement),
            observation("E2", "VG-B", 2, true, EvidenceKind::Transfer),
        ];
        assert_eq!(
            derive_mastery_history(&observations).state,
            MasteryState::Retained
        );
        observations.push(observation("E3", "VG-A", 5, false, EvidenceKind::Implement));
        // The fold sees the prior retained state, so a fresh failure demands
        // confirmation instead of silently downgrading to practicing.
        assert_eq!(
            derive_mastery_history(&observations).state,
            MasteryState::NeedsConfirmation
        );
    }

    #[test]
    fn assisted_success_cannot_advance_mastery() {
        let mut assisted = observation("E1", "VG-A", 0, true, EvidenceKind::Implement);
        assisted.support = Support::SolutionViewed;
        let second = observation("E2", "VG-B", 1, true, EvidenceKind::Transfer);
        let explanation = derive_mastery_history(&[assisted, second]);
        assert_eq!(explanation.state, MasteryState::Practicing);
    }
}
