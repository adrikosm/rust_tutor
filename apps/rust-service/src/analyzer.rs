use std::{collections::HashMap, path::Path, process::Stdio, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};

const MAX_MESSAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_COMPLETIONS: usize = 200;
const MAX_SOURCE_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerCapability {
    pub available: bool,
    pub compatible: bool,
    pub version: String,
    pub remediation: Option<String>,
}

pub async fn discover(rustc_release: &str) -> AnalyzerCapability {
    let output = Command::new("rust-analyzer")
        .arg("--version")
        .output()
        .await;
    let version = output
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_else(|| "unavailable".to_owned());
    let available = version != "unavailable";
    let compatible = available && version.contains(rustc_release);
    AnalyzerCapability {
        available,
        compatible,
        version,
        remediation: (!compatible).then(|| {
            if available {
                "Install rust-analyzer from the pinned Rust toolchain; compilation remains available."
            } else {
                "Run `rustup component add rust-analyzer`; compilation remains available."
            }
            .to_owned()
        }),
    }
}

pub async fn complete_source(
    exercise_id: &str,
    source: &str,
    version: u64,
    position: CompletionPosition,
) -> Result<Vec<CompletionItem>, AnalyzerError> {
    if exercise_id.is_empty()
        || !exercise_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || source.len() > MAX_SOURCE_BYTES
        || version == 0
    {
        return Err(AnalyzerError::Boundary(
            "completion request is outside the curated source boundary".into(),
        ));
    }
    let mut random = [0_u8; 12];
    getrandom::fill(&mut random).map_err(|error| AnalyzerError::Protocol(error.to_string()))?;
    let suffix = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let root = std::env::temp_dir()
        .join("rust-tutor-analyzer-v1")
        .join(format!("session-{suffix}"));
    std::fs::create_dir_all(root.join("src")).map_err(AnalyzerError::Io)?;
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname='learner_completion'\nversion='0.0.0'\nedition='2024'\n\n[dependencies]\n",
    )
    .map_err(AnalyzerError::Io)?;
    std::fs::write(root.join("src/main.rs"), source).map_err(AnalyzerError::Io)?;
    let result = async {
        let mut analyzer = AnalyzerSession::start(&root).await?;
        analyzer
            .open_document(&root, "src/main.rs", version, source)
            .await?;
        let mut items = Vec::new();
        for _ in 0..20 {
            items = analyzer
                .complete(&root, "src/main.rs", version, position.clone())
                .await?;
            if !items.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        analyzer.close().await?;
        Ok(items)
    }
    .await;
    let cleanup = std::fs::remove_dir_all(&root);
    match (result, cleanup) {
        (Ok(items), Ok(())) => Ok(items),
        (Err(error), _) => Err(error),
        (_, Err(error)) => Err(AnalyzerError::Io(error)),
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompletionPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub label: String,
    pub kind: Option<u64>,
    pub detail: Option<String>,
    pub documentation: Option<String>,
    pub insert_text: Option<String>,
    pub insert_text_format: Option<u64>,
    pub text_edit: Option<Value>,
}

pub struct AnalyzerSession {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    root_uri: String,
    documents: HashMap<String, u64>,
}

impl AnalyzerSession {
    pub async fn start(root: &Path) -> Result<Self, AnalyzerError> {
        if !root.is_absolute() || !root.is_dir() {
            return Err(AnalyzerError::Boundary(
                "analyzer root must be an existing absolute directory".into(),
            ));
        }
        let mut command = Command::new("rust-analyzer");
        command
            .current_dir(root)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        for variable in ["PATH", "RUSTUP_HOME", "CARGO_HOME"] {
            if let Some(value) = std::env::var_os(variable) {
                command.env(variable, value);
            }
        }
        let mut child = command.spawn().map_err(AnalyzerError::Io)?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AnalyzerError::Protocol("analyzer stdin unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AnalyzerError::Protocol("analyzer stdout unavailable".into()))?;
        let root_uri = file_uri(root)?;
        let mut session = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
            root_uri: root_uri.clone(),
            documents: HashMap::new(),
        };
        session
            .request(
                "initialize",
                json!({
                    "processId": null,
                    "rootUri": root_uri,
                    "workspaceFolders": [{"uri": session.root_uri, "name": "exercise"}],
                    "capabilities": {
                        "textDocument": {"completion": {"completionItem": {"snippetSupport": true}}},
                        "workspace": {"configuration": false}
                    },
                    "initializationOptions": {"checkOnSave": false, "cargo": {"allTargets": false}}
                }),
            )
            .await?;
        session.notify("initialized", json!({})).await?;
        Ok(session)
    }

    pub async fn open_document(
        &mut self,
        root: &Path,
        relative: &str,
        version: u64,
        text: &str,
    ) -> Result<(), AnalyzerError> {
        let uri = document_uri(root, relative)?;
        self.notify(
            "textDocument/didOpen",
            json!({"textDocument":{"uri":uri,"languageId":"rust","version":version,"text":text}}),
        )
        .await?;
        self.documents.insert(uri, version);
        Ok(())
    }

    pub async fn change_document(
        &mut self,
        root: &Path,
        relative: &str,
        version: u64,
        text: &str,
    ) -> Result<(), AnalyzerError> {
        let uri = document_uri(root, relative)?;
        let current = self
            .documents
            .get(&uri)
            .copied()
            .ok_or_else(|| AnalyzerError::Boundary("document is not open".into()))?;
        if version != current + 1 {
            return Err(AnalyzerError::StaleVersion {
                expected: current + 1,
                received: version,
            });
        }
        self.notify(
            "textDocument/didChange",
            json!({"textDocument":{"uri":uri,"version":version},"contentChanges":[{"text":text}]}),
        )
        .await?;
        self.documents.insert(uri, version);
        Ok(())
    }

    pub async fn complete(
        &mut self,
        root: &Path,
        relative: &str,
        version: u64,
        position: CompletionPosition,
    ) -> Result<Vec<CompletionItem>, AnalyzerError> {
        let uri = document_uri(root, relative)?;
        if self.documents.get(&uri).copied() != Some(version) {
            return Err(AnalyzerError::StaleVersion {
                expected: self.documents.get(&uri).copied().unwrap_or(0),
                received: version,
            });
        }
        let response = self
            .request(
                "textDocument/completion",
                json!({"textDocument":{"uri":uri},"position":position}),
            )
            .await?;
        normalize_completions(response.get("result").cloned().unwrap_or(Value::Null))
    }

    pub async fn close(mut self) -> Result<(), AnalyzerError> {
        let _ = self.request("shutdown", Value::Null).await;
        let _ = self.notify("exit", Value::Null).await;
        let _ = timeout(Duration::from_secs(1), self.child.wait()).await;
        if self.child.try_wait().map_err(AnalyzerError::Io)?.is_none() {
            self.child.kill().await.map_err(AnalyzerError::Io)?;
        }
        Ok(())
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), AnalyzerError> {
        write_message(
            &mut self.stdin,
            &json!({"jsonrpc":"2.0","method":method,"params":params}),
        )
        .await
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, AnalyzerError> {
        let id = self.next_id;
        self.next_id += 1;
        write_message(
            &mut self.stdin,
            &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
        )
        .await?;
        timeout(Duration::from_secs(8), async {
            loop {
                let message = read_message(&mut self.stdout).await?;
                if message.get("id").and_then(Value::as_u64) == Some(id) {
                    if let Some(error) = message.get("error") {
                        return Err(AnalyzerError::Protocol(error.to_string()));
                    }
                    return Ok(message);
                }
                if message.get("id").is_some() && message.get("method").is_some() {
                    let response_id = message["id"].clone();
                    write_message(
                        &mut self.stdin,
                        &json!({"jsonrpc":"2.0","id":response_id,"error":{"code":-32601,"message":"method disabled by Rust Tutor"}}),
                    )
                    .await?;
                }
            }
        })
        .await
        .map_err(|_| AnalyzerError::Timeout)?
    }
}

fn normalize_completions(value: Value) -> Result<Vec<CompletionItem>, AnalyzerError> {
    let items = if let Some(items) = value.as_array() {
        items
    } else {
        value
            .get("items")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    };
    if items.len() > MAX_COMPLETIONS {
        return Err(AnalyzerError::Boundary(
            "analyzer returned too many completion items".into(),
        ));
    }
    items
        .iter()
        .filter(|item| {
            item.get("additionalTextEdits")
                .and_then(Value::as_array)
                .is_none_or(Vec::is_empty)
                && item.get("command").is_none_or(Value::is_null)
        })
        .map(|item| {
            let documentation = item.get("documentation").and_then(|value| {
                value.as_str().map(str::to_owned).or_else(|| {
                    value
                        .get("value")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
            });
            Ok(CompletionItem {
                label: item
                    .get("label")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AnalyzerError::Protocol("completion label missing".into()))?
                    .to_owned(),
                kind: item.get("kind").and_then(Value::as_u64),
                detail: item
                    .get("detail")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                documentation,
                insert_text: item
                    .get("insertText")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                insert_text_format: item.get("insertTextFormat").and_then(Value::as_u64),
                text_edit: item.get("textEdit").cloned(),
            })
        })
        .collect()
}

async fn write_message(writer: &mut ChildStdin, message: &Value) -> Result<(), AnalyzerError> {
    let body =
        serde_json::to_vec(message).map_err(|error| AnalyzerError::Protocol(error.to_string()))?;
    if body.len() > MAX_MESSAGE_BYTES {
        return Err(AnalyzerError::Boundary(
            "LSP message exceeds the limit".into(),
        ));
    }
    writer
        .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
        .await
        .map_err(AnalyzerError::Io)?;
    writer.write_all(&body).await.map_err(AnalyzerError::Io)?;
    writer.flush().await.map_err(AnalyzerError::Io)
}

async fn read_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, AnalyzerError> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        if reader
            .read_line(&mut line)
            .await
            .map_err(AnalyzerError::Io)?
            == 0
        {
            return Err(AnalyzerError::Protocol("analyzer closed its output".into()));
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some(value) = line.strip_prefix("Content-Length:") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| AnalyzerError::Protocol("invalid Content-Length".into()))?,
            );
        }
    }
    let length =
        content_length.ok_or_else(|| AnalyzerError::Protocol("Content-Length missing".into()))?;
    if length > MAX_MESSAGE_BYTES {
        return Err(AnalyzerError::Boundary(
            "LSP message exceeds the limit".into(),
        ));
    }
    let mut body = vec![0; length];
    reader
        .read_exact(&mut body)
        .await
        .map_err(AnalyzerError::Io)?;
    serde_json::from_slice(&body).map_err(|error| AnalyzerError::Protocol(error.to_string()))
}

