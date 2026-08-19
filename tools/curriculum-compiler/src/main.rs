use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::{Component, Path, PathBuf},
};

const BOOK_COMMIT: &str = "05d114287b7d6f6c9253d5242540f00fbd6172ab";
const LICENSE: &str = "MIT OR Apache-2.0";
const ATTRIBUTION: &str =
    "The Rust Programming Language by The Rust Project Developers, used under MIT OR Apache-2.0.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    schema_version: u8,
    source_commit: &'static str,
    source_summary_path: &'static str,
    selected_page_count: usize,
    excluded_pages: [&'static str; 2],
    pages: Vec<Page>,
    redirects: Vec<Redirect>,
    preprocessors: Vec<ConfiguredPreprocessor>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfiguredPreprocessor {
    name: &'static str,
    command: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_mode: Option<&'static str>,
    inputs: Vec<HashedInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HashedInput {
    source_path: String,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    id: String,
    sequence: usize,
    title: String,
    depth: usize,
    source_commit: &'static str,
    source_path: String,
    canonical_url: String,
    sha256: String,
    resolved_sha256: String,
    license: &'static str,
    attribution: &'static str,
    change_notes: [&'static str; 1],
    previous_page_id: Option<String>,
    next_page_id: Option<String>,
    headings: Vec<Heading>,
    anchors: Vec<String>,
    links: Vec<Link>,
    assets: Vec<Asset>,
    includes: Vec<Include>,
    code_blocks: Vec<CodeBlockEvidence>,
    code_block_count: usize,
    fenced_code_block_count: usize,
    indented_code_block_count: usize,
    blocks: Vec<Node>,
}

#[derive(Clone, Debug)]
struct SummaryPage {
    title: String,
    path: String,
    depth: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Heading {
    level: u8,
    id: String,
    text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Link {
    source_target: String,
    title: String,
    target: ResolvedTarget,
}

#[derive(Clone, Debug)]
struct RawLink {
    source_target: String,
    title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum ResolvedTarget {
    BookPage {
        page_id: String,
        source_path: String,
        canonical_url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        anchor: Option<String>,
    },
    SourceDocument {
        document_id: String,
        source_path: String,
        canonical_url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        anchor: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        compatibility_alias: Option<String>,
    },
    External {
        url: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
    path: String,
    alt: String,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Include {
    directive: String,
    source_path: String,
    selector: Option<String>,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Redirect {
    source_alias: String,
    source_target: String,
    target: ResolvedTarget,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodeBlockEvidence {
    ordinal: usize,
    info: String,
    byte_length: usize,
    text_sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    attributes: Map<String, Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    children: Vec<Node>,
}

impl Node {
    fn container(kind: impl Into<String>, attributes: Map<String, Value>) -> Self {
        Self {
            kind: kind.into(),
            text: None,
            attributes,
            children: vec![],
        }
    }

    fn leaf(kind: impl Into<String>, text: Option<String>) -> Self {
        Self {
            kind: kind.into(),
            text,
            attributes: Map::new(),
            children: vec![],
        }
    }
}

#[derive(Default)]
struct ParsedPage {
    blocks: Vec<Node>,
    headings: Vec<Heading>,
    anchors: BTreeSet<String>,
    links: Vec<RawLink>,
    assets: Vec<(String, String)>,
    code_block_count: usize,
    fenced_code_block_count: usize,
    indented_code_block_count: usize,
    code_blocks: Vec<CodeBlockEvidence>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SourceKind {
    Book,
    Mainmatter,
}

#[derive(Clone, Debug)]
struct DocumentTarget {
    id: String,
    source_path: String,
    canonical_url: String,
    anchors: BTreeSet<String>,
}

fn main() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    match args.as_slice() {
        [_, snapshot, output] => compile_book(Path::new(snapshot), Path::new(output)),
        [_, mode, snapshot, output] if mode == "book" => {
            compile_book(Path::new(snapshot), Path::new(output))
        }
        [_, mode, source, going_further, output] if mode == "mainmatter" => compile_mainmatter(
            Path::new(source),
            Path::new(going_further),
            Path::new(output),
        ),
        _ => Err("usage: curriculum-compiler book <snapshot> <output> | curriculum-compiler mainmatter <mainmatter.json> <going_further.md> <output>".into()),
    }
}

fn compile_book(root: &Path, output: &Path) -> Result<(), String> {
    let src = root.join("src");
    let summary_path = src.join("SUMMARY.md");
    let summary = read_text(&summary_path)?;
    let all_pages = parse_summary(&summary)?;
    let selected: Vec<_> = all_pages
        .into_iter()
        .filter(|page| page.path != "title-page.md" && page.path != "foreword.md")
        .collect();
    if selected.len() != 109 {
        return Err(format!(
            "expected 109 selected SUMMARY pages, found {}",
            selected.len()
        ));
    }

    let mut targets = BTreeMap::new();
    for summary_page in &selected {
        let source_path = src.join(&summary_page.path);
        let source = read_text(&source_path)?;
        let (resolved, _) = resolve_includes(&source, &source_path, root)?;
        let mut parsed = parse_markdown(&resolved, &summary_page.path, SourceKind::Book)?;
        finish_page(&mut parsed)?;
        targets.insert(
            summary_page.path.clone(),
            DocumentTarget {
                id: page_id(&summary_page.path),
                source_path: format!("src/{}", summary_page.path),
                canonical_url: canonical_url(&summary_page.path),
                anchors: parsed.anchors,
            },
        );
    }

    let mut compiled = Vec::with_capacity(selected.len());
    for (index, summary_page) in selected.iter().enumerate() {
        let source_path = src.join(&summary_page.path);
        let source = read_text(&source_path)?;
        let (resolved, includes) = resolve_includes(&source, &source_path, root)?;
        let mut parsed = parse_markdown(&resolved, &summary_page.path, SourceKind::Book)?;
        finish_page(&mut parsed)?;
        let source_code = collect_source_code_blocks(&resolved)?;
        if source_code != parsed.code_blocks {
            return Err(format!(
                "{}: serialized code blocks differ from resolved source",
                summary_page.path
            ));
        }
        let links = resolve_links(
            &mut parsed.blocks,
            &parsed.links,
            &summary_page.path,
            &targets,
            SourceKind::Book,
        )?;

        let mut assets = Vec::with_capacity(parsed.assets.len());
        for (path, alt) in parsed.assets {
            let asset_path = normalized_join(&src, &source_path, &path)?;
            let bytes = fs::read(&asset_path)
                .map_err(|error| format!("{}: {error}", asset_path.display()))?;
            assets.push(Asset {
                path,
                alt,
                sha256: sha256(&bytes),
            });
        }
        assets.sort_by(|a, b| a.path.cmp(&b.path));
        assets.dedup_by(|a, b| a.path == b.path && a.alt == b.alt);

        compiled.push(Page {
            id: page_id(&summary_page.path),
            sequence: index + 1,
            title: summary_page.title.clone(),
            depth: summary_page.depth,
            source_commit: BOOK_COMMIT,
            source_path: format!("src/{}", summary_page.path),
            canonical_url: canonical_url(&summary_page.path),
            sha256: sha256(source.as_bytes()),
            resolved_sha256: sha256(resolved.as_bytes()),
            license: LICENSE,
            attribution: ATTRIBUTION,
            change_notes: [
                "Verbatim pinned source; mdBook includes resolved into typed blocks at build time.",
            ],
            previous_page_id: index.checked_sub(1).map(|i| page_id(&selected[i].path)),
            next_page_id: selected.get(index + 1).map(|page| page_id(&page.path)),
            headings: parsed.headings,
            anchors: parsed.anchors.into_iter().collect(),
            links,
            assets,
            includes,
            code_blocks: parsed.code_blocks,
            code_block_count: parsed.code_block_count,
            fenced_code_block_count: parsed.fenced_code_block_count,
            indented_code_block_count: parsed.indented_code_block_count,
            blocks: parsed.blocks,
        });
    }

    let document = Document {
        schema_version: 1,
        source_commit: BOOK_COMMIT,
        source_summary_path: "src/SUMMARY.md",
        selected_page_count: compiled.len(),
        excluded_pages: ["src/title-page.md", "src/foreword.md"],
        pages: compiled,
        redirects: read_redirects(root, &targets)?,
        preprocessors: read_preprocessors(root)?,
    };
    let serialized = serde_json::to_string_pretty(&document)
        .map_err(|error| format!("serialize compiled Book: {error}"))?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("{}: {error}", parent.display()))?;
    }
    fs::write(output, format!("{serialized}\n"))
        .map_err(|error| format!("{}: {error}", output.display()))?;
    Ok(())
}

fn compile_mainmatter(
    source_path: &Path,
    going_further_path: &Path,
    output: &Path,
) -> Result<(), String> {
    let source = read_text(source_path)?;
    let raw: Value = serde_json::from_str(&source)
        .map_err(|error| format!("{}: {error}", source_path.display()))?;
    let exercises = raw
        .get("exercises")
        .and_then(Value::as_array)
        .ok_or_else(|| "mainmatter.json exercises missing".to_string())?;
    if exercises.len() != 98 {
        return Err(format!(
            "expected 98 Mainmatter exercises, found {}",
            exercises.len()
        ));
    }
    let mut targets = BTreeMap::new();
    for exercise in exercises {
        let id = required_json_text(exercise, "/id")?;
        let path = required_json_text(exercise, "/sourceLesson/path")?;
        let markdown = required_json_text(exercise, "/sourceLesson/markdown")?;
        let mut parsed = parse_markdown(markdown, path, SourceKind::Mainmatter)?;
        finish_page(&mut parsed)?;
        targets.insert(
            path.to_string(),
            DocumentTarget {
                id: id.to_string(),
                source_path: path.to_string(),
                canonical_url: format!(
                    "https://github.com/mainmatter/100-exercises-to-learn-rust/blob/57d145e6d393dfffeadb97fc61e814255c3b6ffe/{path}"
                ),
                anchors: parsed.anchors,
            },
        );
    }
    let going_path = "book/src/going_further.md";
    let going_further = read_text(going_further_path)?;
    let mut going_parsed = parse_markdown(&going_further, going_path, SourceKind::Mainmatter)?;
    finish_page(&mut going_parsed)?;
    targets.insert(
        going_path.to_string(),
        DocumentTarget {
            id: "MAINMATTER-GOING-FURTHER".into(),
            source_path: going_path.into(),
            canonical_url: "https://github.com/mainmatter/100-exercises-to-learn-rust/blob/57d145e6d393dfffeadb97fc61e814255c3b6ffe/book/src/going_further.md".into(),
            anchors: going_parsed.anchors,
        },
    );
    let mut documents = vec![];
    for exercise in exercises {
        let id = required_json_text(exercise, "/id")?;
        let sequence = exercise
            .get("sequence")
            .and_then(Value::as_u64)
            .ok_or_else(|| format!("{id}: sequence missing"))?;
        let path = required_json_text(exercise, "/sourceLesson/path")?;
        let title = required_json_text(exercise, "/sourceLesson/title")?;
        let markdown = required_json_text(exercise, "/sourceLesson/markdown")?;
        let declared_hash = required_json_text(exercise, "/sourceLesson/sha256")?;
        let actual_hash = sha256(markdown.as_bytes());
        if declared_hash != actual_hash {
            return Err(format!("{id}: source lesson hash mismatch"));
        }
        let mut parsed = parse_markdown(markdown, path, SourceKind::Mainmatter)?;
        finish_page(&mut parsed)?;
        let links = resolve_links(
            &mut parsed.blocks,
            &parsed.links,
            path,
            &targets,
            SourceKind::Mainmatter,
        )?;
        documents.push(json!({
            "exerciseId": id,
            "sequence": sequence,
            "title": title,
            "sourceCommit": "57d145e6d393dfffeadb97fc61e814255c3b6ffe",
            "sourcePath": path,
            "canonicalUrl": format!("https://github.com/mainmatter/100-exercises-to-learn-rust/blob/57d145e6d393dfffeadb97fc61e814255c3b6ffe/{path}"),
            "sha256": actual_hash,
            "license": "CC-BY-NC-4.0",
            "attribution": "“100 Exercises to Learn Rust” by Luca Palmieri/Mainmatter, used under CC BY-NC 4.0.",
            "changeNotes": if path == "book/src/01_intro/01_syntax.md" {
                vec![
                    "Verbatim pinned source lesson compiled to typed blocks; Rust Tutor metadata is separate.",
                    "The stale source fragment wr-the-workshop-runner is retained as a compatibility alias and resolves to the pinned heading anchor workshop-runner-wr.",
                ]
            } else {
                vec!["Verbatim pinned source lesson compiled to typed blocks; Rust Tutor metadata is separate."]
            },
            "headings": parsed.headings,
            "anchors": parsed.anchors,
            "links": links,
            "codeBlocks": parsed.code_blocks,
            "codeBlockCount": parsed.code_block_count,
            "fencedCodeBlockCount": parsed.fenced_code_block_count,
            "indentedCodeBlockCount": parsed.indented_code_block_count,
            "blocks": parsed.blocks,
        }));
    }
    documents.sort_by_key(|document| document["sequence"].as_u64().unwrap_or_default());

    let mut parsed = parse_markdown(&going_further, going_path, SourceKind::Mainmatter)?;
    finish_page(&mut parsed)?;
    let links = resolve_links(
        &mut parsed.blocks,
        &parsed.links,
        going_path,
        &targets,
        SourceKind::Mainmatter,
    )?;
    let compiled = json!({
        "schemaVersion": 1,
        "starterCommit": "57d145e6d393dfffeadb97fc61e814255c3b6ffe",
        "solutionCommit": "e77613749a55c19c63cf78e3b30cafc007f53dab",
        "exerciseCount": documents.len(),
        "exercises": documents,
        "resources": [{
            "id": "MAINMATTER-GOING-FURTHER",
            "title": "Going further",
            "sequence": 99,
            "scored": false,
            "sourceCommit": "57d145e6d393dfffeadb97fc61e814255c3b6ffe",
            "sourcePath": going_path,
            "canonicalUrl": "https://github.com/mainmatter/100-exercises-to-learn-rust/blob/57d145e6d393dfffeadb97fc61e814255c3b6ffe/book/src/going_further.md",
            "sha256": sha256(going_further.as_bytes()),
            "license": "CC-BY-NC-4.0",
            "attribution": "“100 Exercises to Learn Rust” by Luca Palmieri/Mainmatter, used under CC BY-NC 4.0.",
            "changeNotes": ["Verbatim pinned source compiled to typed blocks and intentionally excluded from scoring."],
            "headings": parsed.headings,
            "anchors": parsed.anchors,
            "links": links,
            "codeBlocks": parsed.code_blocks,
            "codeBlockCount": parsed.code_block_count,
            "fencedCodeBlockCount": parsed.fenced_code_block_count,
            "indentedCodeBlockCount": parsed.indented_code_block_count,
            "blocks": parsed.blocks,
        }]
    });
    let serialized = serde_json::to_string_pretty(&compiled)
        .map_err(|error| format!("serialize compiled Mainmatter: {error}"))?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("{}: {error}", parent.display()))?;
    }
    fs::write(output, format!("{serialized}\n"))
        .map_err(|error| format!("{}: {error}", output.display()))
}

fn required_json_text<'a>(value: &'a Value, pointer: &str) -> Result<&'a str, String> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing JSON text at {pointer}"))
}

fn parse_summary(summary: &str) -> Result<Vec<SummaryPage>, String> {
    let mut pages = vec![];
    for line in summary.lines() {
        let trimmed = line.trim_start();
        let link = trimmed.strip_prefix("- ").unwrap_or(trimmed);
        let Some(label_start) = link.find('[') else {
            continue;
        };
        let Some(separator) = link[label_start..].find("](") else {
            continue;
        };
        let separator = label_start + separator;
        let Some(close) = link[separator + 2..].find(')') else {
            return Err(format!("malformed SUMMARY link: {line}"));
        };
        let title = &link[label_start + 1..separator];
        let path = &link[separator + 2..separator + 2 + close];
        if path.ends_with(".md") {
            pages.push(SummaryPage {
                title: strip_inline_markdown(title),
                path: path.to_string(),
                depth: line.len() - line.trim_start().len(),
            });
        }
    }
    if pages.len() != 111 {
        return Err(format!("expected 111 SUMMARY links, found {}", pages.len()));
    }
    Ok(pages)
}

fn resolve_includes(
    source: &str,
    page_path: &Path,
    snapshot_root: &Path,
) -> Result<(String, Vec<Include>), String> {
    let mut output = String::with_capacity(source.len());
    let mut includes = vec![];
    let mut cursor = 0;
    while let Some(relative_start) = source[cursor..].find("{{#") {
        let start = cursor + relative_start;
        output.push_str(&source[cursor..start]);
        let Some(relative_end) = source[start..].find("}}") else {
            return Err(format!(
                "{}: unterminated mdBook directive",
                page_path.display()
            ));
        };
        let end = start + relative_end + 2;
        let directive = &source[start + 3..end - 2];
        let Some(spec) = directive
            .strip_prefix("include ")
            .or_else(|| directive.strip_prefix("rustdoc_include "))
        else {
            output.push_str(&source[start..end]);
            cursor = end;
            continue;
        };
        let (target, selector) = split_include_spec(spec);
        let absolute = normalized_join(snapshot_root, page_path, target)?;
        let included = read_text(&absolute)?;
        let selected = select_include(&included, selector.as_deref())?;
        output.push_str(&selected);
        includes.push(Include {
            directive: directive
                .split_ascii_whitespace()
                .next()
                .unwrap_or("include")
                .to_string(),
            source_path: absolute
                .strip_prefix(snapshot_root)
                .map_err(|_| format!("include escaped snapshot: {}", absolute.display()))?
                .to_string_lossy()
                .replace('\\', "/"),
            selector,
            sha256: sha256(included.as_bytes()),
        });
        cursor = end;
    }
    output.push_str(&source[cursor..]);
    Ok((output, includes))
}

fn split_include_spec(spec: &str) -> (&str, Option<String>) {
    let Some(first_colon) = spec.find(':') else {
        return (spec, None);
    };
    (
        &spec[..first_colon],
        Some(spec[first_colon + 1..].to_string()),
    )
}

fn select_include(source: &str, selector: Option<&str>) -> Result<String, String> {
    let Some(selector) = selector else {
        return Ok(source.to_string());
    };
    if selector.contains(':')
        || selector.is_empty()
        || selector.bytes().all(|byte| byte.is_ascii_digit())
    {
        let mut bounds = selector.split(':');
        let start = bounds
            .next()
            .filter(|value| !value.is_empty())
            .map(|value| value.parse::<usize>())
            .transpose()
            .map_err(|_| format!("invalid include range: {selector}"))?
            .unwrap_or(1);
        let end = bounds
            .next()
            .filter(|value| !value.is_empty())
            .map(|value| value.parse::<usize>())
            .transpose()
            .map_err(|_| format!("invalid include range: {selector}"))?
            .unwrap_or_else(|| source.lines().count());
        if start == 0 || end < start {
            return Err(format!("invalid include range: {selector}"));
        }
        return Ok(source
            .lines()
            .skip(start - 1)
            .take(end - start + 1)
            .collect::<Vec<_>>()
            .join("\n"));
    }

    let start_markers = [format!("ANCHOR: {selector}"), format!("ANCHOR:{selector}")];
    let end_markers = [
        format!("ANCHOR_END: {selector}"),
        format!("ANCHOR_END:{selector}"),
    ];
    let mut found = false;
    let mut lines = vec![];
    for line in source.lines() {
        if start_markers.iter().any(|marker| line.contains(marker)) {
            if found {
                return Ok(lines.join("\n"));
            }
            found = true;
            continue;
        }
        if found && end_markers.iter().any(|marker| line.contains(marker)) {
            return Ok(lines.join("\n"));
        }
        if found {
            lines.push(line);
        }
    }
    Err(format!("missing include anchor {selector}"))
}

fn parse_markdown(
    markdown: &str,
    page_path: &str,
    source_kind: SourceKind,
) -> Result<ParsedPage, String> {
    let mut parsed = ParsedPage::default();
    let mut stack: Vec<Node> = vec![];
    let options = Options::all();
    let renderable = strip_html_comments(markdown)?;
    for event in Parser::new_ext(&renderable, options) {
        match event {
            Event::Start(tag) => {
                let node = node_from_tag(tag, &mut parsed)?;
                stack.push(node);
            }
            Event::End(_) => {
                let node = stack
                    .pop()
                    .ok_or_else(|| format!("{page_path}: unmatched Markdown end event"))?;
                push_node(node, &mut stack, &mut parsed.blocks);
            }
            Event::Text(text) => push_node(
                Node::leaf("text", Some(text.into_string())),
                &mut stack,
                &mut parsed.blocks,
            ),
            Event::Code(text) => push_node(
                Node::leaf("inlineCode", Some(text.into_string())),
                &mut stack,
                &mut parsed.blocks,
            ),
            Event::Html(raw) | Event::InlineHtml(raw) => {
                for node in typed_html(raw.as_ref(), &mut parsed, source_kind)? {
                    push_node(node, &mut stack, &mut parsed.blocks);
                }
            }
            Event::FootnoteReference(label) => {
                let mut node = Node::leaf("footnoteReference", Some(label.into_string()));
                node.attributes.insert("label".into(), json!(node.text));
                push_node(node, &mut stack, &mut parsed.blocks);
            }
            Event::SoftBreak => push_node(
                Node::leaf("softBreak", None),
                &mut stack,
                &mut parsed.blocks,
            ),
            Event::HardBreak => push_node(
                Node::leaf("hardBreak", None),
                &mut stack,
                &mut parsed.blocks,
            ),
            Event::Rule => push_node(
                Node::leaf("thematicBreak", None),
                &mut stack,
                &mut parsed.blocks,
            ),
            Event::TaskListMarker(checked) => {
                let mut node = Node::leaf("taskMarker", None);
                node.attributes.insert("checked".into(), json!(checked));
                push_node(node, &mut stack, &mut parsed.blocks);
            }
            Event::InlineMath(text) => push_node(
                Node::leaf("inlineMath", Some(text.into_string())),
                &mut stack,
                &mut parsed.blocks,
            ),
            Event::DisplayMath(text) => push_node(
                Node::leaf("displayMath", Some(text.into_string())),
                &mut stack,
                &mut parsed.blocks,
            ),
        }
    }
    if !stack.is_empty() {
        return Err(format!("{page_path}: unclosed Markdown container"));
    }
    parsed.blocks = nest_typed_elements(std::mem::take(&mut parsed.blocks), page_path)?;
    if source_kind == SourceKind::Book {
        apply_book_preprocessors(&mut parsed, page_path)?;
    }
    Ok(parsed)
}

fn apply_book_preprocessors(parsed: &mut ParsedPage, page_path: &str) -> Result<(), String> {
    fn note_variant(node: &Node) -> Option<&'static str> {
        let first = node.children.first()?;
        if first.kind == "heading" {
            return Some("heading");
        }
        if first.kind == "paragraph"
            && first
                .children
                .first()
                .and_then(|child| child.text.as_deref())
                .is_some_and(|text| text.starts_with("Note: "))
        {
            return Some("label");
        }
        None
    }

    fn validate_caption_nodes(nodes: &[Node], page_path: &str) -> Result<(), String> {
        for node in nodes {
            if !matches!(
                node.kind.as_str(),
                "text" | "inlineCode" | "emphasis" | "strong" | "strikethrough"
            ) {
                return Err(format!(
                    "{page_path}: listing caption contains unsupported block or inline construct {}",
                    node.kind
                ));
            }
            validate_caption_nodes(&node.children, page_path)?;
        }
        Ok(())
    }

    fn caption_children(caption: &str, page_path: &str) -> Result<Vec<Node>, String> {
        let caption_path = format!("{page_path}#listing-caption");
        let parsed = parse_markdown(caption, &caption_path, SourceKind::Book)?;
        if parsed.blocks.len() != 1 || parsed.blocks[0].kind != "paragraph" {
            return Err(format!(
                "{page_path}: listing caption must be one inline Markdown paragraph"
            ));
        }
        if !parsed.links.is_empty()
            || !parsed.assets.is_empty()
            || parsed.code_block_count != 0
            || !parsed.headings.is_empty()
        {
            return Err(format!(
                "{page_path}: listing caption contains unsupported linked or block content"
            ));
        }
        let children = parsed.blocks.into_iter().next().unwrap().children;
        validate_caption_nodes(&children, page_path)?;
        Ok(children)
    }

    fn transform(nodes: &mut [Node], page_path: &str) -> Result<(), String> {
        for node in nodes {
            transform(&mut node.children, page_path)?;
            if node.kind == "blockquote"
                && let Some(variant) = note_variant(node)
            {
                node.kind = "noteCallout".into();
                node.attributes
                    .insert("sourcePreprocessor".into(), json!("trpl-note"));
                node.attributes.insert("variant".into(), json!(variant));
                continue;
            }
            if node.kind != "typedElement"
                || node.attributes.get("element") != Some(&json!("listing"))
            {
                continue;
            }

            let source_attributes = std::mem::take(&mut node.attributes);
            let string_attribute = |name: &str| -> Result<Option<String>, String> {
                source_attributes
                    .get(name)
                    .map(|value| {
                        value
                            .as_str()
                            .map(str::to_string)
                            .ok_or_else(|| format!("{page_path}: missing value for {name}"))
                    })
                    .transpose()
            };
            let number = string_attribute("number")?;
            let caption = string_attribute("caption")?;
            let file_name = string_attribute("file-name")?;
            if let Some(number) = &number
                && (number.is_empty()
                    || !number
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'))
            {
                return Err(format!("{page_path}: unsafe listing number {number:?}"));
            }

            node.kind = "listing".into();
            node.attributes
                .insert("sourcePreprocessor".into(), json!("trpl-listing"));
            if let Some(number) = &number {
                node.attributes.insert("number".into(), json!(number));
                node.attributes
                    .insert("id".into(), json!(format!("listing-{number}")));
            }
            if let Some(file_name) = file_name {
                node.attributes.insert("fileName".into(), json!(file_name));
            }
            if number.is_some() || caption.is_some() {
                let mut caption_node = Node::container("listingCaption", Map::new());
                if let Some(caption) = caption {
                    caption_node.children = caption_children(&caption, page_path)?;
                }
                node.children.push(caption_node);
            }
        }
        Ok(())
    }

    transform(&mut parsed.blocks, page_path)
}

fn strip_html_comments(markdown: &str) -> Result<String, String> {
    let mut output = String::with_capacity(markdown.len());
    let mut cursor = 0;
    while let Some(relative_start) = markdown[cursor..].find("<!--") {
        let start = cursor + relative_start;
        output.push_str(&markdown[cursor..start]);
        let Some(relative_end) = markdown[start + 4..].find("-->") else {
            return Err("unterminated HTML comment".into());
        };
        cursor = start + 4 + relative_end + 3;
    }
    output.push_str(&markdown[cursor..]);
    Ok(output)
}

fn node_from_tag(tag: Tag<'_>, parsed: &mut ParsedPage) -> Result<Node, String> {
    let mut attributes = Map::new();
    let kind = match tag {
        Tag::Paragraph => "paragraph",
        Tag::Heading {
            level,
            id,
            classes,
            attrs,
        } => {
            attributes.insert("level".into(), json!(heading_level(level)));
            if let Some(id) = id {
                attributes.insert("id".into(), json!(id.into_string()));
            }
            if !classes.is_empty() {
                attributes.insert(
                    "classes".into(),
                    json!(
                        classes
                            .into_iter()
                            .map(|class| class.into_string())
                            .collect::<Vec<_>>()
                    ),
                );
            }
            if !attrs.is_empty() {
                attributes.insert(
                    "sourceAttributes".into(),
                    json!(
                        attrs
                            .into_iter()
                            .map(|(name, value)| {
                                (name.into_string(), value.map(|value| value.into_string()))
                            })
                            .collect::<Vec<_>>()
                    ),
                );
            }
            "heading"
        }
        Tag::BlockQuote(kind) => {
            if let Some(kind) = kind {
                attributes.insert("kind".into(), json!(format!("{kind:?}").to_lowercase()));
            }
            "blockquote"
        }
        Tag::CodeBlock(kind) => {
            parsed.code_block_count += 1;
            let info = match kind {
                CodeBlockKind::Indented => {
                    parsed.indented_code_block_count += 1;
                    String::new()
                }
                CodeBlockKind::Fenced(info) => {
                    parsed.fenced_code_block_count += 1;
                    info.into_string()
                }
            };
            let classification =
                if info.contains("compile_fail") || info.contains("does_not_compile") {
                    "compile_fail"
                } else if info.contains("should_panic") {
                    "panic"
                } else if info.contains("ignore") || info.contains("not_desired_behavior") {
                    "context_fragment"
                } else {
                    "display"
                };
            attributes.insert("info".into(), json!(info));
            attributes.insert("classification".into(), json!(classification));
            attributes.insert("runnable".into(), json!(false));
            "codeBlock"
        }
        Tag::HtmlBlock => "typedHtmlBlock",
        Tag::List(start) => {
            attributes.insert("ordered".into(), json!(start.is_some()));
            if let Some(start) = start {
                attributes.insert("start".into(), json!(start));
            }
            "list"
        }
        Tag::Item => "listItem",
        Tag::FootnoteDefinition(label) => {
            attributes.insert("label".into(), json!(label.into_string()));
            "footnoteDefinition"
        }
        Tag::DefinitionList => "definitionList",
        Tag::DefinitionListTitle => "definitionTitle",
        Tag::DefinitionListDefinition => "definition",
        Tag::Table(alignments) => {
            attributes.insert(
                "alignments".into(),
                json!(
                    alignments
                        .into_iter()
                        .map(|alignment| format!("{alignment:?}").to_lowercase())
                        .collect::<Vec<_>>()
                ),
            );
            "table"
        }
        Tag::TableHead => "tableHead",
        Tag::TableRow => "tableRow",
        Tag::TableCell => "tableCell",
        Tag::Emphasis => "emphasis",
        Tag::Strong => "strong",
        Tag::Strikethrough => "strikethrough",
        Tag::Superscript => "superscript",
        Tag::Subscript => "subscript",
        Tag::Link {
            dest_url, title, ..
        } => {
            let target = dest_url.into_string();
            let title = title.into_string();
            attributes.insert("sourceTarget".into(), json!(target));
            attributes.insert("title".into(), json!(title));
            parsed.links.push(RawLink {
                source_target: target,
                title,
            });
            "link"
        }
        Tag::Image {
            dest_url, title, ..
        } => {
            let target = dest_url.into_string();
            attributes.insert("path".into(), json!(target));
            attributes.insert("title".into(), json!(title.into_string()));
            parsed.assets.push((target, String::new()));
            "image"
        }
        Tag::MetadataBlock(kind) => {
            attributes.insert("kind".into(), json!(format!("{kind:?}").to_lowercase()));
            "metadata"
        }
    };
    Ok(Node::container(kind, attributes))
}

fn typed_html(
    raw: &str,
    parsed: &mut ParsedPage,
    source_kind: SourceKind,
) -> Result<Vec<Node>, String> {
    let trimmed = raw.trim();
    if trimmed.starts_with("<!--") && trimmed.ends_with("-->") {
        return Ok(vec![]);
    }
    let mut nodes = vec![];
    let mut cursor = 0;
    while let Some(relative) = trimmed[cursor..].find('<') {
        let start = cursor + relative;
        if start > cursor {
            nodes.push(Node::leaf("text", Some(trimmed[cursor..start].to_string())));
        }
        let Some(relative_end) = find_html_tag_end(&trimmed[start..]) else {
            return Err(format!("unterminated raw HTML: {trimmed}"));
        };
        let end = start + relative_end + 1;
        let token = &trimmed[start + 1..end - 1];
        let closing = token.trim_start().starts_with('/');
        let self_closing = token.trim_end().ends_with('/');
        let body = token
            .trim()
            .trim_start_matches('/')
            .trim_end_matches('/')
            .trim();
        let name_end = body.find(char::is_whitespace).unwrap_or(body.len());
        let name = body[..name_end].to_ascii_lowercase();
        let allowed = match source_kind {
            SourceKind::Book => matches!(
                name.as_str(),
                "a" | "code"
                    | "em"
                    | "figcaption"
                    | "figure"
                    | "img"
                    | "kbd"
                    | "listing"
                    | "pre"
                    | "span"
                    | "sup"
            ),
            SourceKind::Mainmatter => name == "div",
        };
        if !allowed {
            return Err(format!("raw HTML element <{name}> is not allowlisted"));
        }
        let mut attributes = parse_html_attributes(&body[name_end..])?;
        validate_html_attributes(&name, closing, &mut attributes)?;
        attributes.insert("element".into(), json!(name));
        attributes.insert("closing".into(), json!(closing));
        attributes.insert("selfClosing".into(), json!(self_closing));
        if name == "a"
            && let Some(id) = attributes.get("id").and_then(Value::as_str)
        {
            parsed.anchors.insert(id.to_string());
        }
        if name == "img" && !closing {
            let path = attributes
                .get("src")
                .and_then(Value::as_str)
                .ok_or_else(|| "typed img requires src".to_string())?
                .to_string();
            let alt = attributes
                .get("alt")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            parsed.assets.push((path, alt));
        }
        nodes.push(Node::container("typedElementBoundary", attributes));
        cursor = end;
    }
    if cursor < trimmed.len() {
        nodes.push(Node::leaf("text", Some(trimmed[cursor..].to_string())));
    }
    Ok(nodes)
}

fn nest_typed_elements(nodes: Vec<Node>, page_path: &str) -> Result<Vec<Node>, String> {
    fn flatten(nodes: Vec<Node>, page_path: &str) -> Result<Vec<Node>, String> {
        let mut flattened = vec![];
        for mut node in nodes {
            if node.kind == "typedHtmlBlock" {
                flattened.extend(node.children);
            } else {
                node.children = nest_typed_elements(node.children, page_path)?;
                flattened.push(node);
            }
        }
        Ok(flattened)
    }

    fn append(node: Node, roots: &mut Vec<Node>, stack: &mut [(String, Node)]) {
        if let Some((_, parent)) = stack.last_mut() {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }

    let mut roots = vec![];
    let mut stack: Vec<(String, Node)> = vec![];
    for mut node in flatten(nodes, page_path)? {
        if node.kind != "typedElementBoundary" {
            append(node, &mut roots, &mut stack);
            continue;
        }
        let element = node
            .attributes
            .get("element")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("{page_path}: typed element is missing its name"))?
            .to_string();
        let closing = node
            .attributes
            .remove("closing")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let self_closing = node
            .attributes
            .remove("selfClosing")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if closing {
            if self_closing || node.attributes.len() != 1 {
                return Err(format!("{page_path}: invalid closing </{element}>"));
            }
            let Some((opened, completed)) = stack.pop() else {
                return Err(format!("{page_path}: unmatched closing </{element}>"));
            };
            if opened != element {
                return Err(format!(
                    "{page_path}: mismatched typed HTML, expected </{opened}> but found </{element}>"
                ));
            }
            append(completed, &mut roots, &mut stack);
            continue;
        }
        node.kind = if element == "div" {
            "warningCallout".into()
        } else {
            "typedElement".into()
        };
        if self_closing {
            append(node, &mut roots, &mut stack);
        } else {
            stack.push((element, node));
        }
    }
    if let Some((element, _)) = stack.last() {
        return Err(format!(
            "{page_path}: unclosed typed HTML element <{element}>"
        ));
    }
    Ok(roots)
}

fn validate_html_attributes(
    name: &str,
    closing: bool,
    attributes: &mut Map<String, Value>,
) -> Result<(), String> {
    let allowed: &[&str] = match name {
        "a" => &["id"],
        "div" => &["class"],
        "img" => &["alt", "class", "src", "style"],
        "listing" => &["caption", "file-name", "number"],
        "span" => &["class", "id"],
        "code" | "em" | "figcaption" | "figure" | "kbd" | "pre" | "sup" => &[],
        _ => return Err(format!("raw HTML element <{name}> is not allowlisted")),
    };
    if let Some(attribute) = attributes
        .keys()
        .find(|key| !allowed.contains(&key.as_str()))
    {
        return Err(format!("attribute {attribute} is not allowed on <{name}>"));
    }
    for attribute in allowed {
        if attributes
            .get(*attribute)
            .is_some_and(|value| !value.is_string())
        {
            return Err(format!("missing value for attribute: '{attribute}'"));
        }
    }
    if !closing && name == "a" && !attributes.get("id").is_some_and(Value::is_string) {
        return Err("typed <a> requires id".into());
    }
    if !closing
        && name == "img"
        && (!attributes.get("src").is_some_and(Value::is_string)
            || !attributes.get("alt").is_some_and(Value::is_string))
    {
        return Err("typed <img> requires src and alt".into());
    }
    if !closing
        && name == "span"
        && !attributes.get("class").is_some_and(Value::is_string)
        && !attributes.get("id").is_some_and(Value::is_string)
    {
        return Err("typed <span> requires an approved class or id".into());
    }
    if let Some(class) = attributes.get("class").and_then(Value::as_str) {
        let allowed_class = match name {
            "div" => class == "warning",
            "img" => matches!(class, "center" | "ferris-explain"),
            "span" => matches!(class, "caption" | "filename"),
            _ => false,
        };
        if !allowed_class {
            return Err(format!("class {class} is not allowed on <{name}>"));
        }
    }
    if let Some(src) = attributes.get("src").and_then(Value::as_str)
        && (src.starts_with('/') || src.contains(":") || src.contains(".."))
    {
        return Err(format!("unsafe image source: {src}"));
    }
    if let Some(style) = attributes.remove("style") {
        let normalized = style
            .as_str()
            .unwrap_or_default()
            .split_whitespace()
            .collect::<String>();
        if normalized != "width:50%;" {
            return Err(format!("unsupported image style: {style}"));
        }
        attributes.insert("widthPercent".into(), json!(50));
    }
    Ok(())
}

fn find_html_tag_end(input: &str) -> Option<usize> {
    let mut quote = None;
    for (index, byte) in input.bytes().enumerate() {
        if index == 0 {
            continue;
        }
        match (quote, byte) {
            (None, b'\'' | b'"') => quote = Some(byte),
            (Some(active), current) if active == current => quote = None,
            (None, b'>') => return Some(index),
            _ => {}
        }
    }
    None
}

fn parse_html_attributes(input: &str) -> Result<Map<String, Value>, String> {
    let mut attributes = Map::new();
    let bytes = input.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor == bytes.len() {
            break;
        }
        let start = cursor;
        while cursor < bytes.len() && !bytes[cursor].is_ascii_whitespace() && bytes[cursor] != b'='
        {
            cursor += 1;
        }
        let name = input[start..cursor]
            .trim_end_matches('/')
            .to_ascii_lowercase();
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor == bytes.len() || bytes[cursor] != b'=' {
            if !name.is_empty() {
                attributes.insert(name, json!(true));
            }
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor == bytes.len() || !matches!(bytes[cursor], b'"' | b'\'') {
            return Err(format!("HTML attribute {name} must be quoted"));
        }
        let quote = bytes[cursor];
        cursor += 1;
        let value_start = cursor;
        while cursor < bytes.len() && bytes[cursor] != quote {
            cursor += 1;
        }
        if cursor == bytes.len() {
            return Err(format!("unterminated HTML attribute {name}"));
        }
        attributes.insert(name, json!(&input[value_start..cursor]));
        cursor += 1;
    }
    Ok(attributes)
}

fn push_node(node: Node, stack: &mut [Node], roots: &mut Vec<Node>) {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(node);
    } else {
        roots.push(node);
    }
}

fn finish_page(parsed: &mut ParsedPage) -> Result<(), String> {
    finish_headings(parsed);
    let mut ordinal = 0;
    let mut evidence = vec![];
    collect_code_evidence(&mut parsed.blocks, &mut ordinal, &mut evidence)?;
    if evidence.len() != parsed.code_block_count {
        return Err(format!(
            "parsed {} code blocks but serialized {}",
            parsed.code_block_count,
            evidence.len()
        ));
    }
    parsed.code_blocks = evidence;
    Ok(())
}

fn finish_headings(parsed: &mut ParsedPage) {
    collect_headings(
        &mut parsed.blocks,
        &mut parsed.headings,
        &mut parsed.anchors,
    );
    for node in &mut parsed.blocks {
        collect_image_alt(node, &mut parsed.assets);
    }
}

fn collect_code_evidence(
    nodes: &mut [Node],
    ordinal: &mut usize,
    evidence: &mut Vec<CodeBlockEvidence>,
) -> Result<(), String> {
    for node in nodes {
        if node.kind == "codeBlock" {
            *ordinal += 1;
            let info = node
                .attributes
                .get("info")
                .and_then(Value::as_str)
                .ok_or_else(|| "code block is missing its info string".to_string())?
                .to_string();
            let text = plain_text(&node.children);
            let record = CodeBlockEvidence {
                ordinal: *ordinal,
                info,
                byte_length: text.len(),
                text_sha256: sha256(text.as_bytes()),
            };
            node.attributes
                .insert("ordinal".into(), json!(record.ordinal));
            node.attributes
                .insert("byteLength".into(), json!(record.byte_length));
            node.attributes
                .insert("textSha256".into(), json!(record.text_sha256));
            evidence.push(record);
        }
        collect_code_evidence(&mut node.children, ordinal, evidence)?;
    }
    Ok(())
}

fn collect_source_code_blocks(markdown: &str) -> Result<Vec<CodeBlockEvidence>, String> {
    let renderable = strip_html_comments(markdown)?;
    let mut blocks = vec![];
    let mut current: Option<(String, String)> = None;
    for event in Parser::new_ext(&renderable, Options::all()) {
        match event {
            Event::Start(Tag::CodeBlock(kind)) => {
                if current.is_some() {
                    return Err("nested code block events are unsupported".into());
                }
                let info = match kind {
                    CodeBlockKind::Indented => String::new(),
                    CodeBlockKind::Fenced(info) => info.into_string(),
                };
                current = Some((info, String::new()));
            }
            Event::Text(text) if current.is_some() => {
                current.as_mut().unwrap().1.push_str(text.as_ref());
            }
            Event::End(TagEnd::CodeBlock) => {
                let Some((info, text)) = current.take() else {
                    return Err("code block ended without a matching start".into());
                };
                blocks.push(CodeBlockEvidence {
                    ordinal: blocks.len() + 1,
                    info,
                    byte_length: text.len(),
                    text_sha256: sha256(text.as_bytes()),
                });
            }
            _ => {}
        }
    }
    if current.is_some() {
        return Err("code block did not end".into());
    }
    Ok(blocks)
}

fn collect_headings(
    nodes: &mut [Node],
    headings: &mut Vec<Heading>,
    anchors: &mut BTreeSet<String>,
) {
    for node in nodes {
        if node.kind == "heading" {
            let text = plain_text(&node.children);
            let explicit = node
                .attributes
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string);
            let id = explicit.unwrap_or_else(|| heading_slug(&text));
            node.attributes.insert("id".into(), json!(id));
            anchors.insert(id.clone());
            headings.push(Heading {
                level: node
                    .attributes
                    .get("level")
                    .and_then(Value::as_u64)
                    .unwrap_or(1) as u8,
                id,
                text,
            });
        }
        collect_headings(&mut node.children, headings, anchors);
    }
}

fn collect_image_alt(node: &Node, assets: &mut [(String, String)]) {
    if node.kind == "image" {
        let target = node
            .attributes
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("");
        let alt = plain_text(&node.children);
        if let Some(entry) = assets.iter_mut().find(|entry| entry.0 == target) {
            entry.1 = alt;
        }
    }
    for child in &node.children {
        collect_image_alt(child, assets);
    }
}

fn plain_text(nodes: &[Node]) -> String {
    let mut output = String::new();
    for node in nodes {
        if let Some(text) = &node.text {
            output.push_str(text);
        }
        output.push_str(&plain_text(&node.children));
    }
    output
}

fn resolve_links(
    blocks: &mut [Node],
    raw_links: &[RawLink],
    page_path: &str,
    targets: &BTreeMap<String, DocumentTarget>,
    source_kind: SourceKind,
) -> Result<Vec<Link>, String> {
    let mut links = Vec::with_capacity(raw_links.len());
    for raw in raw_links {
        let target = resolve_target(&raw.source_target, page_path, targets, source_kind)?;
        links.push(Link {
            source_target: raw.source_target.clone(),
            title: raw.title.clone(),
            target,
        });
    }
    let mut resolved = links.iter();
    attach_resolved_links(blocks, &mut resolved)?;
    if resolved.next().is_some() {
        return Err(format!("{page_path}: not every parsed link was serialized"));
    }
    Ok(links)
}

fn attach_resolved_links<'a>(
    nodes: &mut [Node],
    links: &mut impl Iterator<Item = &'a Link>,
) -> Result<(), String> {
    for node in nodes {
        if node.kind == "link" {
            let link = links
                .next()
                .ok_or_else(|| "serialized link has no parsed target".to_string())?;
            node.attributes
                .insert("sourceTarget".into(), json!(link.source_target));
            node.attributes.insert("title".into(), json!(link.title));
            node.attributes.insert(
                "target".into(),
                serde_json::to_value(&link.target)
                    .map_err(|error| format!("serialize resolved link: {error}"))?,
            );
        }
        attach_resolved_links(&mut node.children, links)?;
    }
    Ok(())
}

fn resolve_target(
    source_target: &str,
    page_path: &str,
    targets: &BTreeMap<String, DocumentTarget>,
    source_kind: SourceKind,
) -> Result<ResolvedTarget, String> {
    validate_link_text(source_target, page_path)?;
    if source_target.starts_with("http://")
        || source_target.starts_with("https://")
        || source_target.starts_with("mailto:")
    {
        validate_external_url(source_target, page_path)?;
        return Ok(ResolvedTarget::External {
            url: source_target.to_string(),
        });
    }
    if source_target.contains(':') {
        return Err(format!(
            "{page_path}: unapproved colon form in link {source_target}"
        ));
    }
    if source_target.starts_with("//") || source_target.starts_with('/') {
        return Err(format!(
            "{page_path}: protocol-relative or rooted link is not allowed: {source_target}"
        ));
    }

    let (path, anchor) = split_link_target(source_target, page_path)?;
    if source_kind == SourceKind::Book && path.starts_with("../") {
        let remainder = path
            .strip_prefix("../")
            .ok_or_else(|| format!("{page_path}: invalid documentation link {source_target}"))?;
        let namespace = remainder.split('/').next().unwrap_or("");
        if !matches!(namespace, "std" | "reference" | "nomicon" | "unstable-book")
            || remainder.contains("../")
        {
            return Err(format!(
                "{page_path}: unapproved documentation-relative link {source_target}"
            ));
        }
        let mut url = format!("https://doc.rust-lang.org/{remainder}");
        if let Some(anchor) = anchor {
            url.push('#');
            url.push_str(anchor);
        }
        validate_external_url(&url, page_path)?;
        return Ok(ResolvedTarget::External { url });
    }

    let target_path = if path.is_empty() {
        page_path.to_string()
    } else {
        let markdown = match source_kind {
            SourceKind::Book => path
                .strip_suffix(".html")
                .map(|base| format!("{base}.md"))
                .or_else(|| path.ends_with(".md").then(|| path.to_string()))
                .ok_or_else(|| {
                    format!("{page_path}: unsupported local Book target {source_target}")
                })?,
            SourceKind::Mainmatter => {
                if !path.ends_with(".md") {
                    return Err(format!(
                        "{page_path}: unsupported local Mainmatter target {source_target}"
                    ));
                }
                path.to_string()
            }
        };
        let base = Path::new(page_path)
            .parent()
            .unwrap_or_else(|| Path::new(""));
        normalize_relative(&base.join(markdown))?
    };
    if source_kind == SourceKind::Mainmatter && !target_path.starts_with("book/src/") {
        return Err(format!(
            "{page_path}: Mainmatter link escapes book/src: {source_target}"
        ));
    }
    let target = targets.get(&target_path).ok_or_else(|| {
        format!("{page_path}: dangling local link {source_target} -> {target_path}")
    })?;
    let resolved_anchor = anchor.map(|anchor| {
        if source_kind == SourceKind::Mainmatter
            && target_path == "book/src/01_intro/00_welcome.md"
            && anchor == "wr-the-workshop-runner"
        {
            "workshop-runner-wr"
        } else {
            anchor
        }
    });
    if let Some(anchor) = resolved_anchor
        && !target.anchors.contains(anchor)
    {
        return Err(format!(
            "{page_path}: dangling anchor #{anchor} in {source_target}"
        ));
    }
    Ok(match source_kind {
        SourceKind::Book => ResolvedTarget::BookPage {
            page_id: target.id.clone(),
            source_path: target.source_path.clone(),
            canonical_url: target.canonical_url.clone(),
            anchor: resolved_anchor.map(str::to_string),
        },
        SourceKind::Mainmatter => ResolvedTarget::SourceDocument {
            document_id: target.id.clone(),
            source_path: target.source_path.clone(),
            canonical_url: target.canonical_url.clone(),
            anchor: resolved_anchor.map(str::to_string),
            compatibility_alias: anchor
                .filter(|source| Some(*source) != resolved_anchor)
                .map(str::to_string),
        },
    })
}

fn split_link_target<'a>(
    target: &'a str,
    page_path: &str,
) -> Result<(&'a str, Option<&'a str>), String> {
    let mut parts = target.split('#');
    let path = parts.next().unwrap_or("");
    let anchor = parts.next();
    if parts.next().is_some() || anchor == Some("") {
        return Err(format!("{page_path}: malformed fragment in {target}"));
    }
    Ok((path, anchor))
}

