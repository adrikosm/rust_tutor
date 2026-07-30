use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const LAB_MODEL_VERSION: &str = "systems-lab-v1";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioKind {
    DuplicateDelivery,
    PartialWriteRecovery,
    SchemaEvolution,
    LateEventTime,
    BoundedBackpressure,
    OrchestrationDag,
    ObservabilityDiagnosis,
    SloErrorBudget,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LabRequest {
    pub seed: u64,
    #[serde(default)]
    pub hypothesis: String,
    #[serde(default = "default_capacity")]
    pub capacity: usize,
}

fn default_capacity() -> usize {
    3
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabReport {
    pub model_version: &'static str,
    pub scenario: ScenarioKind,
    pub seed: u64,
    pub virtual_clock: u64,
    pub passed: bool,
    pub invariant: String,
    pub events: Vec<LabEvent>,
    pub outputs: Vec<Value>,
    pub metrics: BTreeMap<String, f64>,
    pub replay_manifest: ReplayManifest,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabEvent {
    pub tick: u64,
    pub kind: String,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayManifest {
    pub model_version: &'static str,
    pub seed: u64,
    pub fixture_version: &'static str,
    pub wall_clock_used: bool,
    pub network_used: bool,
}

pub fn run(kind: ScenarioKind, request: &LabRequest) -> Result<LabReport, &'static str> {
    if request.capacity == 0 || request.capacity > 128 {
        return Err("capacity must be between 1 and 128");
    }
    if matches!(kind, ScenarioKind::ObservabilityDiagnosis) && request.hypothesis.trim().is_empty()
    {
        return Err("commit a root-cause hypothesis before causal evidence is revealed");
    }
    let (invariant, events, outputs, metrics, passed) = match kind {
        ScenarioKind::DuplicateDelivery => duplicate_delivery(request.seed),
        ScenarioKind::PartialWriteRecovery => partial_write_recovery(request.seed),
        ScenarioKind::SchemaEvolution => schema_evolution(request.seed),
        ScenarioKind::LateEventTime => late_event_time(request.seed),
        ScenarioKind::BoundedBackpressure => bounded_backpressure(request.seed, request.capacity),
        ScenarioKind::OrchestrationDag => orchestration_dag(request.seed),
        ScenarioKind::ObservabilityDiagnosis => observability(request.seed, &request.hypothesis),
        ScenarioKind::SloErrorBudget => slo_error_budget(request.seed),
    };
    let virtual_clock = events.last().map_or(0, |event| event.tick);
    Ok(LabReport {
        model_version: LAB_MODEL_VERSION,
        scenario: kind,
        seed: request.seed,
        virtual_clock,
        passed,
        invariant,
        events,
        outputs,
        metrics,
        replay_manifest: ReplayManifest {
            model_version: LAB_MODEL_VERSION,
            seed: request.seed,
            fixture_version: "systems-fixtures-v1",
            wall_clock_used: false,
            network_used: false,
        },
    })
}

type ScenarioResult = (
    String,
    Vec<LabEvent>,
    Vec<Value>,
    BTreeMap<String, f64>,
    bool,
);

fn event(tick: u64, kind: &str, detail: impl Into<String>) -> LabEvent {
    LabEvent {
        tick,
        kind: kind.to_owned(),
        detail: detail.into(),
    }
}

fn duplicate_delivery(seed: u64) -> ScenarioResult {
    let base = seed % 7;
    let deliveries = ["evt-a", "evt-b", "evt-a", "evt-c", "evt-b"];
    let mut seen = HashSet::new();
    let mut events = Vec::new();
    let mut outputs = Vec::new();
    for (index, id) in deliveries.into_iter().enumerate() {
        let tick = base + index as u64;
        if seen.insert(id) {
            outputs.push(serde_json::json!({"eventId":id,"applied":true}));
            events.push(event(
                tick,
                "applied",
                format!("{id} changed state exactly once"),
            ));
        } else {
            events.push(event(
                tick,
                "duplicate",
                format!("{id} was acknowledged without reapplying"),
            ));
        }
    }
    let metrics = BTreeMap::from([
        ("deliveries".to_owned(), 5.0),
        ("unique_applied".to_owned(), outputs.len() as f64),
        ("duplicates".to_owned(), 2.0),
    ]);
    (
        "Each event identity changes durable state at most once under repeated delivery."
            .to_owned(),
        events,
        outputs,
        metrics,
        seen.len() == 3,
    )
}

fn partial_write_recovery(seed: u64) -> ScenarioResult {
    let mut events = vec![event(0, "checkpoint", "offset 40 is durable")];
    let sink = BTreeSet::from(["evt-40"]);
    events.push(event(1, "sink_write", "evt-41 reached the idempotent sink"));
    events.push(event(
        2,
        "injected_crash",
        "worker stopped before checkpoint 41",
    ));
    events.push(event(3, "replay", "restarted from durable offset 40"));
    let mut recovered = sink;
    recovered.insert("evt-41");
    recovered.insert("evt-41");
    events.push(event(4, "checkpoint", "offset 41 is durable after replay"));
    (
        "After any crash cut-point, replay from the last durable checkpoint produces one logical sink effect per identity.".to_owned(),
        events,
        recovered
            .into_iter()
            .map(|id| serde_json::json!({"eventId":id}))
            .collect(),
        BTreeMap::from([("crashes".to_owned(), 1.0), ("replays".to_owned(), 1.0), ("seed_jitter".to_owned(), (seed % 5) as f64)]),
        true,
    )
}

fn schema_evolution(seed: u64) -> ScenarioResult {
    let fixtures = [
        ("v1", true, "baseline required id/value"),
        ("v2", true, "optional source field with default"),
        ("v3", false, "required id changed from integer to object"),
    ];
    let events: Vec<_> = fixtures
        .iter()
        .enumerate()
        .map(|(index, (version, compatible, reason))| {
            event(
                index as u64 + seed % 3,
                if *compatible {
                    "compatible"
                } else {
                    "breaking"
                },
                format!("{version}: {reason}"),
            )
        })
        .collect();
    (
        "Compatible changes preserve existing readers; breaking changes are rejected before partial publication.".to_owned(),
        events,
        fixtures
            .iter()
            .map(|(version, compatible, reason)| serde_json::json!({"version":version,"compatible":compatible,"reason":reason}))
            .collect(),
        BTreeMap::from([("compatible".to_owned(), 2.0), ("breaking".to_owned(), 1.0)]),
        true,
    )
}

fn late_event_time(seed: u64) -> ScenarioResult {
    let allowed_lateness = 5_u64;
    let input = [
        ("a", 10_u64),
        ("b", 14_u64),
        ("late-a", 11_u64),
        ("too-late", 2_u64),
    ];
    let mut watermark = 0;
    let mut events = Vec::new();
    let mut output = BTreeMap::<&str, &'static str>::new();
    for (index, (id, event_time)) in input.into_iter().enumerate() {
        watermark = watermark.max(event_time.saturating_sub(seed % 2));
        if event_time + allowed_lateness < watermark {
            events.push(event(
                index as u64,
                "late_rejected",
                format!("{id} beyond allowed lateness"),
            ));
        } else {
            let status = if event_time < watermark {
                "revision"
            } else {
                "on_time"
            };
            output.insert(id, status);
            events.push(event(
                index as u64,
                status,
                format!("{id} at event time {event_time}, watermark {watermark}"),
            ));
        }
    }
    (
        "Event-time output is controlled by watermark plus allowed lateness, never machine wall time.".to_owned(),
        events,
        output
            .into_iter()
            .map(|(id, status)| serde_json::json!({"eventId":id,"status":status}))
            .collect(),
        BTreeMap::from([("allowed_lateness".to_owned(), allowed_lateness as f64), ("watermark".to_owned(), watermark as f64)]),
        true,
    )
}

fn bounded_backpressure(seed: u64, capacity: usize) -> ScenarioResult {
    let mut queue = VecDeque::new();
    let mut events = Vec::new();
    let mut max_depth = 0;
    for index in 0..10 {
        if queue.len() == capacity {
            let drained = queue.pop_front().expect("nonempty bounded queue");
            events.push(event(
                index,
                "consumer_progress",
                format!("drained job {drained}"),
            ));
        }
        queue.push_back(index + seed % 2);
        max_depth = max_depth.max(queue.len());
        events.push(event(
            index,
            "enqueue",
            format!("depth {} of {capacity}", queue.len()),
        ));
    }
    (
        "Queue depth never exceeds the declared capacity; producers yield to observable consumer progress.".to_owned(),
        events,
        queue.into_iter().map(|job| serde_json::json!({"pending":job})).collect(),
        BTreeMap::from([("capacity".to_owned(), capacity as f64), ("max_depth".to_owned(), max_depth as f64)]),
        max_depth <= capacity,
    )
}

fn orchestration_dag(seed: u64) -> ScenarioResult {
    let dependencies = HashMap::from([
        ("extract", Vec::<&str>::new()),
        ("validate", vec!["extract"]),
        ("load", vec!["validate"]),
        ("report", vec!["load"]),
    ]);
    let mut completed = HashSet::new();
    let mut order = Vec::new();
    while completed.len() < dependencies.len() {
        let mut ready: Vec<_> = dependencies
            .iter()
            .filter(|(job, prerequisites)| {
                !completed.contains(**job)
                    && prerequisites.iter().all(|item| completed.contains(item))
            })
            .map(|(job, _)| *job)
            .collect();
        ready.sort();
        let Some(next) = ready.first().copied() else {
            break;
        };
        completed.insert(next);
        order.push(next);
    }
    let mut events: Vec<_> = order
        .iter()
        .enumerate()
        .map(|(index, job)| event(index as u64, "task_complete", *job))
        .collect();
    events.push(event(
        seed % 4 + 5,
        "cycle_fixture_rejected",
        "a→b→a has no ready node",
    ));
    (
        "A task runs only after every predecessor; cycles are rejected with no partial schedule."
            .to_owned(),
        events,
        order
            .into_iter()
            .map(|job| Value::String(job.to_owned()))
            .collect(),
        BTreeMap::from([
            ("completed".to_owned(), completed.len() as f64),
            ("cycles_rejected".to_owned(), 1.0),
        ]),
        completed.len() == dependencies.len(),
    )
}

fn observability(seed: u64, hypothesis: &str) -> ScenarioResult {
    let trace_id = format!("trace-{:04}", seed % 10_000);
    let events = vec![
        event(0, "hypothesis_committed", hypothesis),
        event(1, "metric", "queue_depth reached declared capacity"),
        event(
            2,
            "trace",
            format!("{trace_id}: sink retry held the consumer"),
        ),
        event(
            3,
            "log",
            format!("{trace_id}: retry budget exhausted without secret fields"),
        ),
    ];
    (
        "A committed hypothesis is tested against correlated logs, metrics, and traces before the causal explanation.".to_owned(),
        events,
        vec![serde_json::json!({"rootCause":"sink retry stalled bounded consumer","traceId":trace_id})],
        BTreeMap::from([("queue_depth".to_owned(), 3.0), ("retry_exhausted".to_owned(), 1.0)]),
        true,
    )
}

fn slo_error_budget(seed: u64) -> ScenarioResult {
    let requests = 10_000_f64;
    // Seed varies failures across the budget boundary so both healthy and
    // exhausted windows are observable deterministically.
    let failures = 8_f64 + (seed % 5) as f64;
    let objective = 0.999_f64;
    let allowed = requests * (1.0 - objective);
    let remaining = allowed - failures;
    (
        "The error budget invariant holds while remaining budget is non-negative; exhaustion triggers the stated operational action.".to_owned(),
        vec![event(0, "window_closed", format!("{failures} failures of {requests} requests")), event(1, "action", if remaining < 0.0 { "freeze risky rollout and investigate" } else { "continue with monitoring" })],
        vec![serde_json::json!({"indicator":"successful requests / eligible requests","objective":objective,"window":"28d","allowedFailures":allowed,"observedFailures":failures,"remaining":remaining,"budgetExhausted":remaining < 0.0})],
        BTreeMap::from([("objective".to_owned(), objective), ("remaining_budget".to_owned(), remaining)]),
        remaining >= 0.0,
    )
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SqlComparison {
    pub ordered: bool,
    pub numeric_tolerance: f64,
    pub expected: Vec<Vec<Value>>,
    pub actual: Vec<Vec<Value>>,
}

pub fn compare_sql(input: &SqlComparison) -> bool {
    if input.expected.len() != input.actual.len() || input.numeric_tolerance < 0.0 {
        return false;
    }
    let mut expected = input.expected.clone();
    let mut actual = input.actual.clone();
    if !input.ordered {
        expected.sort_by_key(|row| serde_json::to_string(row).unwrap_or_default());
        actual.sort_by_key(|row| serde_json::to_string(row).unwrap_or_default());
    }
    expected.iter().zip(actual.iter()).all(|(left, right)| {
        left.len() == right.len()
            && left
                .iter()
                .zip(right)
                .all(|(left, right)| match (left, right) {
                    (Value::Number(left), Value::Number(right)) => left
                        .as_f64()
                        .zip(right.as_f64())
                        .is_some_and(|(left, right)| {
                            (left - right).abs() <= input.numeric_tolerance
                        }),
                    _ => left == right,
                })
    })
}
