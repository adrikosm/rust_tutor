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
    concepts: Vec<Value>,
    #[serde(default)]
    outcomes: Vec<Value>,
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
    concepts: Vec<Value>,
    outcomes: Vec<Value>,
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
    pub package_root: Option<String>,
    pub manifest: Option<String>,
    pub shared_files: Vec<(String, String)>,
    pub starter_files: Vec<(String, String)>,
    pub locked_files: Vec<(String, String)>,
    pub editable_files: Vec<String>,
    pub test_mounts: Vec<TestMount>,
    pub test_names: Vec<String>,
    pub hidden_tests: String,
    pub suite_id: Option<String>,
    pub suite_sha256: Option<String>,
    pub manifest_policy: ManifestPolicy,
    pub allow_loopback: bool,
}

#[derive(Clone, Debug)]
pub struct TestMount {
    pub path: String,
    pub content: String,
    pub append: bool,
}

#[derive(Clone, Debug, Default)]
pub struct ManifestPolicy {
    pub editable: bool,
    pub package: HashMap<String, String>,
    pub dependencies: HashMap<String, String>,
}

#[derive(Clone, Debug)]
pub struct PracticeEvidenceContract {
    pub concept_ids: Vec<String>,
    pub outcome_ids: Vec<String>,
    pub variant_group: String,
    pub next_exercise_id: Option<String>,
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
            &release.concepts,
            &release.outcomes,
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
            let kind = string(edge, "kind").ok_or_else(|| format!("{id} requires kind"))?;
            let rationale = string(edge, "rationale").unwrap_or_default();
            let provenance = string(edge, "provenance").unwrap_or_default();
            if ![
                "prerequisite_of",
                "practices",
                "assesses",
                "part_of",
                "stage_after",
                "transfers_to",
                "precedes",
            ]
            .contains(&kind)
            {
                return Err(format!("{id} uses unsupported graph relationship {kind}"));
            }
            if !all_ids.contains(source)
                || !all_ids.contains(target)
                || rationale.trim().is_empty()
                || provenance.trim().is_empty()
            {
                return Err(format!("{id} is dangling or lacks rationale/provenance"));
            }
        }
        validate_prerequisite_dag(&release.edges)?;
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
            concepts: release.concepts,
            outcomes: release.outcomes,
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
        json!({"sources":self.sources.len(),"concepts":self.concepts.len(),"outcomes":self.outcomes.len(),"modules":self.modules.len(),"lessons":self.lessons.len(),"exercises":self.exercises.len(),"projects":self.projects.len(),"stages":self.stages.len(),"edges":self.edges.len()})
    }

    /// The server-only answer key for one recall check: the correct option
    /// index, its explanation, and the option count used to bound the answer.
    /// Never reachable through a public projection; `safe_lesson` strips both.
    pub fn lesson_check_answer(
        &self,
        lesson_id: &str,
        check_id: &str,
    ) -> Option<(usize, String, usize)> {
        let canonical = self
            .aliases
            .get(lesson_id)
            .map(String::as_str)
            .unwrap_or(lesson_id);
        let lesson = &self.lessons[*self.lesson_index.get(canonical)?];
        let check = lesson
            .get("recallChecks")?
            .as_array()?
            .iter()
            .find(|check| string(check, "id") == Some(check_id))?;
        let answer = usize::try_from(check.get("answerIndex")?.as_u64()?).ok()?;
        let options = check.get("options")?.as_array()?.len();
        let explanation = string(check, "explanation")?.to_owned();
        (answer < options).then_some((answer, explanation, options))
    }

    /// The canonical lesson ID an alias or ID resolves to, or `None` when the
    /// release does not contain it.
    pub fn canonical_lesson_id(&self, requested: &str) -> Option<String> {
        let canonical = self
            .aliases
            .get(requested)
            .map(String::as_str)
            .unwrap_or(requested);
        self.lesson_index
            .get(canonical)
            .and_then(|index| string(&self.lessons[*index], "id"))
            .map(str::to_owned)
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
            .map(|index| safe_exercise(&self.exercises[*index]))
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
        let evaluator = item.get("evaluator").unwrap_or(&Value::Null);
        let mut test_names = Vec::new();
        let mut test_mounts = Vec::new();
        for key in ["hidden", "regression"] {
            for test in tests
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(content) = string(test, "content").or_else(|| string(test, "source"))
                else {
                    continue;
                };
                let name = string(test, "name").unwrap_or("hidden_test").to_owned();
                test_names.push(name);
                let path = string(test, "path").unwrap_or("tests/hidden.rs");
                let append = string(test, "mode") == Some("append");
                test_mounts.push(TestMount {
                    path: path.to_owned(),
                    content: content.to_owned(),
                    append,
                });
            }
        }
        if test_mounts.is_empty() {
            return None;
        }
        let starter = item.get("starter").unwrap_or(&Value::Null);
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
        let mainmatter_source = self
            .sources
            .iter()
            .find(|source| string(source, "id") == Some("SRC-MAINMATTER-100"));
        let manifest_policy = evaluator
            .get("manifestPolicy")
            .map(manifest_policy)
            .unwrap_or_default();
        let hidden_tests = test_mounts
            .iter()
            .enumerate()
            .map(|(index, test)| format!("mod contract_case_{index} {{\n{}\n}}", test.content))
            .collect::<Vec<_>>()
            .join("\n");
        Some(EvaluationContract {
            package_root: string(evaluator, "packageRoot").map(str::to_owned),
            manifest: starter
                .get("manifest")
                .and_then(Value::as_str)
                .map(str::to_owned),
            shared_files: mainmatter_source
                .map(|source| file_pairs(source.get("snapshotFiles")))
                .unwrap_or_default(),
            starter_files: file_pairs(starter.get("files")),
            locked_files,
            editable_files,
            test_mounts,
            test_names,
            hidden_tests,
            suite_id: string(evaluator, "suiteId").map(str::to_owned),
            suite_sha256: string(evaluator, "suiteSha256").map(str::to_owned),
            manifest_policy,
            allow_loopback: evaluator
                .get("runtimePolicy")
                .and_then(|policy| policy.get("loopback"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
    }

    pub fn practice_evidence_contract(&self, id: &str) -> Option<PracticeEvidenceContract> {
        let item = self.exercises.get(*self.exercise_index.get(id)?)?;
        if item.get("scored").and_then(Value::as_bool) != Some(true) {
            return None;
        }
        let variant_group = item
            .get("arc")
            .and_then(|arc| string(arc, "id"))
            .map(|arc| format!("VG-{arc}"))
            .unwrap_or_else(|| format!("VG-{id}"));
        Some(PracticeEvidenceContract {
            concept_ids: strings_at(item, "conceptIds"),
            outcome_ids: strings_at(item, "outcomeIds"),
            variant_group,
            next_exercise_id: self.next_exercise_id(id),
        })
    }

    pub fn next_exercise_id(&self, id: &str) -> Option<String> {
        let item = self.exercises.get(*self.exercise_index.get(id)?)?;
        let sequence = item.get("sequence")?.as_u64()?;
        let family = string(item, "family")?;
        self.exercises
            .iter()
            .filter(|candidate| {
                string(candidate, "family") == Some(family)
                    && candidate
                        .get("sequence")
                        .and_then(Value::as_u64)
                        .is_some_and(|candidate_sequence| candidate_sequence > sequence)
            })
            .min_by_key(|candidate| candidate.get("sequence").and_then(Value::as_u64))
            .and_then(|candidate| string(candidate, "id"))
            .map(str::to_owned)
    }

    /// The Book track's ordered containers and page summaries, and the eight
    /// Mainmatter practice arcs. Public projection only: no evaluator contract,
    /// answer key, or solution reaches this shape. Progress is layered on by
    /// the caller, which owns the learner database.
    pub fn tracks(&self) -> Value {
        let mut modules = Vec::new();
        for module in &self.modules {
            let Some(id) = string(module, "id") else {
                continue;
            };
            if !id.starts_with("MOD-BOOK-") {
                continue;
            }
            let pages: Vec<Value> = self
                .lessons
                .iter()
                .filter(|lesson| string(lesson, "moduleId") == Some(id))
                .map(|lesson| {
                    json!({
                        "id": string(lesson, "id"),
                        "title": string(lesson, "title"),
                        "summary": string(lesson, "summary"),
                        "pageSequence": lesson.get("pageSequence"),
                        "pageRole": string(lesson, "pageRole"),
                        "estimateMinutes": lesson.get("estimateMinutes"),
                        "difficulty": string(lesson, "difficulty"),
                        "canonicalUrl": string(lesson, "canonicalUrl"),
                        "checkIds": lesson
                            .get("recallChecks")
                            .and_then(Value::as_array)
                            .map(|checks| {
                                checks.iter().filter_map(|check| string(check, "id")).collect::<Vec<_>>()
                            })
                            .unwrap_or_default(),
                    })
                })
                .collect();
            modules.push(json!({
                "id": id,
                "number": module.get("number"),
                "title": string(module, "title"),
                "summary": string(module, "summary"),
                "pages": pages,
            }));
        }

        let mut arcs: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        for exercise in &self.exercises {
            if string(exercise, "family") != Some("mainmatter") {
                continue;
            }
            let arc = exercise
                .get("arc")
                .and_then(|arc| string(arc, "id").or_else(|| arc.as_str()))
                .unwrap_or("unknown")
                .to_owned();
            arcs.entry(arc).or_default().push(json!({
                "id": string(exercise, "id"),
                "title": string(exercise, "title"),
                "sequence": exercise.get("sequence"),
                "difficulty": string(exercise, "difficulty"),
                "estimateMinutes": exercise.get("estimateMinutes"),
                // Whether finishing this exercise can record evidence yet.
                "scored": exercise.get("scored").and_then(Value::as_bool).unwrap_or(false),
                "suiteReview": string(exercise, "suiteReview").unwrap_or("pending"),
            }));
        }
        let arcs: Vec<Value> = arcs
            .into_iter()
            .map(|(id, mut exercises)| {
                exercises.sort_by_key(|item| item.get("sequence").and_then(Value::as_u64));
                json!({ "id": id, "count": exercises.len(), "exercises": exercises })
            })
            .collect();

        json!({
            "book": { "modules": modules },
            "practice": { "arcs": arcs },
        })
    }

    /// Per-source licence and attribution for the bundled curriculum, for the
    /// About surface and offline packaging.
    pub fn attribution(&self) -> Vec<Value> {
        self.sources
            .iter()
            .map(|source| {
                json!({
                    "id": string(source, "id"),
                    "title": string(source, "title"),
                    "publisher": string(source, "publisher"),
                    "license": string(source, "license"),
                    "licenseUrl": license_url(string(source, "license").unwrap_or_default()),
                    "attribution": string(source, "attribution"),
                    "use": string(source, "use"),
                    "canonicalUrl": string(source, "canonicalUrl"),
                    "sourceCommit": string(source, "sourceCommit"),
                })
            })
            .collect()
    }

    pub fn graph_records(&self) -> (&[Value], &[Value]) {
        (&self.edges, &self.edge_kinds)
    }
    pub fn graph_entities(&self) -> impl Iterator<Item = (&'static str, Value)> + '_ {
        self.sources
            .iter()
            .map(|value| ("resource", graph_entity("resource", value)))
            .chain(
                self.concepts
                    .iter()
                    .map(|value| ("concept", graph_entity("concept", value))),
            )
            .chain(
                self.outcomes
                    .iter()
                    .map(|value| ("learning_outcome", graph_entity("learning_outcome", value))),
            )
            .chain(
                self.modules
                    .iter()
                    .map(|value| ("module", graph_entity("module", value))),
            )
            .chain(
                self.lessons
                    .iter()
                    .map(|value| ("lesson", graph_entity("lesson", value))),
            )
            .chain(
                self.exercises
                    .iter()
                    .map(|value| ("exercise", graph_entity("exercise", value))),
            )
            .chain(
                self.projects
                    .iter()
                    .map(|value| ("project", graph_entity("project", value))),
            )
            .chain(
                self.stages
                    .iter()
                    .map(|value| ("project_stage", graph_entity("project_stage", value))),
            )
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

fn validate_prerequisite_dag(edges: &[Value]) -> Result<(), String> {
    fn visit(
        id: &str,
        outgoing: &HashMap<String, Vec<String>>,
        visiting: &mut HashSet<String>,
        done: &mut HashSet<String>,
    ) -> Result<(), String> {
        if done.contains(id) {
            return Ok(());
        }
        if !visiting.insert(id.to_owned()) {
            return Err(format!("prerequisite_of cycle at {id}"));
        }
        for target in outgoing.get(id).into_iter().flatten() {
            visit(target, outgoing, visiting, done)?;
        }
        visiting.remove(id);
        done.insert(id.to_owned());
        Ok(())
    }
    let mut outgoing: HashMap<String, Vec<String>> = HashMap::new();
    for edge in edges
        .iter()
        .filter(|edge| string(edge, "kind") == Some("prerequisite_of"))
    {
        let source = string(edge, "sourceId").expect("validated edge source");
        let target = string(edge, "targetId").expect("validated edge target");
        outgoing
            .entry(source.to_owned())
            .or_default()
            .push(target.to_owned());
    }
    let mut visiting = HashSet::new();
    let mut done = HashSet::new();
    for id in outgoing.keys() {
        visit(id, &outgoing, &mut visiting, &mut done)?;
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
fn safe_exercise(value: &Value) -> Value {
    let editable_files = value
        .get("evaluator")
        .map(|evaluator| strings_at(evaluator, "editableFiles"))
        .unwrap_or_default();
    let mut copy = safe(value);
    if let Value::Object(map) = &mut copy {
        map.remove("sourceLesson");
        if let Some(starter) = map.get_mut("starter").and_then(Value::as_object_mut)
            && let Some(manifest) = starter.get("manifest").and_then(Value::as_str)
        {
            let manifest = manifest.to_owned();
            let files = starter
                .entry("files")
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .expect("validated starter files");
            if !files
                .iter()
                .any(|file| string(file, "path") == Some("Cargo.toml"))
            {
                files.push(json!({
                    "path":"Cargo.toml",
                    "content":manifest,
                    "role":"manifest",
                    "editable":editable_files.iter().any(|path| path == "Cargo.toml")
                }));
            }
        }
    }
    copy
}
/// Canonical licence text URLs, so the About surface can link the exact terms
/// the bundled material is used under.
fn license_url(license: &str) -> Option<&'static str> {
    match license {
        "CC-BY-NC-4.0" => Some("https://creativecommons.org/licenses/by-nc/4.0/"),
        "MIT OR Apache-2.0" | "MIT" => Some("https://spdx.org/licenses/MIT.html"),
        _ => None,
    }
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
        "conceptIds",
        "outcomeIds",
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

fn graph_entity(kind: &str, value: &Value) -> Value {
    let mut result = Map::new();
    for key in ["id", "title", "sourceIds"] {
        if let Some(value) = value
            .get(key)
            .and_then(|value| public_graph_field(key, value))
        {
            result.insert(key.to_owned(), value);
        }
    }
    if let Some(summary) = value
        .get("summary")
        .or_else(|| value.get("brief"))
        .and_then(|value| public_graph_field("summary", value))
    {
        result.insert("summary".to_owned(), summary);
    }
    let fields: &[&str] = match kind {
        "resource" => &["publisher", "canonicalUrl", "license", "attribution", "use"],
        "module" => &["number", "lessonIds", "prerequisiteModuleIds"],
        "lesson" => &[
            "number",
            "moduleId",
            "slug",
            "aliases",
            "pageSequence",
            "pageRole",
            "sourceDocumentId",
            "sourcePath",
            "canonicalUrl",
            "sourceSha256",
            "previousPageId",
            "nextPageId",
            "conceptIds",
            "outcomeIds",
            "mappingRationale",
            "mappingSource",
            "difficulty",
            "estimateMinutes",
            "prerequisiteIds",
        ],
        "exercise" => &[
            "family",
            "sequence",
            "upstreamSequence",
            "arc",
            "category",
            "pattern",
            "variant",
            "moduleId",
            "lessonId",
            "concepts",
            "conceptIds",
            "outcomeIds",
            "mappingRationale",
            "mappingSource",
            "difficulty",
            "estimateMinutes",
            "runnable",
            "scored",
            "prerequisiteIds",
        ],
        "project" => &["stageIds"],
        "project_stage" => &[
            "projectId",
            "sequence",
            "predecessorStageId",
            "relatedLessonIds",
            "relatedExerciseIds",
        ],
        _ => &[],
    };
    for key in fields {
        if let Some(value) = value
            .get(*key)
            .and_then(|value| public_graph_field(key, value))
        {
            result.insert((*key).to_owned(), value);
        }
    }
    if matches!(kind, "lesson" | "exercise") {
        let text = searchable_text(value);
        if !text.is_empty() {
            result.insert("searchText".to_owned(), Value::String(text));
        }
    }
    let mut projection = Value::Object(result);
    strip_secrets(&mut projection);
    projection
}

/// The text a learner may legitimately search: the pinned public source page or
/// exercise brief, plus the Rust Tutor overlay written around it.
///
/// Deliberately excludes anything the learner has not earned — recall answers
/// and their explanations, hidden or regression tests, reference solutions, and
/// reveal text are never read here.
fn searchable_text(value: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    for key in ["brief", "prompt", "mentalModel", "whyNow", "requirement"] {
        if let Some(text) = string(value, key) {
            parts.push(text.to_owned());
        }
    }
    for key in [
        "objectives",
        "recap",
        "commonMistakes",
        "tradeoffs",
        "constraints",
    ] {
        for entry in value
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(text) = entry.as_str() {
                parts.push(text.to_owned());
            }
        }
    }
    for entry in value
        .get("keyTerms")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for key in ["term", "definition"] {
            if let Some(text) = string(entry, key) {
                parts.push(text.to_owned());
            }
        }
    }
    for entry in value
        .get("misconceptions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for key in ["symptom", "explanation", "repair"] {
            if let Some(text) = string(entry, key) {
                parts.push(text.to_owned());
            }
        }
    }
    if let Some(document) = value.get("sourceDocument") {
        for block in document
            .get("blocks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            collect_block_text(block, &mut parts);
        }
    }
    parts.join(" ")
}

fn collect_block_text(node: &Value, out: &mut Vec<String>) {
    if let Some(text) = node.get("text").and_then(Value::as_str) {
        out.push(text.to_owned());
    }
    for child in node
        .get("children")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        collect_block_text(child, out);
    }
}

fn public_graph_field(key: &str, value: &Value) -> Option<Value> {
    if [
        "id",
        "title",
        "summary",
        "publisher",
        "canonicalUrl",
        "license",
        "attribution",
        "use",
        "moduleId",
        "slug",
        "difficulty",
        "family",
        "arc",
        "category",
        "pattern",
        "variant",
        "lessonId",
        "projectId",
        "predecessorStageId",
        "pageRole",
        "sourceDocumentId",
        "sourcePath",
        "sourceSha256",
        "previousPageId",
        "nextPageId",
        "mappingRationale",
        "mappingSource",
    ]
    .contains(&key)
    {
        return value.as_str().map(|value| Value::String(value.to_owned()));
    }
    if [
        "sourceIds",
        "lessonIds",
        "prerequisiteModuleIds",
        "aliases",
        "prerequisiteIds",
        "concepts",
        "conceptIds",
        "outcomeIds",
        "stageIds",
        "relatedLessonIds",
        "relatedExerciseIds",
    ]
    .contains(&key)
    {
        let values = value.as_array()?;
        return values
            .iter()
            .map(|value| value.as_str().map(|value| Value::String(value.to_owned())))
            .collect::<Option<Vec<_>>>()
            .map(Value::Array);
    }
    if [
        "number",
        "sequence",
        "upstreamSequence",
        "pageSequence",
        "estimateMinutes",
    ]
    .contains(&key)
    {
        return value.is_number().then(|| value.clone());
    }
    if ["runnable", "scored"].contains(&key) {
        return value.as_bool().map(Value::Bool);
    }
    None
}

fn strip_secrets(value: &mut Value) {
    match value {
        Value::Object(map) => {
            if map.get("locked").and_then(Value::as_bool) == Some(true) {
                *value = Value::Null;
                return;
            }
            map.retain(|key, _| !secret_key(key));
            for child in map.values_mut() {
                strip_secrets(child);
            }
        }
        Value::Array(values) => {
            for child in values.iter_mut() {
                strip_secrets(child);
            }
            values.retain(|child| !child.is_null());
        }
        _ => {}
    }
}

fn secret_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    matches!(
        normalized.as_str(),
        "answer"
            | "answerindex"
            | "correctanswer"
            | "hidden"
            | "regression"
            | "hiddentests"
            | "regressiontests"
            | "hiddencontract"
            | "regressioncontract"
            | "referencesolution"
            | "solution"
            | "solutionfiles"
            | "solutionreveal"
            | "solutionrevealexplanation"
            | "solutionsnapshotoverrides"
            | "evaluator"
            | "environment"
            | "environmentsettings"
            | "locked"
            | "lockedfile"
            | "lockedfiles"
            | "reveal"
            | "revealexplanation"
    )
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
fn manifest_policy(value: &Value) -> ManifestPolicy {
    let strings = |field: &str| {
        value
            .get(field)
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|entries| entries.iter())
            .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.to_owned())))
            .collect()
    };
    ManifestPolicy {
        editable: value
            .get("editable")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        package: strings("package"),
        dependencies: strings("dependencies"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> CurriculumV2 {
        CurriculumV2::parse(r#"{"schemaVersion":2,"releaseId":"v2","aliases":{"old":"L1"},"sources":[{"id":"S"}],"modules":[{"id":"M"}],"lessons":[{"id":"L1","moduleId":"M","aliases":["older"],"recallChecks":[{"prompt":"x","answerIndex":1}],"prerequisiteIds":[]}],"exercises":[{"id":"E1","family":"rust","moduleId":"M","lessonId":"L1","concepts":["ownership"],"difficulty":"easy","runnable":true,"tests":{"hidden":[{"source":"secret"}]},"explanation":{"purpose":"secret"},"referenceSolution":{"files":[]}}],"projects":[{"id":"P"}],"stages":[{"id":"T","projectId":"P","tests":{"hidden":["stage secret"]}}],"edges":[{"id":"X","sourceId":"L1","targetId":"E1","kind":"practices","rationale":"Practice it","provenance":"test fixture"}],"edgeKinds":[]}"#).unwrap()
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
    fn graph_entities_are_strict_public_allowlists() {
        let curriculum = CurriculumV2::parse(
            r#"{"schemaVersion":2,"releaseId":"v2","sources":[{"id":"S","title":"Source","snapshotFiles":[{"path":"locked","content":"server-only-secret","locked":true}]}],"modules":[{"id":"M","title":"Module"}],"lessons":[{"id":"L1","moduleId":"M","title":"Lesson","recallChecks":[{"answerIndex":0,"explanation":"server-only-secret"}],"prerequisiteIds":[]}],"exercises":[{"id":"E1","family":"mainmatter","title":"Exercise","moduleId":"M","lessonId":"L1","concepts":[{"environment":{"TOKEN":"server-only-secret"}},{"solutionReveal":{"body":"reveal-only-secret"}}],"tests":{"hidden":[{"source":"server-only-secret"}],"regression":[{"source":"server-only-secret"}]},"evaluator":{"environment":{"TOKEN":"server-only-secret"},"lockedFiles":[{"content":"server-only-secret"}]},"referenceSolution":{"files":[{"content":"server-only-secret"}]},"explanation":{"revealExplanation":"server-only-secret"}}],"projects":[{"id":"P","title":"Project"}],"stages":[{"id":"T","title":"Stage","projectId":"P","tests":{"hidden":["server-only-secret"]}}],"edges":[{"id":"X","sourceId":"L1","targetId":"E1","kind":"practices","rationale":"Practice it","provenance":"test fixture"}],"edgeKinds":[]}"#,
        )
        .unwrap();
        let projection = serde_json::to_value(curriculum.graph_entities().collect::<Vec<_>>())
            .expect("public graph projection");
        let encoded = projection.to_string();
        assert!(!encoded.contains("server-only-secret"));
        assert!(!encoded.contains("reveal-only-secret"));
        for forbidden in [
            "tests",
            "evaluator",
            "referenceSolution",
            "explanation",
            "snapshotFiles",
        ] {
            assert!(!encoded.contains(forbidden), "leaked {forbidden}");
        }
    }

    #[test]
    fn public_dtos_recursively_remove_server_only_data() {
        let mut value = json!({
            "id":"E",
            "nested":{
                "environment":{"TOKEN":"server-only-secret"},
                "revealExplanation":"server-only-secret",
                "lockedFiles":[{"content":"server-only-secret"}]
            },
            "files":[
                {"path":"src/lib.rs","content":"pub fn visible() {}"},
                {"path":"tests/hidden.rs","content":"server-only-secret","locked":true}
            ]
        });
        strip_secrets(&mut value);
        let encoded = value.to_string();
        assert!(!encoded.contains("server-only-secret"));
        assert!(encoded.contains("pub fn visible"));
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
            r#"{"schemaVersion":2,"releaseId":"v2","sources":[{"id":"S"}],"modules":[{"id":"M"}],"lessons":[{"id":"L1","moduleId":"M","recallChecks":[{"prompt":"x","answerIndex":1}],"prerequisiteIds":[]}],"exercises":[{"id":"E1","family":"interview","moduleId":"M","lessonId":"L1","concepts":["ownership"],"difficulty":"easy","runnable":true,"tests":{"hidden":[{"content":"use solution::solve; #[test] fn a(){}"}],"regression":[{"content":"use solution::solve; #[test] fn b(){}"}]},"referenceSolution":{"files":[]}}],"projects":[{"id":"P"}],"stages":[{"id":"T","projectId":"P"}],"edges":[{"id":"X","sourceId":"L1","targetId":"E1","kind":"practices","rationale":"Practice it","provenance":"test fixture"}],"edgeKinds":[]}"#,
        )
        .unwrap();
        let hidden = curriculum.evaluation_contract("E1").unwrap().hidden_tests;
        assert!(hidden.contains("mod contract_case_0"));
        assert!(hidden.contains("mod contract_case_1"));
        assert_eq!(hidden.matches("use solution::solve").count(), 2);
        assert!(hidden.contains("fn a()") && hidden.contains("fn b()"));
    }

    #[test]
    fn only_prerequisite_relationships_participate_in_dag_validation() {
        let release = |kind: &str| {
            json!({
                "schemaVersion": 2,
                "releaseId": "v2",
                "sources": [{"id": "A"}, {"id": "B"}],
                "modules": [],
                "lessons": [],
                "exercises": [],
                "projects": [],
                "stages": [],
                "edges": [
                    {"id": "E1", "sourceId": "A", "targetId": "B", "kind": kind, "rationale": "forward relationship", "provenance": "test fixture"},
                    {"id": "E2", "sourceId": "B", "targetId": "A", "kind": kind, "rationale": "reverse relationship", "provenance": "test fixture"}
                ],
                "edgeKinds": []
            })
            .to_string()
        };

        assert!(CurriculumV2::parse(&release("precedes")).is_ok());
        assert!(CurriculumV2::parse(&release("stage_after")).is_ok());
        assert!(
            CurriculumV2::parse(&release("prerequisite_of"))
                .unwrap_err()
                .contains("prerequisite_of cycle")
        );
    }

    #[test]
    fn embedded_release_has_the_promised_counts_and_contracts() {
        let curriculum = embedded().expect("tracked curriculum release");
        assert_eq!(curriculum.modules.len(), 23);
        assert_eq!(curriculum.lessons.len(), 109);
        assert_eq!(curriculum.concepts.len(), 101);
        assert_eq!(curriculum.outcomes.len(), 57);
        assert_eq!(curriculum.exercises.len(), 146);
        assert_eq!(curriculum.stages.len(), 27);
        assert_eq!(curriculum.edges.len(), 1_789);
        for (kind, expected) in [
            ("part_of", 489),
            ("practices", 839),
            ("precedes", 205),
            ("prerequisite_of", 105),
            ("stage_after", 24),
            ("transfers_to", 127),
            ("assesses", 0),
        ] {
            assert_eq!(
                curriculum
                    .edges
                    .iter()
                    .filter(|edge| string(edge, "kind") == Some(kind))
                    .count(),
                expected,
                "wrong {kind} edge count"
            );
        }
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
            48
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

    #[test]
    fn every_book_page_serves_its_pinned_source_document_without_answer_keys() {
        let curriculum = embedded().expect("tracked curriculum release");
        for record in &curriculum.lessons {
            let id = string(record, "id").expect("lesson id");
            let lesson = curriculum.lesson(id).expect("released lesson");
            let document = lesson
                .get("sourceDocument")
                .unwrap_or_else(|| panic!("{id} must serve its pinned source document"));
            assert!(
                document["blocks"].as_array().is_some_and(|b| !b.is_empty()),
                "{id} must carry typed source blocks"
            );
            for key in ["canonicalUrl", "attribution", "license", "sha256"] {
                assert!(document[key].as_str().is_some(), "{id} must state {key}");
            }
            // Opening a page must never hand the learner the graded answers.
            for check in lesson["recallChecks"].as_array().into_iter().flatten() {
                assert!(check.get("answerIndex").is_none(), "{id} leaks an answer");
                assert!(check.get("explanation").is_none(), "{id} leaks a reveal");
            }
        }
    }

    #[test]
    fn mainmatter_soft_sequence_crosses_arcs_without_hard_locking_the_target() {
        let curriculum = embedded().expect("tracked curriculum release");
        let next = curriculum.next_exercise_id("mainmatter-01-intro-01-syntax");
        assert_eq!(
            next.as_deref(),
            Some("mainmatter-02-basic_calculator-00-intro")
        );
        let target = curriculum
            .exercise(next.as_deref().unwrap())
            .expect("soft-sequence target stays directly accessible");
        assert_eq!(target["arc"]["id"], "02_basic_calculator");
    }
}
