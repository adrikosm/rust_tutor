use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuestionKind {
    MultipleChoice,
    MultipleSelect,
    TrueFalse,
    PredictOutput,
    IdentifyCompilerError,
    FillMissingCode,
    Ordering,
    ShortResponse,
    ComplexityAnalysis,
    DebuggingDecision,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Question {
    pub id: String,
    pub version: u32,
    pub lesson_id: String,
    pub kind: QuestionKind,
    pub prompt: String,
    pub options: Vec<String>,
    pub starter: Option<String>,
    pub outcome_ids: Vec<String>,
    pub rubric: Vec<String>,
    pub support_policy: String,
    pub partial_credit_policy: String,
    pub randomization_seed: u64,
    pub explanation: String,
    pub answer: ExpectedAnswer,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicQuestion {
    pub id: String,
    pub version: u32,
    pub lesson_id: String,
    pub kind: QuestionKind,
    pub prompt: String,
    pub options: Vec<String>,
    pub starter: Option<String>,
    pub outcome_ids: Vec<String>,
    pub rubric: Vec<String>,
    pub support_policy: String,
    pub partial_credit_policy: String,
    pub randomization_seed: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum ExpectedAnswer {
    Index(usize),
    Indices(Vec<usize>),
    Boolean(bool),
    Text(String),
    CompilerCode(String),
    EvaluatorPass,
    Order(Vec<String>),
    Checklist(Vec<String>),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum LearnerResponse {
    Index {
        value: usize,
    },
    Indices {
        values: Vec<usize>,
    },
    Boolean {
        value: bool,
    },
    Text {
        value: String,
    },
    CompilerCode {
        value: String,
    },
    Evaluator {
        passed: bool,
    },
    Order {
        values: Vec<String>,
    },
    Checklist {
        checked: Vec<String>,
        response: String,
    },
    Complexity {
        time: String,
        space: String,
        reasoning: String,
        checked: Vec<String>,
    },
    Debugging {
        hypothesis: String,
        action: String,
        checked: Vec<String>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradingResult {
    pub question_id: String,
    pub version: u32,
    pub correct: bool,
    pub score: f64,
    pub deterministic: bool,
    pub manual_self_review: bool,
    pub rubric_checks: Vec<String>,
    pub explanation: String,
    pub outcome_ids: Vec<String>,
    pub revealed_answer: ExpectedAnswer,
    pub review_additions: Vec<String>,
}

impl Question {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty()
            || self.version == 0
            || self.lesson_id.trim().is_empty()
            || self.prompt.trim().is_empty()
            || self.outcome_ids.is_empty()
            || self.rubric.is_empty()
            || self.support_policy.trim().is_empty()
            || self.partial_credit_policy.trim().is_empty()
            || self.explanation.trim().is_empty()
        {
            return Err("question identity, lesson, prompt, outcomes, rubric, policies, and explanation are required".into());
        }
        let unique: HashSet<_> = self.outcome_ids.iter().collect();
        if unique.len() != self.outcome_ids.len() {
            return Err("question outcome IDs must be unique".into());
        }
        // Exhaustive kind/answer contract: every question kind must carry the
        // matching expected-answer shape with in-bounds members, so an invalid
        // release fails to load instead of grading everything false later.
        match (&self.kind, &self.answer) {
            (QuestionKind::MultipleChoice, ExpectedAnswer::Index(index)) => {
                if self.options.len() < 2 || *index >= self.options.len() {
                    return Err(
                        "multiple-choice answers must index one of at least two options".into(),
                    );
                }
            }
            (QuestionKind::MultipleSelect, ExpectedAnswer::Indices(indices)) => {
                let unique: HashSet<_> = indices.iter().collect();
                if self.options.len() < 2
                    || indices.is_empty()
                    || unique.len() != indices.len()
                    || indices.iter().any(|index| *index >= self.options.len())
                {
                    return Err("multiple-select answers must be distinct in-bounds indices".into());
                }
            }
            (QuestionKind::TrueFalse, ExpectedAnswer::Boolean(_)) => {}
            (QuestionKind::PredictOutput, ExpectedAnswer::Text(expected)) => {
                if expected.is_empty() {
                    return Err("predict-output questions need an expected output".into());
                }
            }
            (QuestionKind::IdentifyCompilerError, ExpectedAnswer::CompilerCode(code)) => {
                if !code.starts_with('E') || !code[1..].bytes().all(|byte| byte.is_ascii_digit()) {
                    return Err(
                        "compiler-error answers must be an E-prefixed diagnostic code".into(),
                    );
                }
            }
            (QuestionKind::FillMissingCode, ExpectedAnswer::EvaluatorPass) => {
                if self.starter.as_deref().unwrap_or("").is_empty() {
                    return Err("fill-missing-code questions need starter code".into());
                }
            }
            (QuestionKind::Ordering, ExpectedAnswer::Order(order)) => {
                let expected: HashSet<_> = order.iter().collect();
                let options: HashSet<_> = self.options.iter().collect();
                if self.options.len() < 2
                    || expected != options
                    || order.len() != self.options.len()
                {
                    return Err("ordering answers must be a permutation of the options".into());
                }
            }
            (
                QuestionKind::ShortResponse
                | QuestionKind::ComplexityAnalysis
                | QuestionKind::DebuggingDecision,
                ExpectedAnswer::Checklist(checks),
            ) => {
                if checks.is_empty() || checks.iter().any(|check| !self.rubric.contains(check)) {
                    return Err("self-review checklists must be nonempty rubric subsets".into());
                }
            }
            _ => {
                return Err(format!(
                    "question {} pairs an incompatible kind and answer shape",
                    self.id
                ));
            }
        }
        Ok(())
    }

    pub fn public(&self) -> PublicQuestion {
        let order = self.display_order();
        PublicQuestion {
            id: self.id.clone(),
            version: self.version,
            lesson_id: self.lesson_id.clone(),
            kind: self.kind.clone(),
            prompt: self.prompt.clone(),
            options: order
                .iter()
                .map(|index| self.options[*index].clone())
                .collect(),
            starter: self.starter.clone(),
            outcome_ids: self.outcome_ids.clone(),
            rubric: self.rubric.clone(),
            support_policy: self.support_policy.clone(),
            partial_credit_policy: self.partial_credit_policy.clone(),
            randomization_seed: self.randomization_seed,
        }
    }

    fn display_order(&self) -> Vec<usize> {
        let mut indices = (0..self.options.len()).collect::<Vec<_>>();
        if matches!(
            self.kind,
            QuestionKind::MultipleChoice | QuestionKind::MultipleSelect
        ) {
            indices.sort_by_key(|index| {
                Sha256::digest(format!("{}:{}:{index}", self.randomization_seed, self.id)).to_vec()
            });
        }
        indices
    }

    fn canonical_response(&self, response: &LearnerResponse) -> LearnerResponse {
        let order = self.display_order();
        match response {
            LearnerResponse::Index { value } => LearnerResponse::Index {
                value: order.get(*value).copied().unwrap_or(usize::MAX),
            },
            LearnerResponse::Indices { values } => LearnerResponse::Indices {
                values: values
                    .iter()
                    .map(|value| order.get(*value).copied().unwrap_or(usize::MAX))
                    .collect(),
            },
            value => value.clone(),
        }
    }

    fn displayed_answer(&self) -> ExpectedAnswer {
        let order = self.display_order();
        match &self.answer {
            ExpectedAnswer::Index(value) => ExpectedAnswer::Index(
                order
                    .iter()
                    .position(|canonical| canonical == value)
                    .unwrap_or(usize::MAX),
            ),
            ExpectedAnswer::Indices(values) => ExpectedAnswer::Indices(
                values
                    .iter()
                    .filter_map(|value| order.iter().position(|canonical| canonical == value))
                    .collect(),
            ),
            value => value.clone(),
        }
    }

    pub fn grade(&self, response: &LearnerResponse) -> GradingResult {
        let response = self.canonical_response(response);
        let expected_checks = match &self.answer {
            ExpectedAnswer::Checklist(checks) => checks.clone(),
            _ => self.rubric.clone(),
        };
        let (correct, manual, checks) = match (&self.answer, &response) {
            (ExpectedAnswer::Index(expected), LearnerResponse::Index { value }) => {
                (*expected == *value, false, Vec::new())
            }
            (ExpectedAnswer::Indices(expected), LearnerResponse::Indices { values }) => {
                let mut a = expected.clone();
                let mut b = values.clone();
                a.sort_unstable();
                b.sort_unstable();
                (a == b, false, Vec::new())
            }
            (ExpectedAnswer::Boolean(expected), LearnerResponse::Boolean { value }) => {
                (*expected == *value, false, Vec::new())
            }
            (ExpectedAnswer::Text(expected), LearnerResponse::Text { value }) => {
                (expected.trim_end() == value.trim_end(), false, Vec::new())
            }
            (ExpectedAnswer::CompilerCode(expected), LearnerResponse::CompilerCode { value }) => (
                expected.eq_ignore_ascii_case(value.trim()),
                false,
                Vec::new(),
            ),
            (ExpectedAnswer::EvaluatorPass, LearnerResponse::Evaluator { passed }) => {
                (*passed, false, Vec::new())
            }
            (ExpectedAnswer::Order(expected), LearnerResponse::Order { values }) => {
                (expected == values, false, Vec::new())
            }
            (ExpectedAnswer::Checklist(_), LearnerResponse::Checklist { checked, response }) => (
                expected_checks.iter().all(|check| checked.contains(check))
                    && !response.trim().is_empty(),
                true,
                checked.clone(),
            ),
            (
                ExpectedAnswer::Checklist(_),
                LearnerResponse::Complexity {
                    time,
                    space,
                    reasoning,
                    checked,
                },
            ) => (
                expected_checks.iter().all(|check| checked.contains(check))
                    && [time, space, reasoning]
                        .iter()
                        .all(|value| !value.trim().is_empty()),
                true,
                checked.clone(),
            ),
            (
                ExpectedAnswer::Checklist(_),
                LearnerResponse::Debugging {
                    hypothesis,
                    action,
                    checked,
                },
            ) => (
                expected_checks.iter().all(|check| checked.contains(check))
                    && [hypothesis, action]
                        .iter()
                        .all(|value| !value.trim().is_empty()),
                true,
                checked.clone(),
            ),
            _ => (false, false, Vec::new()),
        };
        GradingResult {
            question_id: self.id.clone(),
            version: self.version,
            correct,
            score: if correct { 1.0 } else { 0.0 },
            deterministic: true,
            manual_self_review: manual,
            rubric_checks: checks,
            explanation: self.explanation.clone(),
            outcome_ids: self.outcome_ids.clone(),
            revealed_answer: self.displayed_answer(),
            review_additions: if correct {
                Vec::new()
            } else {
                self.outcome_ids.clone()
            },
        }
    }
}

#[allow(clippy::too_many_arguments)] // Keeps the compact golden-bank rows readable without a one-use builder.
fn q(
    id: &str,
    kind: QuestionKind,
    prompt: &str,
    options: &[&str],
    starter: Option<&str>,
    answer: ExpectedAnswer,
    rubric: &[&str],
    outcomes: &[&str],
    explanation: &str,
) -> Question {
    Question {
        id: id.into(),
        version: 1,
        // Every golden check belongs to the shipped ownership lesson; there is
        // no placeholder lesson family in this release.
        lesson_id: "UNIT-OWNERSHIP-001".into(),
        kind,
        prompt: prompt.into(),
        options: options.iter().map(|value| (*value).into()).collect(),
        starter: starter.map(str::to_owned),
        outcome_ids: outcomes.iter().map(|value| (*value).into()).collect(),
        rubric: rubric.iter().map(|value| (*value).into()).collect(),
        support_policy: "v1: official docs and compiler allowed; disclose hints".into(),
        partial_credit_policy: "v1: exact result only; no partial credit".into(),
        randomization_seed: 23,
        explanation: explanation.into(),
        answer,
    }
}

pub fn golden_bank() -> Vec<Question> {
    use ExpectedAnswer as A;
    use QuestionKind as K;
    vec![
        q(
            "Q-GOLD-01",
            K::MultipleChoice,
            "Which operation keeps the original String usable?",
            &["Move it", "Borrow it with &", "Drop it", "Shadow it"],
            None,
            A::Index(1),
            &["selects a shared borrow"],
            &["OUT-IMMUT-BORROW-001"],
            "A shared borrow grants read access without transferring ownership, so the original binding stays usable after the operation.",
        ),
        q(
            "Q-GOLD-02",
            K::MultipleSelect,
            "Select every statement that is true after let b = &a.",
            &[
                "a remains usable",
                "b borrows a",
                "a is moved",
                "b owns the allocation",
            ],
            None,
            A::Indices(vec![0, 1]),
            &["identifies both borrow consequences"],
            &["OUT-IMMUT-BORROW-001", "OUT-TRACE-MOVE-001"],
            "Taking &a creates a loan: b reads through the reference while a keeps ownership; nothing moves and nothing is duplicated.",
        ),
        q(
            "Q-GOLD-03",
            K::TrueFalse,
            "A shared borrow transfers ownership.",
            &[],
            None,
            A::Boolean(false),
            &["distinguishes borrow from move"],
            &["OUT-IMMUT-BORROW-001"],
            "Only a move transfers the drop responsibility; a shared borrow is temporary read access that ends at its last use.",
        ),
        q(
            "Q-GOLD-04",
            K::PredictOutput,
            "Predict the exact output of println!(\"{}\", 6 * 7).",
            &[],
            Some("fn main() { println!(\"{}\", 6 * 7); }"),
            A::Text("42\n".into()),
            &["preserves exact output"],
            &["OUT-TRACE-MOVE-001"],
            "Committing an exact predicted output before running the program is the trace discipline that later makes ownership errors predictable.",
        ),
        q(
            "Q-GOLD-05",
            K::IdentifyCompilerError,
            "Which compiler code identifies use after move?",
            &[],
            None,
            A::CompilerCode("E0382".into()),
            &["uses the pinned diagnostic fixture E0382"],
            &["OUT-TRACE-MOVE-001"],
            "E0382 is rustc's use-of-moved-value diagnostic: the primary span shows the invalid use and the secondary span shows the earlier move.",
        ),
        q(
            "Q-GOLD-06",
            K::FillMissingCode,
            "Replace the missing expression so the program compiles without moving name.",
            &[],
            Some(
                "fn main() { let name = String::from(\"Ferris\"); let view = /* missing */; println!(\"{view} {name}\"); }",
            ),
            A::EvaluatorPass,
            &["passes a real cargo check"],
            &["OUT-IMMUT-BORROW-001"],
            "Borrowing with &name gives view read access while name remains the owner, so both bindings appear in the final println.",
        ),
        q(
            "Q-GOLD-07",
            K::Ordering,
            "Order the independent-practice loop.",
            &[
                "commit a prediction",
                "run the tool",
                "explain the evidence",
            ],
            None,
            A::Order(vec![
                "commit a prediction".into(),
                "run the tool".into(),
                "explain the evidence".into(),
            ]),
            &["prediction precedes tool use"],
            &["OUT-TRACE-MOVE-001"],
            "Predicting before running keeps the compiler an oracle for your ownership model instead of a slot machine for guesses.",
        ),
        q(
            "Q-GOLD-08",
            K::ShortResponse,
            "Explain why borrowing preserves the caller's ownership.",
            &[],
            None,
            A::Checklist(vec!["names owner".into(), "states no move".into()]),
            &["names owner", "states no move"],
            &["OUT-IMMUT-BORROW-001"],
            "A complete explanation names the binding that stays the owner and states that a reference never transfers the drop responsibility.",
        ),
        q(
            "Q-GOLD-09",
            K::ComplexityAnalysis,
            "Analyze one pass over a borrowed slice.",
            &[],
            None,
            A::Checklist(vec!["time justified".into(), "space justified".into()]),
            &["time justified", "space justified"],
            &["OUT-SLICE-001"],
            "One pass over n borrowed elements is O(n) time; because a slice is a view, the pass needs O(1) auxiliary space and no copies.",
        ),
        q(
            "Q-GOLD-10",
            K::DebuggingDecision,
            "Commit a hypothesis and next action for E0382 before revealing the consequence.",
            &[],
            None,
            A::Checklist(vec!["causal hypothesis".into(), "bounded action".into()]),
            &["causal hypothesis", "bounded action"],
            &["OUT-TRACE-MOVE-001"],
            "A causal E0382 hypothesis names the earlier move; the bounded next action changes either the move or the later use, not unrelated lines.",
        ),
    ]
}

pub fn validate_bank(questions: &[Question]) -> Result<(), String> {
    if questions.is_empty() {
        return Err("question bank is empty".into());
    }
    let mut ids = HashSet::new();
    let mut lesson_counts = BTreeMap::<&str, usize>::new();
    for question in questions {
        question.validate()?;
        if !ids.insert((question.id.as_str(), question.version)) {
            return Err("question ID/version must be unique".into());
        }
        *lesson_counts.entry(&question.lesson_id).or_default() += 1;
    }
    if let Some((lesson, count)) = lesson_counts
        .iter()
        .find(|(_, count)| !(3..=12).contains(*count))
    {
        return Err(format!(
            "published lesson {lesson} has {count} checks; expected 3–12"
        ));
    }
    Ok(())
}

/// Cross-checks the bank against the active tutor slice: every mapped outcome
/// and the owning lesson must exist in the release.
pub fn validate_bank_against_content(
    questions: &[Question],
    content: &crate::tutor::TutorContent,
) -> Result<(), String> {
    let outcomes: HashSet<_> = content
        .outcomes
        .iter()
        .map(|outcome| outcome.id.as_str())
        .collect();
    for question in questions {
        if question.lesson_id != content.lesson.id {
            return Err(format!(
                "{} references lesson {} outside the active release",
                question.id, question.lesson_id
            ));
        }
        for outcome_id in &question.outcome_ids {
            if !outcomes.contains(outcome_id.as_str()) {
                return Err(format!(
                    "{} maps to unknown outcome {outcome_id}",
                    question.id
                ));
            }
        }
    }
    Ok(())
}