fn validate_link_text(target: &str, page_path: &str) -> Result<(), String> {
    if target.is_empty()
        || target.contains('\\')
        || target.chars().any(char::is_control)
        || target.chars().any(char::is_whitespace)
    {
        return Err(format!("{page_path}: malformed link target {target:?}"));
    }
    let bytes = target.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return Err(format!("{page_path}: malformed percent escape in {target}"));
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    Ok(())
}

fn validate_external_url(url: &str, page_path: &str) -> Result<(), String> {
    let rest = if let Some(rest) = url.strip_prefix("https://") {
        rest
    } else if let Some(rest) = url.strip_prefix("http://") {
        rest
    } else if let Some(rest) = url.strip_prefix("mailto:") {
        if rest.is_empty() || !rest.contains('@') || rest.starts_with('/') || rest.contains('#') {
            return Err(format!("{page_path}: malformed mailto URL {url}"));
        }
        return Ok(());
    } else {
        return Err(format!("{page_path}: unapproved external URL {url}"));
    };
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty()
        || authority.contains('@')
        || authority.starts_with('.')
        || authority.ends_with('.')
    {
        return Err(format!("{page_path}: malformed HTTP(S) URL {url}"));
    }
    Ok(())
}

fn read_redirects(
    root: &Path,
    targets: &BTreeMap<String, DocumentTarget>,
) -> Result<Vec<Redirect>, String> {
    let book_toml = read_text(&root.join("book.toml"))?;
    let mut redirects = vec![];
    let mut in_redirects = false;
    for line in book_toml.lines() {
        let trimmed = line.trim();
        if trimmed == "[output.html.redirect]" {
            in_redirects = true;
            continue;
        }
        if in_redirects && trimmed.starts_with('[') {
            break;
        }
        if !in_redirects || trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((from, target)) = trimmed.split_once('=') else {
            return Err(format!("invalid book.toml redirect: {line}"));
        };
        let from = from.trim().trim_matches('"');
        let target = target.trim().trim_matches('"');
        let resolved = resolve_target(target, "SUMMARY.md", targets, SourceKind::Book)?;
        if !matches!(resolved, ResolvedTarget::BookPage { .. }) {
            return Err(format!(
                "book.toml: redirect must target a Book page: {target}"
            ));
        }
        redirects.push(Redirect {
            source_alias: from.to_string(),
            source_target: target.to_string(),
            target: resolved,
        });
    }
    redirects.sort_by(|a, b| a.source_alias.cmp(&b.source_alias));
    Ok(redirects)
}

