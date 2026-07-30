use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const COLLECTIONS: &[(&str, &[&str])] = &[
    (
        "tracks",
        &["id", "version", "title", "sourceIds", "moduleIds"],
    ),
    (
        "modules",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "conceptIds",
            "outcomeIds",
            "materialIds",
        ],
    ),
    (
        "concepts",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "domain",
            "summary",
            "status",
        ],
    ),
    (
        "outcomes",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "observable",
            "conceptId",
            "status",
            "rubricId",
            "assessmentIds",
        ],
    ),
    (
        "materials",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "kind",
            "outcomeIds",
            "markdownPath",
        ],
    ),
    (
        "items",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "kind",
            "promptChecksum",
            "outcomeIds",
            "variantIds",
            "testIds",
            "evaluatorId",
            "supportMode",
        ],
    ),
    (
        "variants",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "itemId",
            "seed",
            "parameterOverrides",
        ],
    ),
    (
        "tests",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "itemId",
            "kind",
            "command",
            "expected",
        ],
    ),
    (
        "evaluators",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "itemId",
            "testIds",
            "mode",
        ],
    ),
    (
        "misconceptions",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "diagnosticPatterns",
            "feedback",
            "remediationIds",
        ],
    ),
    (
        "hints",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "itemId",
            "level",
            "prerequisiteAction",
            "text",
            "solutionReveal",
        ],
    ),
    (
        "rubrics",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "criteria",
            "allowedSupport",
            "evidenceRules",
        ],
    ),
    (
        "projects",
        &["id", "version", "title", "sourceIds", "purpose", "stages"],
    ),
    (
        "artifacts",
        &[
            "id",
            "version",
            "title",
            "sourceIds",
            "projectId",
            "kind",
            "evidenceRequirements",
        ],
    ),
];
const PREFIXES: &[&str] = &[
    "REL", "SRC", "TRK", "MOD", "CON", "OUT", "UNIT", "WORKED", "CHECK", "RES", "EX", "ASM", "MIS",
    "HINT", "RUB", "PRJ", "STG", "ART", "VAR", "TST", "EVAL", "EDGE",
];

