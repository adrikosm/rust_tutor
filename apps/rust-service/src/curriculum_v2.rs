use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::OnceLock,
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

static EMBEDDED: OnceLock<Result<CurriculumV2, String>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Release {
    schema_version: u32,
    release_id: String,
    #[serde(default)]
    aliases: HashMap<String, String>,
    #[serde(default)]
    sources: Vec<Value>,
    #[serde(default)]
    modules: Vec<Value>,
    #[serde(default)]
    lessons: Vec<Value>,
    #[serde(default)]
    exercises: Vec<Value>,
    #[serde(default)]
    projects: Vec<Value>,
    #[serde(default)]
    stages: Vec<Value>,
    #[serde(default)]
    edges: Vec<Value>,
    #[serde(default)]
    edge_kinds: Vec<Value>,
    #[serde(flatten)]
    other: BTreeMap<String, Value>,
}

#[derive(Clone, Debug)]
pub struct CurriculumV2 {
    pub release_id: String,
    pub checksum: String,
    sources: Vec<Value>,
    modules: Vec<Value>,
    lessons: Vec<Value>,
    exercises: Vec<Value>,
    projects: Vec<Value>,
    stages: Vec<Value>,
    edges: Vec<Value>,
    edge_kinds: Vec<Value>,
    aliases: HashMap<String, String>,
    lesson_index: HashMap<String, usize>,
    exercise_index: HashMap<String, usize>,
    project_index: HashMap<String, usize>,
    stage_index: HashMap<String, usize>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PracticeQuery {
    pub family: Option<String>,
    pub module: Option<String>,
    pub lesson: Option<String>,
    pub concept: Option<String>,
    pub difficulty: Option<String>,
    pub status: Option<String>,
    pub runnable: Option<bool>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticePage {
    pub release_id: String,
    pub items: Vec<Value>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub total_pages: usize,
}

#[derive(Clone, Debug)]
pub struct EvaluationContract {
    pub manifest: Option<String>,
    pub starter_files: Vec<(String, String)>,
    pub locked_files: Vec<(String, String)>,
    pub editable_files: Vec<String>,
    pub hidden_tests: String,
}

impl CurriculumV2 {
    pub fn load_embedded() -> Result<Self, String> {
        let path = std::env::var_os("RUST_TUTOR_CURRICULUM_V2_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../content/curriculum-v2/release.json")
            });
        let body = fs::read_to_string(&path)
            .map_err(|error| format!("cannot read curriculum v2 at {}: {error}", path.display()))?;
        Self::parse(&body)
    }

    pub fn parse(body: &str) -> Result<Self, String> {
        let release: Release = serde_json::from_str(body)
            .map_err(|error| format!("invalid curriculum v2 JSON: {error}"))?;
        if release.schema_version != 2 || release.release_id.trim().is_empty() {
            return Err("curriculum v2 requires schemaVersion 2 and a releaseId".into());
        }
        let _ = release.other;
        let lesson_index = index("lesson", &release.lessons)?;
        let exercise_index = index("exercise", &release.exercises)?;
        let project_index = index("project", &release.projects)?;
        let stage_index = index("stage", &release.stages)?;
        let mut all_ids = HashSet::new();
        for collection in [
            &release.sources,
            &release.modules,
            &release.lessons,
            &release.exercises,
            &release.projects,
            &release.stages,
        ] {
            for record in collection {
                let id = string(record, "id")
                    .ok_or_else(|| "every curriculum record requires an id".to_owned())?;
                if !all_ids.insert(id.to_owned()) {
                    return Err(format!("duplicate curriculum id: {id}"));
                }
            }
        }
        for edge in &release.edges {
            let id = string(edge, "id").ok_or_else(|| "every edge requires an id".to_owned())?;
            let source =
                string(edge, "sourceId").ok_or_else(|| format!("{id} requires sourceId"))?;
            let target =
                string(edge, "targetId").ok_or_else(|| format!("{id} requires targetId"))?;
            let rationale = string(edge, "rationale").unwrap_or_default();
            if !all_ids.contains(source) || !all_ids.contains(target) || rationale.trim().is_empty()
            {
                return Err(format!("{id} is dangling or has no rationale"));
            }
        }
        validate_prerequisite_dag(&release.lessons, &lesson_index)?;
        let mut aliases = release.aliases;
        for (position, lesson) in release.lessons.iter().enumerate() {
            let id = string(lesson, "id").expect("indexed lesson");
            for alias in strings_at(lesson, "aliases") {
                if aliases.get(&alias).is_some_and(|existing| existing != id) {
                    return Err(format!("duplicate lesson alias: {alias}"));
                }
                aliases.insert(alias, id.to_owned());
            }
            debug_assert_eq!(lesson_index[id], position);
        }
        if aliases.values().any(|id| !lesson_index.contains_key(id)) {
            return Err("lesson alias points to an unknown lesson".into());
        }
        Ok(Self {
            release_id: release.release_id,
            checksum: format!("{:x}", Sha256::digest(body.as_bytes())),
            sources: release.sources,
            modules: release.modules,
            lessons: release.lessons,
            exercises: release.exercises,
            projects: release.projects,
            stages: release.stages,
            edges: release.edges,
            edge_kinds: release.edge_kinds,
            aliases,
            lesson_index,
            exercise_index,
            project_index,
            stage_index,
        })
    }

