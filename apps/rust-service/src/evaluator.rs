use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::sync::{Semaphore, mpsc, watch};
use tokio::{process::Command, time::sleep};

const MAX_SOURCE_BYTES: usize = 128 * 1024;
const DEFAULT_OUTPUT_BYTES: u64 = 256 * 1024;
const DEFAULT_WORKSPACE_BYTES: u64 = 128 * 1024 * 1024;
const DEFAULT_MEMORY_KILOBYTES: u64 = 768 * 1024;

#[derive(Clone, Debug)]
pub struct Evaluator {
    temp_root: PathBuf,
    timeout: Duration,
    max_output_bytes: u64,
    max_workspace_bytes: u64,
    queue: std::sync::Arc<Semaphore>,
}

impl Evaluator {
    pub fn new(temp_root: PathBuf) -> Result<Self, EvalError> {
        if !temp_root.is_absolute() {
            return Err(EvalError::InvalidManifest(
                "evaluator temp root must be absolute".to_owned(),
            ));
        }
        fs::create_dir_all(&temp_root).map_err(EvalError::Io)?;
        sweep_stale_workspaces(&temp_root)?;
        Ok(Self {
            temp_root,
            timeout: Duration::from_secs(8),
            max_output_bytes: DEFAULT_OUTPUT_BYTES,
            max_workspace_bytes: DEFAULT_WORKSPACE_BYTES,
            queue: std::sync::Arc::new(Semaphore::new(2)),
        })
    }

    pub async fn run(&self, request: EvaluationRequest) -> Result<EvaluationResult, EvalError> {
        let (_cancel, receiver) = watch::channel(false);
        self.run_cancellable(request, receiver).await
    }

    pub async fn run_cancellable(
        &self,
        request: EvaluationRequest,
        cancelled: watch::Receiver<bool>,
    ) -> Result<EvaluationResult, EvalError> {
        self.run_with_progress(request, cancelled, None).await
    }

    pub async fn run_with_progress(
        &self,
        request: EvaluationRequest,
        mut cancelled: watch::Receiver<bool>,
        progress: Option<mpsc::Sender<OutputChunk>>,
    ) -> Result<EvaluationResult, EvalError> {
        let _permit = self
            .queue
            .clone()
            .try_acquire_owned()
            .map_err(|_| EvalError::Busy)?;
        request.validate()?;
        let workspace = self.create_workspace(&request)?;
        let result = self
            .execute(&workspace, &request, &mut cancelled, progress.as_ref())
            .await;
        let cleanup = fs::remove_dir_all(&workspace);
        match (result, cleanup) {
            (Ok(result), Ok(())) => Ok(result),
            (Err(error), _) => Err(error),
            (_, Err(error)) => Err(EvalError::Io(error)),
        }
    }

