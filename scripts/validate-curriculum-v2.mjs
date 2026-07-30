#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelease, stableJson } from "./build-curriculum.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releasePath = resolve(root, "content/curriculum-v2/release.json");
const schemaPath = resolve(root, "schemas/curriculum.v2.schema.json");
const errors = [];
const fail = (message) => errors.push(message);
const requireArray = (value, label, minimum = 0) => {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
    return [];
  }
  if (value.length < minimum) fail(`${label} must contain at least ${minimum} entries`);
  return value;
};
const requireText = (value, label, minimum = 1) => {
  if (typeof value !== "string" || value.trim().length < minimum)
    fail(`${label} must be text (${minimum}+ characters)`);
};

function checkUniqueIds(collections) {
  const seen = new Map();
  for (const [label, records] of collections) {
    for (const record of records) {
      requireText(record.id, `${label}.id`);
      if (seen.has(record.id))
        fail(`duplicate id ${record.id} in ${seen.get(record.id)} and ${label}`);
      else seen.set(record.id, label);
    }
  }
  return seen;
}

function checkWorkspace(record, label) {
  requireText(record.starter?.manifest, `${label}.starter.manifest`);
  const starterFiles = requireArray(record.starter?.files, `${label}.starter.files`, 1);
  const solutionFiles = requireArray(
    record.referenceSolution?.files,
    `${label}.referenceSolution.files`,
    1,
  );
  const starterPaths = new Set(starterFiles.map((file) => file.path));
  for (const file of [...starterFiles, ...solutionFiles]) {
    requireText(file.path, `${label}.file.path`);
    if (typeof file.content !== "string") fail(`${label} ${file.path} content must be a string`);
  }
  for (const suite of ["visible", "hidden", "regression"]) {
    const tests = requireArray(
      record.tests?.[suite],
      `${label}.tests.${suite}`,
      suite === "regression" ? 0 : 1,
    );
    for (const test of tests) {
      requireText(test.name, `${label}.tests.${suite}.name`);
      requireText(test.path, `${label}.tests.${suite}.path`);
      requireText(test.content, `${label}.tests.${suite}.content`);
    }
  }
  const evaluator = record.evaluator;
  if (evaluator?.mode !== "cargo-workspace")
    fail(`${label}.evaluator.mode must be cargo-workspace`);
  requireArray(evaluator?.editableFiles, `${label}.evaluator.editableFiles`, 1);
  requireArray(evaluator?.lockedFiles, `${label}.evaluator.lockedFiles`, 1);
  const commands = requireArray(evaluator?.commands, `${label}.evaluator.commands`, 1);
  if (!commands.every((command) => command.includes("--offline")))
    fail(`${label} evaluator commands must run offline`);
  if (
    !evaluator?.limits ||
    !Number.isInteger(evaluator.limits.timeoutMs) ||
    evaluator.limits.timeoutMs < 1
  )
    fail(`${label} needs positive evaluator limits`);
  requireArray(evaluator?.expectedArtifacts, `${label}.evaluator.expectedArtifacts`, 1);
  if (starterPaths.size !== starterFiles.length) fail(`${label} has duplicate starter file paths`);
}

function checkDag(edges) {
  const outgoing = new Map();
  const nodes = new Set();
  for (const edge of edges.filter(
    (edge) => edge.kind === "prerequisite" || edge.kind === "continues",
  )) {
    nodes.add(edge.sourceId);
    nodes.add(edge.targetId);
    if (!outgoing.has(edge.sourceId)) outgoing.set(edge.sourceId, []);
    outgoing.get(edge.sourceId).push(edge.targetId);
  }
  const visiting = new Set();
  const visited = new Set();
  const walk = (node) => {
    if (visiting.has(node)) {
      fail(`prerequisite/continuation cycle reaches ${node}`);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of outgoing.get(node) ?? []) walk(next);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of nodes) walk(node);
}