#[derive(Debug, Clone, Serialize)]
pub struct ValidationError {
    pub code: String,
    pub file: String,
    pub field: String,
    pub line: usize,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct ValidationReport {
    pub status: &'static str,
    pub checksum: String,
    pub counts: HashMap<String, usize>,
    pub generated_edges: Vec<Value>,
    pub errors: Vec<ValidationError>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct IdResolution {
    pub requested_id: String,
    pub status: &'static str,
    pub canonical_id: Option<String>,
}

fn error(
    errors: &mut Vec<ValidationError>,
    code: &str,
    field: impl Into<String>,
    message: impl Into<String>,
) {
    errors.push(ValidationError {
        code: code.to_owned(),
        file: "release-v1.json".to_owned(),
        field: field.into(),
        line: 1,
        message: message.into(),
    });
}

fn located_error(
    errors: &mut Vec<ValidationError>,
    code: &str,
    file: &str,
    field: impl Into<String>,
    body: &str,
    needle: &str,
    message: impl Into<String>,
) {
    errors.push(ValidationError {
        code: code.to_owned(),
        file: file.to_owned(),
        field: field.into(),
        line: body
            .lines()
            .position(|line| line.contains(needle))
            .map_or(1, |line| line + 1),
        message: message.into(),
    });
}

pub fn validate_pack(root: &Path) -> Result<ValidationReport, String> {
    let release_path = root.join("release-v1.json");
    let body = fs::read_to_string(&release_path)
        .map_err(|e| format!("{}: {e}", release_path.display()))?;
    let release: Value = serde_json::from_str(&body).map_err(|e| {
        format!(
            "{}:{}:{}: {e}",
            release_path.display(),
            e.line(),
            e.column()
        )
    })?;
    let mut errors = Vec::new();
    if release["schemaVersion"] != 1 {
        error(
            &mut errors,
            "schema_version",
            "schemaVersion",
            "expected content schema version 1",
        );
    }
    if !release["release"]["id"].as_str().is_some_and(valid_id) {
        error(
            &mut errors,
            "invalid_id",
            "release.id",
            "release ID must use a reserved stable-ID prefix",
        );
    }
    for field in ["release", "sources", "graph", "idMigrations"] {
        if release.get(field).is_none() {
            error(
                &mut errors,
                "required_field",
                field,
                "missing required top-level field",
            );
        }
    }

    let mut ids = HashSet::new();
    let mut records = HashMap::new();
    let mut record_kinds = HashMap::new();
    let mut counts = HashMap::new();
    for (collection, required) in COLLECTIONS {
        let entries = release[*collection].as_array();
        if entries.is_none() {
            error(
                &mut errors,
                "required_collection",
                *collection,
                "collection must be an array",
            );
            continue;
        }
        let entries = entries.expect("checked");
        counts.insert((*collection).to_owned(), entries.len());
        for (index, record) in entries.iter().enumerate() {
            let field = format!("{collection}[{index}]");
            for required_field in *required {
                let draft_without_assessment = *collection == "outcomes"
                    && *required_field == "assessmentIds"
                    && record["status"] == "draft";
                if !draft_without_assessment && missing(record.get(*required_field)) {
                    error(
                        &mut errors,
                        "required_field",
                        format!("{field}.{required_field}"),
                        "required value is absent or empty",
                    );
                }
            }
            if let Some(id) = record["id"].as_str() {
                if !valid_id(id) {
                    error(
                        &mut errors,
                        "invalid_id",
                        format!("{field}.id"),
                        format!("invalid or unreserved stable ID {id}"),
                    );
                }
                if !ids.insert(id.to_owned()) {
                    error(
                        &mut errors,
                        if *collection == "items" {
                            "immutable_item"
                        } else {
                            "duplicate_id"
                        },
                        format!("{field}.id"),
                        format!("stable ID {id} cannot be duplicated or overwritten in a release"),
                    );
                }
                records.insert(id.to_owned(), record);
                record_kinds.insert(id.to_owned(), collection.trim_end_matches('s'));
            }
        }
    }

    let mut source_ids = HashSet::new();
    for (index, source) in release["sources"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        if let Some(id) = source["id"].as_str() {
            if !valid_id(id) {
                error(
                    &mut errors,
                    "invalid_id",
                    format!("sources[{index}].id"),
                    format!("invalid source stable ID {id}"),
                );
            }
            if !source_ids.insert(id) {
                error(
                    &mut errors,
                    "duplicate_id",
                    format!("sources[{index}].id"),
                    format!("duplicate source stable ID {id}"),
                );
            }
        }
        for field in ["id", "snapshotHash", "license", "useDecision"] {
            if missing(source.get(field)) {
                error(
                    &mut errors,
                    "source_license",
                    format!("sources[{index}].{field}"),
                    "source provenance/license value is required",
                );
            }
        }
        for class in ["code", "prose", "tests", "assets"] {
            if missing(source["license"].get(class)) {
                error(
                    &mut errors,
                    "source_license",
                    format!("sources[{index}].license.{class}"),
                    "file-class license is required",
                );
            }
        }
    }
    for (id, record) in &records {
        for source in strings(&record["sourceIds"]) {
            if !source_ids.contains(source.as_str()) {
                error(
                    &mut errors,
                    "dangling_source",
                    format!("{id}.sourceIds"),
                    format!("unknown source {source}"),
                );
            }
        }
    }

    for (index, material) in release["materials"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        if !matches!(
            material["kind"].as_str(),
            Some("unit" | "worked_example" | "check" | "resource")
        ) {
            error(
                &mut errors,
                "invalid_material_kind",
                format!("materials[{index}].kind"),
                "material kind must be unit, worked_example, check, or resource",
            );
        }
        for outcome in strings(&material["outcomeIds"]) {
            if record_kinds.get(&outcome) != Some(&"outcome") {
                error(
                    &mut errors,
                    "dangling_outcome",
                    format!("materials[{index}].outcomeIds"),
                    format!("unknown outcome {outcome}"),
                );
            }
        }
    }

    for (index, item) in release["items"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        for field in [
            "variantSeedPolicy",
            "rubricId",
            "variantIds",
            "testIds",
            "evaluatorId",
        ] {
            if missing(item.get(field)) {
                error(
                    &mut errors,
                    "required_field",
                    format!("items[{index}].{field}"),
                    "item version metadata is required",
                );
            }
        }
        let evaluator = item["evaluatorId"].as_str().unwrap_or("");
        if record_kinds.get(evaluator) != Some(&"evaluator") {
            error(
                &mut errors,
                "dangling_evaluator",
                format!("items[{index}].evaluatorId"),
                format!("unknown evaluator {evaluator}"),
            );
        }
        for (field, expected_kind) in [("variantIds", "variant"), ("testIds", "test")] {
            for id in strings(&item[field]) {
                if record_kinds.get(&id) != Some(&expected_kind) {
                    error(
                        &mut errors,
                        "dangling_item_reference",
                        format!("items[{index}].{field}"),
                        format!("unknown {expected_kind} {id}"),
                    );
                }
            }
        }
    }

    for (index, hint) in release["hints"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        if hint["level"].as_u64().is_some_and(|level| level >= 4) && hint["solutionReveal"] != true
        {
            error(
                &mut errors,
                "unflagged_solution_hint",
                format!("hints[{index}].solutionReveal"),
                "a level-4 full-solution hint must set solutionReveal=true",
            );
        }
    }

    for collection in ["variants", "tests", "evaluators"] {
        for (index, record) in release[collection]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let item = record["itemId"].as_str().unwrap_or("");
            if record_kinds.get(item) != Some(&"item") {
                error(
                    &mut errors,
                    "dangling_item_reference",
                    format!("{collection}[{index}].itemId"),
                    format!("unknown item {item}"),
                );
            }
        }
    }

    for (index, artifact) in release["artifacts"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let project = artifact["projectId"].as_str().unwrap_or("");
        if record_kinds.get(project) != Some(&"project") {
            error(
                &mut errors,
                "dangling_project_reference",
                format!("artifacts[{index}].projectId"),
                format!("unknown project {project}"),
            );
        }
    }

    for (project_index, project) in release["projects"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        for (stage_index, stage) in project["stages"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            for field in [
                "id",
                "version",
                "prerequisiteOutcomeIds",
                "artifactIds",
                "testGroupIds",
                "acceptanceRubricId",
            ] {
                if missing(stage.get(field)) {
                    error(
                        &mut errors,
                        "milestone_evidence",
                        format!("projects[{project_index}].stages[{stage_index}].{field}"),
                        "project milestone evidence mapping is required",
                    );
                }
            }
        }
    }

    for (index, material) in release["materials"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        if let Some(path) = material["markdownPath"].as_str() {
            validate_markdown(
                root,
                path,
                material["id"].as_str().unwrap_or(""),
                &mut errors,
                index,
            );
        }
    }

    let node_list = strings(&release["graph"]["nodes"]);
    let nodes: HashSet<_> = node_list.iter().cloned().collect();
    if nodes.len() != node_list.len() {
        error(
            &mut errors,
            "duplicate_id",
            "graph.nodes",
            "graph node IDs must be unique",
        );
    }
    for node in &nodes {
        if !records.contains_key(node) {
            error(
                &mut errors,
                "dangling_node",
                "graph.nodes",
                format!("unknown graph node {node}"),
            );
        }
    }
    let mut touched = HashSet::new();
    let mut prereqs = Vec::new();
    for (index, edge) in release["graph"]["edges"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        for field in ["id", "sourceId", "targetId", "kind", "rationale"] {
            if missing(edge.get(field)) {
                error(
                    &mut errors,
                    "required_field",
                    format!("graph.edges[{index}].{field}"),
                    "graph edge field is required",
                );
            }
        }
        if !edge["id"].as_str().is_some_and(valid_id) {
            error(
                &mut errors,
                "invalid_id",
                format!("graph.edges[{index}].id"),
                "edge ID must use the reserved EDGE prefix",
            );
        }
        let source = edge["sourceId"].as_str().unwrap_or("");
        let target = edge["targetId"].as_str().unwrap_or("");
        let kind = edge["kind"].as_str().unwrap_or("");
        if !nodes.contains(source) || !nodes.contains(target) {
            located_error(
                &mut errors,
                "dangling_edge",
                "release-v1.json",
                format!("graph.edges[{index}]"),
                &body,
                edge["id"].as_str().unwrap_or(source),
                format!("edge endpoint missing: {source} -> {target}"),
            );
        }
        touched.extend([source.to_owned(), target.to_owned()]);
        if ["part_of", "teaches", "assesses", "practices"].contains(&kind) {
            error(
                &mut errors,
                "duplicate_structural_truth",
                format!("graph.edges[{index}].kind"),
                "structural edges are generated from canonical mappings",
            );
        }
        if kind == "prerequisite_of" {
            prereqs.push((source.to_owned(), target.to_owned()));
        }
        let pair = (
            record_kinds.get(source).copied().unwrap_or("unknown"),
            kind,
            record_kinds.get(target).copied().unwrap_or("unknown"),
        );
        if !matches!(
            pair,
            ("concept", "prerequisite_of", "concept")
                | ("outcome", "prerequisite_of", "outcome")
                | ("outcome", "transfers_to", "project")
        ) {
            error(
                &mut errors,
                "invalid_edge_kind_pair",
                format!("graph.edges[{index}].kind"),
                format!("edge kind is not allowed for {} -> {}", pair.0, pair.2),
            );
        }
    }
    let generated_edges = generated_edges(&release);
    for edge in &generated_edges {
        if let Some(source) = edge["sourceId"].as_str() {
            touched.insert(source.to_owned());
        }
        if let Some(target) = edge["targetId"].as_str() {
            touched.insert(target.to_owned());
        }
    }
    for node in nodes.difference(&touched) {
        error(
            &mut errors,
            "orphan_node",
            "graph.nodes",
            format!("orphan graph node {node}"),
        );
    }
    if let Some(cycle) = shortest_cycle(&nodes, &prereqs) {
        error(
            &mut errors,
            "prerequisite_cycle",
            "graph.edges",
            format!("shortest prerequisite cycle: {}", cycle.join(" -> ")),
        );
    }

    for outcome in release["outcomes"].as_array().into_iter().flatten() {
        let outcome_id = outcome["id"].as_str().unwrap_or("");
        let covered = strings(&outcome["assessmentIds"]).iter().any(|id| {
            records
                .get(id)
                .is_some_and(|item| item["kind"] == "assessment" && item["supportMode"] == "none")
        });
        if outcome["status"] != "draft" && !covered {
            error(
                &mut errors,
                "assessment_coverage",
                format!("{outcome_id}.assessmentIds"),
                "published outcome needs an independent no-support assessment",
            );
        }
    }

    let migrations = &release["idMigrations"];
    let aliases: HashSet<_> = migrations["aliases"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["alias"].as_str())
        .collect();
    for (index, alias) in migrations["aliases"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let from = alias["alias"].as_str().unwrap_or("");
        let to = alias["canonicalId"].as_str().unwrap_or("");
        if from == to || aliases.contains(to) || !records.contains_key(to) {
            error(
                &mut errors,
                "invalid_alias",
                format!("idMigrations.aliases[{index}]"),
                "alias must resolve once to an active canonical ID",
            );
        }
    }
    for tombstone in migrations["tombstones"].as_array().into_iter().flatten() {
        if let Some(id) = tombstone["id"].as_str()
            && records.contains_key(id)
        {
            error(
                &mut errors,
                "reused_tombstone",
                "idMigrations.tombstones",
                format!("tombstoned ID reused: {id}"),
            );
        }
    }
    let tombstones: HashSet<_> = migrations["tombstones"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry["id"].as_str())
        .collect();
    for (index, supersedes) in migrations["supersedes"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let old = supersedes["oldId"].as_str().unwrap_or("");
        let new = supersedes["newId"].as_str().unwrap_or("");
        if !tombstones.contains(old) || !records.contains_key(new) || old == new {
            error(
                &mut errors,
                "invalid_supersedes",
                format!("idMigrations.supersedes[{index}]"),
                "supersedes must map one tombstoned ID to one active canonical ID",
            );
        }
    }

    let checksum = pack_checksum(root)?;
    Ok(ValidationReport {
        status: if errors.is_empty() {
            "passed"
        } else {
            "failed"
        },
        checksum,
        counts,
        generated_edges,
        errors,
    })
}

pub fn resolve_id(root: &Path, requested: &str) -> Result<IdResolution, String> {
    let path = root.join("release-v1.json");
    let release: Value = serde_json::from_str(
        &fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))?,
    )
    .map_err(|error| format!("{}: {error}", path.display()))?;
    let active: HashSet<_> = COLLECTIONS
        .iter()
        .flat_map(|(collection, _)| release[*collection].as_array().into_iter().flatten())
        .filter_map(|record| record["id"].as_str())
        .collect();
    if active.contains(requested) {
        return Ok(IdResolution {
            requested_id: requested.to_owned(),
            status: "active",
            canonical_id: Some(requested.to_owned()),
        });
    }
    if let Some(canonical) = release["idMigrations"]["aliases"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|entry| entry["alias"] == requested)
        .and_then(|entry| entry["canonicalId"].as_str())
    {
        return Ok(IdResolution {
            requested_id: requested.to_owned(),
            status: "aliased",
            canonical_id: Some(canonical.to_owned()),
        });
    }
    let tombstoned = release["idMigrations"]["tombstones"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|entry| entry["id"] == requested);
    if tombstoned {
        let successor = release["idMigrations"]["supersedes"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|entry| entry["oldId"] == requested)
            .and_then(|entry| entry["newId"].as_str())
            .map(str::to_owned);
        return Ok(IdResolution {
            requested_id: requested.to_owned(),
            status: if successor.is_some() {
                "superseded"
            } else {
                "retired"
            },
            canonical_id: successor,
        });
    }
    Ok(IdResolution {
        requested_id: requested.to_owned(),
        status: "unknown",
        canonical_id: None,
    })
}