    pub fn counts(&self) -> Value {
        json!({"sources":self.sources.len(),"modules":self.modules.len(),"lessons":self.lessons.len(),"exercises":self.exercises.len(),"projects":self.projects.len(),"stages":self.stages.len(),"edges":self.edges.len()})
    }

    pub fn lesson(&self, requested: &str) -> Option<Value> {
        let canonical = self
            .aliases
            .get(requested)
            .map(String::as_str)
            .unwrap_or(requested);
        self.lesson_index
            .get(canonical)
            .map(|index| safe_lesson(&self.lessons[*index]))
    }

    pub fn exercise(&self, id: &str) -> Option<Value> {
        self.exercise_index
            .get(id)
            .map(|index| safe(&self.exercises[*index]))
    }

    pub fn practice(&self, query: &PracticeQuery) -> PracticePage {
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(25).clamp(1, 25);
        let filtered: Vec<_> = self
            .exercises
            .iter()
            .filter(|item| {
                matches_string(item, "family", query.family.as_deref())
                    && matches_string(item, "moduleId", query.module.as_deref())
                    && matches_string(item, "lessonId", query.lesson.as_deref())
                    && matches_list(item, "concepts", query.concept.as_deref())
                    && matches_string(item, "difficulty", query.difficulty.as_deref())
                    && query.status.as_deref().is_none_or(|wanted| {
                        string(item, "status")
                            .unwrap_or("not_started")
                            .eq_ignore_ascii_case(wanted)
                    })
                    && query.runnable.is_none_or(|wanted| {
                        item.get("runnable")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                            == wanted
                    })
            })
            .collect();
        let total = filtered.len();
        let total_pages = total.div_ceil(page_size);
        let items = filtered
            .into_iter()
            .skip((page - 1).saturating_mul(page_size))
            .take(page_size)
            .map(safe_summary)
            .collect();
        PracticePage {
            release_id: self.release_id.clone(),
            items,
            total,
            page,
            page_size,
            total_pages,
        }
    }

    pub fn reveal(&self, id: &str) -> Option<Value> {
        let item = self.exercises.get(*self.exercise_index.get(id)?)?;
        Some(json!({
            "exerciseId": id,
            "support": "full_reveal",
            "explanation": item.get("explanation").cloned().unwrap_or(Value::Null),
            "referenceSolution": item.get("referenceSolution").cloned().unwrap_or(Value::Null)
        }))
    }

    pub fn stage(&self, project_id: &str, stage_id: &str) -> Option<Value> {
        let project = self.projects.get(*self.project_index.get(project_id)?)?;
        let stage = self.stages.get(*self.stage_index.get(stage_id)?)?;
        (string(stage, "projectId") == Some(project_id)).then(|| {
            json!({
                "releaseId": self.release_id,
                "project": safe_summary(project),
                "stage": safe(stage)
            })
        })
    }

