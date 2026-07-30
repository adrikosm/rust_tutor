use std::{
    convert::Infallible,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    process::Stdio,
    sync::Arc,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path as AxumPath, Query, State},
    http::{HeaderMap, Method, Request, StatusCode, header},
    middleware::{Next, from_fn_with_state},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::process::Command;
use tokio::sync::{Mutex, mpsc, watch};
use tokio_stream::{StreamExt as _, wrappers::ReceiverStream};
use tower_http::services::{ServeDir, ServeFile};

pub mod analyzer;
pub mod content;
pub mod curriculum_v2;
pub mod data_lifecycle;
pub mod db;
pub mod diagnostic;
pub mod evaluator;
pub mod exam;
pub mod graph;
pub mod learning;
pub mod project;
pub mod question;
pub mod systems_lab;
pub mod tutor;
pub mod workspace;

pub const API_VERSION: &str = "v1";

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub allowed_origin: String,
    pub web_dist: PathBuf,
    pub db_status: String,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let bind: SocketAddr = std::env::var("RUST_TUTOR_BIND")
            .unwrap_or_else(|_| "127.0.0.1:4317".to_owned())
            .parse()
            .map_err(|_| ConfigError::InvalidBind)?;
        if !is_loopback(bind.ip()) {
            return Err(ConfigError::NonLoopbackBind);
        }
        let allowed_origin = std::env::var("RUST_TUTOR_ALLOWED_ORIGIN")
            .unwrap_or_else(|_| "http://127.0.0.1:3000".to_owned());
        if !is_exact_loopback_origin(&allowed_origin) {
            return Err(ConfigError::InvalidOrigin);
        }
        Ok(Self {
            bind,
            allowed_origin,
            web_dist: std::env::var_os("RUST_TUTOR_WEB_DIST")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("apps/web/dist/client")),
            db_status: std::env::var("RUST_TUTOR_DB_STATUS")
                .unwrap_or_else(|_| "not_configured".to_owned()),
        })
    }
}

fn is_loopback(ip: IpAddr) -> bool {
    ip.is_loopback()
}

/// Accepts exactly `http://127.0.0.1:<port>` or `http://localhost:<port>` with a
/// valid decimal port and nothing after it. A prefix test would also accept
/// hostnames such as `localhost:3000.evil.example`.
fn is_exact_loopback_origin(origin: &str) -> bool {
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    let Some((host, port)) = rest.rsplit_once(':') else {
        return false;
    };
    matches!(host, "127.0.0.1" | "localhost")
        && !port.is_empty()
        && port.len() <= 5
        && port.bytes().all(|byte| byte.is_ascii_digit())
        && port.parse::<u16>().is_ok()
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    InvalidBind,
    NonLoopbackBind,
    InvalidOrigin,
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::InvalidBind => "RUST_TUTOR_BIND must be a valid socket address",
            Self::NonLoopbackBind => "RUST_TUTOR_BIND must use a loopback address",
            Self::InvalidOrigin => "RUST_TUTOR_ALLOWED_ORIGIN must be loopback HTTP",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for ConfigError {}

#[derive(Clone, Debug, Serialize)]
pub struct ToolchainStatus {
    pub cargo: bool,
    pub rustc: bool,
    pub rustfmt: bool,
    pub clippy: bool,
    pub rust_analyzer: bool,
    pub rust_analyzer_remediation: Option<String>,
    pub target: String,
    pub versions: std::collections::BTreeMap<String, String>,
}

impl ToolchainStatus {
    pub async fn discover() -> Self {
        let mut versions = std::collections::BTreeMap::new();
        for tool in [
            "cargo",
            "rustc",
            "rustfmt",
            "clippy-driver",
            "rust-analyzer",
        ] {
            versions.insert(tool.to_owned(), command_version(tool).await);
        }
        let target = rustc_target().await;
        let rustc_release = versions["rustc"]
            .split_whitespace()
            .nth(1)
            .unwrap_or_default()
            .to_owned();
        let analyzer = analyzer::discover(&rustc_release).await;
        Self {
            cargo: versions["cargo"] != "unavailable",
            rustc: versions["rustc"] != "unavailable",
            rustfmt: versions["rustfmt"] != "unavailable",
            clippy: versions["clippy-driver"] != "unavailable",
            rust_analyzer: analyzer.compatible,
            rust_analyzer_remediation: analyzer.remediation,
            target,
            versions,
        }
    }

    fn fixture(available: bool) -> Self {
        Self {
            cargo: available,
            rustc: available,
            rustfmt: available,
            clippy: available,
            rust_analyzer: available,
            rust_analyzer_remediation: None,
            target: if available {
                "fixture-target"
            } else {
                "unavailable"
            }
            .to_owned(),
            versions: std::collections::BTreeMap::new(),
        }
    }
}

async fn command_version(program: &str) -> String {
    Command::new(program)
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_else(|| "unavailable".to_owned())
}

async fn rustc_target() -> String {
    Command::new("rustc")
        .arg("-vV")
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| line.strip_prefix("host: ").map(str::to_owned))
        })
        .unwrap_or_else(|| "unavailable".to_owned())
}

#[derive(Clone)]
pub struct AppState {
    allowed_origin: String,
    bind_host: String,
    session_token: String,
    db_status: String,
    database: Option<db::Database>,
    toolchain: ToolchainStatus,
    tutor_content: Arc<tutor::TutorContent>,
    curriculum_v2: &'static curriculum_v2::CurriculumV2,
    graph: &'static graph::RuntimeGraph,
    diagnostic: Arc<diagnostic::DiagnosticBlueprints>,
    exam: Arc<exam::FinalExam>,
    questions: Arc<Vec<question::Question>>,
    evaluator: evaluator::Evaluator,
    active_runs: Arc<Mutex<std::collections::HashMap<String, watch::Sender<bool>>>>,
}

impl AppState {
    pub fn new(config: &Config, toolchain: ToolchainStatus) -> Result<Self, getrandom::Error> {
        let mut token = [0_u8; 32];
        getrandom::fill(&mut token)?;
        let tutor_content = Arc::new(
            tutor::TutorContent::load_embedded().expect("embedded tutor content must validate"),
        );
        Ok(Self {
            allowed_origin: config.allowed_origin.clone(),
            bind_host: config.bind.to_string(),
            session_token: hex(&token),
            db_status: config.db_status.clone(),
            database: None,
            toolchain,
            tutor_content: tutor_content.clone(),
            curriculum_v2: curriculum_v2::embedded().expect("embedded curriculum v2 must validate"),
            graph: graph::embedded(),
            diagnostic: Arc::new(
                diagnostic::DiagnosticBlueprints::load_embedded(graph::embedded())
                    .expect("embedded diagnostic blueprints must validate"),
            ),
            exam: Arc::new(
                exam::FinalExam::load_embedded(graph::embedded())
                    .expect("embedded final exam must validate"),
            ),
            questions: Arc::new({
                let questions = question::golden_bank();
                question::validate_bank(&questions).expect("embedded question bank must validate");
                question::validate_bank_against_content(&questions, &tutor_content)
                    .expect("question bank must map into the active content release");
                questions
            }),
            evaluator: evaluator::Evaluator::new(
                std::env::temp_dir().join("rust-tutor-evaluator-v1"),
            )
            .expect("evaluator temp root must be available"),
            active_runs: Arc::new(Mutex::new(std::collections::HashMap::new())),
        })
    }

    pub fn with_database(mut self, database: db::Database) -> Self {
        self.db_status = "ready".to_owned();
        self.database = Some(database);
        self
    }
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(HEX[(byte >> 4) as usize] as char);
        value.push(HEX[(byte & 0x0f) as usize] as char);
    }
    value
}

#[derive(Serialize)]
struct HealthReport {
    status: &'static str,
    service_version: &'static str,
    api_version: &'static str,
    db_status: String,
    toolchain: ToolchainStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapReport {
    profile: BootstrapResource,
    goals: BootstrapResource,
    content: ContentBootstrap,
    capabilities: Capabilities,
    toolchain: ToolchainStatus,
}

#[derive(Serialize)]
struct BootstrapResource {
    status: &'static str,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentBootstrap {
    status: &'static str,
    release_id: String,
    checksum: String,
    graph_release_id: String,
}

#[derive(Serialize)]
struct Capabilities {
    database: bool,
    compiler: bool,
    offline: bool,
}

#[derive(Serialize)]
struct ErrorEnvelope {
    code: &'static str,
    message: &'static str,
    details: serde_json::Value,
    request_id: &'static str,
    retryable: bool,
}

pub fn api_contract_fixture() -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "health": HealthReport {
            status: "degraded",
            service_version: env!("CARGO_PKG_VERSION"),
            api_version: API_VERSION,
            db_status: "not_configured".to_owned(),
            toolchain: ToolchainStatus::fixture(true),
        },
        "bootstrap": BootstrapReport {
            profile: BootstrapResource { status: "ready", count: 1 },
            goals: BootstrapResource { status: "ready", count: 5 },
            content: ContentBootstrap {
                status: "ready",
                release_id: tutor::embedded_release_id(),
                checksum: tutor::embedded_release_checksum(),
                graph_release_id: graph::embedded().release_id.clone(),
            },
            capabilities: Capabilities { database: true, compiler: true, offline: true },
            toolchain: ToolchainStatus::fixture(true),
        },
        "error": ErrorEnvelope {
            code: "invalid_request",
            message: "Request did not satisfy the API contract.",
            details: serde_json::json!({"field": "example"}),
            request_id: "REQ-FIXTURE-001",
            retryable: false,
        },
        // The evidence-critical DTO: the frontend contract test parses this
        // fixture with its Zod schema so drift fails CI on either side.
        "evaluation": evaluator::EvaluationResult {
            run_id: "RUN-FIXTURE-001".to_owned(),
            status: evaluator::EvaluationStatus::Accepted,
            exit_code: Some(0),
            duration_ms: 42,
            stdout: "running 1 test\n".to_owned(),
            stderr: String::new(),
            diagnostics: vec![evaluator::Diagnostic {
                severity: "warning".to_owned(),
                code: Some("unused_variables".to_owned()),
                message: "unused variable: `x`".to_owned(),
                spans: vec![evaluator::DiagnosticSpan {
                    file: "src/main.rs".to_owned(),
                    line_start: 1,
                    line_end: 1,
                    column_start: 5,
                    column_end: 6,
                    primary: true,
                    label: Some("help: prefix with underscore".to_owned()),
                }],
                rendered: Some("warning: unused variable".to_owned()),
                children: vec![evaluator::DiagnosticChild {
                    severity: "note".to_owned(),
                    message: "note text".to_owned(),
                    rendered: None,
                }],
                tool: "rustc",
            }],
            formatted_files: std::collections::BTreeMap::new(),
            cases: vec![evaluator::CaseResult {
                id: "CASE-FIXTURE-001".to_owned(),
                input: String::new(),
                expected: Some("42\n".to_owned()),
                actual: "42\n".to_owned(),
                stdout: "42\n".to_owned(),
                stderr: String::new(),
                status: evaluator::EvaluationStatus::Accepted,
                duration_ms: 10,
            }],
            output_chunks: vec![evaluator::OutputChunk {
                channel: "test".to_owned(),
                text: "running 1 test\n".to_owned(),
            }],
            replay: evaluator::ReplayManifest {
                action: evaluator::Action::Test,
                content_hash: "377abae1d4523366424a66c736f0a8a20c279e7f556bd95e3c241a11b24237d7".to_owned(),
                toolchain: std::collections::HashMap::new(),
                network: "denied-by-macos-sandbox-profile".to_owned(),
            },
        }
    })
}

async fn health(State(state): State<Arc<AppState>>) -> Json<HealthReport> {
    let healthy = state.db_status == "ready" && state.toolchain.cargo && state.toolchain.rustc;
    Json(HealthReport {
        status: if healthy { "healthy" } else { "degraded" },
        service_version: env!("CARGO_PKG_VERSION"),
        api_version: API_VERSION,
        db_status: state.db_status.clone(),
        toolchain: state.toolchain.clone(),
    })
}