fn missing(value: Option<&Value>) -> bool {
    value.is_none_or(|value| {
        value.is_null() || value == "" || value.as_array().is_some_and(Vec::is_empty)
    })
}
fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}
fn valid_id(id: &str) -> bool {
    let Some((prefix, rest)) = id.split_once('-') else {
        return false;
    };
    PREFIXES.contains(&prefix)
        && !rest.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
}

fn validate_markdown(
    root: &Path,
    relative: &str,
    expected_id: &str,
    errors: &mut Vec<ValidationError>,
    index: usize,
) {
    let path = root.join(relative);
    let Ok(body) = fs::read_to_string(&path) else {
        errors.push(ValidationError {
            code: "markdown_missing".to_owned(),
            file: relative.to_owned(),
            field: format!("materials[{index}].markdownPath"),
            line: 1,
            message: format!("missing {relative}"),
        });
        return;
    };
    if !body.starts_with("---\n") {
        located_error(
            errors,
            "frontmatter",
            relative,
            relative,
            &body,
            body.lines().next().unwrap_or(""),
            "Markdown must begin with frontmatter",
        );
        return;
    }
    let end = body[4..].find("\n---\n").map(|value| value + 4);
    let Some(end) = end else {
        located_error(
            errors,
            "frontmatter",
            relative,
            relative,
            &body,
            "---",
            "unterminated frontmatter",
        );
        return;
    };
    let frontmatter = &body[4..end];
    for field in ["id", "version", "source_ids", "outcome_ids", "license"] {
        if !frontmatter
            .lines()
            .any(|line| line.starts_with(&format!("{field}:")))
        {
            located_error(
                errors,
                "frontmatter",
                relative,
                field,
                &body,
                "---",
                format!("missing {field}"),
            );
        }
    }
    if !frontmatter
        .lines()
        .any(|line| line == format!("id: {expected_id}"))
    {
        located_error(
            errors,
            "frontmatter",
            relative,
            relative,
            &body,
            "id:",
            "frontmatter ID does not match manifest",
        );
    }
    let prose = &body[end + 5..];
    let lower = prose.to_ascii_lowercase();
    if ["<script", "<style", "javascript:", "onclick=", "onerror="]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        located_error(
            errors,
            "unsafe_markdown",
            relative,
            relative,
            &body,
            ["<script", "<style", "javascript:", "onclick=", "onerror="]
                .iter()
                .find(|needle| lower.contains(**needle))
                .copied()
                .unwrap_or("<"),
            "raw HTML/script/event/style content is prohibited",
        );
    }
}