    pub fn evaluation_contract(&self, id: &str) -> Option<EvaluationContract> {
        let item = self
            .exercise_index
            .get(id)
            .and_then(|i| self.exercises.get(*i))
            .or_else(|| self.stage_index.get(id).and_then(|i| self.stages.get(*i)))?;
        let tests = item.get("tests")?;
        // Each test file carries its own `use solution::solve;`; concatenating
        // them into one hidden.rs would import the same name twice (E0252) and
        // could collide test-fn names. Scope each source in its own module so
        // the `#[test]` functions still run but imports and names stay isolated.
        let hidden_tests = ["hidden", "regression"]
            .into_iter()
            .flat_map(|key| test_sources(tests.get(key)))
            .enumerate()
            .map(|(index, source)| format!("mod contract_case_{index} {{\n{source}\n}}"))
            .collect::<Vec<_>>()
            .join("\n");
        if hidden_tests.trim().is_empty() {
            return None;
        }
        let starter = item.get("starter").unwrap_or(&Value::Null);
        let evaluator = item.get("evaluator").unwrap_or(&Value::Null);
        let editable_files: Vec<String> = evaluator
            .get("editableFiles")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        let mut locked_files = file_pairs(evaluator.get("lockedFiles"));
        locked_files.extend(
            file_pairs(tests.get("visible"))
                .into_iter()
                .filter(|(path, _)| !editable_files.contains(path)),
        );
        Some(EvaluationContract {
            manifest: starter
                .get("manifest")
                .and_then(Value::as_str)
                .map(str::to_owned),
            starter_files: file_pairs(starter.get("files")),
            locked_files,
            editable_files,
            hidden_tests,
        })
    }

    pub fn graph_records(&self) -> (&[Value], &[Value]) {
        (&self.edges, &self.edge_kinds)
    }
    pub fn graph_entities(&self) -> impl Iterator<Item = (&'static str, &Value)> {
        self.sources
            .iter()
            .map(|v| ("resource", v))
            .chain(self.modules.iter().map(|v| ("module", v)))
            .chain(self.lessons.iter().map(|v| ("lesson", v)))
            .chain(self.exercises.iter().map(|v| ("exercise", v)))
            .chain(self.projects.iter().map(|v| ("project", v)))
            .chain(self.stages.iter().map(|v| ("project_stage", v)))
    }
}

pub fn embedded() -> Result<&'static CurriculumV2, String> {
    EMBEDDED
        .get_or_init(CurriculumV2::load_embedded)
        .as_ref()
        .map_err(Clone::clone)
}

fn index(kind: &str, values: &[Value]) -> Result<HashMap<String, usize>, String> {
    let mut result = HashMap::new();
    for (position, value) in values.iter().enumerate() {
        let id =
            string(value, "id").ok_or_else(|| format!("{kind} at index {position} requires id"))?;
        if result.insert(id.to_owned(), position).is_some() {
            return Err(format!("duplicate {kind} id: {id}"));
        }
    }
    Ok(result)
}

fn validate_prerequisite_dag(
    lessons: &[Value],
    index: &HashMap<String, usize>,
) -> Result<(), String> {
    fn visit(
        id: &str,
        lessons: &[Value],
        index: &HashMap<String, usize>,
        visiting: &mut HashSet<String>,
        done: &mut HashSet<String>,
    ) -> Result<(), String> {
        if done.contains(id) {
            return Ok(());
        }
        if !visiting.insert(id.to_owned()) {
            return Err(format!("lesson prerequisite cycle at {id}"));
        }
        let lesson = &lessons[*index
            .get(id)
            .ok_or_else(|| format!("unknown lesson prerequisite: {id}"))?];
        for prerequisite in strings_at(lesson, "prerequisiteIds") {
            if index.contains_key(&prerequisite) {
                visit(&prerequisite, lessons, index, visiting, done)?;
            }
        }
        visiting.remove(id);
        done.insert(id.to_owned());
        Ok(())
    }
    let mut visiting = HashSet::new();
    let mut done = HashSet::new();
    for id in index.keys() {
        visit(id, lessons, index, &mut visiting, &mut done)?;
    }
    Ok(())
}