async fn bootstrap(State(state): State<Arc<AppState>>) -> Json<BootstrapReport> {
    Json(BootstrapReport {
        profile: BootstrapResource {
            status: "ready",
            count: 1,
        },
        goals: BootstrapResource {
            status: "ready",
            count: 5,
        },
        content: ContentBootstrap {
            status: "ready",
            release_id: state.tutor_content.release_id.clone(),
            checksum: tutor::embedded_release_checksum(),
            graph_release_id: state.graph.release_id.clone(),
        },
        capabilities: Capabilities {
            database: state.db_status == "ready",
            compiler: state.toolchain.cargo && state.toolchain.rustc,
            offline: true,
        },
        toolchain: state.toolchain.clone(),
    })
}

async fn about(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "appVersion":env!("CARGO_PKG_VERSION"),"apiVersion":API_VERSION,"databaseSchemaVersion":10,
        "contentRelease":state.graph.release_id,"contentChecksum":state.graph.checksum,
        "rustToolchain":state.toolchain.versions.get("rustc").cloned().unwrap_or_else(||"unavailable".into()),
        "masteryModel":"mastery-v1","placementModel":state.diagnostic.model_version,
        "examForm":state.exam.form_id,"examVersion":state.exam.form_version,
        "scheduler":"fixed-intervals-v1","license":"MIT","offlineRuntime":true
    }))
}

async fn diagnostics_preview(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin)
        || !session_matches(&headers, &state)
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(serde_json::json!({
        "previewOnly":true,"uploaded":false,"appVersion":env!("CARGO_PKG_VERSION"),
        "apiVersion":API_VERSION,"databaseStatus":state.db_status,
        "toolAvailability":{"cargo":state.toolchain.cargo,"rustc":state.toolchain.rustc,"rustfmt":state.toolchain.rustfmt,"clippy":state.toolchain.clippy,"rustAnalyzer":state.toolchain.rust_analyzer},
        "contentRelease":state.graph.release_id,"contentChecksum":state.graph.checksum,
        "redacted":["tokens","environment values","machine/user/temp paths","learner code","journal bodies","evaluator logs"]
    })).into_response()
}

#[derive(Serialize)]
struct SessionGrant<'a> {
    token: &'a str,
}

async fn session(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response = Json(SessionGrant {
        token: &state.session_token,
    })
    .into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        header::HeaderValue::from_static("no-referrer"),
    );
    response
}

async fn check_session(State(state): State<Arc<AppState>>, headers: HeaderMap) -> StatusCode {
    if !request_origin_allowed(&headers, &state.allowed_origin) {
        return StatusCode::FORBIDDEN;
    }
    if session_matches(&headers, &state) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::UNAUTHORIZED
    }
}

fn session_matches(headers: &HeaderMap, state: &AppState) -> bool {
    headers
        .get("x-rust-tutor-session")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == state.session_token)
}

async fn tutor_content(State(state): State<Arc<AppState>>) -> Json<tutor::TutorContent> {
    Json((*state.tutor_content).clone())
}

async fn lesson_detail(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    match state.curriculum_v2.lesson(&id) {
        Some(lesson) => Json(serde_json::json!({
            "releaseId": state.curriculum_v2.release_id,
            "lesson": lesson
        }))
        .into_response(),
        None => service_error(
            StatusCode::NOT_FOUND,
            "lesson_not_found",
            "The lesson is not released.",
            false,
        ),
    }
}

async fn practice_list(
    State(state): State<Arc<AppState>>,
    Query(query): Query<curriculum_v2::PracticeQuery>,
) -> Response {
    Json(state.curriculum_v2.practice(&query)).into_response()
}

async fn practice_detail(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    match state.curriculum_v2.exercise(&id) {
        Some(item) => Json(serde_json::json!({
            "releaseId": state.curriculum_v2.release_id,
            "item": item
        }))
        .into_response(),
        None => service_error(
            StatusCode::NOT_FOUND,
            "practice_not_found",
            "The practice item is not released.",
            false,
        ),
    }
}

async fn practice_reveal(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let Some(reveal) = state.curriculum_v2.reveal(&id) else {
        return service_error(
            StatusCode::NOT_FOUND,
            "practice_not_found",
            "The practice item is not released.",
            false,
        );
    };
    if let Err(error) = database
        .record_support_reveal("LEARNER-LOCAL-001", &id, "full_reveal", &unix_timestamp())
        .await
    {
        return service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "reveal_record_failed",
            &error.to_string(),
            false,
        );
    }
    Json(reveal).into_response()
}

async fn project_stage_detail(
    State(state): State<Arc<AppState>>,
    AxumPath((project_id, stage_id)): AxumPath<(String, String)>,
) -> Response {
    match state.curriculum_v2.stage(&project_id, &stage_id) {
        Some(detail) => Json(detail).into_response(),
        None => service_error(
            StatusCode::NOT_FOUND,
            "project_stage_not_found",
            "The project stage is not released for this project.",
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectWorkspaceSave {
    files: std::collections::HashMap<String, String>,
}

async fn project_workspace_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath((project_id, stage_id)): AxumPath<(String, String)>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if state.curriculum_v2.stage(&project_id, &stage_id).is_none() {
        return service_error(
            StatusCode::NOT_FOUND,
            "project_stage_not_found",
            "The project stage is not released for this project.",
            false,
        );
    }
    match database
        .latest_project_workspace("LEARNER-LOCAL-001", &project_id, &stage_id)
        .await
    {
        Ok(Some(workspace)) => Json(workspace).into_response(),
        Ok(None) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "workspace_read_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn save_project_workspace(
    state: &AppState,
    headers: &HeaderMap,
    project_id: String,
    stage_id: String,
    request: ProjectWorkspaceSave,
    checkpoint: bool,
) -> Response {
    let database = match authenticated_database(state, headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if state.curriculum_v2.stage(&project_id, &stage_id).is_none() {
        return service_error(
            StatusCode::NOT_FOUND,
            "project_stage_not_found",
            "The project stage is not released for this project.",
            false,
        );
    }
    let valid = !request.files.is_empty()
        && request.files.len() <= 128
        && request
            .files
            .iter()
            .map(|(path, body)| path.len() + body.len())
            .sum::<usize>()
            <= 1_048_576
        && request.files.keys().all(|path| {
            let path = std::path::Path::new(path);
            !path.is_absolute()
                && path
                    .components()
                    .all(|part| matches!(part, std::path::Component::Normal(_)))
        });
    if !valid {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_workspace",
            "Workspace files must be relative text files within the one MiB revision limit.",
            false,
        );
    }
    let checksum = workspace_checksum(&request.files);
    let files = serde_json::to_value(&request.files).expect("workspace JSON");
    match database
        .save_project_workspace(&db::NewProjectWorkspace {
            learner_id: "LEARNER-LOCAL-001",
            project_id: &project_id,
            stage_id: &stage_id,
            files: &files,
            checksum: &checksum,
            checkpoint,
            created_at: &unix_timestamp(),
        })
        .await
    {
        Ok(workspace) => Json(workspace).into_response(),
        Err(error) => service_error(
            StatusCode::CONFLICT,
            "workspace_save_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn project_workspace_save(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath((project_id, stage_id)): AxumPath<(String, String)>,
    Json(request): Json<ProjectWorkspaceSave>,
) -> Response {
    save_project_workspace(&state, &headers, project_id, stage_id, request, false).await
}

async fn project_workspace_checkpoint(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath((project_id, stage_id)): AxumPath<(String, String)>,
    Json(request): Json<ProjectWorkspaceSave>,
) -> Response {
    save_project_workspace(&state, &headers, project_id, stage_id, request, true).await
}

async fn evaluate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<evaluator::EvaluationRequest>,
) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !session_matches(&headers, &state) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let missing = match request.action {
        evaluator::Action::Clippy if !state.toolchain.clippy => Some((
            "Clippy is unavailable. Run `rustup component add clippy`; Check remains available.",
            "clippy",
        )),
        evaluator::Action::FormatCheck | evaluator::Action::FormatPreview
            if !state.toolchain.rustfmt =>
        {
            Some((
                "rustfmt is unavailable. Run `rustup component add rustfmt`; Check remains available.",
                "rustfmt",
            ))
        }
        _ if !state.toolchain.cargo || !state.toolchain.rustc => Some((
            "The pinned Cargo/rustc toolchain is unavailable. Install it with rustup before evaluating.",
            "cargo-rustc",
        )),
        _ => None,
    };
    if let Some((message, tool)) = missing {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "code": "unsupported_action",
                "message": message,
                "details": {"tool": tool, "target": state.toolchain.target},
                "request_id": "REQ-EVALUATOR-CAPABILITY",
                "retryable": false
            })),
        )
            .into_response();
    }
    let run_id = request.run_id.clone();
    let exercise_id = request.exercise_id.clone();
    let action = action_name(request.action);
    let checksum = workspace_checksum(&request.files);
    let (cancel, receiver) = watch::channel(false);
    if let Some(run_id) = &run_id {
        let mut active = state.active_runs.lock().await;
        if active.contains_key(run_id) {
            return service_error(
                StatusCode::CONFLICT,
                "duplicate_run",
                "An evaluator run with this ID is already active.",
                false,
            );
        }
        active.insert(run_id.clone(), cancel);
    }
    let result = state.evaluator.run_cancellable(request, receiver).await;
    if let Some(run_id) = &run_id {
        state.active_runs.lock().await.remove(run_id);
    }
    match result {
        Ok(result) => {
            // Persist the completed run so evidence recording can later verify
            // this run ID server-side instead of trusting client-supplied status.
            if let (Some(run_id), Some(database)) = (&run_id, &state.database) {
                let final_state = if result.status == evaluator::EvaluationStatus::Cancelled {
                    "cancelled"
                } else {
                    "completed"
                };
                let result_json = serde_json::to_value(&result).expect("evaluation result JSON");
                if let Err(error) = database
                    .record_completed_run(
                        "LEARNER-LOCAL-001",
                        run_id,
                        &exercise_id,
                        &action,
                        &checksum,
                        final_state,
                        &result_json,
                        &unix_timestamp(),
                    )
                    .await
                {
                    return service_error(
                        StatusCode::CONFLICT,
                        "run_persistence_failed",
                        &error.to_string(),
                        false,
                    );
                }
            }
            Json(result).into_response()
        }
        Err(evaluator::EvalError::Busy) => service_error(
            StatusCode::TOO_MANY_REQUESTS,
            "evaluator_busy",
            "The evaluator queue is full; retry shortly.",
            true,
        ),
        Err(error) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({
                "code": "evaluation_rejected",
                "message": error.to_string(),
                "details": {},
                "request_id": "REQ-EVALUATOR",
                "retryable": false
            })),
        )
            .into_response(),
    }
}