fn generated_edges(release: &Value) -> Vec<Value> {
    let mut edges = Vec::new();
    for track in release["tracks"].as_array().into_iter().flatten() {
        for module in strings(&track["moduleIds"]) {
            edges.push(
                json!({"sourceId":module,"targetId":track["id"],"kind":"part_of","generated":true}),
            );
        }
    }
    for module in release["modules"].as_array().into_iter().flatten() {
        for concept in strings(&module["conceptIds"]) {
            edges.push(json!({"sourceId":module["id"],"targetId":concept,"kind":"teaches","generated":true}));
        }
        for outcome in strings(&module["outcomeIds"]) {
            edges.push(json!({"sourceId":module["id"],"targetId":outcome,"kind":"teaches","generated":true}));
        }
    }
    for outcome in release["outcomes"].as_array().into_iter().flatten() {
        for assessment in strings(&outcome["assessmentIds"]) {
            edges.push(json!({"sourceId":assessment,"targetId":outcome["id"],"kind":"assesses","generated":true}));
        }
    }
    for item in release["items"].as_array().into_iter().flatten() {
        if item["kind"] != "assessment" {
            for outcome in strings(&item["outcomeIds"]) {
                edges.push(json!({"sourceId":item["id"],"targetId":outcome,"kind":"practices","generated":true}));
            }
        }
    }
    edges
}

