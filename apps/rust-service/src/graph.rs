use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const TUTOR_FEED: &str = include_str!("../../../knowledge/feed/generated/tutor-feed.json");
const GRAPH_ENRICHMENT: &str = include_str!("../../../content/enrichment/graph-enrichment.v1.json");

/// Bumped whenever what goes into the full-text corpus changes. It is folded
/// into the graph checksum so a stored import is rebuilt rather than kept with
/// a stale index: the corpus is not serialized into node payloads, so nothing
/// else in the checksum would notice the change.
const SEARCH_CORPUS_VERSION: &str = "search-corpus-v2-source-text";
static EMBEDDED_GRAPH: OnceLock<RuntimeGraph> = OnceLock::new();

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Enrichment {
    #[serde(default)]
    nodes: Vec<GraphNode>,
    #[serde(default)]
    edges: Vec<GraphEdge>,
}

pub fn embedded() -> &'static RuntimeGraph {
    EMBEDDED_GRAPH.get_or_init(|| {
        RuntimeGraph::load_embedded().expect("embedded tutor-feed graph must validate")
    })
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Feed {
    schema_version: String,
    release: String,
    graph_projection: Projection,
    #[serde(flatten)]
    other: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Projection {
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub content_version: String,
    #[serde(default)]
    pub review_state: String,
    #[serde(default)]
    pub provenance_ids: Vec<String>,
    /// Public source text and tutor overlay for full-text search only. Never
    /// serialized into a graph, catalog, or search payload.
    #[serde(default, skip_serializing)]
    pub search_text: String,
    #[serde(flatten)]
    pub detail: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub edge_id: String,
    pub source_id: String,
    pub target_id: String,
    pub kind: String,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub provenance_ids: Vec<String>,
    #[serde(default)]
    pub content_version: String,
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub review_state: String,
    #[serde(flatten)]
    pub detail: BTreeMap<String, Value>,
}

#[derive(Clone, Debug)]
pub struct RuntimeGraph {
    pub release_id: String,
    pub checksum: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    node_index: HashMap<String, usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphResult {
    pub release_id: String,
    pub selected_id: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub truncated: bool,
    pub legend: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapProjection {
    pub release_id: String,
    pub checksum: String,
    pub nodes: Vec<MapNode>,
    pub edges: Vec<MapEdge>,
    pub legend: BTreeMap<String, String>,
    pub node_kinds: BTreeMap<String, u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapNode {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_target: Option<String>,
    pub degree: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapEdge {
    pub source: String,
    pub target: String,
    pub kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathResult {
    pub release_id: String,
    pub start_id: String,
    pub goal_id: String,
    pub found: bool,
    pub steps: Vec<PathStep>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStep {
    pub node: GraphNode,
    pub via: Option<GraphEdge>,
    pub explanation: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tour {
    pub id: &'static str,
    pub title: &'static str,
    pub entry_gate: &'static str,
    pub draft: bool,
    pub steps: Vec<TourStep>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TourStep {
    pub node_id: &'static str,
    pub what: &'static str,
    pub why_now: &'static str,
    pub previous_connection: &'static str,
    /// Only present when this release ships a real lesson for the subject.
    pub lesson_id: Option<&'static str>,
    /// Only present when the exercise has an executable acceptance contract.
    pub exercise_id: Option<&'static str>,
    pub project_id: &'static str,
}

impl RuntimeGraph {
    pub fn load_embedded() -> Result<Self, String> {
        let feed: Feed = serde_json::from_str(TUTOR_FEED)
            .map_err(|error| format!("invalid embedded tutor feed: {error}"))?;
        if feed.schema_version != "0.1.0" || feed.release != "KF-v0" {
            return Err("unsupported tutor-feed graph release".to_owned());
        }
        let _ = feed.other;
        let mut checksum = format!(
            "{:x}",
            Sha256::digest([TUTOR_FEED.as_bytes(), b"graph-import-v2"].concat())
        );
        let mut nodes = feed.graph_projection.nodes;
        let mut edges = feed.graph_projection.edges;
        // The active tutor slice (lesson, outcomes, concepts, exercises, checks)
        // must resolve inside the runtime graph so evidence, gap maps, and replay
        // records all describe one release instead of three disjoint namespaces.
        let (slice_nodes, slice_edges) = tutor_slice_projection()?;
        let known: HashSet<String> = nodes.iter().map(|node| node.id.clone()).collect();
        nodes.extend(
            slice_nodes
                .into_iter()
                .filter(|node| !known.contains(&node.id)),
        );
        edges.extend(slice_edges);
        if let Ok(curriculum) = crate::curriculum_v2::embedded() {
            let mut known: HashSet<String> = nodes.iter().map(|node| node.id.clone()).collect();
            for (kind, entity) in curriculum.graph_entities() {
                let Some(id) = entity.get("id").and_then(Value::as_str) else {
                    continue;
                };
                if !known.insert(id.to_owned()) {
                    continue;
                }
                nodes.push(curriculum_node(kind, &entity, id));
            }
            let mut known_edges: HashSet<String> =
                edges.iter().map(|edge| edge.edge_id.clone()).collect();
            for edge in curriculum.graph_records().0 {
                let Some(id) = edge.get("id").and_then(Value::as_str) else {
                    continue;
                };
                if !known_edges.insert(id.to_owned()) {
                    continue;
                }
                edges.push(curriculum_edge(edge)?);
            }
            checksum = format!(
                "{:x}",
                Sha256::digest(format!("{checksum}:{}", curriculum.checksum).as_bytes())
            );
        }
        // Curated v2 enrichment overlay: rustc error catalogue plus semantic,
        // non-hierarchical concept edges. It is additive and defensive — any
        // node or edge whose endpoints are absent from this release is skipped
        // instead of failing the load, so the overlay can lead the feed.
        {
            let overlay: Enrichment = serde_json::from_str(GRAPH_ENRICHMENT)
                .map_err(|error| format!("invalid graph enrichment overlay: {error}"))?;
            let mut known: HashSet<String> = nodes.iter().map(|node| node.id.clone()).collect();
            for node in overlay.nodes {
                if known.insert(node.id.clone()) {
                    nodes.push(node);
                }
            }
            let mut known_edges: HashSet<String> =
                edges.iter().map(|edge| edge.edge_id.clone()).collect();
            for edge in overlay.edges {
                if known.contains(&edge.source_id)
                    && known.contains(&edge.target_id)
                    && known_edges.insert(edge.edge_id.clone())
                {
                    edges.push(edge);
                }
            }
            checksum = format!(
                "{:x}",
                Sha256::digest(format!("{checksum}:{GRAPH_ENRICHMENT}").as_bytes())
            );
        }
        checksum = format!(
            "{:x}",
            Sha256::digest(format!("{checksum}:{SEARCH_CORPUS_VERSION}").as_bytes())
        );
        let node_index: HashMap<_, _> = nodes
            .iter()
            .enumerate()
            .map(|(index, node)| (node.id.clone(), index))
            .collect();
        if node_index.len() != nodes.len() {
            return Err("graph contains duplicate node IDs".to_owned());
        }
        edges.extend([
            GraphEdge {
                edge_id: "EDG-APP-E0382-RESOLUTION-001".to_owned(),
                source_id: "CON-RUST-SHARED-BORROW-001".to_owned(),
                target_id: "ERR-RUST-E0382-001".to_owned(),
                kind: "resolves_error".to_owned(),
                rationale: "Borrowing instead of transferring ownership preserves the source binding when later use is required.".to_owned(),
                provenance_ids: vec!["SRC-LOCAL-EPICS-AND-SPRINTS".to_owned()],
                content_version: "0.1.0".to_owned(),
                confidence: "high".to_owned(),
                review_state: "accepted".to_owned(),
                detail: BTreeMap::new(),
            },
            GraphEdge {
                edge_id: "EDG-APP-E0382-TOOL-001".to_owned(),
                source_id: "ERR-RUST-E0382-001".to_owned(),
                target_id: "TOL-RUSTC-001".to_owned(),
                kind: "debugged_with".to_owned(),
                rationale: "rustc emits the structured primary and secondary spans used to trace the move and later invalid use.".to_owned(),
                provenance_ids: vec!["SRC-LOCAL-EPICS-AND-SPRINTS".to_owned()],
                content_version: "0.1.0".to_owned(),
                confidence: "high".to_owned(),
                review_state: "accepted".to_owned(),
                detail: BTreeMap::new(),
            },
        ]);
        // The canonical feed and curriculum release can carry the same
        // reviewed relationship under different compatibility IDs. Keep the
        // first (the feed record has the fuller provenance) so consumers see
        // one semantic edge instead of duplicate cards and map lines.
        let mut semantic_edges = HashSet::new();
        edges.retain(|edge| {
            semantic_edges.insert((
                edge.source_id.clone(),
                edge.target_id.clone(),
                edge.kind.clone(),
            ))
        });
        let mut edge_ids = HashSet::new();
        for edge in &edges {
            if !edge_ids.insert(&edge.edge_id)
                || !node_index.contains_key(&edge.source_id)
                || !node_index.contains_key(&edge.target_id)
            {
                return Err(format!("{} is duplicate or dangling", edge.edge_id));
            }
        }
        let graph = Self {
            release_id: feed.release,
            checksum,
            nodes,
            edges,
            node_index,
        };
        graph.validate_prerequisite_dag()?;
        graph.validate_tours()?;
        Ok(graph)
    }

    pub fn node(&self, id: &str) -> Option<&GraphNode> {
        self.node_index.get(id).map(|index| &self.nodes[*index])
    }

    pub(crate) fn is_public_id(&self, id: &str) -> bool {
        self.node(id).is_some_and(is_public_node)
    }

    pub(crate) fn is_public_edge(&self, edge: &GraphEdge) -> bool {
        self.is_public_id(&edge.source_id) && self.is_public_id(&edge.target_id)
    }

    /// Compact whole-graph projection for the canvas map.
    ///
    /// The relationship explorer fetches bounded neighbourhoods; the map needs
    /// every node and edge at once, so this strips authored prose and detail
    /// blobs down to what a renderer needs. Payload stays roughly two orders of
    /// magnitude smaller than the full projection.
    pub fn map_projection(&self) -> MapProjection {
        let mut degree: HashMap<&str, u32> = HashMap::new();
        for edge in self.edges.iter().filter(|edge| self.is_public_edge(edge)) {
            *degree.entry(edge.source_id.as_str()).or_default() += 1;
            *degree.entry(edge.target_id.as_str()).or_default() += 1;
        }
        let nodes = self
            .nodes
            .iter()
            .filter(|node| is_public_node(node))
            .map(|node| {
                let public = public_node(node);
                MapNode {
                    id: node.id.clone(),
                    kind: node.kind.clone(),
                    title: node.title.clone(),
                    tier: public
                        .detail
                        .get("tier")
                        .and_then(Value::as_u64)
                        .or_else(|| public.detail.get("difficultyTier").and_then(Value::as_u64))
                        .map(|tier| tier.min(5) as u8),
                    route_target: public
                        .detail
                        .get("routeTarget")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    degree: degree.get(node.id.as_str()).copied().unwrap_or(0),
                }
            })
            .collect();
        let edges = self
            .edges
            .iter()
            .filter(|edge| self.is_public_edge(edge))
            .map(|edge| MapEdge {
                source: edge.source_id.clone(),
                target: edge.target_id.clone(),
                kind: edge.kind.clone(),
            })
            .collect();
        let mut legend = edge_legend();
        for edge in self.edges.iter().filter(|edge| self.is_public_edge(edge)) {
            legend
                .entry(edge.kind.clone())
                .or_insert_with(|| edge.kind.replace('_', " "));
        }
        let mut kinds: BTreeMap<String, u32> = BTreeMap::new();
        for node in self.nodes.iter().filter(|node| is_public_node(node)) {
            *kinds.entry(node.kind.clone()).or_default() += 1;
        }
        MapProjection {
            release_id: self.release_id.clone(),
            checksum: self.checksum.clone(),
            nodes,
            edges,
            legend,
            node_kinds: kinds,
        }
    }

    pub fn neighborhood(
        &self,
        selected_id: &str,
        depth: usize,
        limit: usize,
        kinds: &HashSet<&str>,
    ) -> Result<GraphResult, String> {
        if !self.is_public_id(selected_id) {
            return Err("selected graph node does not exist".to_owned());
        }
        let depth = depth.clamp(0, 3);
        let limit = limit.clamp(1, 200);
        let mut included = BTreeSet::from([selected_id.to_owned()]);
        let mut queue = VecDeque::from([(selected_id.to_owned(), 0_usize)]);
        let mut truncated = false;
        while let Some((current, current_depth)) = queue.pop_front() {
            if current_depth >= depth {
                continue;
            }
            let mut neighbors: Vec<_> = self
                .edges
                .iter()
                .filter(|edge| {
                    self.is_public_edge(edge)
                        && (kinds.is_empty() || kinds.contains(edge.kind.as_str()))
                        && (edge.source_id == current || edge.target_id == current)
                })
                .map(|edge| {
                    if edge.source_id == current {
                        edge.target_id.clone()
                    } else {
                        edge.source_id.clone()
                    }
                })
                .collect();
            neighbors.sort();
            neighbors.dedup();
            for neighbor in neighbors {
                if included.len() >= limit {
                    truncated = true;
                    break;
                }
                if included.insert(neighbor.clone()) {
                    queue.push_back((neighbor, current_depth + 1));
                }
            }
        }
        let nodes = included
            .iter()
            .filter_map(|id| {
                self.node(id)
                    .filter(|node| is_public_node(node))
                    .map(public_node)
            })
            .collect();
        let mut edges: Vec<_> = self
            .edges
            .iter()
            .filter(|edge| {
                self.is_public_edge(edge)
                    && included.contains(&edge.source_id)
                    && included.contains(&edge.target_id)
                    && (kinds.is_empty() || kinds.contains(edge.kind.as_str()))
            })
            .map(public_edge)
            .collect();
        edges.sort_by(|left, right| left.edge_id.cmp(&right.edge_id));
        Ok(GraphResult {
            release_id: self.release_id.clone(),
            selected_id: selected_id.to_owned(),
            nodes,
            edges,
            truncated,
            legend: {
                let mut legend = edge_legend();
                for edge in self.edges.iter().filter(|edge| self.is_public_edge(edge)) {
                    legend
                        .entry(edge.kind.clone())
                        .or_insert_with(|| edge.kind.replace('_', " "));
                }
                legend
            },
        })
    }

    pub fn prerequisite_closure(&self, id: &str, satisfied: &HashSet<&str>) -> PathResult {
        if !self.is_public_id(id) {
            return PathResult {
                release_id: self.release_id.clone(),
                start_id: id.to_owned(),
                goal_id: id.to_owned(),
                found: false,
                steps: Vec::new(),
            };
        }
        let mut required = BTreeSet::new();
        let mut queue = VecDeque::from([id.to_owned()]);
        while let Some(target) = queue.pop_front() {
            let mut parents: Vec<_> = self
                .edges
                .iter()
                .filter(|edge| {
                    self.is_public_edge(edge)
                        && edge.kind == "prerequisite_of"
                        && edge.target_id == target
                })
                .map(|edge| edge.source_id.clone())
                .collect();
            parents.sort();
            for parent in parents {
                if !satisfied.contains(parent.as_str()) && required.insert(parent.clone()) {
                    queue.push_back(parent);
                }
            }
        }
        let steps = required
            .into_iter()
            .filter_map(|node_id| {
                self.node(&node_id)
                    .filter(|node| is_public_node(node))
                    .map(|node| PathStep {
                        node: public_node(node),
                        via: None,
                        explanation: "Unsatisfied authored prerequisite.".to_owned(),
                    })
            })
            .collect();
        PathResult {
            release_id: self.release_id.clone(),
            start_id: id.to_owned(),
            goal_id: id.to_owned(),
            found: true,
            steps,
        }
    }

    pub fn path(&self, start_id: &str, goal_id: &str) -> PathResult {
        if !self.is_public_id(start_id) || !self.is_public_id(goal_id) {
            return PathResult {
                release_id: self.release_id.clone(),
                start_id: start_id.to_owned(),
                goal_id: goal_id.to_owned(),
                found: false,
                steps: Vec::new(),
            };
        }
        let mut queue = VecDeque::from([start_id.to_owned()]);
        let mut predecessor: HashMap<String, (String, usize)> = HashMap::new();
        predecessor.insert(start_id.to_owned(), (start_id.to_owned(), usize::MAX));
        while let Some(current) = queue.pop_front() {
            if current == goal_id {
                break;
            }
            let mut outgoing: Vec<_> = self
                .edges
                .iter()
                .enumerate()
                .filter(|(_, edge)| self.is_public_edge(edge) && edge.source_id == current)
                .collect();
            outgoing.sort_by(|(_, left), (_, right)| {
                left.target_id
                    .cmp(&right.target_id)
                    .then_with(|| left.edge_id.cmp(&right.edge_id))
            });
            for (edge_index, edge) in outgoing {
                if !predecessor.contains_key(&edge.target_id) {
                    predecessor.insert(edge.target_id.clone(), (current.clone(), edge_index));
                    queue.push_back(edge.target_id.clone());
                }
            }
        }
        if !predecessor.contains_key(goal_id) {
            return PathResult {
                release_id: self.release_id.clone(),
                start_id: start_id.to_owned(),
                goal_id: goal_id.to_owned(),
                found: false,
                steps: Vec::new(),
            };
        }
        let mut ids = vec![goal_id.to_owned()];
        let mut cursor = goal_id;
        while cursor != start_id {
            let (prior, _) = &predecessor[cursor];
            ids.push(prior.clone());
            cursor = prior;
        }
        ids.reverse();
        let steps = ids
            .iter()
            .enumerate()
            .filter_map(|(index, id)| {
                self.node(id)
                    .filter(|node| is_public_node(node))
                    .map(|node| {
                        let via = (index > 0).then(|| {
                            let (_, edge_index) = predecessor[id];
                            public_edge(&self.edges[edge_index])
                        });
                        let explanation = via.as_ref().map_or_else(
                            || "Selected path entry.".to_owned(),
                            |edge| {
                                if edge.rationale.is_empty() {
                                    format!("Connected by {}.", edge.kind.replace('_', " "))
                                } else {
                                    edge.rationale.clone()
                                }
                            },
                        );
                        PathStep {
                            node: public_node(node),
                            via,
                            explanation,
                        }
                    })
            })
            .collect();
        PathResult {
            release_id: self.release_id.clone(),
            start_id: start_id.to_owned(),
            goal_id: goal_id.to_owned(),
            found: true,
            steps,
        }
    }

    pub fn misconception_remediation(&self, id: &str) -> Result<GraphResult, String> {
        let node = self
            .node(id)
            .ok_or_else(|| "misconception does not exist".to_owned())?;
        if node.kind != "misconception" {
            return Err("selected node is not a misconception".to_owned());
        }
        self.neighborhood(id, 1, 40, &HashSet::new())
    }

    pub fn tours(&self) -> Vec<Tour> {
        tours()
    }

    pub fn catalog(&self, kind: &str, prefix: Option<&str>, limit: usize) -> Vec<GraphNode> {
        let mut nodes: Vec<_> = self
            .nodes
            .iter()
            .filter(|node| {
                is_public_node(node)
                    && node.kind == kind
                    && prefix.is_none_or(|prefix| node.id.starts_with(prefix))
            })
            .map(public_node)
            .collect();
        nodes.sort_by(|left, right| {
            left.title
                .cmp(&right.title)
                .then_with(|| left.id.cmp(&right.id))
        });
        nodes.truncate(limit.clamp(1, 1_000));
        nodes
    }

    pub fn project_detail(&self, project_id: &str) -> Result<Value, String> {
        let project = self
            .node(project_id)
            .filter(|node| is_public_node(node) && node.kind == "project")
            .map(public_node)
            .ok_or_else(|| "project does not exist".to_owned())?;
        let mut stage_ids: Vec<_> = self
            .edges
            .iter()
            .filter(|edge| {
                self.is_public_edge(edge) && edge.kind == "part_of" && edge.target_id == project_id
            })
            .map(|edge| edge.source_id.clone())
            .collect();
        stage_ids.sort();
        let stages: Vec<_> = stage_ids
            .iter()
            .enumerate()
            .filter_map(|(position, stage_id)| {
                let stage = public_node(self.node(stage_id).filter(|node| is_public_node(node))?);
                let mut relations: Vec<_> = self
                    .edges
                    .iter()
                    .filter(|edge| {
                        self.is_public_edge(edge)
                            && (edge.source_id == *stage_id || edge.target_id == *stage_id)
                    })
                    .filter(|edge| {
                        [
                            "prerequisite_of",
                            "assesses",
                            "produces_artifact",
                            "verified_by",
                            "stage_after",
                            "practices",
                        ]
                        .contains(&edge.kind.as_str())
                    })
                    .map(public_edge)
                    .collect();
                relations.sort_by(|left, right| left.edge_id.cmp(&right.edge_id));
                Some(serde_json::json!({
                    "stage":stage,
                    "relations":relations,
                    "runnable":crate::evaluator::has_test_contract(stage_id),
                    "tutorOverlay":crate::project::tutor_overlay(stage_id, position + 1)
                }))
            })
            .collect();
        let entry_prerequisites: Vec<_> = self
            .edges
            .iter()
            .filter(|edge| {
                self.is_public_edge(edge)
                    && edge.kind == "prerequisite_of"
                    && stage_ids.contains(&edge.target_id)
            })
            .filter_map(|edge| {
                self.node(&edge.source_id)
                    .filter(|node| is_public_node(node))
                    .map(public_node)
            })
            .collect();
        Ok(serde_json::json!({
            "releaseId":self.release_id,
            "project":project,
            "stages":stages,
            "entryPrerequisites":entry_prerequisites,
            "templates":project_templates(),
            "portfolioChecklist":[
                "README and architecture",
                "reproducible setup and pinned versions",
                "visible, unseen, regression, failure, and resource tests",
                "measurements with correctness oracle",
                "limitations and residual risks",
                "demo proof and license inventory"
            ]
        }))
    }

    pub fn curriculum(&self) -> Value {
        let definitions = [
            (
                "MOD-RUST-00",
                "Independence and toolchain",
                ["LEARN", "TOOLCHAIN", "STATIC-CHECK"].as_slice(),
            ),
            (
                "MOD-RUST-01",
                "Bindings, functions, control flow, and types",
                ["BINDING", "FUNCTION", "CONTROL-FLOW", "TYPE-INTERPRETATION"].as_slice(),
            ),
            (
                "MOD-RUST-02",
                "Ownership, strings, slices, and borrowing",
                ["OWNERSHIP", "MOVE", "BORROW", "SCOPE-DROP", "COPY"].as_slice(),
            ),
            (
                "MOD-RUST-03",
                "Modules, crates, visibility, and API boundaries",
                [
                    "MODULE",
                    "CRATE",
                    "PACKAGE",
                    "VISIBILITY",
                    "ITEM-PATH",
                    "REEXPORT",
                ]
                .as_slice(),
            ),
            (
                "MOD-RUST-04",
                "Collections, iterators, and closures",
                ["COLLECTION", "ITERATOR", "ITERATION", "CLOSURE"].as_slice(),
            ),
            (
                "MOD-RUST-05",
                "Generics, traits, and lifetimes",
                ["GENERIC", "TRAIT", "LIFETIME", "MONOMORPHIZATION"].as_slice(),
            ),
            (
                "MOD-RUST-06",
                "Errors, testing, and debugging",
                ["ERROR", "TEST", "DEBUG", "FAILURE-FIXTURE"].as_slice(),
            ),
            (
                "MOD-RUST-07",
                "Threads and bounded concurrency",
                [
                    "THREAD",
                    "CHANNEL",
                    "SHARED-STATE",
                    "LOCK",
                    "DEADLOCK",
                    "CONCURRENCY",
                ]
                .as_slice(),
            ),
            (
                "MOD-RUST-08",
                "Async, Tokio, cancellation, and shutdown",
                [
                    "ASYNC",
                    "POLL-WAKE",
                    "CANCEL",
                    "GRACEFUL",
                    "BLOCKING-BOUNDARY",
                ]
                .as_slice(),
            ),
            (
                "MOD-RUST-09",
                "Cargo and production engineering",
                [
                    "WORKSPACE",
                    "QUALITY-GATE",
                    "RELEASE",
                    "REPRODUCIBLE",
                    "OPERABILITY",
                    "CI-MATRIX",
                ]
                .as_slice(),
            ),
            (
                "MOD-ALG-01",
                "Algorithms, invariants, and pattern selection",
                ["CON-ALG", "ALG-PAT"].as_slice(),
            ),
            (
                "MOD-DATA-01",
                "Data systems and deterministic failure labs",
                ["CON-DATA", "DATA-PAT"].as_slice(),
            ),
        ];
        let allowed_kinds = [
            "concept",
            "learning_outcome",
            "algorithm_pattern",
            "tool",
            "compiler_error",
            "exercise",
            "assessment",
        ];
        // Each node belongs to at most one module: the first definition whose
        // terms match. Records are sorted before any display cap so membership
        // and order are deterministic across releases.
        // Membership is term-derived, not hand-authored, and only ~40%
        // of graph nodes match a term — so this is a curated *topic index* into
        // the graph for the reference view, never the exhaustive concept map.
        // The full map is served by the graph and search endpoints; the authored
        // from-zero course (course.ts) is the primary learning path. Replacing
        // this with authored per-node module metadata in the feed is a content-
        // pipeline change we deliberately skip while the course carries teaching.
        let mut memberships: BTreeMap<&str, Vec<GraphNode>> = BTreeMap::new();
        for node in self
            .nodes
            .iter()
            .filter(|node| is_public_node(node) && allowed_kinds.contains(&node.kind.as_str()))
        {
            if let Some((module_id, _, _)) = definitions
                .iter()
                .find(|(_, _, terms)| terms.iter().any(|term| node.id.contains(term)))
            {
                memberships
                    .entry(module_id)
                    .or_default()
                    .push(public_node(node));
            }
        }
        let modules: Vec<_> = definitions
            .iter()
            .map(|(id, title, _)| {
                let mut records = memberships.remove(id).unwrap_or_default();
                records.sort_by(|left, right| left.id.cmp(&right.id));
                records.truncate(36);
                serde_json::json!({
                    "id":id,
                    "title":title,
                    "status":"released",
                    "records":records,
                    "review":{
                        "technical":"accepted",
                        "editorial":"accepted",
                        "accessibility":"accepted",
                        "reviewer":"Maintainer technical/editorial/accessibility review",
                        "reviewedAt":"2026-07-18"
                    }
                })
            })
            .collect();
        serde_json::json!({
            "releaseId":self.release_id,
            "modules":modules,
            "ordering":"Reviewed prerequisite DAG; blocked means guidance, never route denial.",
            "virtualizationDecision":"not_earned_below_200_visible_rows"
        })
    }

    fn validate_prerequisite_dag(&self) -> Result<(), String> {
        let mut indegree: HashMap<&str, usize> = self
            .nodes
            .iter()
            .map(|node| (node.id.as_str(), 0))
            .collect();
        let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
        for edge in self
            .edges
            .iter()
            .filter(|edge| edge.kind == "prerequisite_of")
        {
            *indegree.entry(&edge.target_id).or_default() += 1;
            outgoing
                .entry(&edge.source_id)
                .or_default()
                .push(&edge.target_id);
        }
        let mut queue: VecDeque<_> = indegree
            .iter()
            .filter(|(_, count)| **count == 0)
            .map(|(id, _)| *id)
            .collect();
        let mut visited = 0;
        while let Some(id) = queue.pop_front() {
            visited += 1;
            for target in outgoing.get(id).into_iter().flatten() {
                let count = indegree.get_mut(target).expect("known target");
                *count -= 1;
                if *count == 0 {
                    queue.push_back(target);
                }
            }
        }
        if visited != self.nodes.len() {
            return Err("prerequisite graph contains a cycle".to_owned());
        }
        Ok(())
    }

    fn validate_tours(&self) -> Result<(), String> {
        let authored = tours();
        if authored.len() != 12
            || authored
                .iter()
                .any(|tour| tour.draft || tour.steps.is_empty())
        {
            return Err("all twelve required guided tours must be released".to_owned());
        }
        for tour in authored {
            for step in tour.steps {
                let lesson_valid = step.lesson_id.is_none_or(|lesson| {
                    self.node(lesson).is_some_and(|node| node.kind == "lesson")
                });
                let exercise_valid = step.exercise_id.is_none_or(|exercise| {
                    self.node(exercise)
                        .is_some_and(|node| node.kind == "exercise")
                        && crate::evaluator::has_test_contract(exercise)
                });
                if self.node(step.node_id).is_none()
                    || step.what.is_empty()
                    || step.why_now.is_empty()
                    || step.previous_connection.is_empty()
                    || !lesson_valid
                    || !exercise_valid
                    || step.project_id.is_empty()
                {
                    return Err(format!("{} contains an invalid tour step", tour.id));
                }
            }
        }
        Ok(())
    }
}

/// Build the only graph-node shape that may cross an API boundary.
///
/// The canonical feed intentionally carries evaluator and editorial metadata in
/// flattened node fields. Keeping the allowlist here means a newly-added feed
/// field stays private until it is deliberately reviewed for publication.
fn public_node(node: &GraphNode) -> GraphNode {
    let mut detail = BTreeMap::new();
    for key in [
        "category",
        "difficulty",
        "family",
        "lessonId",
        "moduleId",
        "pageRole",
        "pattern",
        "projectId",
        "upstreamSequence",
        "variant",
    ] {
        if let Some(value) = node.detail.get(key).and_then(Value::as_str) {
            detail.insert(key.to_owned(), Value::String(value.to_owned()));
        }
    }
    for key in [
        "difficultyTier",
        "estimateMinutes",
        "number",
        "pageSequence",
        "sequence",
        "tier",
    ] {
        if let Some(value) = node.detail.get(key).and_then(Value::as_u64) {
            detail.insert(key.to_owned(), Value::from(value));
        }
    }
    for key in ["runnable", "scored"] {
        if let Some(value) = node.detail.get(key).and_then(Value::as_bool) {
            detail.insert(key.to_owned(), Value::Bool(value));
        }
    }
    if let Some(route) = node
        .detail
        .get("routeTarget")
        .and_then(Value::as_str)
        .filter(|route| route.starts_with('/') && !route.chars().any(char::is_control))
    {
        detail.insert("routeTarget".to_owned(), Value::String(route.to_owned()));
    }
    if let Some(arc) = node.detail.get("arc").and_then(Value::as_object) {
        let id = arc.get("id").and_then(Value::as_str);
        let sequence = arc.get("sequence").and_then(Value::as_u64);
        let title = arc.get("title").and_then(Value::as_str);
        if let (Some(id), Some(sequence), Some(title)) = (id, sequence, title) {
            detail.insert(
                "arc".to_owned(),
                serde_json::json!({"id": id, "sequence": sequence, "title": title}),
            );
        }
    }
    GraphNode {
        id: node.id.clone(),
        kind: node.kind.clone(),
        title: node.title.clone(),
        summary: node.summary.clone(),
        content_version: node.content_version.clone(),
        review_state: node.review_state.clone(),
        provenance_ids: node.provenance_ids.clone(),
        // The public projection deliberately drops the search corpus.
        search_text: String::new(),
        detail,
    }
}

pub(crate) fn is_public_node(node: &GraphNode) -> bool {
    node.kind != "test_group" && !node.id.starts_with("TST-")
}

/// Public edges deliberately expose no flattened extension fields. All fields
/// needed to explain and render a relationship are part of the typed record.
fn public_edge(edge: &GraphEdge) -> GraphEdge {
    GraphEdge {
        edge_id: edge.edge_id.clone(),
        source_id: edge.source_id.clone(),
        target_id: edge.target_id.clone(),
        kind: edge.kind.clone(),
        rationale: edge.rationale.clone(),
        provenance_ids: edge.provenance_ids.clone(),
        content_version: edge.content_version.clone(),
        confidence: edge.confidence.clone(),
        review_state: edge.review_state.clone(),
        detail: BTreeMap::new(),
    }
}

fn curriculum_node(kind: &str, entity: &Value, id: &str) -> GraphNode {
    let mut detail: BTreeMap<String, Value> = entity
        .as_object()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .collect();
    for key in ["id", "title", "summary", "sourceIds"] {
        detail.remove(key);
    }
    // Indexed for search, never published: lifting it out of `detail` keeps the
    // full page prose out of every graph and catalog payload.
    let search_text = detail
        .remove("searchText")
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default();
    detail.insert(
        "routeTarget".to_owned(),
        Value::String(curriculum_route(kind, entity, id)),
    );
    GraphNode {
        id: id.to_owned(),
        kind: kind.to_owned(),
        title: entity
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(id)
            .to_owned(),
        summary: entity
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        content_version: "2.0.0".to_owned(),
        review_state: "accepted".to_owned(),
        provenance_ids: entity
            .get("sourceIds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        search_text,
        detail,
    }
}

fn curriculum_route(kind: &str, entity: &Value, id: &str) -> String {
    match kind {
        "resource" => "/library".to_owned(),
        "module" => format!("/curriculum/{id}"),
        "lesson" => format!("/lessons/{id}"),
        "exercise" if entity.get("family").and_then(Value::as_str) == Some("interview") => {
            format!("/practice/algorithms/{id}")
        }
        "exercise" => format!("/practice/rust/{id}"),
        "project" => format!("/projects/{id}"),
        "project_stage" => entity.get("projectId").and_then(Value::as_str).map_or_else(
            || format!("/projects/{id}"),
            |project| format!("/projects/{project}"),
        ),
        _ => format!("/graph?id={id}&depth=1"),
    }
}

fn curriculum_edge(edge: &Value) -> Result<GraphEdge, String> {
    let id = edge
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "curriculum graph edge requires an id".to_owned())?;
    let source = edge
        .get("sourceId")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{id} requires sourceId"))?;
    let target = edge
        .get("targetId")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{id} requires targetId"))?;
    let legacy_kind = edge
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{id} requires kind"))?;
    let (source, target, kind) = match legacy_kind {
        "prerequisite" | "prerequisite_of" => (source, target, "prerequisite_of"),
        "practices" => (source, target, "practices"),
        "applies-in" | "transfers_to" => (source, target, "transfers_to"),
        "continues" => (target, source, "stage_after"),
        "contains" => (target, source, "part_of"),
        "assesses" => (source, target, "assesses"),
        "part_of" => (source, target, "part_of"),
        "stage_after" => (source, target, "stage_after"),
        "precedes" => (source, target, "precedes"),
        other => return Err(format!("{id} has unsupported curriculum edge kind {other}")),
    };
    Ok(GraphEdge {
        edge_id: id.to_owned(),
        source_id: source.to_owned(),
        target_id: target.to_owned(),
        kind: kind.to_owned(),
        rationale: edge
            .get("rationale")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        provenance_ids: Vec::new(),
        content_version: "2.0.0".to_owned(),
        confidence: "high".to_owned(),
        review_state: "accepted".to_owned(),
        detail: BTreeMap::new(),
    })
}

fn slice_node(id: &str, kind: &str, title: &str, summary: &str, release: &str) -> GraphNode {
    GraphNode {
        id: id.to_owned(),
        kind: kind.to_owned(),
        title: title.to_owned(),
        summary: summary.to_owned(),
        content_version: release.to_owned(),
        review_state: "accepted".to_owned(),
        provenance_ids: vec![release.to_owned()],
        search_text: String::new(),
        detail: BTreeMap::new(),
    }
}

fn slice_edge(edge_id: String, source: &str, target: &str, kind: &str, release: &str) -> GraphEdge {
    GraphEdge {
        edge_id,
        source_id: source.to_owned(),
        target_id: target.to_owned(),
        kind: kind.to_owned(),
        rationale: String::new(),
        provenance_ids: vec![release.to_owned()],
        content_version: release.to_owned(),
        confidence: "high".to_owned(),
        review_state: "accepted".to_owned(),
        detail: BTreeMap::new(),
    }
}

fn tutor_slice_projection() -> Result<(Vec<GraphNode>, Vec<GraphEdge>), String> {
    let slice = crate::tutor::TutorContent::load_embedded()?;
    let release = &slice.release_id;
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    nodes.push(slice_node(
        &slice.lesson.id,
        "lesson",
        &slice.lesson.title,
        &slice.lesson.summary,
        release,
    ));
    let mut concepts = BTreeMap::new();
    for outcome in &slice.outcomes {
        nodes.push(slice_node(
            &outcome.id,
            "learning_outcome",
            &outcome.title,
            &outcome.observable,
            release,
        ));
        concepts.insert(outcome.concept_id.clone(), outcome.title.clone());
        edges.push(slice_edge(
            format!("EDG-SLICE-TEACHES-{}", outcome.id),
            &slice.lesson.id,
            &outcome.id,
            "assessed_by",
            release,
        ));
    }
    for (concept_id, title) in &concepts {
        nodes.push(slice_node(
            concept_id,
            "concept",
            title,
            "Concept taught by the active ownership slice.",
            release,
        ));
    }
    for outcome in &slice.outcomes {
        edges.push(slice_edge(
            format!("EDG-SLICE-CONCEPT-{}", outcome.id),
            &outcome.concept_id,
            &outcome.id,
            "assessed_by",
            release,
        ));
    }
    for prerequisite in &slice.prerequisites {
        edges.push(slice_edge(
            format!(
                "EDG-SLICE-PREREQ-{}-{}",
                prerequisite.source_id, prerequisite.target_id
            ),
            &prerequisite.source_id,
            &prerequisite.target_id,
            "prerequisite_of",
            release,
        ));
    }
    for exercise in &slice.exercises {
        nodes.push(slice_node(
            &exercise.id,
            "exercise",
            &exercise.title,
            &exercise.prompt,
            release,
        ));
        for outcome_id in &exercise.outcome_ids {
            edges.push(slice_edge(
                format!("EDG-SLICE-ASSESSES-{}-{outcome_id}", exercise.id),
                &exercise.id,
                outcome_id,
                "assesses",
                release,
            ));
        }
    }
    for item in &slice.diagnostic {
        nodes.push(slice_node(
            &item.id,
            "assessment",
            &item.prompt,
            "Diagnostic check from the active ownership slice.",
            release,
        ));
        edges.push(slice_edge(
            format!("EDG-SLICE-DIAG-{}", item.id),
            &item.id,
            &item.outcome_id,
            "assesses",
            release,
        ));
    }
    Ok((nodes, edges))
}

pub fn safe_fts_query(raw: &str) -> Option<String> {
    let tokens: Vec<_> = raw
        .split(|character: char| {
            !character.is_alphanumeric() && character != '-' && character != '_'
        })
        .filter(|token| !token.is_empty())
        .take(8)
        .map(|token| {
            let clean: String = token.chars().take(48).collect();
            format!("\"{}\"*", clean.replace('"', ""))
        })
        .collect();
    (!tokens.is_empty()).then(|| tokens.join(" AND "))
}

fn edge_legend() -> BTreeMap<String, String> {
    BTreeMap::from([
        (
            "prerequisite_of".to_owned(),
            "must be ready before".to_owned(),
        ),
        (
            "assessed_by".to_owned(),
            "observable evidence checked by".to_owned(),
        ),
        (
            "causes_error".to_owned(),
            "can produce compiler error".to_owned(),
        ),
        (
            "resolves_error".to_owned(),
            "authored remedy for error".to_owned(),
        ),
        (
            "debugged_with".to_owned(),
            "investigated with local tool".to_owned(),
        ),
        (
            "measured_by".to_owned(),
            "bounded by evidence or metric".to_owned(),
        ),
        (
            "applied_in".to_owned(),
            "transferred into project".to_owned(),
        ),
    ])
}

fn project_templates() -> Value {
    serde_json::json!({
        "adr":{"required":["context","options","decision","tradeOffs","revisitTrigger"]},
        "slo":{"required":["indicator","objective","window","errorBudget","action"]},
        "threatModel":{"required":["assets","actors","trustBoundaries","controls","residualRisk"]},
        "testPlan":{"required":["oracle","fixtures","visible","unseen","regression","failure","resource"]},
        "benchmark":{"required":["correctnessOracle","fixture","toolchain","machine","baseline","samples","caveats"]},
        "postmortem":{"required":["impact","timeline","rootCause","contributingFactors","recovery","followUps"]}
    })
}

/// Ownership is the only subject with a shipped lesson and an executable
/// exercise contract in this release; tours for other subjects link only their
/// canonical graph nodes instead of borrowing ownership resources.
fn subject_resources(tour_id: &str) -> (Option<&'static str>, Option<&'static str>) {
    match tour_id {
        "TOUR-001" | "TOUR-002" | "TOUR-009" | "TOUR-011" => (
            Some("UNIT-OWNERSHIP-001"),
            Some("EX-OWNERSHIP-INDEPENDENT-001"),
        ),
        "TOUR-008" => (None, Some("EXE-ALG-CATALOG-PROBE-001")),
        _ => (None, None),
    }
}

fn tours() -> Vec<Tour> {
    let definitions: [(&str, &str, &str, [&str; 3], &str); 12] = [
        (
            "TOUR-001",
            "Rust fundamentals",
            "No prerequisite beyond a local toolchain.",
            [
                "CON-RUST-BINDING-001",
                "CON-RUST-OWNERSHIP-001",
                "CON-RUST-SHARED-BORROW-001",
            ],
            "PRJ-PULSE",
        ),
        (
            "TOUR-002",
            "Ownership and borrowing",
            "Begin after binding and expression recall.",
            [
                "CON-RUST-OWNERSHIP-001",
                "ERR-RUST-E0382-001",
                "CON-RUST-SHARED-BORROW-001",
            ],
            "PRJ-PULSE",
        ),
        (
            "TOUR-003",
            "Synchronous to asynchronous Rust",
            "Begin after ownership across thread boundaries.",
            [
                "CON-RUST-THREAD-LIFECYCLE-001",
                "CON-RUST-ASYNC-SUITABILITY-001",
                "CON-RUST-ASYNC-TASK-LIFECYCLE-001",
            ],
            "PRJ-PULSE",
        ),
        (
            "TOUR-004",
            "Tokio application flow",
            "Begin after async task lifecycle evidence.",
            [
                "CRT-TOKIO-001",
                "CON-RUST-ASYNC-CANCELLATION-001",
                "CON-RUST-GRACEFUL-SHUTDOWN-001",
            ],
            "PRJ-PULSE",
        ),
        (
            "TOUR-005",
            "Files to data pipeline",
            "Begin after Result-based error handling.",
            [
                "CON-DATA-INGEST-RESOURCE-BOUND-001",
                "CON-RUST-CSV-CONTRACT-001",
                "DATA-PAT-STRICT-TYPED-CSV-001",
            ],
            "PRJ-QUAY",
        ),
        (
            "TOUR-006",
            "Production Rust engineering",
            "Begin after a tested command-line program.",
            [
                "TOL-CARGO-001",
                "TOL-CLIPPY-001",
                "CON-RUST-RELEASE-PACKAGE-001",
            ],
            "PRJ-QUAY",
        ),
        (
            "TOUR-007",
            "Arrow, Parquet, and DataFusion",
            "Begin after bounded typed ingestion.",
            [
                "CON-DATA-ARROW-ARRAY-LAYOUT-001",
                "CON-DATA-PARQUET-FILE-HIERARCHY-001",
                "CON-RUST-DATAFUSION-QUERY-001",
            ],
            "PRJ-QUAY",
        ),
        (
            "TOUR-008",
            "Algorithm foundations",
            "Begin with explicit input and cost models.",
            [
                "CON-ALG-LOOP-INVARIANT-001",
                "ALG-PAT-EXACT-BINARY-SEARCH-001",
                "ASM-ALG-COMPLEXITY-INVARIANT-001",
            ],
            "PRJ-PULSE",
        ),
        (
            "TOUR-009",
            "PULSE path",
            "Begin after ownership and basic ingestion evidence.",
            [
                "CON-RUST-OWNERSHIP-001",
                "PRJ-PULSE",
                "OUT-PRJ-PULSE-RELEASE-001",
            ],
            "PRJ-PULSE",
        ),
        (
            "TOUR-010",
            "QUAY path",
            "Begin after PULSE exit evidence.",
            [
                "OUT-PRJ-PULSE-RELEASE-001",
                "PRJ-QUAY",
                "OUT-PRJ-QUAY-RELEASE-001",
            ],
            "PRJ-QUAY",
        ),
        (
            "TOUR-011",
            "Independence from LLM assistance",
            "Begin on the first evidence-producing attempt.",
            [
                "CON-LEARN-ATTEMPT-FIRST-001",
                "CON-LEARN-HELP-LEVEL-001",
                "ASM-LEARN-HELP-INDEPENDENCE-001",
            ],
            "PRJ-QUAY",
        ),
        (
            "TOUR-012",
            "TESSERA path",
            "Requires accepted QUAY exit evidence.",
            [
                "OUT-PRJ-QUAY-RELEASE-001",
                "PRJ-TESSERA",
                "OUT-PRJ-TESSERA-RELEASE-001",
            ],
            "PRJ-TESSERA",
        ),
    ];
    definitions
        .into_iter()
        .map(|(id, title, gate, ids, project)| {
            let (lesson_id, exercise_id) = subject_resources(id);
            Tour {
                id,
                title,
                entry_gate: gate,
                draft: false,
                steps: ids
                    .into_iter()
                    .enumerate()
                    .map(|(index, node)| TourStep {
                        node_id: node,
                        what: "Open the canonical concept, inspect its evidence contract, then attempt the linked practice.",
                        why_now: "This is the next reviewed dependency on the selected path.",
                        previous_connection: if index == 0 {
                            "This is the tour entry and states its readiness gate."
                        } else {
                            "The prior step supplies the prerequisite or transfer context."
                        },
                        lesson_id,
                        exercise_id,
                        project_id: project,
                    })
                    .collect(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str) -> GraphNode {
        GraphNode {
            id: id.to_owned(),
            kind: "lesson".to_owned(),
            title: id.to_owned(),
            summary: String::new(),
            content_version: "test".to_owned(),
            review_state: "accepted".to_owned(),
            provenance_ids: Vec::new(),
            search_text: String::new(),
            detail: BTreeMap::new(),
        }
    }

    fn edge(id: &str, source: &str, target: &str, kind: &str) -> GraphEdge {
        GraphEdge {
            edge_id: id.to_owned(),
            source_id: source.to_owned(),
            target_id: target.to_owned(),
            kind: kind.to_owned(),
            rationale: String::new(),
            provenance_ids: Vec::new(),
            content_version: "test".to_owned(),
            confidence: "high".to_owned(),
            review_state: "accepted".to_owned(),
            detail: BTreeMap::new(),
        }
    }

    fn assert_no_server_only_keys(value: &Value) {
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    let normalized = key
                        .chars()
                        .filter(|character| character.is_alphanumeric())
                        .flat_map(char::to_lowercase)
                        .collect::<String>();
                    assert!(
                        ![
                            "hidden",
                            "hiddentests",
                            "hiddencontract",
                            "regression",
                            "regressiontests",
                            "regressioncontract",
                            "evaluator",
                            "evaluatorkind",
                            "disclosurepolicy",
                            "determinismrule",
                            "referencesolution",
                            "solution",
                            "solutionfiles",
                            "solutionreveal",
                            "solutionrevealexplanation",
                            "reveal",
                            "revealexplanation",
                            "environment",
                            "environmentsettings",
                            "locked",
                            "lockedfile",
                            "lockedfiles",
                        ]
                        .contains(&normalized.as_str()),
                        "public projection leaked {key}"
                    );
                    assert_no_server_only_keys(child);
                }
            }
            Value::Array(items) => items.iter().for_each(assert_no_server_only_keys),
            Value::String(text) => assert!(
                !text.contains("SERVER_SECRET_MARKER"),
                "public projection leaked a server-only marker"
            ),
            _ => {}
        }
    }

    #[test]
    fn v2_projection_has_no_dangling_edges_and_complete_legend() {
        let graph = RuntimeGraph::load_embedded().expect("combined graph");
        assert!(graph.nodes.iter().any(|node| node.id == "LESSON-BOOK-01"));
        assert!(
            graph
                .edges
                .iter()
                .all(|edge| graph.node(&edge.source_id).is_some()
                    && graph.node(&edge.target_id).is_some())
        );
        let result = graph
            .neighborhood("LESSON-BOOK-01", 1, 200, &HashSet::new())
            .unwrap();
        assert!(
            result
                .edges
                .iter()
                .all(|edge| result.legend.contains_key(&edge.kind))
        );
    }

    #[test]
    fn v2_graph_map_and_catalog_never_expose_server_contracts() {
        let graph = RuntimeGraph::load_embedded().expect("combined graph");
        let evaluator_node = graph.node("TST-ALG-DP-001").expect("real evaluator node");
        assert!(evaluator_node.detail.contains_key("evaluatorKind"));
        assert!(evaluator_node.detail.contains_key("disclosurePolicy"));
        assert!(
            graph
                .neighborhood("TST-ALG-DP-001", 0, 1, &HashSet::new())
                .is_err(),
            "direct private-node selection must reveal nothing"
        );
        assert!(graph.catalog("test_group", None, 1_000).is_empty());
        assert!(!graph.path("TST-ALG-DP-001", "PRJ-QUAY").found);
        assert!(
            !graph
                .prerequisite_closure("TST-ALG-DP-001", &HashSet::new())
                .found
        );
        assert_no_server_only_keys(
            &serde_json::to_value(
                graph
                    .neighborhood("mainmatter-01-intro-00-welcome", 1, 200, &HashSet::new())
                    .unwrap(),
            )
            .unwrap(),
        );
        assert_no_server_only_keys(&serde_json::to_value(graph.map_projection()).unwrap());
        let map = graph.map_projection();
        let map_ids: HashSet<_> = map.nodes.iter().map(|node| node.id.as_str()).collect();
        assert!(map.nodes.iter().all(|node| !node.id.starts_with("TST-")));
        assert!(
            map.edges
                .iter()
                .all(|edge| map_ids.contains(edge.source.as_str())
                    && map_ids.contains(edge.target.as_str()))
        );
        assert_no_server_only_keys(
            &serde_json::to_value(graph.catalog("exercise", None, 1_000)).unwrap(),
        );
        assert_no_server_only_keys(&graph.curriculum());
        assert_no_server_only_keys(&graph.project_detail("PRJ-PULSE").unwrap());
        assert_no_server_only_keys(
            &serde_json::to_value(graph.path("LESSON-BOOK-10", "mainmatter-01-intro-00-welcome"))
                .unwrap(),
        );
        let curriculum = crate::curriculum_v2::embedded().expect("curriculum");
        let hidden = curriculum
            .evaluation_contract("mainmatter-01-intro-00-welcome")
            .expect("server contract")
            .hidden_tests;
        assert!(
            !serde_json::to_string(&graph.nodes)
                .unwrap()
                .contains(&hidden)
        );
    }

    #[test]
    fn every_public_graph_projection_drops_malicious_nested_detail() {
        fn malicious_node(id: &str, kind: &str) -> GraphNode {
            let mut node = node(id);
            node.kind = kind.to_owned();
            node.detail.insert(
                "evaluatorKind".to_owned(),
                serde_json::json!({
                    "hidden": {
                        "solutionRevealExplanation": "SERVER_SECRET_MARKER"
                    }
                }),
            );
            node.detail.insert(
                "disclosurePolicy".to_owned(),
                Value::String("visible checks plus SERVER_SECRET_MARKER hidden cases".to_owned()),
            );
            node.detail.insert(
                "routeTarget".to_owned(),
                Value::String(format!("/graph?id={id}")),
            );
            node.detail.insert(
                "arc".to_owned(),
                serde_json::json!({
                    "id":"malicious",
                    "sequence":1,
                    "title":"Safe title",
                    "solution":"SERVER_SECRET_MARKER"
                }),
            );
            node.detail.insert(
                "family".to_owned(),
                serde_json::json!({"nested":"SERVER_SECRET_MARKER"}),
            );
            node
        }

        assert!(
            !is_public_node(&malicious_node("TST-MISTYPED-AS-CONCEPT", "concept")),
            "reserved evaluator IDs stay private even if their kind is corrupted"
        );

        let nodes = vec![
            malicious_node("CON-RUST-BINDING-MALICIOUS", "concept"),
            malicious_node("STAGE-MALICIOUS", "project_stage"),
            malicious_node("PROJECT-MALICIOUS", "project"),
        ];
        let mut prerequisite = edge(
            "EDGE-MALICIOUS-PREREQUISITE",
            "CON-RUST-BINDING-MALICIOUS",
            "STAGE-MALICIOUS",
            "prerequisite_of",
        );
        prerequisite.detail.insert(
            "regressionContract".to_owned(),
            serde_json::json!({"lockedFiles":["SERVER_SECRET_MARKER"]}),
        );
        let mut assessment = edge(
            "EDGE-MALICIOUS-ASSESSMENT",
            "STAGE-MALICIOUS",
            "CON-RUST-BINDING-MALICIOUS",
            "assesses",
        );
        assessment.detail.insert(
            "solution".to_owned(),
            Value::String("SERVER_SECRET_MARKER".to_owned()),
        );
        let containment = edge(
            "EDGE-MALICIOUS-CONTAINMENT",
            "STAGE-MALICIOUS",
            "PROJECT-MALICIOUS",
            "part_of",
        );
        let graph = RuntimeGraph {
            release_id: "test".to_owned(),
            checksum: "test".to_owned(),
            node_index: HashMap::from([
                ("CON-RUST-BINDING-MALICIOUS".to_owned(), 0),
                ("STAGE-MALICIOUS".to_owned(), 1),
                ("PROJECT-MALICIOUS".to_owned(), 2),
            ]),
            nodes,
            edges: vec![prerequisite, assessment, containment],
        };

        let public_values = [
            serde_json::to_value(
                graph
                    .neighborhood("CON-RUST-BINDING-MALICIOUS", 2, 20, &HashSet::new())
                    .unwrap(),
            )
            .unwrap(),
            serde_json::to_value(graph.map_projection()).unwrap(),
            serde_json::to_value(graph.catalog("concept", None, 20)).unwrap(),
            serde_json::to_value(graph.path("CON-RUST-BINDING-MALICIOUS", "PROJECT-MALICIOUS"))
                .unwrap(),
            serde_json::to_value(graph.prerequisite_closure("STAGE-MALICIOUS", &HashSet::new()))
                .unwrap(),
            graph.curriculum(),
            graph.project_detail("PROJECT-MALICIOUS").unwrap(),
        ];
        for value in public_values {
            assert_no_server_only_keys(&value);
            assert!(!value.to_string().contains("SERVER_SECRET_MARKER"));
        }

        let projected = public_node(&graph.nodes[0]);
        assert_eq!(
            projected.detail.get("arc"),
            Some(&serde_json::json!({
                "id":"malicious",
                "sequence":1,
                "title":"Safe title"
            }))
        );
        assert!(!projected.detail.contains_key("family"));
    }

    #[test]
    fn curriculum_routes_follow_real_family_routes() {
        assert_eq!(
            curriculum_route(
                "exercise",
                &serde_json::json!({"family":"mainmatter"}),
                "MM"
            ),
            "/practice/rust/MM"
        );
        assert_eq!(
            curriculum_route(
                "exercise",
                &serde_json::json!({"family":"interview"}),
                "INT"
            ),
            "/practice/algorithms/INT"
        );
        assert_eq!(
            curriculum_route("lesson", &Value::Null, "LESSON"),
            "/lessons/LESSON"
        );
        assert_eq!(
            curriculum_route(
                "project_stage",
                &serde_json::json!({"projectId":"PROJECT"}),
                "STAGE"
            ),
            "/projects/PROJECT"
        );
    }

    #[test]
    fn v2_edge_kinds_are_canonical_and_order_is_not_a_prerequisite() {
        let cases = [
            ("prerequisite", "prerequisite_of", "A", "B"),
            ("practices", "practices", "A", "B"),
            ("applies-in", "transfers_to", "A", "B"),
            ("contains", "part_of", "B", "A"),
            ("continues", "stage_after", "B", "A"),
            ("precedes", "precedes", "A", "B"),
        ];
        for (legacy, canonical, source, target) in cases {
            let edge = curriculum_edge(&serde_json::json!({
                "id":format!("EDGE-{legacy}"),
                "sourceId":"A",
                "targetId":"B",
                "kind":legacy,
                "rationale":"test"
            }))
            .unwrap();
            assert_eq!(edge.kind, canonical);
            assert_eq!(edge.source_id, source);
            assert_eq!(edge.target_id, target);
        }

        let nodes = vec![node("A"), node("B")];
        let graph = RuntimeGraph {
            release_id: "test".to_owned(),
            checksum: "test".to_owned(),
            node_index: HashMap::from([("A".to_owned(), 0), ("B".to_owned(), 1)]),
            nodes,
            edges: vec![
                edge("ORDER-A-B", "A", "B", "precedes"),
                edge("ORDER-B-A", "B", "A", "precedes"),
            ],
        };
        graph
            .validate_prerequisite_dag()
            .expect("display-order cycles are not prerequisite cycles");
        assert!(
            graph
                .prerequisite_closure("B", &HashSet::new())
                .steps
                .is_empty()
        );
    }

    #[test]
    fn enrichment_overlay_adds_error_catalogue_and_semantic_edges() {
        let graph = RuntimeGraph::load_embedded().expect("combined graph");
        let mut semantic_edges = HashSet::new();
        assert!(graph.edges.iter().all(|edge| semantic_edges.insert((
            edge.source_id.as_str(),
            edge.target_id.as_str(),
            edge.kind.as_str(),
        ))));
        let errors = graph
            .nodes
            .iter()
            .filter(|node| node.kind == "compiler_error")
            .count();
        assert!(
            errors >= 30,
            "expected an enriched error catalogue, got {errors}"
        );
        for kind in ["resolves_error", "commonly_confused_with", "contrasts_with"] {
            assert!(
                graph.edges.iter().any(|edge| edge.kind == kind),
                "missing semantic edge kind {kind}"
            );
        }
        let map = graph.map_projection();
        assert!(map.node_kinds.get("compiler_error").copied().unwrap_or(0) >= 30);
        assert!(
            map.edges
                .iter()
                .all(|edge| map.legend.contains_key(&edge.kind))
        );
    }
}