async fn evaluate_stream(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<evaluator::EvaluationRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database.clone(),
        Err(response) => return response,
    };
    let Some(run_id) = request.run_id.clone() else {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "stream_run_id_required",
            "A stable run ID is required for recoverable streaming.",
            false,
        );
    };
    let workspace_checksum = workspace_checksum(&request.files);
    let action = action_name(request.action);
    if let Err(error) = database
        .create_evaluation_stream(
            "LEARNER-LOCAL-001",
            &run_id,
            &request.exercise_id,
            &action,
            &workspace_checksum,
            &unix_timestamp(),
        )
        .await
    {
        return service_error(
            StatusCode::CONFLICT,
            "stream_run_conflict",
            &error.to_string(),
            false,
        );
    }
    let (cancel, receiver) = watch::channel(false);
    let mut active = state.active_runs.lock().await;
    if active.contains_key(&run_id) {
        let failure = serde_json::json!({
            "runId":run_id,"state":"failed","message":"A run with this ID is already active."
        });
        drop(active);
        let _ = database
            .finish_evaluation_stream(&run_id, "failed", &failure, &unix_timestamp())
            .await;
        return service_error(
            StatusCode::CONFLICT,
            "duplicate_run",
            "An evaluator run with this ID is already active.",
            false,
        );
    }
    active.insert(run_id.clone(), cancel);
    drop(active);
    let (progress_tx, mut progress_rx) = mpsc::channel::<evaluator::OutputChunk>(32);
    let (event_tx, event_rx) = mpsc::channel::<serde_json::Value>(32);
    let chunk_database = database.clone();
    let chunk_run_id = run_id.clone();
    let chunk_events = event_tx.clone();
    let progress_task = tokio::spawn(async move {
        while let Some(chunk) = progress_rx.recv().await {
            if chunk_database
                .append_evaluation_stream_chunk(&chunk_run_id, &chunk, &unix_timestamp())
                .await
                .is_err()
            {
                break;
            }
            if chunk_events
                .send(serde_json::json!({"type":"chunk","chunk":chunk}))
                .await
                .is_err()
            {
                break;
            }
        }
    });
    let run_state = state.clone();
    tokio::spawn(async move {
        let _ = database
            .mark_evaluation_stream_running(&run_id, &unix_timestamp())
            .await;
        let _ = event_tx
            .send(serde_json::json!({"type":"state","state":"running","runId":run_id}))
            .await;
        let outcome = run_state
            .evaluator
            .run_with_progress(request, receiver, Some(progress_tx))
            .await;
        let _ = progress_task.await;
        match outcome {
            Ok(result) => {
                let result_json = serde_json::to_value(&result).expect("evaluation result JSON");
                let final_state = if result.status == evaluator::EvaluationStatus::Cancelled {
                    "cancelled"
                } else {
                    "completed"
                };
                let _ = database
                    .finish_evaluation_stream(&run_id, final_state, &result_json, &unix_timestamp())
                    .await;
                let _ = event_tx
                    .send(serde_json::json!({"type":"result","state":final_state,"result":result_json}))
                    .await;
            }
            Err(error) => {
                let failure = serde_json::json!({
                    "runId":run_id,"state":"failed","message":error.to_string()
                });
                let _ = database
                    .finish_evaluation_stream(&run_id, "failed", &failure, &unix_timestamp())
                    .await;
                let _ = event_tx
                    .send(serde_json::json!({"type":"error","state":"failed","error":failure}))
                    .await;
            }
        }
        run_state.active_runs.lock().await.remove(&run_id);
    });
    let events = ReceiverStream::new(event_rx).map(|payload| {
        Ok::<Event, Infallible>(
            Event::default()
                .event(payload["type"].as_str().unwrap_or("message"))
                .data(payload.to_string()),
        )
    });
    Sse::new(events)
        .keep_alive(KeepAlive::default())
        .into_response()
}

async fn evaluation_stream_recovery(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(run_id): AxumPath<String>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    match database
        .evaluation_stream("LEARNER-LOCAL-001", &run_id)
        .await
    {
        Ok(Some(snapshot)) => Json(snapshot).into_response(),
        Ok(None) => service_error(
            StatusCode::NOT_FOUND,
            "stream_run_not_found",
            "No recoverable evaluator stream exists for that run ID.",
            false,
        ),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "stream_recovery_failed",
            &error.to_string(),
            false,
        ),
    }
}

fn workbench_contract(item_id: &str) -> Option<(&'static str, &'static str)> {
    match item_id {
        "EXE-ALG-CATALOG-PROBE-001" => Some(("algorithm", "EXE-ALG-FIRST-BREACH-001")),
        "PRJ-PULSE-00" => Some(("project_stage", "PRJ-PULSE-01")),
        // Lesson code checkpoint: an accepted hidden-test run of the lesson's
        // exercise completes the lesson and unlocks independent practice.
        "EX-OWNERSHIP-COMPLETION-001" => Some(("lesson", "EX-OWNERSHIP-INDEPENDENT-001")),
        _ => None,
    }
}

fn workspace_checksum(files: &std::collections::HashMap<String, String>) -> String {
    let mut sorted: Vec<_> = files.iter().collect();
    sorted.sort_by_key(|(path, _)| *path);
    let mut digest = Sha256::new();
    for (path, body) in sorted {
        digest.update(path.as_bytes());
        digest.update([0]);
        digest.update(body.as_bytes());
        digest.update([0]);
    }
    format!("{:x}", digest.finalize())
}

fn action_name(action: evaluator::Action) -> String {
    serde_json::to_value(action)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .expect("evaluator action serializes to a string")
}

/// Resolves a learner-supplied run ID against the persisted evaluator record
/// and checks it describes the expected exercise and action. The caller reads
/// the persisted result; nothing about the run is trusted from the client.
async fn verified_completed_run(
    database: &db::Database,
    run_id: &str,
    exercise_id: &str,
    required_action: &str,
) -> Result<serde_json::Value, Response> {
    let stream = database
        .evaluation_stream("LEARNER-LOCAL-001", run_id)
        .await
        .map_err(|error| {
            service_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "run_lookup_failed",
                &error.to_string(),
                false,
            )
        })?
        .ok_or_else(|| {
            service_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "evaluator_run_not_found",
                "No persisted evaluator run exists for that run ID.",
                false,
            )
        })?;
    if stream["state"] != "completed"
        || stream["exerciseId"] != exercise_id
        || stream["action"] != required_action
        || !stream["result"].is_object()
    {
        return Err(service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "evaluator_run_mismatch",
            "The persisted evaluator run does not match this item and scored action.",
            false,
        ));
    }
    Ok(stream)
}

async fn workbench_progress(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    match database.workbench_progress("LEARNER-LOCAL-001").await {
        Ok(completions) => Json(serde_json::json!({"completions":completions})).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "workbench_progress_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkbenchAcceptRequest {
    run_id: String,
}

async fn workbench_accept(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(item_id): AxumPath<String>,
    Json(request): Json<WorkbenchAcceptRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let Some((kind, unlocked_item_id)) = workbench_contract(&item_id) else {
        return service_error(
            StatusCode::NOT_FOUND,
            "workbench_item_not_found",
            "This release has no executable acceptance contract for that item.",
            false,
        );
    };
    match database
        .accept_workbench_item(
            "LEARNER-LOCAL-001",
            &item_id,
            kind,
            unlocked_item_id,
            &request.run_id,
            &unix_timestamp(),
        )
        .await
    {
        Ok(completion) => Json(completion).into_response(),
        Err(error) => service_error(
            StatusCode::CONFLICT,
            "workbench_evidence_rejected",
            &error.to_string(),
            false,
        ),
    }
}

async fn course_progress(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    match database.course_progress("LEARNER-LOCAL-001").await {
        Ok(chapters) => Json(serde_json::json!({ "chapters": chapters })).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "course_progress_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CourseProgressRequest {
    #[serde(default)]
    cleared_stops: Vec<String>,
    #[serde(default)]
    ran: bool,
}

async fn course_progress_save(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(chapter_id): AxumPath<String>,
    Json(request): Json<CourseProgressRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    // Chapter IDs are short kebab-case slugs from the frontend course; bound the
    // input so an arbitrary body cannot store unbounded keys or values.
    if chapter_id.is_empty()
        || chapter_id.len() > 64
        || request.cleared_stops.len() > 32
        || request.cleared_stops.iter().any(|stop| stop.len() > 64)
    {
        return service_error(
            StatusCode::BAD_REQUEST,
            "course_progress_invalid",
            "The chapter ID or cleared-stop set is outside the accepted bounds.",
            false,
        );
    }
    match database
        .upsert_course_progress(
            "LEARNER-LOCAL-001",
            &chapter_id,
            &request.cleared_stops,
            request.ran,
            &unix_timestamp(),
        )
        .await
    {
        Ok(chapter) => Json(chapter).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "course_progress_save_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn cancel_evaluation(
    State(state): State<Arc<AppState>>,
    AxumPath(run_id): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !session_matches(&headers, &state) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let active = state.active_runs.lock().await;
    let Some(cancel) = active.get(&run_id) else {
        return service_error(
            StatusCode::NOT_FOUND,
            "run_not_active",
            "The evaluator run is not active.",
            false,
        );
    };
    let _ = cancel.send(true);
    StatusCode::ACCEPTED.into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompletionRequest {
    exercise_id: String,
    source: String,
    version: u64,
    position: analyzer::CompletionPosition,
}

async fn complete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CompletionRequest>,
) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !session_matches(&headers, &state) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match analyzer::complete_source(
        &request.exercise_id,
        &request.source,
        request.version,
        request.position,
    )
    .await
    {
        Ok(items) => Json(serde_json::json!({"items": items})).into_response(),
        Err(error) => service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "completion_unavailable",
            &error.to_string(),
            true,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AttemptRecordRequest {
    exercise_id: String,
    concept_id: String,
    plan: String,
    confidence: u8,
    support: String,
    reflection: String,
    evaluator_run_id: String,
    #[serde(default)]
    hint_level: u8,
    #[serde(default)]
    accessibility_bypass: bool,
}

async fn record_attempt(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<AttemptRecordRequest>,
) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !session_matches(&headers, &state) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let exercise = state
        .tutor_content
        .exercises
        .iter()
        .find(|exercise| exercise.id == request.exercise_id);
    let matched_outcome = exercise.and_then(|exercise| {
        exercise.outcome_ids.iter().find(|outcome_id| {
            state.tutor_content.outcomes.iter().any(|outcome| {
                outcome.id == **outcome_id && outcome.concept_id == request.concept_id
            })
        })
    });
    let known_concept = matched_outcome.is_some();
    if request.plan.trim().is_empty()
        || request.reflection.trim().is_empty()
        || !(1..=5).contains(&request.confidence)
        || !known_concept
        || request.evaluator_run_id.trim().is_empty()
        || ![
            "none",
            "compiler",
            "official_docs",
            "hint",
            "full_reveal",
            "external_help",
        ]
        .contains(&request.support.as_str())
        || (request.support == "hint" && !(1..=7).contains(&request.hint_level))
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_attempt",
            "Plan, confidence, support, reflection, and a known concept are required.",
            false,
        );
    }
    let Some(database) = &state.database else {
        return service_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "database_unavailable",
            "The learner database is unavailable; this attempt was not recorded.",
            true,
        );
    };
    // Scored evidence must come from this exercise's persisted hidden-test run;
    // a compile, run, clippy, or format action can never become mastery evidence.
    let run = match verified_completed_run(
        database,
        &request.evaluator_run_id,
        &request.exercise_id,
        "test",
    )
    .await
    {
        Ok(run) => run,
        Err(response) => return response,
    };
    let result = &run["result"];
    let evaluation_status = result["status"].as_str().unwrap_or("INFRASTRUCTURE_ERROR");
    let passed = evaluation_status == "ACCEPTED";
    let diagnostic_codes: Vec<String> = result["diagnostics"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|diagnostic| diagnostic["code"].as_str().map(str::to_owned))
        .collect();
    let replay = result["replay"].clone();
    let ids = EventIds::new();
    let support = match request.support.as_str() {
        "none" => serde_json::json!("none"),
        "compiler" => serde_json::json!("compiler"),
        "official_docs" => serde_json::json!("official_docs"),
        "hint" => serde_json::json!({"hint":{"level":request.hint_level}}),
        "full_reveal" => serde_json::json!("solution_viewed"),
        _ => serde_json::json!("external_help"),
    };
    let exercise = exercise.expect("validated exercise");
    let primary_outcome =
        matched_outcome.is_some_and(|outcome_id| exercise.primary_outcome_ids.contains(outcome_id));
    let concept_id = request.concept_id.clone();
    let evidence_kind = match exercise.kind.as_str() {
        "transfer" => "transfer",
        "completion" | "independent" | "mixed" => "implement",
        _ => "explain",
    };
    let events = [
        ids.event(0, "plan_committed", serde_json::json!({"plan": request.plan})),
        ids.event(
            1,
            "confidence_committed",
            serde_json::json!({"phase":"before","value":request.confidence}),
        ),
        ids.event(
            2,
            "compiler_observed",
            serde_json::json!({"status":evaluation_status,"diagnosticCodes":diagnostic_codes}),
        ),
        ids.event(3, "support_used", serde_json::json!({"support":support.clone(),"hintLevel":request.hint_level,"accessibilityBypass":request.accessibility_bypass})),
        ids.event(
            4,
            "reflection_committed",
            serde_json::json!({"reflection":request.reflection}),
        ),
        ids.event(
            5,
            "assessment_scored",
            serde_json::json!({
                "conceptId":concept_id.clone(),
                "score":if passed {1.0} else {0.0},
                "itemId":request.exercise_id,
                "variantGroup":exercise.variant_group,
                "kind":evidence_kind,
                "support":support,
                "day":current_day(),
                "criticalMisconception":false,
                "primaryOutcome":primary_outcome
            }),
        ),
    ];
    let session = db::NewSession {
        learner_id: "LEARNER-LOCAL-001".to_owned(),
        session_id: ids.session.clone(),
        attempt_id: ids.attempt.clone(),
        item_id: request.exercise_id.clone(),
        item_version: 1,
        started_at: ids.occurred_at.clone(),
        run_id: ids.run.clone(),
        request_id: ids.request.clone(),
    };
    let evaluator_log = db::NewEvaluatorLog {
        evaluator_run_id: request.evaluator_run_id,
        attempt_id: ids.attempt.clone(),
        event_id: Some(events[2].event_id.clone()),
        run_id: ids.run.clone(),
        request_id: ids.request.clone(),
        status: evaluation_status.to_owned(),
        toolchain_json: replay
            .get("toolchain")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}))
            .to_string(),
        detail_json: replay.to_string(),
        created_at: ids.occurred_at.clone(),
    };
    let projection = match database
        .record_attempt_bundle(
            &session,
            "evaluated",
            &events,
            Some(&evaluator_log),
            "mastery-v1",
        )
        .await
    {
        Ok(projection) => projection,
        Err(error) => {
            return service_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "event_store_failed",
                &error.to_string(),
                false,
            );
        }
    };
    let mastery = database
        .mastery_explanation("LEARNER-LOCAL-001", &concept_id)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| {
            serde_json::json!({
                "state":"not_started",
                "explanation":{"nextProof":"Record valid scored evidence."}
            })
        });
    Json(serde_json::json!({
        "attemptId": ids.attempt,
        "evidenceId": format!("EVID-{}", events[5].event_id),
        "outcomeState": mastery["state"],
        "whyNext": mastery["explanation"]["nextProof"],
        "projectionChecksum": projection.checksum
    }))
    .into_response()
}