fn document_uri(root: &Path, relative: &str) -> Result<String, AnalyzerError> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
        || !relative.starts_with("src")
        || relative.extension().and_then(|value| value.to_str()) != Some("rs")
    {
        return Err(AnalyzerError::Boundary(
            "document URI is outside the curated workspace".into(),
        ));
    }
    file_uri(&root.join(relative))
}

fn file_uri(path: &Path) -> Result<String, AnalyzerError> {
    let text = path
        .to_str()
        .ok_or_else(|| AnalyzerError::Boundary("workspace path is not UTF-8".into()))?;
    let encoded = text
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect::<String>();
    Ok(format!("file://{encoded}"))
}

#[derive(Debug)]
pub enum AnalyzerError {
    Boundary(String),
    Io(std::io::Error),
    Protocol(String),
    StaleVersion { expected: u64, received: u64 },
    Timeout,
}

impl std::fmt::Display for AnalyzerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Boundary(message) | Self::Protocol(message) => formatter.write_str(message),
            Self::Io(error) => write!(formatter, "rust-analyzer I/O failed: {error}"),
            Self::StaleVersion { expected, received } => {
                write!(
                    formatter,
                    "stale document version: expected {expected}, received {received}"
                )
            }
            Self::Timeout => formatter.write_str("rust-analyzer timed out"),
        }
    }
}

impl std::error::Error for AnalyzerError {}