fn safe(value: &Value) -> Value {
    let mut copy = value.clone();
    strip_secrets(&mut copy);
    if let Value::Object(map) = &mut copy {
        map.remove("explanation");
    }
    copy
}
fn safe_lesson(value: &Value) -> Value {
    let mut copy = value.clone();
    strip_secrets(&mut copy);
    if let Some(checks) = copy.get_mut("recallChecks").and_then(Value::as_array_mut) {
        for check in checks {
            if let Value::Object(map) = check {
                map.remove("explanation");
            }
        }
    }
    copy
}
fn safe_summary(value: &Value) -> Value {
    let mut result = Map::new();
    for key in [
        "id",
        "family",
        "sequence",
        "title",
        "summary",
        "prompt",
        "moduleId",
        "lessonId",
        "concepts",
        "difficulty",
        "estimateMinutes",
        "runnable",
        "scored",
        "status",
        "requirement",
        "whyNow",
        "prepares",
        "projectId",
    ] {
        if let Some(value) = value.get(key) {
            result.insert(key.to_owned(), value.clone());
        }
    }
    Value::Object(result)
}
fn strip_secrets(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for key in [
                "answer",
                "answerIndex",
                "correctAnswer",
                "hidden",
                "regression",
                "hiddenTests",
                "regressionTests",
                "referenceSolution",
                "solution",
                "solutionFiles",
                "evaluator",
            ] {
                map.remove(key);
            }
            for child in map.values_mut() {
                strip_secrets(child);
            }
        }
        Value::Array(values) => {
            for child in values {
                strip_secrets(child);
            }
        }
        _ => {}
    }
}
fn string<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}
fn strings_at(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}
fn matches_string(value: &Value, key: &str, wanted: Option<&str>) -> bool {
    wanted.is_none_or(|wanted| {
        string(value, key).is_some_and(|actual| actual.eq_ignore_ascii_case(wanted))
    })
}
fn matches_list(value: &Value, key: &str, wanted: Option<&str>) -> bool {
    wanted.is_none_or(|wanted| {
        strings_at(value, key)
            .iter()
            .any(|actual| actual.eq_ignore_ascii_case(wanted))
    })
}
fn file_pairs(value: Option<&Value>) -> Vec<(String, String)> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|file| {
            Some((
                string(file, "path")?.to_owned(),
                string(file, "content")
                    .or_else(|| string(file, "body"))?
                    .to_owned(),
            ))
        })
        .collect()
}
fn test_sources(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|test| {
            test.as_str().map(str::to_owned).or_else(|| {
                string(test, "source")
                    .or_else(|| string(test, "content"))
                    .map(str::to_owned)
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> CurriculumV2 {
        CurriculumV2::parse(r#"{"schemaVersion":2,"releaseId":"v2","aliases":{"old":"L1"},"sources":[{"id":"S"}],"modules":[{"id":"M"}],"lessons":[{"id":"L1","moduleId":"M","aliases":["older"],"recallChecks":[{"prompt":"x","answerIndex":1}],"prerequisiteIds":[]}],"exercises":[{"id":"E1","family":"rust","moduleId":"M","lessonId":"L1","concepts":["ownership"],"difficulty":"easy","runnable":true,"tests":{"hidden":[{"source":"secret"}]},"explanation":{"purpose":"secret"},"referenceSolution":{"files":[]}}],"projects":[{"id":"P"}],"stages":[{"id":"T","projectId":"P","tests":{"hidden":["stage secret"]}}],"edges":[{"id":"X","sourceId":"L1","targetId":"E1","kind":"practices","rationale":"Practice it"}],"edgeKinds":[]}"#).unwrap()
    }

    #[test]
    fn safe_dtos_and_aliases() {
        let curriculum = fixture();
        let lesson = curriculum.lesson("old").unwrap();
        assert_eq!(lesson["id"], "L1");
        assert!(lesson["recallChecks"][0].get("answerIndex").is_none());
        let exercise = curriculum.exercise("E1").unwrap();
        assert!(exercise.get("tests").unwrap().get("hidden").is_none());
        assert!(exercise.get("explanation").is_none());
        assert!(exercise.get("evaluator").is_none());
        assert!(exercise.get("referenceSolution").is_none());
    }
    #[test]
    fn filtering_and_pagination_are_bounded() {
        let curriculum = fixture();
        let page = curriculum.practice(&PracticeQuery {
            family: Some("rust".into()),
            runnable: Some(true),
            page_size: Some(100),
            ..Default::default()
        });
        assert_eq!(page.total, 1);
        assert_eq!(page.page_size, 25);
    }
    #[test]
    fn evaluator_contract_remains_server_side() {
        let curriculum = fixture();
        // Each test source is scoped in its own module so concatenating several
        // files (each with `use solution::solve;`) never trips E0252.
        assert_eq!(
            curriculum.evaluation_contract("E1").unwrap().hidden_tests,
            "mod contract_case_0 {\nsecret\n}"
        );
        assert!(
            !curriculum
                .exercise("E1")
                .unwrap()
                .to_string()
                .contains("secret")
        );
    }

    #[test]
    fn concatenated_test_sources_do_not_duplicate_imports() {
        // Two sources, each importing `solve`, must land in distinct modules so
        // the merged hidden.rs compiles instead of failing with E0252.
        let curriculum = CurriculumV2::parse(
            r#"{"schemaVersion":2,"releaseId":"v2","sources":[{"id":"S"}],"modules":[{"id":"M"}],"lessons":[{"id":"L1","moduleId":"M","recallChecks":[{"prompt":"x","answerIndex":1}],"prerequisiteIds":[]}],"exercises":[{"id":"E1","family":"interview","moduleId":"M","lessonId":"L1","concepts":["ownership"],"difficulty":"easy","runnable":true,"tests":{"hidden":[{"content":"use solution::solve; #[test] fn a(){}"}],"regression":[{"content":"use solution::solve; #[test] fn b(){}"}]},"referenceSolution":{"files":[]}}],"projects":[{"id":"P"}],"stages":[{"id":"T","projectId":"P"}],"edges":[{"id":"X","sourceId":"L1","targetId":"E1","kind":"practices","rationale":"Practice it"}],"edgeKinds":[]}"#,
        )
        .unwrap();
        let hidden = curriculum.evaluation_contract("E1").unwrap().hidden_tests;
        assert!(hidden.contains("mod contract_case_0"));
        assert!(hidden.contains("mod contract_case_1"));
        assert_eq!(hidden.matches("use solution::solve").count(), 2);
        assert!(hidden.contains("fn a()") && hidden.contains("fn b()"));
    }

    #[test]
    fn embedded_release_has_the_promised_counts_and_contracts() {
        let curriculum = embedded().expect("tracked curriculum release");
        assert_eq!(curriculum.modules.len(), 21);
        assert!(curriculum.lessons.len() >= 21);
        assert_eq!(curriculum.exercises.len(), 248);
        assert_eq!(curriculum.stages.len(), 27);
        assert_eq!(
            curriculum
                .exercises
                .iter()
                .filter(|item| string(item, "family") == Some("mainmatter"))
                .count(),
            98
        );
        assert_eq!(
            curriculum
                .exercises
                .iter()
                .filter(|item| string(item, "family") == Some("interview"))
                .count(),
            150
        );
        assert!(
            curriculum
                .exercises
                .iter()
                .filter(|item| item.get("runnable").and_then(Value::as_bool) == Some(true))
                .all(|item| curriculum
                    .evaluation_contract(string(item, "id").unwrap())
                    .is_some())
        );
        assert!(curriculum.stages.iter().all(|item| {
            curriculum
                .evaluation_contract(string(item, "id").unwrap())
                .is_some()
        }));
    }
}