async fn mastery_explanation(
    State(state): State<Arc<AppState>>,
    AxumPath(concept_id): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin)
        || !session_matches(&headers, &state)
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(database) = &state.database else {
        return service_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "database_unavailable",
            "Mastery evidence is unavailable because the learner database is unavailable.",
            true,
        );
    };
    match database
        .mastery_explanation("LEARNER-LOCAL-001", &concept_id)
        .await
    {
        Ok(Some(explanation)) => Json(explanation).into_response(),
        Ok(None) => service_error(
            StatusCode::NOT_FOUND,
            "mastery_not_started",
            "No scored evidence exists for this outcome yet.",
            false,
        ),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "mastery_query_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TimelineQuery {
    concept_id: Option<String>,
}

async fn evidence_timeline(
    State(state): State<Arc<AppState>>,
    Query(query): Query<TimelineQuery>,
    headers: HeaderMap,
) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin)
        || !session_matches(&headers, &state)
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(database) = &state.database else {
        return service_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "database_unavailable",
            "The evidence timeline is unavailable because the learner database is unavailable.",
            true,
        );
    };
    match database
        .evidence_timeline("LEARNER-LOCAL-001", query.concept_id.as_deref())
        .await
    {
        Ok(events) => Json(serde_json::json!({"events":events})).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "timeline_query_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewQuery {
    day: Option<u32>,
    limit: Option<usize>,
}

async fn review_queue(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ReviewQuery>,
    headers: HeaderMap,
) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin)
        || !session_matches(&headers, &state)
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(database) = &state.database else {
        return service_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "database_unavailable",
            "The review queue is unavailable because the learner database is unavailable.",
            true,
        );
    };
    match database
        .review_queue(
            "LEARNER-LOCAL-001",
            query.day.unwrap_or_else(current_day),
            query.limit.unwrap_or(8).clamp(1, 20),
        )
        .await
    {
        Ok(mut queue) => {
            // Attach the concept-mapped fresh exercise so the client can deep
            // link the retrieval work instead of pointing at the whole catalog.
            if let Some(items) = queue["items"].as_array_mut() {
                for item in items {
                    let concept = item["conceptId"].as_str().unwrap_or_default().to_owned();
                    let suggestion = state
                        .tutor_content
                        .exercises
                        .iter()
                        .find(|exercise| {
                            exercise.outcome_ids.iter().any(|outcome_id| {
                                state.tutor_content.outcomes.iter().any(|outcome| {
                                    outcome.id == *outcome_id && outcome.concept_id == concept
                                })
                            })
                        })
                        .map(|exercise| exercise.id.clone());
                    item["suggestedExerciseId"] =
                        suggestion.map_or(serde_json::Value::Null, serde_json::Value::String);
                }
            }
            Json(queue).into_response()
        }
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "review_query_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn confidence_calibration(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin)
        || !session_matches(&headers, &state)
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(database) = &state.database else {
        return service_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "database_unavailable",
            "Confidence calibration is unavailable because the learner database is unavailable.",
            true,
        );
    };
    match database
        .confidence_calibration("LEARNER-LOCAL-001", 5)
        .await
    {
        Ok(bands) => Json(serde_json::json!({"minimumSamples":5,"bands":bands})).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "calibration_query_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn recommendations(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin)
        || !session_matches(&headers, &state)
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(database) = &state.database else {
        return service_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "database_unavailable",
            "Recommendations are unavailable because the learner database is unavailable.",
            true,
        );
    };
    let queue = match database
        .review_queue("LEARNER-LOCAL-001", current_day(), 8)
        .await
    {
        Ok(queue) => queue,
        Err(error) => {
            return service_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "recommendation_query_failed",
                &error.to_string(),
                false,
            );
        }
    };
    let due_id = queue["items"]
        .as_array()
        .and_then(|items| items.first())
        .and_then(|item| item["conceptId"].as_str());
    // Rank real candidates from the learner's plan, mastery projection, and
    // attempt history instead of returning a hardcoded exercise.
    let plan = database
        .learner_plan("LEARNER-LOCAL-001")
        .await
        .ok()
        .flatten();
    let overlay = database
        .mastery_overlay("LEARNER-LOCAL-001")
        .await
        .unwrap_or_default();
    let mastery_state: std::collections::HashMap<String, String> = overlay
        .iter()
        .filter_map(|row| {
            Some((
                row["nodeId"].as_str()?.to_owned(),
                row["state"].as_str()?.to_owned(),
            ))
        })
        .collect();
    let timeline = database
        .evidence_timeline("LEARNER-LOCAL-001", None)
        .await
        .unwrap_or_default();
    let attempted: std::collections::HashSet<String> = timeline
        .iter()
        .filter_map(|event| event["itemId"].as_str().map(str::to_owned))
        .collect();
    let capacity = plan
        .as_ref()
        .and_then(|plan| plan["weeklyCapacityHours"].as_i64())
        .unwrap_or(10);
    let mut candidates = Vec::new();
    for exercise in &state.tutor_content.exercises {
        let weak = exercise.primary_outcome_ids.iter().any(|outcome_id| {
            let concept = state
                .tutor_content
                .outcomes
                .iter()
                .find(|outcome| outcome.id == *outcome_id)
                .map(|outcome| outcome.concept_id.as_str());
            concept.is_none_or(|concept| {
                !matches!(
                    mastery_state.get(concept).map(String::as_str),
                    Some("retained") | Some("provisional")
                )
            })
        });
        let mut components = std::collections::HashMap::new();
        components.insert("goal", if plan.is_some() { 3 } else { 0 });
        components.insert("weak_or_uncertain", if weak { 3 } else { 0 });
        components.insert(
            "novelty",
            if attempted.contains(&exercise.id) {
                0
            } else {
                1
            },
        );
        components.insert(
            "recency",
            if attempted.contains(&exercise.id) {
                -1
            } else {
                0
            },
        );
        components.insert("load", if capacity < 3 { -1 } else { 0 });
        candidates.push((exercise.id.clone(), components));
    }
    if let Some(due) = due_id {
        candidates.push((
            due.to_owned(),
            std::collections::HashMap::from([("overdue", 8)]),
        ));
    }
    let ranked = learning::rank_recommendations(&candidates, &std::collections::HashSet::new());
    let goal_exercise = ranked
        .iter()
        .map(|candidate| candidate.id.as_str())
        .find(|id| id.starts_with("EX-"))
        .unwrap_or("EX-OWNERSHIP-INDEPENDENT-001")
        .to_owned();
    Json(learning::build_daily_plan(
        &ranked,
        due_id,
        &goal_exercise,
        queue["overflow"].as_u64().unwrap_or(0) as usize,
    ))
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewRatingRequest {
    rating: String,
}

/// Records an explicit retrieval rating for a due concept and refolds its
/// schedule; this is the review workflow's only scheduler input.
async fn rate_review(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(concept_id): AxumPath<String>,
    Json(request): Json<ReviewRatingRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if !["again", "hard", "good", "easy"].contains(&request.rating.as_str()) {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_review_rating",
            "Rate the retrieval as again, hard, good, or easy.",
            false,
        );
    }
    match database
        .apply_review_rating(
            "LEARNER-LOCAL-001",
            &concept_id,
            &request.rating,
            current_day(),
            &format!("RATING-{}", random_hex()),
            &unix_timestamp(),
        )
        .await
    {
        Ok(result) => Json(result).into_response(),
        Err(error) => service_error(
            StatusCode::CONFLICT,
            "review_rating_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphQuery {
    id: Option<String>,
    depth: Option<usize>,
    limit: Option<usize>,
    kinds: Option<String>,
}

async fn graph_neighborhood(
    State(state): State<Arc<AppState>>,
    Query(query): Query<GraphQuery>,
) -> Response {
    let selected = query.id.as_deref().unwrap_or("CON-RUST-OWNERSHIP-001");
    let owned_kinds: Vec<_> = query
        .kinds
        .as_deref()
        .unwrap_or_default()
        .split(',')
        .filter(|kind| !kind.is_empty())
        .collect();
    let kinds = owned_kinds.into_iter().collect();
    match state.graph.neighborhood(
        selected,
        query.depth.unwrap_or(1),
        query.limit.unwrap_or(60),
        &kinds,
    ) {
        Ok(result) => Json(result).into_response(),
        Err(error) => service_error(StatusCode::NOT_FOUND, "graph_node_not_found", &error, false),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathQuery {
    start: Option<String>,
    goal: Option<String>,
}

async fn graph_path(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PathQuery>,
) -> Response {
    Json(state.graph.path(
        query.start.as_deref().unwrap_or("CON-RUST-OWNERSHIP-001"),
        query.goal.as_deref().unwrap_or("PRJ-QUAY"),
    ))
    .into_response()
}

async fn graph_prerequisites(
    State(state): State<Arc<AppState>>,
    Query(query): Query<GraphQuery>,
) -> Response {
    Json(state.graph.prerequisite_closure(
        query.id.as_deref().unwrap_or("PRJ-QUAY"),
        &std::collections::HashSet::new(),
    ))
    .into_response()
}

async fn graph_misconception(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    match state.graph.misconception_remediation(&id) {
        Ok(result) => Json(result).into_response(),
        Err(error) => service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_misconception",
            &error,
            false,
        ),
    }
}

async fn graph_tours(State(state): State<Arc<AppState>>) -> Response {
    Json(serde_json::json!({
        "releaseId":state.graph.release_id,
        "tours":state.graph.tours()
    }))
    .into_response()
}

async fn graph_overlay(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !request_origin_allowed(&headers, &state.allowed_origin)
        || !session_matches(&headers, &state)
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(database) = &state.database else {
        return service_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "database_unavailable",
            "The learner overlay is unavailable because the learner database is unavailable.",
            true,
        );
    };
    match database.mastery_overlay("LEARNER-LOCAL-001").await {
        Ok(overlay) => Json(serde_json::json!({
            "releaseId":state.graph.release_id,
            "learnerState":overlay
        }))
        .into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "graph_overlay_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: Option<String>,
    kind: Option<String>,
    limit: Option<usize>,
}

async fn search(State(state): State<Arc<AppState>>, Query(query): Query<SearchQuery>) -> Response {
    let Some(database) = &state.database else {
        return service_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "database_unavailable",
            "Search is unavailable because the local content index is unavailable.",
            true,
        );
    };
    let started = std::time::Instant::now();
    match database
        .search_curriculum(
            query.q.as_deref().unwrap_or_default(),
            query.kind.as_deref().filter(|kind| !kind.is_empty()),
            query.limit.unwrap_or(30),
        )
        .await
    {
        Ok(results) => {
            let mut groups = std::collections::BTreeMap::<String, Vec<serde_json::Value>>::new();
            for result in &results {
                groups
                    .entry(result["kind"].as_str().unwrap_or("other").to_owned())
                    .or_default()
                    .push(result.clone());
            }
            Json(serde_json::json!({
                "query":query.q.unwrap_or_default(),
                "count":results.len(),
                "groups":groups,
                "suggestions":if results.is_empty() { vec!["ownership", "E0382", "Parquet", "QUAY"] } else { Vec::new() },
                "latencyMicros":started.elapsed().as_micros(),
                "fuzzySearchDecision":"not_earned: measured local FTS5 prefix search is sufficient for the reviewed corpus"
            }))
            .into_response()
        }
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "search_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[allow(clippy::result_large_err)] // Axum handlers return Response directly on auth failure.
fn authenticated_database<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
) -> Result<&'a db::Database, Response> {
    if !request_origin_allowed(headers, &state.allowed_origin) || !session_matches(headers, state) {
        return Err(StatusCode::UNAUTHORIZED.into_response());
    }
    state.database.as_ref().ok_or_else(|| {
        service_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "database_unavailable",
            "The learner database is unavailable.",
            true,
        )
    })
}