    fn create_workspace(&self, request: &EvaluationRequest) -> Result<PathBuf, EvalError> {
        let mut random = [0_u8; 12];
        getrandom::fill(&mut random).map_err(|error| EvalError::Runtime(error.to_string()))?;
        let workspace = self.temp_root.join(format!("run-{}", hex(&random)));
        fs::create_dir(&workspace).map_err(EvalError::Io)?;
        let v2_contract = crate::curriculum_v2::embedded()
            .ok()
            .and_then(|curriculum| curriculum.evaluation_contract(&request.exercise_id));
        fs::write(workspace.join("Cargo.toml"), v2_contract.as_ref().and_then(|contract| contract.manifest.as_deref()).unwrap_or("[package]\nname = \"learner_exercise\"\nversion = \"0.0.0\"\nedition = \"2024\"\n\n[dependencies]\n"))
            .map_err(EvalError::Io)?;
        if let Some(contract) = &v2_contract {
            for (relative, body) in contract.starter_files.iter().chain(&contract.locked_files) {
                write_declared_file(&workspace, relative, body)?;
            }
            if !contract.editable_files.is_empty()
                && request.files.keys().any(|path| {
                    !contract
                        .editable_files
                        .iter()
                        .any(|pattern| path_matches(pattern, path))
                })
            {
                fs::remove_dir_all(&workspace).map_err(EvalError::Io)?;
                return Err(EvalError::InvalidManifest(
                    "learner file is not in the evaluator editable-file allowlist".to_owned(),
                ));
            }
        }
        for (relative, body) in &request.files {
            let path = workspace.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(EvalError::Io)?;
            }
            fs::write(path, body).map_err(EvalError::Io)?;
        }
        if matches!(request.action, Action::Run)
            && let Some(manifest) = v2_contract
                .as_ref()
                .and_then(|contract| contract.manifest.as_deref())
            && !manifest.contains("[[bin]]")
            && !workspace.join("src/main.rs").exists()
            && let Some(crate_name) = manifest_crate_name(manifest)
        {
            // Lib-only curriculum-v2 workspaces have no bin target, so a bare
            // `cargo run` cannot start. Synthesize a stdin -> solve() harness
            // server-side, after learner-file validation, so Run executes the
            // learner's code; Run output remains non-scorable evidence.
            fs::write(
                workspace.join("src/main.rs"),
                format!(
                    "fn main() {{\n    use std::io::Read as _;\n    let mut input = String::new();\n    std::io::stdin().read_to_string(&mut input).ok();\n    println!(\"{{}}\", {crate_name}::solve(&input));\n}}\n"
                ),
            )
            .map_err(EvalError::Io)?;
        }
        if matches!(request.action, Action::Test) {
            let Some(hidden_tests) = hidden_tests(&request.exercise_id) else {
                fs::remove_dir_all(&workspace).map_err(EvalError::Io)?;
                return Err(EvalError::InvalidManifest(format!(
                    "no versioned test contract exists for {}; a scored submission cannot run zero tests",
                    request.exercise_id
                )));
            };
            fs::create_dir_all(workspace.join("tests")).map_err(EvalError::Io)?;
            fs::write(workspace.join("tests/hidden.rs"), hidden_tests).map_err(EvalError::Io)?;
        }
        Ok(workspace)
    }

    async fn execute(
        &self,
        workspace: &Path,
        request: &EvaluationRequest,
        cancelled: &mut watch::Receiver<bool>,
        progress: Option<&mpsc::Sender<OutputChunk>>,
    ) -> Result<EvaluationResult, EvalError> {
        let (program, mut args): (&str, Vec<String>) = match request.action {
            Action::Check => (
                "cargo",
                strings(&["check", "--offline", "--message-format=json"]),
            ),
            Action::Test => (
                "cargo",
                strings(&[
                    "test",
                    "--offline",
                    "--message-format=json",
                    "--",
                    "--nocapture",
                ]),
            ),
            Action::Clippy => (
                "cargo",
                strings(&[
                    "clippy",
                    "--offline",
                    "--message-format=json",
                    "--",
                    "-D",
                    "warnings",
                ]),
            ),
            Action::FormatCheck => ("cargo", strings(&["fmt", "--", "--check"])),
            Action::FormatPreview => ("cargo", strings(&["fmt"])),
            Action::Run => ("cargo", strings(&["run", "--offline", "--quiet"])),
        };
        if matches!(request.action, Action::Run)
            && let Some(case) = &request.case
            && !case.args.is_empty()
        {
            args.push("--".to_owned());
            args.extend(case.args.clone());
        }
        let stdout_path = workspace.join(".stdout");
        let stderr_path = workspace.join(".stderr");
        let stdout = fs::File::create(&stdout_path).map_err(EvalError::Io)?;
        let stderr = fs::File::create(&stderr_path).map_err(EvalError::Io)?;
        let sandbox = sandbox_launch(program, workspace);
        let mut command = Command::new(&sandbox.program);
        command
            .args(&sandbox.prefix_args)
            .args(args)
            .current_dir(workspace)
            .env_clear()
            .env("CARGO_NET_OFFLINE", "true")
            .env("HOME", workspace)
            .env("LANG", "C")
            .env("LC_ALL", "C")
            .env("TZ", "UTC")
            .env("RUST_BACKTRACE", "0")
            .stdin(if request.case.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(stdout)
            .stderr(stderr)
            .kill_on_drop(true);
        if let Some(path) = std::env::var_os("PATH") {
            command.env("PATH", path);
        }
        for name in ["RUSTUP_HOME", "CARGO_HOME"] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            } else if let Some(home) = std::env::var_os("HOME") {
                let directory = if name == "RUSTUP_HOME" {
                    ".rustup"
                } else {
                    ".cargo"
                };
                command.env(name, PathBuf::from(home).join(directory));
            }
        }
        #[cfg(unix)]
        command.as_std_mut().process_group(0);
        let mut child = command.spawn().map_err(EvalError::Io)?;
        if let Some(case) = &request.case
            && let Some(mut stdin) = child.stdin.take()
        {
            stdin
                .write_all(case.stdin.as_bytes())
                .await
                .map_err(EvalError::Io)?;
            stdin.shutdown().await.map_err(EvalError::Io)?;
        }
        let pid = child.id();
        let started = Instant::now();
        let mut streamed_stdout = 0_u64;
        let mut streamed_stderr = 0_u64;
        let mut poll_tick = 0_u32;
        let (exit_code, forced_status) = loop {
            if let Some(status) = child.try_wait().map_err(EvalError::Io)? {
                break (status.code(), None);
            }
            poll_tick += 1;
            if let Some(progress) = progress {
                stream_growth(
                    &stderr_path,
                    &mut streamed_stderr,
                    "build",
                    workspace,
                    progress,
                )?;
                if matches!(request.action, Action::Run | Action::Test) {
                    stream_growth(
                        &stdout_path,
                        &mut streamed_stdout,
                        if matches!(request.action, Action::Run) {
                            "program"
                        } else {
                            "test"
                        },
                        workspace,
                        progress,
                    )?;
                }
            }
            let output_bytes = file_len(&stdout_path) + file_len(&stderr_path);
            let workspace_bytes = directory_size(workspace)?;
            // ponytail: RSS is sampled every ~200ms via ps; a hard rlimit would need
            // platform-specific pre_exec hooks and breaks rustc's address-space use.
            let memory_kilobytes = if poll_tick.is_multiple_of(10) {
                process_group_rss_kilobytes(pid)
            } else {
                0
            };
            let forced = if *cancelled.borrow() {
                Some(EvaluationStatus::Cancelled)
            } else if started.elapsed() > self.timeout {
                Some(EvaluationStatus::TimeLimitExceeded)
            } else if output_bytes > self.max_output_bytes {
                Some(EvaluationStatus::OutputLimitExceeded)
            } else if workspace_bytes > self.max_workspace_bytes {
                Some(EvaluationStatus::WorkspaceLimitExceeded)
            } else if memory_kilobytes > DEFAULT_MEMORY_KILOBYTES {
                Some(EvaluationStatus::MemoryLimitExceeded)
            } else {
                None
            };
            if let Some(status) = forced {
                terminate_tree(pid, &mut child).await;
                break (None, Some(status));
            }
            sleep(Duration::from_millis(20)).await;
        };
        if let Some(progress) = progress {
            stream_growth(
                &stderr_path,
                &mut streamed_stderr,
                "build",
                workspace,
                progress,
            )?;
            if matches!(request.action, Action::Run | Action::Test) {
                stream_growth(
                    &stdout_path,
                    &mut streamed_stdout,
                    if matches!(request.action, Action::Run) {
                        "program"
                    } else {
                        "test"
                    },
                    workspace,
                    progress,
                )?;
            }
        }
        let stdout = read_bounded(&stdout_path, self.max_output_bytes)?;
        let stderr_budget = self.max_output_bytes.saturating_sub(stdout.len() as u64);
        let stderr = read_bounded(&stderr_path, stderr_budget)?;
        let diagnostics = redact_hidden_diagnostics(parse_diagnostics(&stdout, workspace));
        let mut status = forced_status.unwrap_or_else(|| {
            if exit_code == Some(0) {
                EvaluationStatus::Accepted
            } else if diagnostics
                .iter()
                .any(|diagnostic| diagnostic.severity == "error")
            {
                EvaluationStatus::CompileError
            } else if matches!(request.action, Action::Test | Action::FormatCheck) {
                EvaluationStatus::WrongAnswer
            } else {
                EvaluationStatus::RuntimeError
            }
        });
        // `cargo run` carries no --message-format=json diagnostics; its stdout
        // is the learner program's own output, so JSON-parseable lines (a bare
        // number, a quoted string) must not be stripped as tool output.
        let visible_stdout = if matches!(request.action, Action::Run) {
            stdout
        } else {
            non_json_output(&stdout)
        };
        let public_stdout =
            redact_hidden_test_names(sanitize(&visible_stdout, workspace), &request.exercise_id);
        let public_stderr = sanitize(&stderr, workspace);
        if status == EvaluationStatus::Accepted
            && request
                .case
                .as_ref()
                .and_then(|case| case.expected_stdout.as_ref())
                .is_some_and(|expected| expected.trim_end() != public_stdout.trim_end())
        {
            status = EvaluationStatus::WrongAnswer;
        }
        let formatted_files = if matches!(request.action, Action::FormatPreview)
            && status == EvaluationStatus::Accepted
        {
            request
                .files
                .keys()
                .filter_map(|path| {
                    fs::read_to_string(workspace.join(path))
                        .ok()
                        .map(|body| (path.clone(), body))
                })
                .collect()
        } else {
            BTreeMap::new()
        };
        let cases = request
            .case
            .as_ref()
            .map(|case| CaseResult {
                id: case.id.clone(),
                input: case.stdin.clone(),
                expected: case.expected_stdout.clone(),
                actual: public_stdout.clone(),
                stdout: public_stdout.clone(),
                stderr: public_stderr.clone(),
                status,
                duration_ms: started.elapsed().as_millis(),
            })
            .into_iter()
            .collect();
        let mut output_chunks = Vec::new();
        if !public_stderr.is_empty() {
            output_chunks.push(OutputChunk {
                channel: "build".to_owned(),
                text: public_stderr.clone(),
            });
        }
        if !public_stdout.is_empty() {
            output_chunks.push(OutputChunk {
                channel: if matches!(request.action, Action::Run) {
                    "program"
                } else {
                    "test"
                }
                .to_owned(),
                text: public_stdout.clone(),
            });
        }
        Ok(EvaluationResult {
            run_id: request
                .run_id
                .clone()
                .unwrap_or_else(|| "RUN-EVALUATOR-UNSPECIFIED".to_owned()),
            status,
            exit_code,
            duration_ms: started.elapsed().as_millis(),
            stdout: public_stdout,
            stderr: public_stderr,
            diagnostics,
            formatted_files,
            cases,
            output_chunks,
            replay: ReplayManifest {
                action: request.action,
                content_hash: request.content_hash.clone(),
                toolchain: toolchain_versions().await,
                network: sandbox.network_claim.to_owned(),
            },
        })
    }
}