async function writeTree(base, files) {
  for (const file of files) {
    const path = resolve(base, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
}

async function runReferenceSolutions(release) {
  const temporary = await mkdtemp(resolve(tmpdir(), "rust-tutor-curriculum-v2-"));
  const target = resolve(temporary, "target");
  const cargo = (args, cwd, label) => {
    const result = spawnSync("cargo", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, CARGO_NET_OFFLINE: "true", CARGO_TARGET_DIR: target },
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0)
      throw new Error(`${label} reference solution failed:\n${result.stdout}\n${result.stderr}`);
  };
  try {
    const raw = JSON.parse(
      await readFile(resolve(root, "content/curriculum-v2/mainmatter.json"), "utf8"),
    );
    const upstreamRoot = resolve(temporary, "mainmatter");
    await writeTree(upstreamRoot, raw.sharedWorkspaceFiles);
    const mainmatterSource = release.sources.find((source) => source.id === "SRC-MAINMATTER-100");
    await writeTree(upstreamRoot, mainmatterSource.solutionSnapshotOverrides ?? []);
    for (const exercise of raw.exercises)
      await writeTree(
        resolve(upstreamRoot, exercise.starter.workspaceRoot),
        exercise.referenceSolution.files,
      );
    cargo(
      ["test", "--offline", "--workspace", "--all-targets"],
      upstreamRoot,
      "Mainmatter workspace",
    );

    const generated = [
      ...release.exercises.filter((exercise) => exercise.family === "interview"),
      ...release.stages,
    ];
    for (const [index, record] of generated.entries()) {
      const workspace = resolve(temporary, "generated", String(index));
      await mkdir(workspace, { recursive: true });
      await writeFile(resolve(workspace, "Cargo.toml"), record.starter.manifest);
      await writeTree(
        workspace,
        record.referenceSolution.files.filter((file) => file.path !== "Cargo.toml"),
      );
      await writeTree(workspace, [
        ...record.tests.visible,
        ...record.tests.hidden,
        ...record.tests.regression,
      ]);
      cargo(
        ["test", "--offline", "--all-targets", "--manifest-path", resolve(workspace, "Cargo.toml")],
        workspace,
        record.id,
      );
      if ((index + 1) % 25 === 0)
        console.log(`verified ${index + 1}/${generated.length} generated reference workspaces`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const release = JSON.parse(await readFile(releasePath, "utf8"));
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
if (schema.$id !== "urn:rust-tutor:curriculum:v2") fail("schema id is not curriculum v2");
if (release.schemaVersion !== 2) fail("schemaVersion must equal 2");
requireText(release.releaseId, "releaseId");
if (!/^2\.[0-9]+\.[0-9]+$/.test(release.version ?? "")) fail("release version must be a v2 semver");

const sources = requireArray(release.sources, "sources", 3);
const modules = requireArray(release.modules, "modules");
const lessons = requireArray(release.lessons, "lessons");
const exercises = requireArray(release.exercises, "exercises");
const projects = requireArray(release.projects, "projects");
const stages = requireArray(release.stages, "stages");
const edges = requireArray(release.edges, "edges");
const edgeKinds = requireArray(release.edgeKinds, "edgeKinds", 1);
const ids = checkUniqueIds([
  ["source", sources],
  ["module", modules],
  ["lesson", lessons],
  ["exercise", exercises],
  ["project", projects],
  ["stage", stages],
  ["edge", edges],
]);
const sourceIds = new Set(sources.map((source) => source.id));
const moduleIds = new Set(modules.map((module) => module.id));
const lessonIds = new Set(lessons.map((lesson) => lesson.id));
const projectIds = new Set(projects.map((project) => project.id));
const stageIds = new Set(stages.map((stage) => stage.id));
const mainmatterSource = sources.find((source) => source.id === "SRC-MAINMATTER-100");
if (requireArray(mainmatterSource?.snapshotFiles, "SRC-MAINMATTER-100.snapshotFiles", 1).length < 4)
  fail("Mainmatter workspace support snapshot is incomplete");

if (modules.length !== 21) fail(`expected exactly 21 Rust Book modules, found ${modules.length}`);
if (lessons.length !== 80)
  fail(
    `expected 79 substantive Book section lessons plus the chapter 2 project lesson, found ${lessons.length}`,
  );
const moduleNumbers = [...modules].map((module) => module.number).sort((a, b) => a - b);
if (moduleNumbers.join(",") !== Array.from({ length: 21 }, (_, i) => i + 1).join(","))
  fail("Book module numbers must cover 1 through 21 exactly once");
for (const module of modules) {
  if (!module.sourceIds?.includes("SRC-RUST-BOOK-STABLE"))
    fail(`${module.id} must cite the Rust Book source`);
  for (const id of requireArray(module.lessonIds, `${module.id}.lessonIds`, 1))
    if (!lessonIds.has(id)) fail(`${module.id} references missing lesson ${id}`);
  for (const id of module.prerequisiteModuleIds ?? [])
    if (!moduleIds.has(id)) fail(`${module.id} references missing prerequisite module ${id}`);
}

for (const lesson of lessons) {
  if (!moduleIds.has(lesson.moduleId))
    fail(`${lesson.id} references missing module ${lesson.moduleId}`);
  requireText(lesson.summary, `${lesson.id}.summary`, 40);
  requireText(lesson.mentalModel, `${lesson.id}.mentalModel`, 40);
  const objectives = requireArray(lesson.objectives, `${lesson.id}.objectives`, 2);
  if (objectives.length > 4) fail(`${lesson.id} has more than four objectives`);
  requireArray(lesson.keyTerms, `${lesson.id}.keyTerms`, 3);
  requireArray(lesson.syntaxExamples, `${lesson.id}.syntaxExamples`, 1);
  requireArray(lesson.workedTrace, `${lesson.id}.workedTrace`, 3);
  requireArray(lesson.misconceptions, `${lesson.id}.misconceptions`, 1);
  requireArray(lesson.recallChecks, `${lesson.id}.recallChecks`, 1);
  requireArray(lesson.practiceBridge, `${lesson.id}.practiceBridge`, 1);
  requireArray(lesson.projectTransfer, `${lesson.id}.projectTransfer`, 1);
  const citations = requireArray(lesson.sectionSources, `${lesson.id}.sectionSources`, 1);
  if (
    !citations.every((citation) =>
      /^https:\/\/doc\.rust-lang\.org\/book\/ch\d{2}-/.test(citation.url ?? ""),
    )
  )
    fail(`${lesson.id} must use section-level official Book links`);
  if (lesson.review?.status !== "reviewed") fail(`${lesson.id} is not reviewed`);
  for (const id of lesson.prerequisiteIds ?? [])
    if (!lessonIds.has(id)) fail(`${lesson.id} references missing prerequisite lesson ${id}`);
}
const sectionUrls = lessons.flatMap((lesson) => lesson.sectionSources.map((source) => source.url));
if (new Set(sectionUrls).size !== 80)
  fail("every Book lesson must cite a distinct substantive section page");
const sectionCounts = Object.fromEntries(
  modules.map((module) => [module.number, module.lessonIds.length]),
);
const expectedSectionCounts = [3, 1, 5, 3, 3, 3, 5, 3, 3, 3, 3, 6, 4, 5, 6, 4, 6, 3, 3, 5, 3];
for (const [index, count] of expectedSectionCounts.entries())
  if (sectionCounts[index + 1] !== count)
    fail(
      `Book chapter ${index + 1} expected ${count} focused lesson(s), found ${sectionCounts[index + 1]}`,
    );

const expectedAliases = [
  "hello-rust",
  "variables",
  "types",
  "functions-flow",
  "ownership",
  "borrowing",
  "slices-strings",
  "structs",
  "enums-matching",
  "collections",
  "errors",
  "abstraction",
];
for (const alias of expectedAliases)
  if (!lessonIds.has(release.aliases?.[alias])) fail(`legacy alias ${alias} is missing or invalid`);
if (Object.keys(release.aliases ?? {}).length !== 12)
  fail("the release must preserve exactly the 12 current chapter aliases");

const mainmatter = exercises.filter((exercise) => exercise.family === "mainmatter");
const interview = exercises.filter((exercise) => exercise.family === "interview");
if (mainmatter.length !== 98)
  fail(`expected exactly 98 Mainmatter exercises, found ${mainmatter.length}`);
if (interview.length !== 150)
  fail(`expected exactly 150 interview exercises, found ${interview.length}`);
const expectedPatterns = Object.fromEntries([
  ["arrays-hash-maps", 18],
  ["two-pointers-sliding-window", 16],
  ["stacks-queues", 12],
  ["binary-search", 10],
  ["linked-lists", 10],
  ["trees-bst", 18],
  ["heaps", 8],
  ["intervals-greedy", 10],
  ["backtracking", 10],
  ["graphs-union-find-topological", 16],
  ["dynamic-programming", 16],
  ["bit-math", 6],
]);
for (const [pattern, count] of Object.entries(expectedPatterns)) {
  const actual = interview.filter((exercise) => exercise.category === pattern).length;
  if (actual !== count) fail(`${pattern}: expected ${count} interview exercises, found ${actual}`);
}

for (const exercise of exercises) {
  if (!moduleIds.has(exercise.moduleId))
    fail(`${exercise.id} references missing module ${exercise.moduleId}`);
  if (!lessonIds.has(exercise.lessonId))
    fail(`${exercise.id} references missing lesson ${exercise.lessonId}`);
  requireText(exercise.prompt, `${exercise.id}.prompt`, 30);
  requireArray(exercise.prerequisiteIds, `${exercise.id}.prerequisiteIds`, 1);
  requireArray(exercise.outcomes, `${exercise.id}.outcomes`, 1);
  requireArray(exercise.hints, `${exercise.id}.hints`, 3);
  requireArray(exercise.commonMistakes, `${exercise.id}.commonMistakes`, 1);
  requireArray(exercise.tradeoffs, `${exercise.id}.tradeoffs`, 1);
  for (const key of ["purpose", "approach", "compilerImplications", "referenceRationale"])
    requireText(exercise.explanation?.[key], `${exercise.id}.explanation.${key}`, 20);
  checkWorkspace(exercise, exercise.id);
  if (!sourceIds.has(exercise.provenance?.sourceId))
    fail(`${exercise.id} has unknown provenance source ${exercise.provenance?.sourceId}`);
  requireText(exercise.provenance?.license, `${exercise.id}.provenance.license`);
  requireText(exercise.provenance?.attribution, `${exercise.id}.provenance.attribution`, 10);
  if (exercise.family === "mainmatter") {
    if (exercise.provenance?.license !== "CC-BY-NC-4.0")
      fail(`${exercise.id} must retain CC-BY-NC-4.0`);
    if (exercise.provenance?.starterCommit !== "57d145e6d393dfffeadb97fc61e814255c3b6ffe")
      fail(`${exercise.id} has wrong starter commit`);
    if (exercise.provenance?.solutionCommit !== "e77613749a55c19c63cf78e3b30cafc007f53dab")
      fail(`${exercise.id} has wrong solution commit`);
    requireText(exercise.provenance?.originalPath, `${exercise.id}.provenance.originalPath`);
    requireText(exercise.provenance?.canonicalUrl, `${exercise.id}.provenance.canonicalUrl`);
  } else {
    if (exercise.provenance?.mode !== "app-authored")
      fail(`${exercise.id} must be marked app-authored`);
    if (
      /leetcode/i.test(
        JSON.stringify({
          prompt: exercise.prompt,
          tests: exercise.tests,
          solution: exercise.referenceSolution,
        }),
      )
    )
      fail(`${exercise.id} embeds LeetCode content instead of link-only metadata`);
    for (const reference of exercise.externalReferences ?? []) {
      const extra = Object.keys(reference).filter((key) => !["title", "url"].includes(key));
      if (extra.length)
        fail(`${exercise.id} external reference contains non-link metadata: ${extra.join(", ")}`);
    }
  }
}

if (projects.length !== 3) fail(`expected three flagship projects, found ${projects.length}`);
if (stages.length !== 27) fail(`expected exactly 27 flagship stages, found ${stages.length}`);
for (const code of ["PULSE", "QUAY", "TESSERA"]) {
  const project = projects.find((item) => item.id === `PRJ-${code}`);
  if (!project) fail(`missing PRJ-${code}`);
  else {
    if (project.stageIds.length !== 9) fail(`${project.id} must contain nine stages`);
    const stableIds = Array.from(
      { length: 9 },
      (_, index) => `${project.id}-${String(index).padStart(2, "0")}`,
    );
    if (project.stageIds.join(",") !== stableIds.join(",")) {
      fail(`${project.id} must preserve the public 00–08 stage IDs`);
    }
  }
}
for (const project of projects)
  for (const id of project.stageIds)
    if (!stageIds.has(id)) fail(`${project.id} references missing stage ${id}`);
for (const stage of stages) {
  if (!projectIds.has(stage.projectId))
    fail(`${stage.id} references missing project ${stage.projectId}`);
  for (const id of stage.relatedLessonIds)
    if (!lessonIds.has(id)) fail(`${stage.id} references missing lesson ${id}`);
  if (stage.predecessorStageId && !stageIds.has(stage.predecessorStageId))
    fail(`${stage.id} references missing predecessor ${stage.predecessorStageId}`);
  checkWorkspace(stage, stage.id);
  requireArray(stage.boundaries, `${stage.id}.boundaries`, 1);
  requireArray(stage.nonGoals, `${stage.id}.nonGoals`, 1);
  requireArray(stage.entryReadiness, `${stage.id}.entryReadiness`, 1);
  requireArray(stage.definitionOfDone, `${stage.id}.definitionOfDone`, 1);
  requireArray(stage.rubric, `${stage.id}.rubric`, 1);
  requireArray(stage.artifacts, `${stage.id}.artifacts`, 1);
  requireArray(stage.hints, `${stage.id}.hints`, 3);
}

const knownEdgeKinds = new Set(edgeKinds.map((entry) => entry.kind));
for (const edge of edges) {
  if (!ids.has(edge.sourceId)) fail(`${edge.id} has dangling source ${edge.sourceId}`);
  if (!ids.has(edge.targetId)) fail(`${edge.id} has dangling target ${edge.targetId}`);
  if (!knownEdgeKinds.has(edge.kind)) fail(`${edge.id} uses undefined edge kind ${edge.kind}`);
  requireText(edge.rationale, `${edge.id}.rationale`, 10);
}
for (const kind of knownEdgeKinds)
  if (!edges.some((edge) => edge.kind === kind)) fail(`edge kind ${kind} is defined but unused`);
checkDag(edges);

const rebuilt = stableJson(await buildRelease());
const checkedIn = await readFile(releasePath, "utf8");
if (rebuilt !== checkedIn)
  fail("release.json is not the deterministic output of build-curriculum.mjs");

if (process.argv.includes("--run-solutions") && errors.length === 0) {
  await runReferenceSolutions(release);
  console.log("all 98 upstream and 177 generated reference workspaces pass offline");
}

if (errors.length) {
  console.error(`curriculum v2 validation failed (${errors.length} errors):`);
  for (const error of errors.slice(0, 100)) console.error(`- ${error}`);
  if (errors.length > 100) console.error(`- … ${errors.length - 100} additional errors`);
  process.exitCode = 1;
} else {
  console.log(
    `curriculum v2 valid: ${modules.length} Book modules, ${lessons.length} rich lessons, ${mainmatter.length} Mainmatter exercises, ${interview.length} interview exercises, ${stages.length} executable stages, ${edges.length} edges`,
  );
}
