use std::{fs, path::PathBuf};

use rust_tutor_service::{
    api_contract_fixture,
    content::{manifest, validate_pack},
    diagnostic::DiagnosticBlueprints,
    exam::FinalExam,
    graph::RuntimeGraph,
    question,
    tutor::TutorContent,
};
use serde_json::json;

/// Validates every embedded release artifact and their cross-resource links:
/// the runtime graph (including the injected tutor slice), tutor content,
/// diagnostic blueprints, the final exam (checksums and next-proof IDs), and
/// the golden question bank against the active content release.
fn validate_release_artifacts() -> Result<String, String> {
    let graph = RuntimeGraph::load_embedded()?;
    let content = TutorContent::load_embedded()?;
    let diagnostic = DiagnosticBlueprints::load_embedded(&graph)?;
    let exam = FinalExam::load_embedded(&graph)?;
    let questions = question::golden_bank();
    question::validate_bank(&questions)?;
    question::validate_bank_against_content(&questions, &content)?;
    for exercise in &content.exercises {
        if graph.node(&exercise.id).is_none() {
            return Err(format!("{} is missing from the runtime graph", exercise.id));
        }
    }
    Ok(format!(
        "graph {} ({} nodes, {} edges) · content {} · diagnostic {} · exam {} {} · {} questions",
        graph.release_id,
        graph.nodes.len(),
        graph.edges.len(),
        content.release_id,
        diagnostic.release_id,
        exam.form_id,
        exam.form_version,
        questions.len()
    ))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "validate".to_owned());
    let root = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "content/ownership-pack".to_owned()),
    );
    let json_output = args.any(|arg| arg == "--json");
    let report =
        validate_pack(&root).map_err(|error| format!("content validation failed: {error}"))?;
    match command.as_str() {
        "validate" => {
            let release_summary = validate_release_artifacts()
                .map_err(|error| format!("release artifact validation failed: {error}"))?;
            if json_output {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else if report.errors.is_empty() {
                println!("Validated {} ({})", root.display(), report.checksum);
                println!("Validated release artifacts: {release_summary}");
            } else {
                for error in &report.errors {
                    eprintln!(
                        "{}:{} {} {}: {}",
                        error.file, error.line, error.code, error.field, error.message
                    );
                }
            }
        }
        "preview" => println!(
            "{}",
            serde_json::to_string_pretty(
                &json!({"path":root,"status":report.status,"counts":report.counts,"generatedEdges":report.generated_edges.len()})
            )?
        ),
        "format" => {
            let path = root.join("release-v1.json");
            let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path)?)?;
            fs::write(path, format!("{}\n", serde_json::to_string_pretty(&value)?))?;
            println!("Formatted release metadata; Markdown was not rewritten.");
        }
        "manifest" => {
            if !report.errors.is_empty() {
                return Err("cannot manifest invalid content".into());
            }
            let generated = root.parent().unwrap_or(&root).join("generated");
            fs::create_dir_all(&generated)?;
            fs::write(
                generated.join("release-manifest.v1.json"),
                format!("{}\n", serde_json::to_string_pretty(&manifest(&report))?),
            )?;
            fs::write(
                generated.join("structural-edges.v1.json"),
                format!(
                    "{}\n",
                    serde_json::to_string_pretty(&report.generated_edges)?
                ),
            )?;
            println!("Generated deterministic content manifest and structural edges.");
        }
        "api-fixture" => {
            let generated = root.parent().unwrap_or(&root).join("generated");
            fs::create_dir_all(&generated)?;
            let fixture = api_contract_fixture();
            fs::write(
                generated.join("api-contract-v1.json"),
                format!("{}\n", serde_json::to_string_pretty(&fixture)?),
            )?;
            println!("Generated Rust API contract fixture.");
        }
        _ => return Err(format!("unknown content command: {command}").into()),
    }
    if report.errors.is_empty() {
        Ok(())
    } else {
        Err(format!("{} content errors", report.errors.len()).into())
    }
}