async fn diagnostic_blueprint(State(state): State<Arc<AppState>>) -> Response {
    Json(state.diagnostic.as_ref().clone()).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiagnosticSessionRequest {
    #[serde(default)]
    retake: bool,
}

async fn open_diagnostic_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<DiagnosticSessionRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    match database
        .open_diagnostic_session(
            "LEARNER-LOCAL-001",
            &format!("DSESSION-{}", random_hex()),
            &state.diagnostic.release_id,
            &state.diagnostic.model_version,
            request.retake,
            &unix_timestamp(),
        )
        .await
    {
        Ok(session) => Json(session).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "diagnostic_session_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn save_diagnostic_answer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath((session_id, item_id)): AxumPath<(String, String)>,
    Json(answer): Json<diagnostic::DiagnosticAnswer>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let Some((_, item)) = state.diagnostic.item(&item_id) else {
        return service_error(
            StatusCode::NOT_FOUND,
            "diagnostic_item_not_found",
            "The diagnostic item is not part of this release.",
            false,
        );
    };
    let answer_valid = if answer.unknown {
        answer.answer_index.is_none()
    } else {
        answer
            .answer_index
            .is_some_and(|index| index < item.choices.len())
            && (!item.justification_required || !answer.justification.trim().is_empty())
    };
    if !answer_valid {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_diagnostic_answer",
            "Choose one bounded answer or declare I don't know; required justification must be recorded.",
            false,
        );
    }
    match database
        .save_diagnostic_answer("LEARNER-LOCAL-001", &session_id, &item_id, &answer)
        .await
    {
        Ok(answers) => Json(serde_json::json!({
            "sessionId":session_id,
            "savedItemId":item_id,
            "answerCount":answers.as_object().map_or(0, serde_json::Map::len),
            "answers":answers
        }))
        .into_response(),
        Err(error) => service_error(
            StatusCode::CONFLICT,
            "diagnostic_answer_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn finish_diagnostic_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(session_id): AxumPath<String>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let answers = match database
        .diagnostic_answers("LEARNER-LOCAL-001", &session_id)
        .await
    {
        Ok(answers) => answers,
        Err(error) => {
            return service_error(
                StatusCode::NOT_FOUND,
                "diagnostic_session_not_found",
                &error.to_string(),
                false,
            );
        }
    };
    let answers: std::collections::HashMap<String, diagnostic::DiagnosticAnswer> =
        match serde_json::from_value(answers) {
            Ok(answers) => answers,
            Err(error) => {
                return service_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "diagnostic_state_invalid",
                    &error.to_string(),
                    false,
                );
            }
        };
    // Every item needs an explicit answer or an explicit "I don't know" before
    // a placement is computed; a partial session cannot silently place.
    let missing: Vec<&str> = state
        .diagnostic
        .packets
        .iter()
        .flat_map(|packet| &packet.items)
        .filter(|item| !answers.contains_key(&item.id))
        .map(|item| item.id.as_str())
        .collect();
    if !missing.is_empty() {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "diagnostic_incomplete",
            &format!(
                "Every diagnostic item needs an explicit answer or \"I don't know\"; missing: {}.",
                missing.join(", ")
            ),
            false,
        );
    }
    let placement = state.diagnostic.score(&answers);
    let placement_value = serde_json::to_value(&placement).expect("placement JSON");
    if let Err(error) = database
        .complete_diagnostic_session(
            "LEARNER-LOCAL-001",
            &session_id,
            &placement_value,
            &unix_timestamp(),
        )
        .await
    {
        return service_error(
            StatusCode::CONFLICT,
            "diagnostic_finish_failed",
            &error.to_string(),
            false,
        );
    }
    let opened_prerequisites: Vec<_> = placement
        .gap_map
        .iter()
        .filter(|gap| gap.status != "demonstrated")
        .take(12)
        .map(|gap| {
            let closure = state
                .graph
                .prerequisite_closure(&gap.outcome_id, &std::collections::HashSet::new());
            serde_json::json!({
                "outcomeId":gap.outcome_id,
                "prerequisiteIds":closure.steps.iter().map(|step| step.node.id.as_str()).collect::<Vec<_>>()
            })
        })
        .collect();
    Json(serde_json::json!({
        "sessionId":session_id,
        "placement":placement,
        "openedPrerequisites":opened_prerequisites,
        "comparability":"Comparable only within the same diagnostic release and placement model; old evidence remains immutable."
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LearnerPlanRequest {
    goal_id: String,
    goal_title: String,
    horizon_weeks: u32,
    weekly_capacity_hours: u32,
}

async fn learner_plan_get(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    match database.learner_plan("LEARNER-LOCAL-001").await {
        Ok(plan) => {
            Json(serde_json::json!({"plan":plan,"curriculumMutated":false})).into_response()
        }
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "learner_plan_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn learner_plan_save(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<LearnerPlanRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if request.goal_id.trim().is_empty()
        || request.goal_title.trim().is_empty()
        || !(1..=156).contains(&request.horizon_weeks)
        || !(1..=80).contains(&request.weekly_capacity_hours)
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_learner_plan",
            "Goal, a 1–156 week horizon, and 1–80 weekly hours are required.",
            false,
        );
    }
    match database
        .save_learner_plan(
            "LEARNER-LOCAL-001",
            &request.goal_id,
            &request.goal_title,
            request.horizon_weeks,
            request.weekly_capacity_hours,
            &unix_timestamp(),
        )
        .await
    {
        Ok(plan) => {
            Json(serde_json::json!({"plan":plan,"curriculumMutated":false})).into_response()
        }
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "learner_plan_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GapOverrideRequest {
    outcome_id: String,
    requested_status: String,
    explanation: String,
}

async fn diagnostic_gap_override(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<GapOverrideRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if !state
        .graph
        .node(&request.outcome_id)
        .is_some_and(|node| node.kind == "learning_outcome")
        || !["open", "optional", "priority"].contains(&request.requested_status.as_str())
        || request.explanation.trim().is_empty()
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_gap_override",
            "A canonical learning outcome, allowed requested status, and explanation are required.",
            false,
        );
    }
    match database
        .record_gap_override(
            "LEARNER-LOCAL-001",
            &session_id,
            &format!("OVERRIDE-{}", random_hex()),
            &request.outcome_id,
            &request.requested_status,
            &request.explanation,
            &unix_timestamp(),
        )
        .await
    {
        Ok(result) => Json(result).into_response(),
        Err(error) => service_error(
            StatusCode::CONFLICT,
            "gap_override_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn question_bank(State(state): State<Arc<AppState>>) -> Response {
    Json(serde_json::json!({
        "schemaVersion":1,
        "count":state.questions.len(),
        "questions":state.questions.iter().map(question::Question::public).collect::<Vec<_>>()
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuestionEvaluatorEvidence {
    run_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuestionSubmitRequest {
    idempotency_key: String,
    confirmed: bool,
    response: question::LearnerResponse,
    support: serde_json::Value,
    confidence: i64,
    evaluator_evidence: Option<QuestionEvaluatorEvidence>,
}

async fn question_submit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(question_id): AxumPath<String>,
    Json(mut request): Json<QuestionSubmitRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let Some(question) = state
        .questions
        .iter()
        .find(|question| question.id == question_id)
    else {
        return service_error(
            StatusCode::NOT_FOUND,
            "question_not_found",
            "The question is not published.",
            false,
        );
    };
    if !request.confirmed {
        return service_error(
            StatusCode::CONFLICT,
            "submission_not_confirmed",
            "Review and explicitly confirm the editable response before grading.",
            false,
        );
    }
    if request.idempotency_key.trim().is_empty()
        || !(1..=5).contains(&request.confidence)
        || !request.support.is_object()
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_question_submission",
            "Idempotency key, structured support disclosure, and confidence 1–5 are required.",
            false,
        );
    }
    if matches!(question.kind, question::QuestionKind::FillMissingCode) {
        let Some(evidence) = request.evaluator_evidence.as_ref() else {
            return service_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "evaluator_evidence_required",
                "Fill-missing-code alternatives must be checked by the real local evaluator.",
                false,
            );
        };
        // The run is resolved from server persistence; the client supplies only
        // its ID, never a status or toolchain claim.
        let run =
            match verified_completed_run(database, &evidence.run_id, &question.id, "check").await {
                Ok(run) => run,
                Err(response) => return response,
            };
        request.response = question::LearnerResponse::Evaluator {
            passed: run["result"]["status"] == "ACCEPTED",
        };
    }
    let grading = question.grade(&request.response);
    let response_json = serde_json::to_string(&request.response).expect("question response JSON");
    let result_json = serde_json::to_string(&grading).expect("question result JSON");
    let attempt_id = format!("QUIZ-ATTEMPT-{}", random_hex());
    let history = match database
        .record_question_attempt(
            "LEARNER-LOCAL-001",
            &db::NewQuestionAttempt {
                attempt_id,
                idempotency_key: request.idempotency_key,
                question_id: question.id.clone(),
                question_version: i64::from(question.version),
                response_json,
                result_json,
                score: grading.score,
                correct: i64::from(grading.correct),
                support_json: request.support.to_string(),
                confidence: request.confidence,
            },
            &unix_timestamp(),
        )
        .await
    {
        Ok(history) => history,
        Err(error) => {
            return service_error(
                StatusCode::CONFLICT,
                "question_persistence_failed",
                &error.to_string(),
                false,
            );
        }
    };
    // Deterministically graded questions create canonical evidence in the same
    // request that graded them, so a miss really schedules review work.
    // Self-reviewed kinds stay out of mastery/review: they are unverified
    // self-assessment, recorded only in the quiz history.
    let first_submission = history["idempotentRetry"] == false;
    if !grading.manual_self_review && first_submission {
        let support_kind = request.support["type"].as_str().unwrap_or("external_help");
        let support = match support_kind {
            "none" => serde_json::json!("none"),
            "compiler" => serde_json::json!("compiler"),
            "official_docs" => serde_json::json!("official_docs"),
            "hint" => serde_json::json!({"hint":{"level":1}}),
            _ => serde_json::json!("external_help"),
        };
        let evidence_kind = match question.kind {
            question::QuestionKind::PredictOutput => "trace",
            question::QuestionKind::IdentifyCompilerError
            | question::QuestionKind::DebuggingDecision => "debug",
            question::QuestionKind::FillMissingCode => "implement",
            _ => "recall",
        };
        let concepts: Vec<&str> = question
            .outcome_ids
            .iter()
            .filter_map(|outcome_id| {
                state
                    .tutor_content
                    .outcomes
                    .iter()
                    .find(|outcome| outcome.id == *outcome_id)
                    .map(|outcome| outcome.concept_id.as_str())
            })
            .collect();
        let ids = EventIds::new();
        let events: Vec<db::NewAttemptEvent> = concepts
            .iter()
            .enumerate()
            .map(|(index, concept_id)| {
                ids.event(
                    i64::try_from(index).expect("question concept index fits i64"),
                    "assessment_scored",
                    serde_json::json!({
                        "conceptId":concept_id,
                        "score":grading.score,
                        "itemId":question.id,
                        "variantGroup":format!("VG-QUIZ-{}", question.id),
                        "kind":evidence_kind,
                        "support":support,
                        "day":current_day(),
                        "criticalMisconception":false,
                        "primaryOutcome":true
                    }),
                )
            })
            .collect();
        if !events.is_empty() {
            let session = db::NewSession {
                learner_id: "LEARNER-LOCAL-001".to_owned(),
                session_id: ids.session.clone(),
                attempt_id: ids.attempt.clone(),
                item_id: question.id.clone(),
                item_version: i64::from(question.version),
                started_at: ids.occurred_at.clone(),
                run_id: ids.run.clone(),
                request_id: ids.request.clone(),
            };
            if let Err(error) = database
                .record_attempt_bundle(&session, "evaluated", &events, None, "mastery-v1")
                .await
            {
                return service_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "question_evidence_failed",
                    &error.to_string(),
                    false,
                );
            }
        }
    }
    Json(serde_json::json!({
        "result":grading,
        "history":history,
        "lessonId":question.lesson_id,
        "conceptMappings":question.outcome_ids,
        "selfAssessed":grading.manual_self_review,
        "reviewRecommendation":{
            "added":grading.review_additions,
            "deduplicated":true,
            "persisted":!grading.manual_self_review,
            "ordering":"canonical outcome order"
        }
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
struct CatalogQuery {
    kind: Option<String>,
    prefix: Option<String>,
    limit: Option<usize>,
}

async fn catalog(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CatalogQuery>,
) -> Response {
    let kind = query.kind.as_deref().unwrap_or("exercise");
    if ![
        "concept",
        "learning_outcome",
        "algorithm_pattern",
        "exercise",
        "project",
        "tool",
        "compiler_error",
        "resource",
    ]
    .contains(&kind)
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_catalog_kind",
            "The requested catalog kind is not exposed.",
            false,
        );
    }
    let records = state
        .graph
        .catalog(kind, query.prefix.as_deref(), query.limit.unwrap_or(100));
    // Exercises carry an explicit runnable flag: only items with a versioned
    // hidden-test acceptance contract can produce scored evidence.
    let records: Vec<serde_json::Value> = records
        .into_iter()
        .map(|record| {
            let mut value = serde_json::to_value(&record).expect("catalog record JSON");
            if record.kind == "exercise" {
                value["runnable"] =
                    serde_json::Value::Bool(evaluator::has_test_contract(&record.id));
            }
            value
        })
        .collect();
    Json(serde_json::json!({
        "releaseId":state.graph.release_id,
        "kind":kind,
        "count":records.len(),
        "records":records
    }))
    .into_response()
}

async fn curriculum(State(state): State<Arc<AppState>>) -> Response {
    Json(state.graph.curriculum()).into_response()
}

async fn project_detail(
    State(state): State<Arc<AppState>>,
    AxumPath(project_id): AxumPath<String>,
) -> Response {
    match state.graph.project_detail(&project_id) {
        Ok(project) => Json(project).into_response(),
        Err(error) => service_error(StatusCode::NOT_FOUND, "project_not_found", &error, false),
    }
}

async fn project_checkpoints(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(project_id): AxumPath<String>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if state.graph.node(&project_id).is_none() {
        return service_error(
            StatusCode::NOT_FOUND,
            "project_not_found",
            "The project is not released.",
            false,
        );
    }
    match database
        .project_checkpoints("LEARNER-LOCAL-001", &project_id)
        .await
    {
        Ok(checkpoints) => {
            Json(serde_json::json!({"projectId":project_id,"checkpoints":checkpoints}))
                .into_response()
        }
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "checkpoint_query_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectCheckpointRequest {
    stage_id: String,
    parent_checkpoint_id: Option<String>,
    workspace_checksum: String,
    status: String,
    evaluator_run_id: Option<String>,
    regressions: serde_json::Value,
}

async fn project_checkpoint_create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(project_id): AxumPath<String>,
    Json(request): Json<ProjectCheckpointRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let project_valid = state
        .graph
        .node(&project_id)
        .is_some_and(|node| node.kind == "project");
    let stage_belongs = state.graph.edges.iter().any(|edge| {
        edge.kind == "part_of" && edge.source_id == request.stage_id && edge.target_id == project_id
    });
    if !project_valid
        || !stage_belongs
        || !["starter", "saved", "submitted", "accepted"].contains(&request.status.as_str())
        || request.workspace_checksum.len() != 64
        || !request
            .workspace_checksum
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || !request.regressions.is_array()
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_checkpoint",
            "A released project, one of its own stages, a SHA-256 workspace checksum, an allowed status, and a regression list are required.",
            false,
        );
    }
    // Submitted/accepted checkpoints are server-derived: the named run must be a
    // persisted hidden-test run of this stage, and an accepted checkpoint must
    // match that run's result and workspace checksum exactly.
    if ["submitted", "accepted"].contains(&request.status.as_str()) {
        let Some(run_id) = request.evaluator_run_id.as_deref() else {
            return service_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "checkpoint_run_required",
                "Submitted and accepted checkpoints require the stage's persisted evaluator run.",
                false,
            );
        };
        let run = match verified_completed_run(database, run_id, &request.stage_id, "test").await {
            Ok(run) => run,
            Err(response) => return response,
        };
        if request.status == "accepted"
            && (run["result"]["status"] != "ACCEPTED"
                || run["workspaceChecksum"].as_str()
                    != Some(request.workspace_checksum.to_ascii_lowercase().as_str()))
        {
            return service_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "checkpoint_evidence_rejected",
                "Accepted checkpoints must match an accepted run and its exact workspace checksum.",
                false,
            );
        }
    }
    match database
        .create_project_checkpoint(
            "LEARNER-LOCAL-001",
            &format!("CHECKPOINT-{}", random_hex()),
            &db::NewProjectCheckpoint {
                project_id,
                stage_id: request.stage_id,
                parent_checkpoint_id: request.parent_checkpoint_id,
                workspace_checksum: request.workspace_checksum.to_ascii_lowercase(),
                status: request.status,
                evaluator_run_id: request.evaluator_run_id,
                regression_json: request.regressions.to_string(),
            },
            &unix_timestamp(),
        )
        .await
    {
        Ok(checkpoint) => Json(checkpoint).into_response(),
        Err(error) => service_error(
            StatusCode::CONFLICT,
            "checkpoint_write_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn project_portfolio(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(project_id): AxumPath<String>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let project = match state.graph.project_detail(&project_id) {
        Ok(project) => project,
        Err(error) => {
            return service_error(StatusCode::NOT_FOUND, "project_not_found", &error, false);
        }
    };
    match database
        .project_portfolio_evidence("LEARNER-LOCAL-001", &project_id)
        .await
    {
        Ok(evidence) => {
            Json(serde_json::json!({"project":project,"evidence":evidence})).into_response()
        }
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "portfolio_export_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn run_systems_lab(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(scenario): AxumPath<String>,
    Json(request): Json<systems_lab::LabRequest>,
) -> Response {
    if authenticated_database(&state, &headers).is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let kind =
        serde_json::from_value::<systems_lab::ScenarioKind>(serde_json::Value::String(scenario));
    let Ok(kind) = kind else {
        return service_error(
            StatusCode::NOT_FOUND,
            "systems_lab_not_found",
            "The requested deterministic systems scenario is not released.",
            false,
        );
    };
    match systems_lab::run(kind, &request) {
        Ok(report) => Json(report).into_response(),
        Err(error) => service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "systems_lab_commitment_required",
            error,
            false,
        ),
    }
}

async fn compare_sql(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<systems_lab::SqlComparison>,
) -> Response {
    if authenticated_database(&state, &headers).is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(serde_json::json!({
        "accepted":systems_lab::compare_sql(&request),
        "ordered":request.ordered,
        "numericTolerance":request.numeric_tolerance,
        "nullSemantics":"JSON null compares only with null",
        "datasets":1
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JournalRequest {
    kind: String,
    title: String,
    body: String,
    project_id: Option<String>,
    concept_id: Option<String>,
    error_id: Option<String>,
    support: serde_json::Value,
    confidence: Option<i64>,
    reattempt_day: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalQuery {
    q: Option<String>,
    project_id: Option<String>,
    concept_id: Option<String>,
    error_id: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    limit: Option<usize>,
}

async fn journal_list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<JournalQuery>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    match database
        .journal_entries(
            "LEARNER-LOCAL-001",
            query.q.as_deref(),
            query.project_id.as_deref(),
            query.concept_id.as_deref(),
            query.error_id.as_deref(),
            query.from,
            query.to,
            query.limit.unwrap_or(50),
        )
        .await
    {
        Ok(entries) => Json(serde_json::json!({"entries":entries})).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "journal_query_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn journal_create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<JournalRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if request.title.trim().is_empty()
        || request.body.trim().is_empty()
        || request
            .confidence
            .is_some_and(|value| !(1..=5).contains(&value))
        || request.reattempt_day.is_some_and(|value| value < 0)
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_journal_entry",
            "Title, body, and bounded confidence/reattempt values are required.",
            false,
        );
    }
    match database
        .create_journal_entry(
            "LEARNER-LOCAL-001",
            &format!("JOURNAL-{}", random_hex()),
            &db::NewJournalEntry {
                kind: request.kind,
                title: request.title,
                body: request.body,
                project_id: request.project_id,
                concept_id: request.concept_id,
                error_id: request.error_id,
                support_json: request.support.to_string(),
                confidence: request.confidence,
                reattempt_day: request.reattempt_day,
            },
            &unix_timestamp(),
        )
        .await
    {
        Ok(entry) => Json(entry).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "journal_write_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ErrorRecordRequest {
    code: String,
    root_cause: String,
    correction: String,
    future_cue: String,
    concept_ids: Vec<String>,
    attempt_id: Option<String>,
    evaluator_run_id: Option<String>,
}

async fn errors_list(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    match database.error_catalog("LEARNER-LOCAL-001").await {
        Ok(errors) => Json(serde_json::json!({"errors":errors})).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "error_catalog_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn errors_create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ErrorRecordRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if request.code.trim().is_empty()
        || request.root_cause.trim().is_empty()
        || request.correction.trim().is_empty()
        || request.future_cue.trim().is_empty()
        || request
            .concept_ids
            .iter()
            .any(|id| state.graph.node(id).is_none())
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_error_record",
            "Code, cause, correction, future cue, and canonical concept links are required.",
            false,
        );
    }
    match database
        .record_error(
            "LEARNER-LOCAL-001",
            &format!("ERROR-{}", random_hex()),
            &format!("OCCURRENCE-{}", random_hex()),
            &db::NewErrorRecord {
                code: request.code,
                root_cause: request.root_cause,
                correction: request.correction,
                future_cue: request.future_cue,
                concept_ids_json: serde_json::to_string(&request.concept_ids)
                    .expect("concept IDs JSON"),
                attempt_id: request.attempt_id,
                evaluator_run_id: request.evaluator_run_id,
            },
            &unix_timestamp(),
        )
        .await
    {
        Ok(error) => Json(error).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "error_catalog_write_failed",
            &error.to_string(),
            false,
        ),
    }
}

const ARTIFACT_KINDS: [&str; 6] = [
    "design_decision",
    "test_plan",
    "benchmark",
    "postmortem",
    "release_proof",
    "threat_model",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectArtifactRequest {
    project_id: String,
    stage_id: String,
    kind: String,
    pasted_text: String,
}

async fn project_artifact_register(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ProjectArtifactRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let project_valid = state
        .graph
        .node(&request.project_id)
        .is_some_and(|node| node.kind == "project");
    let stage_belongs = state.graph.edges.iter().any(|edge| {
        edge.kind == "part_of"
            && edge.source_id == request.stage_id
            && edge.target_id == request.project_id
    });
    if !project_valid
        || !stage_belongs
        || !ARTIFACT_KINDS.contains(&request.kind.as_str())
        || request.pasted_text.trim().is_empty()
        || request.pasted_text.len() > 200_000
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_project_artifact",
            "A released project, one of its own stages, an allowed evidence kind, and bounded pasted text are required.",
            false,
        );
    }
    // The evidence checksum is derived here from the submitted text; a
    // client-claimed checksum is never trusted.
    let checksum = format!("{:x}", Sha256::digest(request.pasted_text.as_bytes()));
    match database
        .register_project_artifact(
            "LEARNER-LOCAL-001",
            &format!("REGISTRATION-{}", random_hex()),
            &db::NewProjectArtifact {
                project_id: request.project_id,
                stage_id: request.stage_id,
                kind: request.kind,
                local_path: None,
                pasted_text: Some(request.pasted_text),
                checksum,
            },
            &unix_timestamp(),
        )
        .await
    {
        Ok(artifact) => Json(artifact).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "project_artifact_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FocusRequest {
    mode: String,
    intention: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExternalBookmarkRequest {
    platform: String,
    url_or_id: String,
    local_exercise_id: Option<String>,
    pattern_id: Option<String>,
    status: String,
    notes: String,
    support: serde_json::Value,
    confidence: Option<i64>,
    reattempt_day: Option<i64>,
}

async fn external_bookmark_create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ExternalBookmarkRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if request.platform.trim().is_empty()
        || request.url_or_id.trim().is_empty()
        || request.url_or_id.len() > 2048
        || request.notes.len() > 20_000
        || request
            .confidence
            .is_some_and(|value| !(1..=5).contains(&value))
        || request.reattempt_day.is_some_and(|value| value < 0)
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_external_bookmark",
            "Bounded platform/URL-or-ID, reflection, support, confidence, and reattempt metadata are required.",
            false,
        );
    }
    match database
        .save_external_bookmark(
            "LEARNER-LOCAL-001",
            &format!("BOOKMARK-{}", random_hex()),
            &request.platform,
            &request.url_or_id,
            request.local_exercise_id.as_deref(),
            request.pattern_id.as_deref(),
            &request.status,
            &request.notes,
            &request.support.to_string(),
            request.confidence,
            request.reattempt_day,
            &unix_timestamp(),
        )
        .await
    {
        Ok(saved) => Json(saved).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "external_bookmark_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn focus_start(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<FocusRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if !["standard", "deep_work", "llm_free"].contains(&request.mode.as_str())
        || request.intention.trim().is_empty()
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_focus_session",
            "A supported mode and intention are required.",
            false,
        );
    }
    match database
        .start_focus_session(
            "LEARNER-LOCAL-001",
            &format!("FOCUS-{}", random_hex()),
            &request.mode,
            &request.intention,
            &unix_timestamp(),
        )
        .await
    {
        Ok(session) => Json(session).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "focus_session_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FocusFinishRequest {
    interruption_notes: Vec<String>,
    end_review: String,
}

async fn focus_finish(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<FocusFinishRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    if request.end_review.trim().is_empty()
        || request.end_review.len() > 20_000
        || request.interruption_notes.len() > 100
        || request
            .interruption_notes
            .iter()
            .any(|note| note.len() > 2_000)
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_focus_review",
            "A bounded end review and optional bounded interruption notes are required.",
            false,
        );
    }
    match database
        .finish_focus_session(
            "LEARNER-LOCAL-001",
            &session_id,
            &request.interruption_notes,
            &request.end_review,
            &unix_timestamp(),
        )
        .await
    {
        Ok(session) => Json(session).into_response(),
        Err(error) => service_error(
            StatusCode::CONFLICT,
            "focus_finish_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn hint_dependence(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    match database.hint_dependence("LEARNER-LOCAL-001").await {
        Ok(result) => Json(result).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "hint_dependence_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn exam_blueprint(State(state): State<Arc<AppState>>) -> Response {
    Json(state.exam.as_ref().clone()).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenExamRequest {
    #[serde(default)]
    retake: bool,
}

async fn open_exam_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<OpenExamRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    match database
        .open_exam_session(
            "LEARNER-LOCAL-001",
            &format!("EXAM-SESSION-{}", random_hex()),
            &state.exam,
            request.retake,
            &unix_timestamp(),
        )
        .await
    {
        Ok(session) => Json(session).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "exam_session_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn save_exam_answer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath((session_id, item_id)): AxumPath<(String, String)>,
    Json(answer): Json<exam::ExamAnswer>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let Some(item) = state.exam.items.iter().find(|item| item.id == item_id) else {
        return service_error(
            StatusCode::NOT_FOUND,
            "exam_item_not_found",
            "The versioned exam item does not exist.",
            false,
        );
    };
    if answer.answer_index >= item.choices.len()
        || ([
            "debugging_decision",
            "system_design",
            "observability_diagnosis",
        ]
        .contains(&item.format.as_str())
            && answer.commitment.trim().is_empty())
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "exam_commitment_required",
            "Choose a valid answer and commit reasoning for decision/design items.",
            false,
        );
    }
    match database
        .save_exam_answer("LEARNER-LOCAL-001", &session_id, &item_id, &answer)
        .await
    {
        Ok(saved) => Json(saved).into_response(),
        Err(error) => service_error(
            StatusCode::CONFLICT,
            "exam_answer_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn finish_exam_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(session_id): AxumPath<String>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let answers = match database
        .exam_answers("LEARNER-LOCAL-001", &session_id)
        .await
    {
        Ok(answers) => answers,
        Err(error) => {
            return service_error(
                StatusCode::CONFLICT,
                "exam_finish_failed",
                &error.to_string(),
                false,
            );
        }
    };
    if answers.len() != state.exam.items.len() {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "exam_incomplete",
            "All 15 scored categories must be answered before final submission.",
            false,
        );
    }
    let result = state.exam.score(&answers);
    if let Err(error) = database
        .finish_exam_session("LEARNER-LOCAL-001", &session_id, &result, &unix_timestamp())
        .await
    {
        return service_error(
            StatusCode::CONFLICT,
            "exam_finish_failed",
            &error.to_string(),
            false,
        );
    }
    // Missed categories become canonical failed evidence so the review queue
    // actually schedules the promised remediation work.
    let missed: Vec<&serde_json::Value> = result["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entry| entry["correct"] == false)
        .collect();
    if !missed.is_empty() {
        let ids = EventIds::new();
        let events: Vec<db::NewAttemptEvent> = missed
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                ids.event(
                    i64::try_from(index).expect("exam remediation index fits i64"),
                    "assessment_scored",
                    serde_json::json!({
                        "conceptId":entry["outcomeId"],
                        "score":0.0,
                        "itemId":entry["itemId"],
                        "variantGroup":format!("VG-EXAM-{}", state.exam.form_id),
                        "kind":"recall",
                        "support":"none",
                        "day":current_day(),
                        "criticalMisconception":false,
                        "primaryOutcome":true
                    }),
                )
            })
            .collect();
        let session = db::NewSession {
            learner_id: "LEARNER-LOCAL-001".to_owned(),
            session_id: ids.session.clone(),
            attempt_id: ids.attempt.clone(),
            item_id: session_id.clone(),
            item_version: 1,
            started_at: ids.occurred_at.clone(),
            run_id: ids.run.clone(),
            request_id: ids.request.clone(),
        };
        if let Err(error) = database
            .record_attempt_bundle(&session, "evaluated", &events, None, "mastery-v1")
            .await
        {
            return service_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "exam_remediation_failed",
                &error.to_string(),
                false,
            );
        }
    }
    Json(serde_json::json!({"sessionId":session_id,"result":result})).into_response()
}

async fn data_export(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    match database.portable_export("LEARNER-LOCAL-001").await {
        Ok(archive) => Json(archive).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "export_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn dashboard_snapshot(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let total_outcomes = state
        .graph
        .nodes
        .iter()
        .filter(|node| node.kind == "learning_outcome")
        .count();
    match database
        .dashboard_snapshot("LEARNER-LOCAL-001", total_outcomes, current_day())
        .await
    {
        Ok(snapshot) => Json(snapshot).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "dashboard_query_failed",
            &error.to_string(),
            false,
        ),
    }
}

async fn data_backup(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let database_path = match db::default_database_path() {
        Ok(path) => path,
        Err(error) => {
            return service_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backup_path_failed",
                &error.to_string(),
                false,
            );
        }
    };
    let target = database_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("backups")
        .join(format!("rust-tutor-{}.sqlite3", random_hex()));
    match database.consistent_backup(&target).await {
        Ok(backup) => Json(backup).into_response(),
        Err(error) => service_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backup_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportRequest {
    archive: serde_json::Value,
    mode: String,
    confirmation: Option<String>,
    expected_checksum: Option<String>,
}

async fn data_import_validate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ImportRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let validation = match data_lifecycle::validate_portable_archive(&request.archive) {
        Ok(summary) => summary,
        Err(error) => {
            return service_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_import_archive",
                &error,
                false,
            );
        }
    };
    if request.mode == "dry_run" {
        // The dry run executes the complete apply — inserts, conflict checks,
        // and referential integrity — inside a rolled-back transaction.
        return match database
            .apply_portable_import(&request.archive, db::ImportMode::DryRun)
            .await
        {
            Ok(report) => Json(report).into_response(),
            Err(error) => service_error(
                StatusCode::CONFLICT,
                "import_dry_run_failed",
                &error.to_string(),
                false,
            ),
        };
    }
    if request.mode != "apply"
        || request.confirmation.as_deref() != Some("APPLY VERIFIED IMPORT")
        || request.expected_checksum.as_deref() != validation["checksumSha256"].as_str()
    {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "import_confirmation_required",
            "Apply requires the dry-run checksum and the exact confirmation phrase APPLY VERIFIED IMPORT.",
            false,
        );
    }
    let database_path = match db::default_database_path() {
        Ok(path) => path,
        Err(error) => {
            return service_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backup_path_failed",
                &error.to_string(),
                false,
            );
        }
    };
    let backup_target = database_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("backups")
        .join(format!("before-import-{}.sqlite3", random_hex()));
    let backup = match database.consistent_backup(&backup_target).await {
        Ok(backup) => backup,
        Err(error) => {
            return service_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "pre_import_backup_failed",
                &error.to_string(),
                false,
            );
        }
    };
    // Rows, projection rebuild, and the append-only ledger commit in one
    // transaction inside apply_portable_import.
    match database
        .apply_portable_import(
            &request.archive,
            db::ImportMode::Apply {
                backup_checksum: backup["checksumSha256"].as_str().unwrap_or_default(),
                now: &unix_timestamp(),
            },
        )
        .await
    {
        Ok(applied) => {
            let ledger = applied["ledger"].clone();
            Json(serde_json::json!({"backup":backup,"apply":applied,"ledger":ledger}))
                .into_response()
        }
        Err(error) => service_error(
            StatusCode::CONFLICT,
            "import_apply_failed",
            &error.to_string(),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResetRequest {
    scope: String,
    target_id: Option<String>,
    confirmation: String,
}

async fn data_reset(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ResetRequest>,
) -> Response {
    let database = match authenticated_database(&state, &headers) {
        Ok(database) => database,
        Err(response) => return response,
    };
    let valid_scope = ["module", "lesson", "all_progress"].contains(&request.scope.as_str());
    let target_valid = (request.scope == "all_progress" && request.target_id.is_none())
        || (request.scope != "all_progress"
            && request
                .target_id
                .as_ref()
                .is_some_and(|id| !id.trim().is_empty()));
    let expected = format!("RESET {}", request.scope.to_ascii_uppercase());
    if !valid_scope || !target_valid || request.confirmation != expected {
        return service_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reset_confirmation_required",
            &format!(
                "Name a valid scope/target and type {expected}. A verified backup is created first; audit rows are preserved."
            ),
            false,
        );
    }
    // Resolve a scoped reset to the item IDs the baseline filter will exclude.
    let item_ids: Vec<String> = match request.scope.as_str() {
        "lesson" => {
            let target = request.target_id.as_deref().unwrap_or_default();
            if state.tutor_content.lesson.id != target {
                return service_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "reset_target_unknown",
                    "The lesson target is not part of the active content release.",
                    false,
                );
            }
            std::iter::once(target.to_owned())
                .chain(
                    state
                        .tutor_content
                        .exercises
                        .iter()
                        .map(|exercise| exercise.id.clone()),
                )
                .collect()
        }
        "module" => {
            let target = request.target_id.as_deref().unwrap_or_default();
            let curriculum = state.graph.curriculum();
            let Some(module) = curriculum["modules"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|module| module["id"].as_str() == Some(target))
            else {
                return service_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "reset_target_unknown",
                    "The module target is not part of the released curriculum.",
                    false,
                );
            };
            module["records"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|record| record["id"].as_str().map(str::to_owned))
                .collect()
        }
        _ => Vec::new(),
    };
    let database_path = match db::default_database_path() {
        Ok(path) => path,
        Err(error) => {
            return service_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backup_path_failed",
                &error.to_string(),
                false,
            );
        }
    };
    let backup_target = database_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("backups")
        .join(format!("before-reset-{}.sqlite3", random_hex()));
    let backup = match database.consistent_backup(&backup_target).await {
        Ok(backup) => backup,
        Err(error) => {
            return service_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "pre_reset_backup_failed",
                &error.to_string(),
                false,
            );
        }
    };
    let checksum = backup["checksumSha256"].as_str().unwrap_or_default();
    match database
        .apply_reset(
            "LEARNER-LOCAL-001",
            &format!("RESET-{}", random_hex()),
            &request.scope,
            request.target_id.as_deref(),
            &item_ids,
            checksum,
            &unix_timestamp(),
        )
        .await
    {
        Ok(reset) => Json(serde_json::json!({"backup":backup,"reset":reset})).into_response(),
        Err(error) => service_error(
            StatusCode::CONFLICT,
            "reset_failed",
            &error.to_string(),
            false,
        ),
    }
}