fn shortest_cycle(nodes: &HashSet<String>, edges: &[(String, String)]) -> Option<Vec<String>> {
    let mut best: Option<Vec<String>> = None;
    for start in nodes {
        let mut queue = VecDeque::from([(start.clone(), vec![start.clone()])]);
        while let Some((current, path)) = queue.pop_front() {
            for (_, next) in edges.iter().filter(|(source, _)| source == &current) {
                if next == start {
                    let mut cycle = path.clone();
                    cycle.push(start.clone());
                    if best.as_ref().is_none_or(|prior| cycle.len() < prior.len()) {
                        best = Some(cycle);
                    }
                    continue;
                }
                if !path.contains(next)
                    && best
                        .as_ref()
                        .is_none_or(|prior| path.len() + 1 < prior.len())
                {
                    let mut next_path = path.clone();
                    next_path.push(next.clone());
                    queue.push_back((next.clone(), next_path));
                }
            }
        }
    }
    best
}

fn pack_checksum(root: &Path) -> Result<String, String> {
    let mut files = Vec::<PathBuf>::new();
    collect_files(root, root, &mut files)?;
    files.sort();
    let mut hasher = Sha256::new();
    for relative in files {
        hasher.update(relative.to_string_lossy().as_bytes());
        hasher.update([0]);
        hasher.update(fs::read(root.join(&relative)).map_err(|e| e.to_string())?);
        hasher.update([0]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
fn collect_files(root: &Path, current: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_dir() {
            collect_files(root, &path, files)?;
        } else {
            files.push(
                path.strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_owned(),
            );
        }
    }
    Ok(())
}

pub fn manifest(report: &ValidationReport) -> Value {
    json!({"schemaVersion":1,"contentRelease":"REL-OWNERSHIP-001","version":"1.0.0","checksum":report.checksum,"counts":report.counts,"generatedEdgeCount":report.generated_edges.len(),"minimumAppVersion":"0.1.0","minimumToolchain":"1.97.1"})
}