#[cfg(unix)]
use std::os::unix::process::CommandExt as _;

#[cfg(unix)]
async fn terminate_tree(pid: Option<u32>, child: &mut tokio::process::Child) {
    if let Some(pid) = pid {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .status()
            .await;
    }
    let _ = child.kill().await;
}

#[cfg(not(unix))]
async fn terminate_tree(_pid: Option<u32>, child: &mut tokio::process::Child) {
    let _ = child.kill().await;
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvaluationRequest {
    #[serde(default)]
    pub run_id: Option<String>,
    pub exercise_id: String,
    pub action: Action,
    pub files: HashMap<String, String>,
    pub content_hash: String,
    #[serde(default)]
    pub workspace_revision: Option<u64>,
    #[serde(default)]
    pub case: Option<RunCase>,
}

impl EvaluationRequest {
    fn validate(&self) -> Result<(), EvalError> {
        if self.exercise_id.is_empty() || self.content_hash.len() != 64 || self.files.is_empty() {
            return Err(EvalError::InvalidManifest(
                "exercise ID, content hash, and files are required".to_owned(),
            ));
        }
        if self.run_id.as_ref().is_some_and(|run_id| {
            run_id.is_empty()
                || !run_id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        }) {
            return Err(EvalError::InvalidManifest(
                "run ID contains unsupported characters".to_owned(),
            ));
        }
        let editable_files = crate::curriculum_v2::embedded()
            .ok()
            .and_then(|curriculum| curriculum.evaluation_contract(&self.exercise_id))
            .map(|contract| contract.editable_files);
        for (path, body) in &self.files {
            let relative = Path::new(path);
            if relative.is_absolute()
                || relative.components().any(|component| {
                    matches!(
                        component,
                        Component::ParentDir | Component::RootDir | Component::Prefix(_)
                    )
                })
                || !editable_files.as_ref().map_or_else(
                    || path.starts_with("src/") && path.ends_with(".rs"),
                    |patterns| patterns.iter().any(|pattern| path_matches(pattern, path)),
                )
                || matches!(
                    path.as_str(),
                    "build.rs" | "Cargo.toml" | "src/build.rs" | "src/Cargo.toml"
                )
                || body.len() > MAX_SOURCE_BYTES
            {
                return Err(EvalError::InvalidManifest(format!(
                    "learner file is outside the declared Rust source boundary: {path}"
                )));
            }
        }
        if let Some(case) = &self.case
            && (!matches!(self.action, Action::Run)
                || case.id.trim().is_empty()
                || case.args.len() > 16
                || case.args.iter().any(|argument| argument.len() > 256)
                || case.stdin.len() > 16 * 1024
                || case
                    .expected_stdout
                    .as_ref()
                    .is_some_and(|expected| expected.len() > 16 * 1024))
        {
            return Err(EvalError::InvalidManifest(
                "run case exceeds the structured input boundary".to_owned(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Check,
    Test,
    Clippy,
    FormatCheck,
    FormatPreview,
    Run,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunCase {
    pub id: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub stdin: String,
    #[serde(default)]
    pub expected_stdout: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationResult {
    pub run_id: String,
    pub status: EvaluationStatus,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub stdout: String,
    pub stderr: String,
    pub diagnostics: Vec<Diagnostic>,
    pub formatted_files: BTreeMap<String, String>,
    pub cases: Vec<CaseResult>,
    pub output_chunks: Vec<OutputChunk>,
    pub replay: ReplayManifest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseResult {
    pub id: String,
    pub input: String,
    pub expected: Option<String>,
    pub actual: String,
    pub stdout: String,
    pub stderr: String,
    pub status: EvaluationStatus,
    pub duration_ms: u128,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OutputChunk {
    pub channel: String,
    pub text: String,
}

fn stream_growth(
    path: &Path,
    offset: &mut u64,
    channel: &str,
    workspace: &Path,
    sender: &mpsc::Sender<OutputChunk>,
) -> Result<(), EvalError> {
    let length = file_len(path);
    if length <= *offset {
        return Ok(());
    }
    let mut file = fs::File::open(path).map_err(EvalError::Io)?;
    use std::io::Seek as _;
    file.seek(std::io::SeekFrom::Start(*offset))
        .map_err(EvalError::Io)?;
    let bounded = (length - *offset).min(64 * 1024);
    let mut bytes = vec![0_u8; usize::try_from(bounded).expect("bounded stream chunk")];
    file.read_exact(&mut bytes).map_err(EvalError::Io)?;
    // Consume only whole lines so a JSON diagnostic split across reads cannot leak
    // its tail past the line filter below; an unterminated short read waits.
    let consumed = match bytes.iter().rposition(|byte| *byte == b'\n') {
        Some(last_newline) => last_newline + 1,
        None if bounded < 64 * 1024 => return Ok(()),
        None => bytes.len(),
    };
    *offset += consumed as u64;
    // Structured --message-format=json lines can carry hidden-test file names and
    // rendered spans; only human-readable lines may stream to the client.
    let readable = String::from_utf8_lossy(&bytes[..consumed])
        .lines()
        .filter(|line| !line.trim_start().starts_with('{'))
        .collect::<Vec<_>>()
        .join("\n");
    let text = sanitize(&readable, workspace);
    if !text.is_empty() {
        // ponytail: a full or closed progress channel drops this chunk instead of
        // failing the run; the persisted final result remains authoritative.
        let _ = sender.try_send(OutputChunk {
            channel: channel.to_owned(),
            text,
        });
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvaluationStatus {
    Accepted,
    CompileError,
    RuntimeError,
    TimeLimitExceeded,
    MemoryLimitExceeded,
    WorkspaceLimitExceeded,
    OutputLimitExceeded,
    WrongAnswer,
    Cancelled,
    InfrastructureError,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: String,
    pub code: Option<String>,
    pub message: String,
    pub spans: Vec<DiagnosticSpan>,
    pub rendered: Option<String>,
    pub children: Vec<DiagnosticChild>,
    pub tool: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticChild {
    pub severity: String,
    pub message: String,
    pub rendered: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSpan {
    pub file: String,
    pub line_start: u64,
    pub line_end: u64,
    pub column_start: u64,
    pub column_end: u64,
    pub primary: bool,
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayManifest {
    pub action: Action,
    pub content_hash: String,
    pub toolchain: HashMap<String, String>,
    pub network: String,
}

fn parse_diagnostics(output: &str, workspace: &Path) -> Vec<Diagnostic> {
    output
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|value| value.get("message").cloned())
        .filter_map(|message| {
            let level = message["level"].as_str()?;
            let text = message["message"].as_str()?.to_owned();
            Some(Diagnostic {
                severity: level.to_owned(),
                code: message["code"]["code"].as_str().map(str::to_owned),
                message: text,
                spans: message["spans"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|span| DiagnosticSpan {
                        file: sanitize(span["file_name"].as_str().unwrap_or(""), workspace),
                        line_start: span["line_start"].as_u64().unwrap_or(0),
                        line_end: span["line_end"].as_u64().unwrap_or(0),
                        column_start: span["column_start"].as_u64().unwrap_or(0),
                        column_end: span["column_end"].as_u64().unwrap_or(0),
                        primary: span["is_primary"].as_bool().unwrap_or(false),
                        label: span["label"].as_str().map(str::to_owned),
                    })
                    .collect(),
                rendered: message["rendered"]
                    .as_str()
                    .map(|rendered| sanitize(rendered, workspace)),
                children: message["children"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|child| DiagnosticChild {
                        severity: child["level"].as_str().unwrap_or("note").to_owned(),
                        message: child["message"].as_str().unwrap_or("").to_owned(),
                        rendered: child["rendered"]
                            .as_str()
                            .map(|rendered| sanitize(rendered, workspace)),
                    })
                    .collect(),
                tool: "rustc",
            })
        })
        .collect()
}

fn non_json_output(value: &str) -> String {
    value
        .lines()
        .filter(|line| serde_json::from_str::<Value>(line).is_err())
        .collect::<Vec<_>>()
        .join("\n")
}

struct SandboxLaunch {
    program: String,
    prefix_args: Vec<String>,
    network_claim: &'static str,
}

/// On macOS, learner code runs under a seatbelt profile that denies all network
/// access and restricts writes to the workspace, Cargo/rustup state, and temp
/// directories. Elsewhere only `--offline` applies, and the replay manifest says so.
fn sandbox_launch(program: &str, workspace: &Path) -> SandboxLaunch {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let cargo_home = std::env::var_os("CARGO_HOME")
            .map(PathBuf::from)
            .or_else(|| home.as_ref().map(|home| home.join(".cargo")));
        let rustup_home = std::env::var_os("RUSTUP_HOME")
            .map(PathBuf::from)
            .or_else(|| home.as_ref().map(|home| home.join(".rustup")));
        let mut write_allow = format!("(subpath \"{}\")", workspace.display());
        for path in [cargo_home, rustup_home].into_iter().flatten() {
            write_allow.push_str(&format!(" (subpath \"{}\")", path.display()));
        }
        let profile = format!(
            "(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n(allow file-write* {write_allow} (subpath \"/private/var/folders\") (subpath \"/private/tmp\") (subpath \"/dev\"))\n"
        );
        if Path::new("/usr/bin/sandbox-exec").exists() {
            return SandboxLaunch {
                program: "/usr/bin/sandbox-exec".to_owned(),
                prefix_args: vec!["-p".to_owned(), profile, program.to_owned()],
                network_claim: "denied-by-macos-sandbox-profile",
            };
        }
    }
    SandboxLaunch {
        program: program.to_owned(),
        prefix_args: Vec::new(),
        network_claim: "cargo-offline-only; the learner program itself is not network-isolated",
    }
}

/// Sums resident-set kilobytes for the evaluator's process group via `ps`.
#[cfg(unix)]
fn process_group_rss_kilobytes(pid: Option<u32>) -> u64 {
    let Some(pid) = pid else { return 0 };
    let Ok(output) = std::process::Command::new("ps")
        .args(["-axo", "pgid=,rss="])
        .output()
    else {
        return 0;
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let group = fields.next()?.parse::<u32>().ok()?;
            let rss = fields.next()?.parse::<u64>().ok()?;
            (group == pid).then_some(rss)
        })
        .sum()
}

#[cfg(not(unix))]
fn process_group_rss_kilobytes(_pid: Option<u32>) -> u64 {
    0
}

/// A compile error inside the injected hidden test file must not disclose its
/// spans, labels, rendered text, or children through structured diagnostics.
fn redact_hidden_diagnostics(diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic> {
    diagnostics
        .into_iter()
        .map(|diagnostic| {
            let mentions_hidden = diagnostic
                .spans
                .iter()
                .any(|span| span.file.contains("tests/hidden"))
                || diagnostic
                    .rendered
                    .as_deref()
                    .is_some_and(|rendered| rendered.contains("tests/hidden"))
                || diagnostic.children.iter().any(|child| {
                    child.message.contains("tests/hidden")
                        || child
                            .rendered
                            .as_deref()
                            .is_some_and(|rendered| rendered.contains("tests/hidden"))
                });
            if mentions_hidden {
                Diagnostic {
                    severity: diagnostic.severity,
                    code: diagnostic.code,
                    message: "A diagnostic inside the hidden test harness was redacted.".to_owned(),
                    spans: Vec::new(),
                    rendered: None,
                    children: Vec::new(),
                    tool: diagnostic.tool,
                }
            } else {
                diagnostic
            }
        })
        .collect()
}

/// True when a versioned hidden-test acceptance contract exists for the item.
/// This is the single registry the workbench, catalog, and project surfaces use
/// to decide whether an item is executable for scored evidence.
pub fn has_test_contract(exercise_id: &str) -> bool {
    hidden_tests(exercise_id).is_some()
}

fn hidden_tests(exercise_id: &str) -> Option<String> {
    legacy_hidden_tests(exercise_id)
        .map(str::to_owned)
        .or_else(|| {
            crate::curriculum_v2::embedded()
                .ok()?
                .evaluation_contract(exercise_id)
                .map(|contract| contract.hidden_tests)
        })
}

fn legacy_hidden_tests(exercise_id: &str) -> Option<&'static str> {
    match exercise_id {
        "EX-OWNERSHIP-COMPLETION-001" => Some(
            "mod learner { include!(\"../src/main.rs\"); #[test] fn retained_owner_contract() { let value = String::from(\"rust\"); assert_eq!(measure(&value), 4); assert_eq!(value, \"rust\"); } }",
        ),
        "EX-OWNERSHIP-INDEPENDENT-001" => Some(
            "mod learner { include!(\"../src/main.rs\"); #[test] fn retained_job_owner() { let value = String::from(\"compile\"); assert_eq!(job_len(&value), 7); assert_eq!(value, \"compile\"); } }",
        ),
        "EX-OWNERSHIP-INDEPENDENT-002" => Some(
            "mod learner { include!(\"../src/main.rs\"); #[test] fn retained_table_owner() { let mut value = String::from(\"users\"); assert_eq!(table_len(&value), 5); value.push('!'); } }",
        ),
        "EX-OWNERSHIP-CSV-001" => Some(
            "mod learner { include!(\"../src/main.rs\"); #[test] fn trims_and_borrows_header() { let mut value = String::from(\" name,age \" ); assert_eq!(first_column(&mut value), \"name\"); } }",
        ),
        // From-zero course chapters with a function to implement. Each asserts
        // the learner's edit; a bare `cargo run` could pass with a stub, so
        // these chapters submit `test` instead of `run`.
        "EX-CH-FUNCTIONS-001" => Some(
            "mod learner { include!(\"../src/main.rs\"); #[test] fn current_fizzbuzz_contract() { assert_eq!(fizzbuzz(1), \"1\"); assert_eq!(fizzbuzz(3), \"Fizz\"); assert_eq!(fizzbuzz(5), \"Buzz\"); assert_eq!(fizzbuzz(15), \"FizzBuzz\"); } #[test] fn prior_multiple_boundaries() { assert_eq!(fizzbuzz(9), \"Fizz\"); assert_eq!(fizzbuzz(10), \"Buzz\"); assert_eq!(fizzbuzz(7), \"7\"); } }",
        ),
        "EX-CH-STRUCTS-001" => Some(
            "mod learner { include!(\"../src/main.rs\"); #[test] fn current_bump_increments() { let mut counter = Counter::new(\"clicks\"); counter.bump(); counter.bump(); assert_eq!(counter.count, 2); } #[test] fn prior_starts_at_zero() { let counter = Counter::new(\"x\"); assert_eq!(counter.count, 0); } }",
        ),
        "EX-CH-ENUMS-001" => Some(
            "mod learner { include!(\"../src/main.rs\"); #[test] fn current_light_durations() { assert_eq!(seconds(&Light::Red), 30); assert_eq!(seconds(&Light::Yellow), 5); assert_eq!(seconds(&Light::Green), 45); } }",
        ),
        "EX-CH-ERRORS-001" => Some(
            "mod learner { include!(\"../src/main.rs\"); #[test] fn current_halve_contract() { assert_eq!(halve(\"42\"), Ok(21)); assert!(halve(\"x\").is_err()); } #[test] fn prior_odd_rejected() { assert_eq!(halve(\"7\"), Err(\"7 is odd\".to_string())); } }",
        ),
        "EXE-ALG-CATALOG-PROBE-001" => Some(
            "mod learner { include!(\"../src/main.rs\"); #[test] fn current_exact_and_between_positions() { assert_eq!(catalog_probe(&[2,5,9,14], 9), Ok(2)); assert_eq!(catalog_probe(&[2,5,9,14], 7), Err(2)); } #[test] fn prior_empty_and_boundary_regression() { assert_eq!(catalog_probe(&[], 3), Err(0)); assert_eq!(catalog_probe(&[2,5,9], 1), Err(0)); assert_eq!(catalog_probe(&[2,5,9], 10), Err(3)); } }",
        ),
        "PRJ-PULSE-00" => Some(
            "mod learner { include!(\"../src/main.rs\"); #[test] fn current_slo_contract() { assert!(validate_slo(&Slo { availability_bps: 9_950, max_query_cost_cents: 250 }).is_ok()); assert_eq!(validate_slo(&Slo { availability_bps: 10_001, max_query_cost_cents: 250 }), Err(\"availability_bps must be at most 10000\")); } #[test] fn prior_zero_budget_regression() { assert_eq!(validate_slo(&Slo { availability_bps: 9_900, max_query_cost_cents: 0 }), Err(\"max_query_cost_cents must be positive\")); } }",
        ),
        _ => None,
    }
}

fn redact_hidden_test_names(mut output: String, exercise_id: &str) -> String {
    let names: &[&str] = match exercise_id {
        "EX-OWNERSHIP-COMPLETION-001" => &["retained_owner_contract"],
        "EX-OWNERSHIP-INDEPENDENT-001" => &["retained_job_owner"],
        "EX-OWNERSHIP-INDEPENDENT-002" => &["retained_table_owner"],
        "EX-OWNERSHIP-CSV-001" => &["trims_and_borrows_header"],
        "EX-CH-FUNCTIONS-001" => &["current_fizzbuzz_contract", "prior_multiple_boundaries"],
        "EX-CH-STRUCTS-001" => &["current_bump_increments", "prior_starts_at_zero"],
        "EX-CH-ENUMS-001" => &["current_light_durations"],
        "EX-CH-ERRORS-001" => &["current_halve_contract", "prior_odd_rejected"],
        "EXE-ALG-CATALOG-PROBE-001" => &[
            "current_exact_and_between_positions",
            "prior_empty_and_boundary_regression",
        ],
        "PRJ-PULSE-00" => &["current_slo_contract", "prior_zero_budget_regression"],
        _ => &[],
    };
    for name in names {
        output = output.replace(name, "hidden_test");
    }
    output
}

fn sanitize(value: &str, workspace: &Path) -> String {
    let mut without_path = value.replace(&workspace.to_string_lossy().to_string(), "<workspace>");
    for variable in ["HOME", "RUSTUP_HOME", "CARGO_HOME"] {
        if let Some(path) = std::env::var_os(variable) {
            let path = path.to_string_lossy();
            if !path.is_empty() {
                without_path = without_path.replace(path.as_ref(), "<host>");
            }
        }
    }
    without_path = without_path.replace("/private<workspace>", "<workspace>");
    without_path
        .chars()
        .filter(|character| {
            *character == '\n' || *character == '\t' || !character.is_ascii_control()
        })
        .collect()
}

fn write_declared_file(workspace: &Path, relative: &str, body: &str) -> Result<(), EvalError> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || body.len() > MAX_SOURCE_BYTES
        || relative == "Cargo.toml"
        || relative.starts_with("tests/hidden")
    {
        return Err(EvalError::InvalidManifest(format!(
            "invalid server-declared evaluator file: {relative}"
        )));
    }
    let path = workspace.join(relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(EvalError::Io)?;
    }
    fs::write(path, body).map_err(EvalError::Io)
}

/// Leniently reads the `name` key from a contract manifest so the synthesized
/// `cargo run` harness can call `<crate>::solve`. Returns `None` unless the
/// name is a plain identifier once `-` is mapped to `_`.
fn manifest_crate_name(manifest: &str) -> Option<String> {
    let name = manifest.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        (key.trim() == "name").then(|| value.trim().trim_matches('"').replace('-', "_"))
    })?;
    (!name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_'))
    .then_some(name)
}

fn path_matches(pattern: &str, path: &str) -> bool {
    pattern
        .split_once('*')
        .map_or(pattern == path, |(prefix, suffix)| {
            path.starts_with(prefix)
                && path.ends_with(suffix)
                && path.len() >= prefix.len() + suffix.len()
        })
}

fn sweep_stale_workspaces(temp_root: &Path) -> Result<(), EvalError> {
    if !temp_root.is_absolute() || temp_root.parent().is_none() {
        return Err(EvalError::InvalidManifest(
            "evaluator sweep root must be a resolved absolute directory".to_owned(),
        ));
    }
    for entry in fs::read_dir(temp_root).map_err(EvalError::Io)? {
        let entry = entry.map_err(EvalError::Io)?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if entry.file_type().map_err(EvalError::Io)?.is_dir()
            && name.starts_with("run-")
            && name.len() == 28
            && name[4..].bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            fs::remove_dir_all(entry.path()).map_err(EvalError::Io)?;
        }
    }
    Ok(())
}

fn file_len(path: &Path) -> u64 {
    fs::metadata(path).map_or(0, |metadata| metadata.len())
}

fn directory_size(path: &Path) -> Result<u64, EvalError> {
    fn walk(path: &Path, total: &mut u64) -> std::io::Result<()> {
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            if file_type.is_dir() {
                walk(&entry.path(), total)?;
            } else {
                match entry.metadata() {
                    Ok(metadata) => *total = total.saturating_add(metadata.len()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(error),
                }
            }
        }
        Ok(())
    }
    let mut total = 0;
    walk(path, &mut total).map_err(EvalError::Io)?;
    Ok(total)
}

fn read_bounded(path: &Path, limit: u64) -> Result<String, EvalError> {
    let file = fs::File::open(path).map_err(EvalError::Io)?;
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(EvalError::Io)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

async fn toolchain_versions() -> HashMap<String, String> {
    let mut versions = HashMap::new();
    for tool in ["cargo", "rustc", "rustfmt", "clippy-driver"] {
        let value = Command::new(tool)
            .arg("--version")
            .output()
            .await
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
            .unwrap_or_else(|| "unavailable".to_owned());
        versions.insert(tool.to_owned(), value);
    }
    versions
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scored_test_without_a_contract_is_rejected() {
        let evaluator =
            Evaluator::new(std::env::temp_dir().join("rust-tutor-evaluator-test")).unwrap();
        let mut files = HashMap::new();
        files.insert("src/main.rs".to_owned(), "fn main() {}".to_owned());
        let request = EvaluationRequest {
            run_id: Some("RUN-TEST-UNKNOWN".to_owned()),
            exercise_id: "EXE-UNKNOWN-999".to_owned(),
            action: Action::Test,
            files,
            content_hash: "a".repeat(64),
            workspace_revision: None,
            case: None,
        };
        let error = evaluator.run(request).await.unwrap_err();
        assert!(error.to_string().contains("no versioned test contract"));
    }

    #[tokio::test]
    async fn lib_only_v2_run_synthesizes_a_bin_harness() {
        let evaluator =
            Evaluator::new(std::env::temp_dir().join("rust-tutor-evaluator-run-test")).unwrap();
        let mut files = HashMap::new();
        files.insert(
            "src/lib.rs".to_owned(),
            "use std::collections::HashSet;\npub fn solve(input: &str) -> String { input.split_whitespace().filter_map(|s| s.parse::<i64>().ok()).collect::<HashSet<_>>().len().to_string() }\n".to_owned(),
        );
        let request = EvaluationRequest {
            run_id: Some("RUN-TEST-LIB-ONLY".to_owned()),
            exercise_id: "INT-ARRAYS_HASH_MAPS-001".to_owned(),
            action: Action::Run,
            files: files.clone(),
            content_hash: "a".repeat(64),
            workspace_revision: None,
            case: Some(RunCase {
                id: "custom".to_owned(),
                args: Vec::new(),
                stdin: "1 2 2 3".to_owned(),
                expected_stdout: Some("3".to_owned()),
            }),
        };
        let result = evaluator.run(request).await.unwrap();
        assert_eq!(
            result.status,
            EvaluationStatus::Accepted,
            "{}",
            result.stderr
        );
        assert!(result.stdout.contains('3'), "stdout: {}", result.stdout);
        // The Run button without a custom case feeds no stdin: solve("") -> "0".
        let bare = EvaluationRequest {
            run_id: Some("RUN-TEST-LIB-ONLY-BARE".to_owned()),
            exercise_id: "INT-ARRAYS_HASH_MAPS-001".to_owned(),
            action: Action::Run,
            files,
            content_hash: "a".repeat(64),
            workspace_revision: None,
            case: None,
        };
        let result = evaluator.run(bare).await.unwrap();
        assert_eq!(
            result.status,
            EvaluationStatus::Accepted,
            "{}",
            result.stderr
        );
        assert!(result.stdout.contains('0'), "stdout: {}", result.stdout);
    }

    #[test]
    fn hidden_test_diagnostics_are_fully_redacted() {
        let diagnostics = vec![Diagnostic {
            severity: "error".to_owned(),
            code: Some("E0425".to_owned()),
            message: "cannot find function `secret_probe`".to_owned(),
            spans: vec![DiagnosticSpan {
                file: "tests/hidden.rs".to_owned(),
                line_start: 1,
                line_end: 1,
                column_start: 1,
                column_end: 2,
                primary: true,
                label: Some("hidden assertion".to_owned()),
            }],
            rendered: Some("error in tests/hidden.rs: assert_eq!(secret, 42)".to_owned()),
            children: vec![DiagnosticChild {
                severity: "note".to_owned(),
                message: "defined in tests/hidden.rs".to_owned(),
                rendered: None,
            }],
            tool: "rustc",
        }];
        let redacted = redact_hidden_diagnostics(diagnostics);
        let diagnostic = &redacted[0];
        assert!(diagnostic.spans.is_empty());
        assert!(diagnostic.rendered.is_none());
        assert!(diagnostic.children.is_empty());
        assert!(!diagnostic.message.contains("secret"));
    }

    #[test]
    fn the_contract_registry_names_only_published_items() {
        assert!(has_test_contract("EX-OWNERSHIP-INDEPENDENT-001"));
        assert!(has_test_contract("EXE-ALG-CATALOG-PROBE-001"));
        assert!(has_test_contract("PRJ-PULSE-00"));
        assert!(!has_test_contract("EXE-ALG-BST-NEIGHBOR-001"));
    }

    #[test]
    fn every_gradeable_course_chapter_has_a_contract() {
        // Chapters whose terminal implements a function submit `test`, so each
        // must have a registered hidden-test contract or the chapter can never
        // be completed. Keep in sync with course.ts terminal exerciseId values.
        for id in [
            "EX-CH-FUNCTIONS-001",
            "EX-CH-STRUCTS-001",
            "EX-CH-ENUMS-001",
            "EX-CH-ERRORS-001",
        ] {
            assert!(has_test_contract(id), "{id} is missing a test contract");
        }
    }
}

#[derive(Debug)]
pub enum EvalError {
    Busy,
    InvalidManifest(String),
    Io(std::io::Error),
    Runtime(String),
}

impl std::fmt::Display for EvalError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy => formatter.write_str("the evaluator queue is full; retry shortly"),
            Self::InvalidManifest(message) | Self::Runtime(message) => formatter.write_str(message),
            Self::Io(error) => write!(formatter, "evaluator I/O failed: {error}"),
        }
    }
}

impl std::error::Error for EvalError {}