fn read_preprocessors(root: &Path) -> Result<Vec<ConfiguredPreprocessor>, String> {
    const NOTE_COMMAND: &str =
        "cargo run --manifest-path packages/mdbook-trpl/Cargo.toml --bin mdbook-trpl-note";
    const LISTING_COMMAND: &str =
        "cargo run --manifest-path packages/mdbook-trpl/Cargo.toml --bin mdbook-trpl-listing";
    let book_toml = read_text(&root.join("book.toml"))?;
    for (name, command) in [
        ("trpl-note", NOTE_COMMAND),
        ("trpl-listing", LISTING_COMMAND),
    ] {
        if !book_toml.contains(&format!("[preprocessor.{name}]"))
            || !book_toml.contains(&format!("command = \"{command}\""))
        {
            return Err(format!("book.toml is missing pinned {name} configuration"));
        }
    }
    if !book_toml.contains("output-mode = \"default\"") {
        return Err("book.toml is missing pinned trpl-listing default output mode".into());
    }

    let hashed_inputs = |paths: &[&str]| -> Result<Vec<HashedInput>, String> {
        paths
            .iter()
            .map(|source_path| {
                let bytes = fs::read(root.join(source_path))
                    .map_err(|error| format!("{}: {error}", root.join(source_path).display()))?;
                Ok(HashedInput {
                    source_path: (*source_path).to_string(),
                    sha256: sha256(&bytes),
                })
            })
            .collect()
    };
    let shared = [
        "packages/mdbook-trpl/Cargo.toml",
        "packages/mdbook-trpl/Cargo.lock",
        "packages/mdbook-trpl/src/lib.rs",
    ];
    Ok(vec![
        ConfiguredPreprocessor {
            name: "trpl-note",
            command: NOTE_COMMAND,
            output_mode: None,
            inputs: hashed_inputs(&[
                shared[0],
                shared[1],
                shared[2],
                "packages/mdbook-trpl/src/note/mod.rs",
            ])?,
        },
        ConfiguredPreprocessor {
            name: "trpl-listing",
            command: LISTING_COMMAND,
            output_mode: Some("default"),
            inputs: hashed_inputs(&[
                shared[0],
                shared[1],
                shared[2],
                "packages/mdbook-trpl/src/config/mod.rs",
                "packages/mdbook-trpl/src/listing/mod.rs",
            ])?,
        },
    ])
}