struct EventIds {
    session: String,
    attempt: String,
    run: String,
    request: String,
    occurred_at: String,
}

impl EventIds {
    fn new() -> Self {
        let suffix = random_hex();
        Self {
            session: format!("SESSION-{suffix}"),
            attempt: format!("ATTEMPT-{suffix}"),
            run: format!("RUN-{suffix}"),
            request: format!("REQ-{suffix}"),
            occurred_at: unix_timestamp(),
        }
    }

    fn event(&self, sequence: i64, kind: &str, payload: serde_json::Value) -> db::NewAttemptEvent {
        db::NewAttemptEvent {
            event_id: format!("EVENT-{}-{sequence}", self.attempt),
            attempt_id: self.attempt.clone(),
            sequence,
            idempotency_key: format!("IDEMP-{}-{sequence}", self.attempt),
            kind: kind.to_owned(),
            payload_json: payload.to_string(),
            occurred_at: self.occurred_at.clone(),
            run_id: self.run.clone(),
            request_id: self.request.clone(),
        }
    }
}

fn random_hex() -> String {
    let mut bytes = [0_u8; 12];
    getrandom::fill(&mut bytes).expect("operating system random source");
    hex(&bytes).to_ascii_uppercase()
}

fn unix_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time after epoch")
        .as_secs()
        .to_string()
}

