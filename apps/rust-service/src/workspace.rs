use std::{
    collections::{BTreeMap, HashMap},
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};

const MAX_EDIT_BYTES: usize = 128 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileOwnership {
    Learner,
    StageReadOnly,
    ServiceHidden,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceFile {
    pub path: String,
    pub ownership: FileOwnership,
    pub starter: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceManifest {
    pub exercise_id: String,
    pub files: Vec<WorkspaceFile>,
}

impl WorkspaceManifest {
    pub fn validate(&self) -> Result<(), WorkspaceError> {
        if self.exercise_id.trim().is_empty() || self.files.is_empty() {
            return Err(WorkspaceError::Invalid(
                "exercise and files are required".into(),
            ));
        }
        let mut seen = std::collections::HashSet::new();
        for file in &self.files {
            validate_relative_source(&file.path)?;
            if !seen.insert(file.path.as_str()) {
                return Err(WorkspaceError::Invalid(format!(
                    "duplicate workspace file: {}",
                    file.path
                )));
            }
            if file.starter.len() > MAX_EDIT_BYTES {
                return Err(WorkspaceError::Invalid(format!(
                    "workspace file exceeds the edit limit: {}",
                    file.path
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub exercise_id: String,
    pub open: bool,
    pub files: Vec<FileSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    pub path: String,
    pub ownership: FileOwnership,
    pub version: u64,
    pub body: Option<String>,
    pub dirty: bool,
}

#[derive(Debug)]
struct FileState {
    ownership: FileOwnership,
    starter: String,
    saved: String,
    draft: String,
    version: u64,
}

#[derive(Debug)]
pub struct WorkspaceSession {
    root: PathBuf,
    exercise_id: String,
    open: bool,
    files: BTreeMap<String, FileState>,
}

impl WorkspaceSession {
    pub fn create(root: PathBuf, manifest: WorkspaceManifest) -> Result<Self, WorkspaceError> {
        if !root.is_absolute() {
            return Err(WorkspaceError::Invalid(
                "workspace root must be absolute".into(),
            ));
        }
        manifest.validate()?;
        let files = manifest
            .files
            .into_iter()
            .map(|file| {
                let state = FileState {
                    ownership: file.ownership,
                    starter: file.starter.clone(),
                    saved: file.starter.clone(),
                    draft: file.starter,
                    version: 1,
                };
                (file.path, state)
            })
            .collect();
        Ok(Self {
            root,
            exercise_id: manifest.exercise_id,
            open: false,
            files,
        })
    }

    pub fn open(&mut self) -> WorkspaceSnapshot {
        self.open = true;
        self.snapshot()
    }

    pub fn change(&mut self, path: &str, version: u64, body: String) -> Result<(), WorkspaceError> {
        self.require_open()?;
        validate_relative_source(path)?;
        if body.len() > MAX_EDIT_BYTES {
            return Err(WorkspaceError::Invalid(
                "edit exceeds the size limit".into(),
            ));
        }
        let file = self
            .files
            .get_mut(path)
            .ok_or_else(|| WorkspaceError::UnknownFile(path.to_owned()))?;
        if file.ownership != FileOwnership::Learner {
            return Err(WorkspaceError::ReadOnly(path.to_owned()));
        }
        if version != file.version + 1 {
            return Err(WorkspaceError::StaleVersion {
                expected: file.version + 1,
                received: version,
            });
        }
        file.draft = body;
        file.version = version;
        Ok(())
    }

    pub fn save(&mut self, path: &str) -> Result<(), WorkspaceError> {
        self.require_open()?;
        let file = self
            .files
            .get_mut(path)
            .ok_or_else(|| WorkspaceError::UnknownFile(path.to_owned()))?;
        if file.ownership != FileOwnership::Learner {
            return Err(WorkspaceError::ReadOnly(path.to_owned()));
        }
        file.saved.clone_from(&file.draft);
        Ok(())
    }

    pub fn reset_preview(&self) -> Result<HashMap<String, String>, WorkspaceError> {
        self.require_open()?;
        Ok(self
            .files
            .iter()
            .filter(|(_, file)| file.ownership == FileOwnership::Learner)
            .map(|(path, file)| (path.clone(), file.starter.clone()))
            .collect())
    }

    pub fn confirm_reset(&mut self) -> Result<(), WorkspaceError> {
        self.require_open()?;
        for file in self.files.values_mut() {
            if file.ownership == FileOwnership::Learner {
                file.saved.clone_from(&file.starter);
                file.draft.clone_from(&file.starter);
                file.version += 1;
            }
        }
        Ok(())
    }

    pub fn disclosed_bundle(&self) -> Result<BTreeMap<String, String>, WorkspaceError> {
        self.require_open()?;
        Ok(self
            .files
            .iter()
            .filter(|(_, file)| file.ownership != FileOwnership::ServiceHidden)
            .map(|(path, file)| (path.clone(), file.draft.clone()))
            .collect())
    }

    pub fn close(&mut self) {
        self.open = false;
    }

    fn require_open(&self) -> Result<(), WorkspaceError> {
        if self.open {
            Ok(())
        } else {
            Err(WorkspaceError::Closed)
        }
    }

    fn snapshot(&self) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            exercise_id: self.exercise_id.clone(),
            open: self.open,
            files: self
                .files
                .iter()
                .filter(|(_, file)| file.ownership != FileOwnership::ServiceHidden)
                .map(|(path, file)| FileSnapshot {
                    path: path.clone(),
                    ownership: file.ownership,
                    version: file.version,
                    body: Some(file.draft.clone()),
                    dirty: file.draft != file.saved,
                })
                .collect(),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

fn validate_relative_source(path: &str) -> Result<(), WorkspaceError> {
    let path = Path::new(path);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
        || !path.starts_with("src")
        || path.extension().and_then(|value| value.to_str()) != Some("rs")
    {
        return Err(WorkspaceError::Invalid(
            "workspace paths must be declared relative src/*.rs files".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
pub enum WorkspaceError {
    Closed,
    Invalid(String),
    UnknownFile(String),
    ReadOnly(String),
    StaleVersion { expected: u64, received: u64 },
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for WorkspaceError {}