fn normalized_join(root: &Path, source_path: &Path, target: &str) -> Result<PathBuf, String> {
    let base = source_path.parent().unwrap_or(root);
    let joined = base.join(target);
    let normalized = normalize_path(&joined)?;
    let root = normalize_path(root)?;
    if !normalized.starts_with(&root) {
        return Err(format!("path escapes snapshot: {target}"));
    }
    Ok(normalized)
}

fn normalize_path(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("path escapes root: {}", path.display()));
                }
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    Ok(normalized)
}

fn normalize_relative(path: &Path) -> Result<String, String> {
    let normalized = normalize_path(path)?;
    Ok(normalized.to_string_lossy().replace('\\', "/"))
}

fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))
}

fn page_id(path: &str) -> String {
    format!(
        "BOOK-PAGE-{}",
        path.trim_end_matches(".md")
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character.to_ascii_uppercase()
                } else {
                    '-'
                }
            })
            .collect::<String>()
    )
}

fn canonical_url(path: &str) -> String {
    format!(
        "https://doc.rust-lang.org/book/{}",
        path.trim_end_matches(".md").to_string() + ".html"
    )
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn heading_slug(text: &str) -> String {
    let mut slug = String::new();
    for character in text.to_lowercase().chars() {
        if character.is_alphanumeric() || character == '_' {
            slug.push(character);
        } else if character.is_whitespace() || character == '-' {
            slug.push('-');
        }
    }
    slug.trim_matches('-').to_string()
}

fn strip_inline_markdown(value: &str) -> String {
    value.replace('`', "")
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn include_anchor_and_ranges_are_resolved() {
        let source = "zero\n// ANCHOR: here\none\ntwo\n// ANCHOR_END: here\nthree\n";
        assert_eq!(select_include(source, Some("here")).unwrap(), "one\ntwo");
        assert_eq!(
            select_include(source, Some("2:3")).unwrap(),
            "// ANCHOR: here\none"
        );
        assert_eq!(
            select_include(source, Some("3:")).unwrap(),
            "one\ntwo\n// ANCHOR_END: here\nthree"
        );
    }

    #[test]
    fn raw_html_is_allowlisted_and_structured() {
        let mut parsed = ParsedPage::default();
        let nodes = typed_html(
            "<img src=\"img/x.svg\" alt=\"diagram\" />",
            &mut parsed,
            SourceKind::Book,
        )
        .unwrap();
        assert_eq!(nodes[0].kind, "typedElementBoundary");
        assert_eq!(parsed.assets, vec![("img/x.svg".into(), "diagram".into())]);
        assert!(typed_html("<script>alert(1)</script>", &mut parsed, SourceKind::Book).is_err());
        assert!(typed_html("<span onclick=\"alert(1)\">", &mut parsed, SourceKind::Book).is_err());
        assert!(
            typed_html(
                "<img src=\"https://example.com/x.svg\">",
                &mut parsed,
                SourceKind::Book
            )
            .is_err()
        );
        assert!(typed_html("<div class=\"warning\">", &mut parsed, SourceKind::Book).is_err());
        assert!(
            typed_html(
                "<span class=\"caption\">",
                &mut parsed,
                SourceKind::Mainmatter
            )
            .is_err()
        );
        assert!(
            typed_html(
                "<div class=\"danger\">",
                &mut parsed,
                SourceKind::Mainmatter
            )
            .is_err()
        );
        assert!(
            typed_html(
                "<div class=\"warning\" id=\"x\">",
                &mut parsed,
                SourceKind::Mainmatter
            )
            .is_err()
        );
    }

    #[test]
    fn comments_are_removed_and_typed_nodes_round_trip() {
        assert_eq!(
            strip_html_comments("before<!-- hidden -->after").unwrap(),
            "beforeafter"
        );
        let node = Node::container("paragraph", Map::new());
        let encoded = serde_json::to_string(&node).unwrap();
        assert_eq!(serde_json::from_str::<Node>(&encoded).unwrap(), node);
    }

    #[test]
    fn blockquoted_fences_remain_code_blocks() {
        let mut parsed = parse_markdown(
            "> ```rust\n> let answer = 42;\n> ```\n",
            "fixture.md",
            SourceKind::Book,
        )
        .unwrap();
        finish_page(&mut parsed).unwrap();
        assert_eq!(parsed.code_block_count, 1);
        assert_eq!(parsed.fenced_code_block_count, 1);
        assert_eq!(parsed.indented_code_block_count, 0);
        assert_eq!(parsed.code_blocks[0].info, "rust");
        assert_eq!(parsed.code_blocks[0].byte_length, 17);
    }

    #[test]
    fn typed_html_is_balanced_and_nested() {
        let mut parsed = parse_markdown(
            "<Listing number=\"1-1\">\n\n```rust\nfn main() {}\n```\n\n</Listing>\n",
            "fixture.md",
            SourceKind::Book,
        )
        .unwrap();
        finish_page(&mut parsed).unwrap();
        assert_eq!(parsed.blocks.len(), 1);
        assert_eq!(parsed.blocks[0].kind, "listing");
        assert_eq!(parsed.blocks[0].children[0].kind, "codeBlock");
        assert!(
            parse_markdown(
                "<Listing>\n\n```rust\nfn main() {}\n```\n",
                "fixture.md",
                SourceKind::Book
            )
            .is_err()
        );
        assert!(
            parse_markdown(
                "<figure><span class=\"caption\"></figure></span>",
                "fixture.md",
                SourceKind::Book
            )
            .is_err()
        );
    }

    #[test]
    fn pinned_note_and_listing_preprocessor_semantics_are_typed() {
        fn descendants<'a>(node: &'a Node, output: &mut Vec<&'a Node>) {
            output.push(node);
            for child in &node.children {
                descendants(child, output);
            }
        }

        let mut parsed = parse_markdown(
            r#"> This is quoted.

> Note: This is *noted*.

> ## A heading note
> With more content.

<Listing number="1-2" caption="Some *text* and a `Box<T>`" file-name="src/main.rs">

```rust
fn main() {}
```

</Listing>

<Listing number="1-3">

```rust
fn numbered() {}
```

</Listing>

<Listing caption="Caption only">

```rust
fn captioned() {}
```

</Listing>

<Listing file-name="src/lib.rs">

```rust
fn named() {}
```

</Listing>

<Listing>

```rust
fn plain() {}
```

</Listing>
"#,
            "fixture.md",
            SourceKind::Book,
        )
        .unwrap();
        finish_page(&mut parsed).unwrap();

        assert_eq!(parsed.blocks[0].kind, "blockquote");
        assert_eq!(parsed.blocks[1].kind, "noteCallout");
        assert_eq!(parsed.blocks[1].attributes["variant"], json!("label"));
        assert_eq!(parsed.blocks[2].kind, "noteCallout");
        assert_eq!(parsed.blocks[2].attributes["variant"], json!("heading"));

        let listings = parsed
            .blocks
            .iter()
            .filter(|node| node.kind == "listing")
            .collect::<Vec<_>>();
        assert_eq!(listings.len(), 5);
        assert_eq!(listings[0].attributes["id"], json!("listing-1-2"));
        assert_eq!(listings[0].attributes["fileName"], json!("src/main.rs"));
        let caption = listings[0]
            .children
            .iter()
            .find(|node| node.kind == "listingCaption")
            .unwrap();
        assert!(caption.attributes.is_empty());
        let mut caption_nodes = vec![];
        descendants(caption, &mut caption_nodes);
        assert!(caption_nodes.iter().any(|node| node.kind == "emphasis"));
        assert!(
            caption_nodes.iter().any(|node| {
                node.kind == "inlineCode" && node.text.as_deref() == Some("Box<T>")
            })
        );
        assert!(
            listings[1]
                .children
                .iter()
                .any(|node| node.kind == "listingCaption" && node.children.is_empty())
        );
        assert!(
            listings[2]
                .children
                .iter()
                .any(|node| node.kind == "listingCaption" && !node.children.is_empty())
        );
        assert!(
            !listings[3]
                .children
                .iter()
                .any(|node| node.kind == "listingCaption")
        );
        assert!(
            !listings[4]
                .children
                .iter()
                .any(|node| node.kind == "listingCaption")
        );

        for missing in ["number", "caption", "file-name"] {
            let fixture =
                format!("<Listing {missing}>\n\n```rust\nfn main() {{}}\n```\n\n</Listing>\n");
            assert!(
                parse_markdown(&fixture, "fixture.md", SourceKind::Book).is_err(),
                "accepted missing {missing} value"
            );
        }
        assert!(
            parse_markdown(
                "<Listing unsupported=\"x\">\n\n```rust\nfn main() {}\n```\n\n</Listing>\n",
                "fixture.md",
                SourceKind::Book
            )
            .is_err()
        );
        assert!(
            parse_markdown(
                "<Listing>\n\n```rust\nfn main() {}\n```\n",
                "fixture.md",
                SourceKind::Book
            )
            .is_err()
        );
        assert!(parse_markdown("</Listing>\n", "fixture.md", SourceKind::Book).is_err());
    }

    #[test]
    fn unsafe_links_are_rejected() {
        let targets = BTreeMap::from([(
            "page.md".into(),
            DocumentTarget {
                id: "BOOK-PAGE-PAGE".into(),
                source_path: "src/page.md".into(),
                canonical_url: "https://doc.rust-lang.org/book/page.html".into(),
                anchors: BTreeSet::from(["safe".into()]),
            },
        )]);
        for target in [
            "//evil.example/path",
            "bad\\path.md",
            "javascript:alert(1)",
            "java_script:alert(1)",
            "page.md#bad%2",
            "/rooted.md",
        ] {
            assert!(
                resolve_target(target, "page.md", &targets, SourceKind::Book).is_err(),
                "accepted {target}"
            );
        }
        assert!(matches!(
            resolve_target("#safe", "page.md", &targets, SourceKind::Book).unwrap(),
            ResolvedTarget::BookPage { .. }
        ));

        let mainmatter_targets = BTreeMap::from([(
            "book/src/01_intro/00_welcome.md".into(),
            DocumentTarget {
                id: "mainmatter-01-intro-00-welcome".into(),
                source_path: "book/src/01_intro/00_welcome.md".into(),
                canonical_url: "https://example.com/welcome".into(),
                anchors: BTreeSet::from(["workshop-runner-wr".into()]),
            },
        )]);
        let stale = resolve_target(
            "00_welcome.md#wr-the-workshop-runner",
            "book/src/01_intro/01_syntax.md",
            &mainmatter_targets,
            SourceKind::Mainmatter,
        )
        .unwrap();
        assert!(matches!(
            stale,
            ResolvedTarget::SourceDocument {
                anchor: Some(anchor),
                compatibility_alias: Some(alias),
                ..
            } if anchor == "workshop-runner-wr" && alias == "wr-the-workshop-runner"
        ));
    }

    #[test]
    fn pinned_snapshots_have_exact_recursive_coverage() {
        fn collect_code_nodes(value: &Value, under_quote: bool, output: &mut Vec<Value>) {
            if let Some(object) = value.as_object() {
                let quoted = under_quote
                    || matches!(
                        object.get("type").and_then(Value::as_str),
                        Some("blockquote" | "noteCallout")
                    );
                if object.get("type") == Some(&json!("codeBlock")) {
                    let mut record = object.get("attributes").cloned().unwrap_or_default();
                    record["underBlockquote"] = json!(quoted);
                    output.push(record);
                }
                if let Some(children) = object.get("children").and_then(Value::as_array) {
                    for child in children {
                        collect_code_nodes(child, quoted, output);
                    }
                }
            }
        }

        fn collect_nodes_of_type<'a>(value: &'a Value, kind: &str, output: &mut Vec<&'a Value>) {
            if let Some(object) = value.as_object() {
                if object.get("type").and_then(Value::as_str) == Some(kind) {
                    output.push(value);
                }
                if let Some(children) = object.get("children").and_then(Value::as_array) {
                    for child in children {
                        collect_nodes_of_type(child, kind, output);
                    }
                }
            }
        }

        fn contains_caption_markup(value: &Value) -> bool {
            value.as_object().is_some_and(|object| {
                matches!(
                    object.get("type").and_then(Value::as_str),
                    Some("inlineCode" | "emphasis" | "strong" | "strikethrough")
                ) || object
                    .get("children")
                    .and_then(Value::as_array)
                    .is_some_and(|children| children.iter().any(contains_caption_markup))
            })
        }

        fn count_files(root: &Path) -> usize {
            fs::read_dir(root)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .map(|path| {
                    if path.is_dir() {
                        count_files(&path)
                    } else {
                        usize::from(path.is_file())
                    }
                })
                .sum()
        }

        let workspace =
            fs::canonicalize(Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
        let temporary = env::temp_dir().join(format!(
            "rust-tutor-curriculum-compiler-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&temporary).unwrap();
        let book_output = temporary.join("book.json");
        let mainmatter_output = temporary.join("mainmatter.json");
        compile_book(
            &workspace.join("content/curriculum-v2/sources/rust-book"),
            &book_output,
        )
        .unwrap();
        compile_mainmatter(
            &workspace.join("content/curriculum-v2/mainmatter.json"),
            &workspace.join("content/curriculum-v2/sources/mainmatter/book/src/going_further.md"),
            &mainmatter_output,
        )
        .unwrap();

        let book: Value = serde_json::from_str(&read_text(&book_output).unwrap()).unwrap();
        let pages = book["pages"].as_array().unwrap();
        assert_eq!(pages.len(), 109);
        assert_eq!(book["redirects"].as_array().unwrap().len(), 22);
        assert_eq!(
            pages
                .iter()
                .map(|page| page["includes"].as_array().unwrap().len())
                .sum::<usize>(),
            707
        );
        assert_eq!(
            pages
                .iter()
                .flat_map(|page| page["includes"].as_array().unwrap())
                .filter_map(|include| include["sourcePath"].as_str())
                .collect::<BTreeSet<_>>()
                .len(),
            669
        );
        assert_eq!(
            pages
                .iter()
                .map(|page| page["assets"].as_array().unwrap().len())
                .sum::<usize>(),
            28
        );
        assert_eq!(book["preprocessors"].as_array().unwrap().len(), 2);
        assert_eq!(
            count_files(
                &workspace.join("content/curriculum-v2/sources/rust-book/packages/mdbook-trpl")
            ),
            20
        );
        let mut listings = vec![];
        let mut captions = vec![];
        let mut notes = vec![];
        let mut quotes = vec![];
        for page in pages {
            for block in page["blocks"].as_array().unwrap() {
                collect_nodes_of_type(block, "listing", &mut listings);
                collect_nodes_of_type(block, "listingCaption", &mut captions);
                collect_nodes_of_type(block, "noteCallout", &mut notes);
                collect_nodes_of_type(block, "blockquote", &mut quotes);
            }
        }
        assert_eq!(listings.len(), 424);
        assert_eq!(
            listings
                .iter()
                .filter(|listing| listing["attributes"]["number"].is_string())
                .count(),
            384
        );
        assert_eq!(captions.len(), 384);
        assert!(
            captions
                .iter()
                .all(|caption| caption.get("attributes").is_none())
        );
        assert_eq!(
            listings
                .iter()
                .filter(|listing| listing["attributes"]["fileName"].is_string())
                .count(),
            337
        );
        assert_eq!(
            captions
                .iter()
                .filter(|caption| contains_caption_markup(caption))
                .count(),
            269
        );
        assert_eq!(notes.len(), 46);
        assert_eq!(
            notes
                .iter()
                .filter(|note| note["attributes"]["variant"] == json!("label"))
                .count(),
            32
        );
        assert_eq!(
            notes
                .iter()
                .filter(|note| note["attributes"]["variant"] == json!("heading"))
                .count(),
            14
        );
        assert_eq!(quotes.len(), 3);
        let mut code_nodes = vec![];
        for page in pages {
            for block in page["blocks"].as_array().unwrap() {
                collect_code_nodes(block, false, &mut code_nodes);
            }
        }
        assert_eq!(code_nodes.len(), 956);
        assert_eq!(
            code_nodes
                .iter()
                .filter(|attributes| attributes["underBlockquote"] == json!(true))
                .count(),
            6
        );
        assert!(code_nodes.iter().all(|attributes| {
            attributes["info"].is_string()
                && attributes["ordinal"].is_number()
                && attributes["byteLength"].is_number()
                && attributes["textSha256"]
                    .as_str()
                    .is_some_and(|hash| hash.len() == 64)
        }));
        assert!(pages.iter().all(|page| {
            page["links"]
                .as_array()
                .unwrap()
                .iter()
                .all(|link| link["sourceTarget"].is_string() && link["target"]["kind"].is_string())
        }));

        let mainmatter: Value =
            serde_json::from_str(&read_text(&mainmatter_output).unwrap()).unwrap();
        assert_eq!(mainmatter["exercises"].as_array().unwrap().len(), 98);
        let raw: Value = serde_json::from_str(
            &read_text(&workspace.join("content/curriculum-v2/mainmatter.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            raw["arcs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|arc| arc["exerciseCount"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![2, 11, 13, 15, 16, 17, 15, 9]
        );

        fs::remove_file(book_output).unwrap();
        fs::remove_file(mainmatter_output).unwrap();
        fs::remove_dir(temporary).unwrap();
    }
}