fn current_day() -> u32 {
    u32::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time after epoch")
            .as_secs()
            / 86_400,
    )
    .unwrap_or(u32::MAX)
}

fn service_error(
    status: StatusCode,
    code: &'static str,
    message: &str,
    retryable: bool,
) -> Response {
    (
        status,
        Json(serde_json::json!({
            "code": code,
            "message": message,
            "details": {},
            "request_id": "REQ-SERVICE",
            "retryable": retryable
        })),
    )
        .into_response()
}

/// `localhost` and `127.0.0.1` are the same loopback interface; browsers treat
/// them as distinct origins, so accept whichever spelling the learner typed.
fn loopback_twin(value: &str) -> String {
    if value.contains("127.0.0.1") {
        value.replace("127.0.0.1", "localhost")
    } else {
        value.replace("localhost", "127.0.0.1")
    }
}

fn origin_matches(headers: &HeaderMap, expected: &str) -> bool {
    headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == expected || value == loopback_twin(expected))
}

fn request_origin_allowed(headers: &HeaderMap, expected: &str) -> bool {
    if headers.contains_key(header::ORIGIN) {
        return origin_matches(headers, expected);
    }
    headers
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok())
        == Some("same-origin")
}

async fn request_guard(
    State(state): State<Arc<AppState>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let expected_host = state
        .allowed_origin
        .strip_prefix("http://")
        .unwrap_or(&state.allowed_origin);
    if request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| {
            host != expected_host
                && host != loopback_twin(expected_host)
                && host != state.bind_host
                && host != loopback_twin(&state.bind_host)
        })
    {
        return service_error(
            StatusCode::FORBIDDEN,
            "host_rejected",
            "The Host header does not match the configured loopback origin.",
            false,
        );
    }
    let mutation = !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    if request.uri().path().starts_with("/api/") && mutation {
        if request
            .headers()
            .get("x-rust-tutor-mutation")
            .and_then(|value| value.to_str().ok())
            != Some("1")
        {
            return service_error(
                StatusCode::FORBIDDEN,
                "mutation_header_required",
                "Local API mutations require the explicit mutation header.",
                false,
            );
        }
        let has_body = request
            .headers()
            .get(header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<usize>().ok())
            .is_some_and(|length| length > 0);
        if has_body
            && request
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_none_or(|value| !value.starts_with("application/json"))
        {
            return service_error(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "json_content_type_required",
                "Mutation bodies must use application/json.",
                false,
            );
        }
    }
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        header::HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        header::HeaderValue::from_static("no-referrer"),
    );
    response
}

pub fn app(state: AppState, web_dist: PathBuf) -> Router {
    let shell = ServeFile::new(web_dist.join("_shell.html"));
    let static_files = ServeDir::new(web_dist).fallback(shell);
    let shared_state = Arc::new(state);
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/bootstrap", get(bootstrap))
        .route("/api/v1/about", get(about))
        .route("/api/v1/diagnostics/preview", get(diagnostics_preview))
        .route("/api/v1/content/ownership", get(tutor_content))
        .route("/api/v1/lessons/{id}", get(lesson_detail))
        .route("/api/v1/practice", get(practice_list))
        .route("/api/v1/practice/{id}", get(practice_detail))
        .route("/api/v1/practice/{id}/reveal", post(practice_reveal))
        .route("/api/v1/evaluate", post(evaluate))
        .route("/api/v1/evaluate/stream", post(evaluate_stream))
        .route(
            "/api/v1/evaluate/stream/{run_id}",
            get(evaluation_stream_recovery),
        )
        .route("/api/v1/evaluate/{run_id}/cancel", post(cancel_evaluation))
        .route("/api/v1/workbench/progress", get(workbench_progress))
        .route("/api/v1/workbench/{item_id}/accept", post(workbench_accept))
        .route("/api/v1/course/progress", get(course_progress))
        .route(
            "/api/v1/course/{chapter_id}/progress",
            post(course_progress_save),
        )
        .route("/api/v1/analyzer/complete", post(complete))
        .route("/api/v1/attempts/record", post(record_attempt))
        .route("/api/v1/mastery/{concept_id}", get(mastery_explanation))
        .route("/api/v1/evidence", get(evidence_timeline))
        .route("/api/v1/review", get(review_queue))
        .route("/api/v1/review/{concept_id}/rate", post(rate_review))
        .route(
            "/api/v1/confidence-calibration",
            get(confidence_calibration),
        )
        .route("/api/v1/recommendations", get(recommendations))
        .route("/api/v1/graph", get(graph_neighborhood))
        .route("/api/v1/graph/path", get(graph_path))
        .route("/api/v1/graph/prerequisites", get(graph_prerequisites))
        .route(
            "/api/v1/graph/misconceptions/{id}",
            get(graph_misconception),
        )
        .route("/api/v1/graph/tours", get(graph_tours))
        .route("/api/v1/graph/overlay", get(graph_overlay))
        .route("/api/v1/search", get(search))
        .route("/api/v1/catalog", get(catalog))
        .route("/api/v1/curriculum", get(curriculum))
        .route("/api/v1/questions", get(question_bank))
        .route(
            "/api/v1/questions/{question_id}/submit",
            post(question_submit),
        )
        .route("/api/v1/projects/{project_id}", get(project_detail))
        .route(
            "/api/v1/projects/{project_id}/stages/{stage_id}",
            get(project_stage_detail),
        )
        .route(
            "/api/v1/projects/{project_id}/stages/{stage_id}/workspace",
            get(project_workspace_get).post(project_workspace_save),
        )
        .route(
            "/api/v1/projects/{project_id}/stages/{stage_id}/workspace/checkpoint",
            post(project_workspace_checkpoint),
        )
        .route(
            "/api/v1/projects/{project_id}/checkpoints",
            get(project_checkpoints).post(project_checkpoint_create),
        )
        .route(
            "/api/v1/projects/{project_id}/portfolio",
            get(project_portfolio),
        )
        .route("/api/v1/labs/{scenario}/run", post(run_systems_lab))
        .route("/api/v1/labs/sql/compare", post(compare_sql))
        .route("/api/v1/journal", get(journal_list).post(journal_create))
        .route("/api/v1/errors", get(errors_list).post(errors_create))
        .route(
            "/api/v1/projects/artifacts/register",
            post(project_artifact_register),
        )
        .route("/api/v1/focus-sessions", post(focus_start))
        .route(
            "/api/v1/focus-sessions/{session_id}/finish",
            post(focus_finish),
        )
        .route("/api/v1/hint-dependence", get(hint_dependence))
        .route("/api/v1/external-practice", post(external_bookmark_create))
        .route("/api/v1/exam/blueprint", get(exam_blueprint))
        .route("/api/v1/exam/sessions", post(open_exam_session))
        .route(
            "/api/v1/exam/sessions/{session_id}/items/{item_id}",
            post(save_exam_answer),
        )
        .route(
            "/api/v1/exam/sessions/{session_id}/finish",
            post(finish_exam_session),
        )
        .route("/api/v1/data/export", get(data_export))
        .route("/api/v1/dashboard", get(dashboard_snapshot))
        .route("/api/v1/data/backup", post(data_backup))
        .route("/api/v1/data/import", post(data_import_validate))
        .route("/api/v1/data/reset", post(data_reset))
        .route("/api/v1/diagnostic/blueprint", get(diagnostic_blueprint))
        .route("/api/v1/diagnostic/sessions", post(open_diagnostic_session))
        .route(
            "/api/v1/diagnostic/sessions/{session_id}/items/{item_id}",
            post(save_diagnostic_answer),
        )
        .route(
            "/api/v1/diagnostic/sessions/{session_id}/finish",
            post(finish_diagnostic_session),
        )
        .route(
            "/api/v1/diagnostic/sessions/{session_id}/gap-override",
            post(diagnostic_gap_override),
        )
        .route(
            "/api/v1/learner-plan",
            get(learner_plan_get).post(learner_plan_save),
        )
        .route("/api/v1/session", get(session))
        .route("/api/v1/session/check", post(check_session))
        .fallback_service(static_files)
        .layer(DefaultBodyLimit::max(1_048_576))
        .layer(from_fn_with_state(shared_state.clone(), request_guard))
        .with_state(shared_state)
}

#[cfg(test)]
mod origin_tests {
    use super::is_exact_loopback_origin;

    #[test]
    fn exact_loopback_origins_are_accepted() {
        for origin in [
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "http://localhost:65535",
        ] {
            assert!(is_exact_loopback_origin(origin), "{origin}");
        }
    }

    #[test]
    fn lookalike_and_malformed_origins_are_rejected() {
        for origin in [
            "http://localhost:3000.evil.example",
            "http://localhost:3000/evil",
            "https://localhost:3000",
            "http://localhost:",
            "http://localhost:99999",
            "http://user@localhost:3000",
            "http://evil.example/http://localhost:3000",
            "http://127.0.0.2:3000",
        ] {
            assert!(!is_exact_loopback_origin(origin), "{origin}");
        }
    }
}
