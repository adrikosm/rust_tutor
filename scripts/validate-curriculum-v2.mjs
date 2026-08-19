#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  buildRelease,
  buildSourceManifest,
  canonicalTreeSha256,
  compileSourceDocuments,
  mainmatterIntegrity,
  stableJson,
  validateKnowledgeExtension,
} from "./build-curriculum.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releasePath = resolve(root, "content/curriculum-v2/release.json");
const schemaPath = resolve(root, "schemas/curriculum.v2.schema.json");
const knowledgeMappingsPath = resolve(root, "content/curriculum-v2/knowledge-mappings.json");
const knowledgeExtensionPath = resolve(root, "content/curriculum-v2/knowledge-extension.json");
const canonicalGraphPath = resolve(root, "knowledge/feed/generated/tutor-feed.json");
const errors = [];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
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
const sameIds = (left = [], right = []) =>
  [...left].sort().join("\n") === [...right].sort().join("\n");

async function gitTreeSha1(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) =>
    Buffer.compare(
      Buffer.from(`${left.name}${left.isDirectory() ? "/" : ""}`, "utf8"),
      Buffer.from(`${right.name}${right.isDirectory() ? "/" : ""}`, "utf8"),
    ),
  );
  const records = [];
  let fileCount = 0;
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    let mode;
    let objectHash;
    if (entry.isDirectory()) {
      mode = "40000";
      const child = await gitTreeSha1(path);
      objectHash = child.sha1;
      fileCount += child.fileCount;
    } else if (entry.isFile()) {
      mode = "100644";
      const bytes = await readFile(path);
      objectHash = createHash("sha1")
        .update(Buffer.from(`blob ${bytes.byteLength}\0`))
        .update(bytes)
        .digest("hex");
      fileCount += 1;
    } else {
      throw new Error(`unsupported pinned source entry: ${path}`);
    }
    records.push(Buffer.from(`${mode} ${entry.name}\0`));
    records.push(Buffer.from(objectHash, "hex"));
  }
  const payload = Buffer.concat(records);
  return {
    fileCount,
    sha1: createHash("sha1")
      .update(Buffer.from(`tree ${payload.byteLength}\0`))
      .update(payload)
      .digest("hex"),
  };
}

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
  for (const edge of edges.filter((edge) => edge.kind === "prerequisite_of")) {
    nodes.add(edge.sourceId);
    nodes.add(edge.targetId);
    if (!outgoing.has(edge.sourceId)) outgoing.set(edge.sourceId, []);
    outgoing.get(edge.sourceId).push(edge.targetId);
  }
  const visiting = new Set();
  const visited = new Set();
  const walk = (node) => {
    if (visiting.has(node)) {
      fail(`prerequisite_of cycle reaches ${node}`);
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

try {
  await compileSourceDocuments({ check: true });
} catch (error) {
  fail(error.message);
}
const rustBookText = await readFile(resolve(root, "content/curriculum-v2/rust-book.json"), "utf8");
const mainmatterDocumentsText = await readFile(
  resolve(root, "content/curriculum-v2/mainmatter-documents.json"),
  "utf8",
);
const sourceManifestText = await readFile(
  resolve(root, "content/curriculum-v2/source-manifest.json"),
  "utf8",
);
const knowledgeMappingsText = await readFile(knowledgeMappingsPath, "utf8");
const knowledgeExtensionText = await readFile(knowledgeExtensionPath, "utf8");
const canonicalGraphText = await readFile(canonicalGraphPath, "utf8");
const mainmatterPilotContracts = JSON.parse(
  await readFile(resolve(root, "content/curriculum-v2/mainmatter-pilot-contracts.json"), "utf8"),
);
const rustBookDocuments = JSON.parse(rustBookText);
const mainmatterDocuments = JSON.parse(mainmatterDocumentsText);
const sourceManifest = JSON.parse(sourceManifestText);
const knowledgeMappings = JSON.parse(knowledgeMappingsText);
const knowledgeExtension = JSON.parse(knowledgeExtensionText);
const canonicalGraph = JSON.parse(canonicalGraphText);
const release = JSON.parse(await readFile(releasePath, "utf8"));
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
if (schema.$id !== "urn:rust-tutor:curriculum:v2") fail("schema id is not curriculum v2");
if (!schema.$defs?.edge?.required?.includes("aliases"))
  fail("schema must require semantic-edge compatibility aliases");
if (schema.$defs?.sourceResource?.properties?.blocks?.items?.$ref !== "#/$defs/typedNode")
  fail("schema must type source resource blocks without raw Markdown or HTML");
const mainmatterSchema = schema.$defs?.exercise?.allOf?.find(
  (rule) => rule.if?.properties?.family?.const === "mainmatter",
);
for (const field of [
  "sourcePath",
  "sourceCommit",
  "sha256",
  "starterCommit",
  "starterPath",
  "starterCanonicalUrl",
  "solutionCommit",
  "solutionPath",
  "solutionCanonicalUrl",
  "packageHashAlgorithm",
  "starterPackageSha256",
  "solutionPackageSha256",
  "starterSharedWorkspaceSha256",
  "solutionSharedWorkspaceSha256",
])
  if (!mainmatterSchema?.then?.properties?.provenance?.required?.includes(field))
    fail(`schema must require Mainmatter provenance field ${field}`);
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
});
addFormats(ajv, ["date-time", "uri"]);
const validateSchema = ajv.compile(schema);
if (!validateSchema(release))
  fail(
    `release.json fails curriculum.v2.schema.json: ${ajv.errorsText(validateSchema.errors, { separator: "; " })}`,
  );
const invalidEdgeFixture = structuredClone(release);
delete invalidEdgeFixture.edges[0].aliases;
if (validateSchema(invalidEdgeFixture))
  fail("schema regression: an edge without compatibility aliases was accepted");
const invalidUriFixture = structuredClone(release);
invalidUriFixture.sources[0].canonicalUrl = "not a URI";
if (validateSchema(invalidUriFixture))
  fail("schema regression: an invalid canonicalUrl URI was accepted");
const invalidDateFixture = structuredClone(release);
invalidDateFixture.generatedAt = "not a date";
if (validateSchema(invalidDateFixture))
  fail("schema regression: an invalid generatedAt date-time was accepted");
const validateTypedNode = ajv.getSchema("urn:rust-tutor:curriculum:v2#/$defs/typedNode");
const validateResolvedTarget = ajv.getSchema("urn:rust-tutor:curriculum:v2#/$defs/resolvedTarget");
if (!validateTypedNode || !validateResolvedTarget)
  fail("schema did not register typed-node and resolved-target validators");
for (const [label, node] of [
  ["img missing alt", { type: "typedElement", attributes: { element: "img", src: "img/x.svg" } }],
  ["img missing src", { type: "typedElement", attributes: { element: "img", alt: "x" } }],
  ["anchor missing id", { type: "typedElement", attributes: { element: "a" }, children: [] }],
  [
    "code with listing caption",
    { type: "typedElement", attributes: { element: "code", caption: "unsafe" }, children: [] },
  ],
  [
    "image with children",
    {
      type: "typedElement",
      attributes: { element: "img", src: "img/x.svg", alt: "x" },
      children: [{ type: "text", text: "not allowed" }],
    },
  ],
  [
    "listing caption with duplicated target identity",
    {
      type: "listingCaption",
      attributes: { number: "2-1", targetId: "listing-2-1" },
      children: [],
    },
  ],
])
  if (validateTypedNode(node)) fail(`typed-element schema regression: ${label} was accepted`);
if (release.schemaVersion !== 2) fail("schemaVersion must equal 2");
requireText(release.releaseId, "releaseId");
if (!/^2\.[0-9]+\.[0-9]+$/.test(release.version ?? "")) fail("release version must be a v2 semver");

const sources = requireArray(release.sources, "sources", 3);
const modules = requireArray(release.modules, "modules");
const lessons = requireArray(release.lessons, "lessons");
const exercises = requireArray(release.exercises, "exercises");
const projects = requireArray(release.projects, "projects");
const stages = requireArray(release.stages, "stages");
const concepts = requireArray(release.concepts, "concepts", 1);
const outcomes = requireArray(release.outcomes, "outcomes", 1);
const edges = requireArray(release.edges, "edges");
const edgeKinds = requireArray(release.edgeKinds, "edgeKinds", 1);
const ids = checkUniqueIds([
  ["source", sources],
  ["module", modules],
  ["lesson", lessons],
  ["exercise", exercises],
  ["project", projects],
  ["stage", stages],
  ["concept", concepts],
  ["outcome", outcomes],
  ["edge", edges],
]);
const sourceIds = new Set(sources.map((source) => source.id));
const moduleIds = new Set(modules.map((module) => module.id));
const lessonIds = new Set(lessons.map((lesson) => lesson.id));
const conceptIds = new Set(concepts.map((concept) => concept.id));
const outcomeIds = new Set(outcomes.map((outcome) => outcome.id));
const library = requireArray(release.library, "library", 8);
const libraryIds = new Set(library.map((entry) => entry.id));
for (const entry of library) {
  if (entry.use !== "link-only")
    fail(`${entry.id} must stay link-only; this release republishes no third-party prose`);
  if (!entry.license) fail(`${entry.id} is missing a license`);
  if (!/^https:\/\//.test(entry.url ?? "")) fail(`${entry.id} needs an https canonical URL`);
}
const projectIds = new Set(projects.map((project) => project.id));
const stageIds = new Set(stages.map((stage) => stage.id));
const mainmatterSource = sources.find((source) => source.id === "SRC-MAINMATTER-100");
if (requireArray(mainmatterSource?.snapshotFiles, "SRC-MAINMATTER-100.snapshotFiles", 1).length < 4)
  fail("Mainmatter workspace support snapshot is incomplete");

const rustBookSource = sources.find((source) => source.id === "SRC-RUST-BOOK-STABLE");
const bookSnapshotRoot = resolve(root, "content/curriculum-v2/sources/rust-book");
const mdbookTrplTree = await gitTreeSha1(resolve(bookSnapshotRoot, "packages/mdbook-trpl"));
if (mdbookTrplTree.fileCount !== 20)
  fail(`pinned mdbook-trpl tree must contain 20 files, found ${mdbookTrplTree.fileCount}`);
if (mdbookTrplTree.sha1 !== "43644830ce53becebfd89c54750a706414f5a1f8")
  fail(`pinned mdbook-trpl Git tree differs: ${mdbookTrplTree.sha1}`);
const summary = await readFile(resolve(bookSnapshotRoot, "src/SUMMARY.md"), "utf8");
const summaryPages = [...summary.matchAll(/^\s*(?:-\s*)?\[([^\]]+)\]\(([^)#]+\.md)\)/gm)].map(
  ([, title, path]) => ({ title: title.replaceAll("`", ""), path }),
);
const selectedSummaryPages = summaryPages.filter(
  ({ path }) => path !== "title-page.md" && path !== "foreword.md",
);
if (summaryPages.length !== 111)
  fail(`Rust Book SUMMARY must contain 111 source links, found ${summaryPages.length}`);
if (selectedSummaryPages.length !== 109)
  fail(`Rust Book SUMMARY must select 109 pages, found ${selectedSummaryPages.length}`);
const compiledPages = requireArray(rustBookDocuments.pages, "rust-book.pages", 109);
if (compiledPages.length !== 109)
  fail(`compiled Rust Book must contain exactly 109 pages, found ${compiledPages.length}`);
if (
  compiledPages.map((page) => page.sourcePath).join("\n") !==
  selectedSummaryPages.map((page) => `src/${page.path}`).join("\n")
)
  fail("compiled Rust Book pages do not map one-to-one to SUMMARY order");
if (rustBookDocuments.sourceCommit !== "05d114287b7d6f6c9253d5242540f00fbd6172ab")
  fail("compiled Rust Book has the wrong source commit");
const configuredPreprocessors = requireArray(
  rustBookDocuments.preprocessors,
  "rust-book.preprocessors",
  2,
);
if (
  configuredPreprocessors.map((preprocessor) => preprocessor.name).join(",") !==
  "trpl-note,trpl-listing"
)
  fail("compiled Rust Book must record the pinned note/listing preprocessor order");
for (const preprocessor of configuredPreprocessors) {
  requireText(preprocessor.command, `${preprocessor.name}.command`);
  for (const input of requireArray(preprocessor.inputs, `${preprocessor.name}.inputs`, 4)) {
    const bytes = await readFile(resolve(bookSnapshotRoot, input.sourcePath)).catch(() => null);
    if (!bytes) fail(`${preprocessor.name} input is missing: ${input.sourcePath}`);
    else if (sha256(bytes) !== input.sha256)
      fail(`${preprocessor.name} input hash differs: ${input.sourcePath}`);
  }
}
if (configuredPreprocessors[1]?.outputMode !== "default")
  fail("trpl-listing must retain the pinned default output mode");
const bookPageById = new Map(compiledPages.map((page) => [page.id, page]));
let bookLinkCount = 0;
for (const page of compiledPages) {
  for (const link of page.links ?? []) {
    bookLinkCount += 1;
    if (Object.hasOwn(link, "internal") || typeof link.sourceTarget !== "string")
      fail(`${page.id} retains the obsolete raw/internal link contract`);
    if (validateResolvedTarget && !validateResolvedTarget(link.target))
      fail(
        `${page.id} resolved target fails schema: ${ajv.errorsText(validateResolvedTarget.errors)}`,
      );
    if (link.target?.kind === "bookPage") {
      const target = bookPageById.get(link.target.pageId);
      if (!target || target.sourcePath !== link.target.sourcePath)
        fail(`${page.id} resolved link points to a missing Book page`);
      if (link.target.anchor && !target?.anchors?.includes(link.target.anchor))
        fail(`${page.id} resolved link points to a missing Book anchor`);
    }
    if (link.sourceTarget.startsWith("../")) {
      const namespace = link.sourceTarget.slice(3).split("/", 1)[0];
      if (
        !["std", "reference", "nomicon", "unstable-book"].includes(namespace) ||
        link.target?.kind !== "external" ||
        !link.target.url.startsWith(`https://doc.rust-lang.org/${namespace}/`)
      )
        fail(`${page.id} has an incorrectly canonicalized documentation-relative link`);
    }
  }
}
if (bookLinkCount !== 312) fail(`expected 312 resolved Rust Book links, found ${bookLinkCount}`);
for (const redirect of rustBookDocuments.redirects ?? []) {
  if (!redirect.sourceAlias || !redirect.sourceTarget || redirect.target?.kind !== "bookPage")
    fail("Rust Book redirect lacks its raw alias or resolved page target");
  if (validateResolvedTarget && !validateResolvedTarget(redirect.target))
    fail(
      `Rust Book redirect target fails schema: ${ajv.errorsText(validateResolvedTarget.errors)}`,
    );
}

const allNodes = [];
const walkNodes = (nodes) => {
  for (const node of requireArray(nodes, "typed blocks")) {
    allNodes.push(node);
    if (validateTypedNode && !validateTypedNode(node))
      fail(
        `typed node fails schema: ${ajv.errorsText(validateTypedNode.errors, { separator: "; " })}`,
      );
    if (Object.hasOwn(node, "raw") || /rawhtml/i.test(node.type ?? ""))
      fail("compiled documents must never contain raw HTML");
    if (node.children) walkNodes(node.children);
  }
};
const nodeText = (node) =>
  `${node.text ?? ""}${(node.children ?? []).map((child) => nodeText(child)).join("")}`;
const codeEvidenceFromNodes = (nodes, output = []) => {
  for (const node of nodes ?? []) {
    if (node.type === "codeBlock") {
      const text = nodeText(node);
      output.push({
        ordinal: node.attributes?.ordinal,
        info: node.attributes?.info,
        byteLength: Buffer.byteLength(text),
        textSha256: sha256(text),
      });
    }
    codeEvidenceFromNodes(node.children, output);
  }
  return output;
};
const sameCodeEvidence = (left, right) =>
  left.length === right?.length &&
  left.every(
    (record, index) =>
      record.ordinal === right[index]?.ordinal &&
      record.info === right[index]?.info &&
      record.byteLength === right[index]?.byteLength &&
      record.textSha256 === right[index]?.textSha256,
  );
let bookIncludes = 0;
let bookAssets = 0;
let bookFencedCode = 0;
let bookIndentedCode = 0;
for (const [index, page] of compiledPages.entries()) {
  if (page.sequence !== index + 1) fail(`${page.id} has wrong sequence`);
  for (const field of [
    "sourcePath",
    "sourceCommit",
    "canonicalUrl",
    "sha256",
    "license",
    "attribution",
  ])
    requireText(page[field], `${page.id}.${field}`);
  if (page.license !== "MIT OR Apache-2.0") fail(`${page.id} has the wrong dual license`);
  if (page.sourceCommit !== "05d114287b7d6f6c9253d5242540f00fbd6172ab")
    fail(`${page.id} has the wrong source commit`);
  if (!Array.isArray(page.changeNotes) || page.changeNotes.length === 0)
    fail(`${page.id} needs change notes`);
  const sourcePath = resolve(bookSnapshotRoot, page.sourcePath);
  const source = await readFile(sourcePath).catch(() => null);
  if (!source) fail(`${page.id} source file is missing: ${page.sourcePath}`);
  else if (sha256(source) !== page.sha256) fail(`${page.id} source hash does not match`);
  for (const include of page.includes ?? []) {
    bookIncludes += 1;
    const content = await readFile(resolve(bookSnapshotRoot, include.sourcePath)).catch(() => null);
    if (!content) fail(`${page.id} include is missing: ${include.sourcePath}`);
    else if (sha256(content) !== include.sha256)
      fail(`${page.id} include hash does not match: ${include.sourcePath}`);
  }
  for (const asset of page.assets ?? []) {
    bookAssets += 1;
    const content = await readFile(resolve(bookSnapshotRoot, "src", asset.path)).catch(() => null);
    if (!content) fail(`${page.id} asset is missing: ${asset.path}`);
    else if (sha256(content) !== asset.sha256)
      fail(`${page.id} asset hash does not match: ${asset.path}`);
  }
  bookFencedCode += page.fencedCodeBlockCount ?? 0;
  bookIndentedCode += page.indentedCodeBlockCount ?? 0;
  const serializedCode = codeEvidenceFromNodes(page.blocks);
  if (!sameCodeEvidence(serializedCode, page.codeBlocks))
    fail(`${page.id} ordered code text/info evidence differs from its serialized nodes`);
  walkNodes(page.blocks);
}
const bookNodes = [...allNodes];
const listings = bookNodes.filter((node) => node.type === "listing");
const listingCaptions = bookNodes.filter((node) => node.type === "listingCaption");
const noteCallouts = bookNodes.filter((node) => node.type === "noteCallout");
const captionHasMarkup = (node) =>
  ["inlineCode", "emphasis", "strong", "strikethrough"].includes(node.type) ||
  (node.children ?? []).some(captionHasMarkup);
if (listings.length !== 424)
  fail(`expected 424 typed Rust Book listings, found ${listings.length}`);
if (listings.filter((node) => node.attributes?.number).length !== 384)
  fail("expected 384 numbered Rust Book listings");
if (listingCaptions.length !== 384) fail("expected 384 typed Rust Book listing captions");
if (listings.filter((node) => node.attributes?.fileName !== undefined).length !== 337)
  fail("expected 337 filename-labelled Rust Book listings");
if (listingCaptions.filter(captionHasMarkup).length !== 269)
  fail("expected 269 Rust Book captions with compiled inline Markdown");
for (const listing of listings) {
  const { id, number } = listing.attributes ?? {};
  if ((number === undefined) !== (id === undefined) || (number && id !== `listing-${number}`))
    fail("Rust Book listing number and target id do not agree");
  const directCaptions = (listing.children ?? []).filter(
    (child) => child.type === "listingCaption",
  );
  if (number !== undefined && directCaptions.length !== 1)
    fail("a numbered Rust Book listing must have exactly one derived-label caption");
  if (number === undefined && directCaptions.length > 1)
    fail("an unnumbered Rust Book listing can have at most one caption");
  if (
    number === undefined &&
    directCaptions.length === 1 &&
    nodeText(directCaptions[0]).length === 0
  )
    fail("an unnumbered Rust Book listing cannot have an empty caption");
  if (
    directCaptions.length === 1 &&
    listing.children?.[listing.children.length - 1] !== directCaptions[0]
  )
    fail("a Rust Book listing caption must be its final direct child");
}
const validateCaptionParents = (nodes, parentType) => {
  for (const node of nodes ?? []) {
    if (node.type === "listingCaption") {
      if (parentType !== "listing") fail("listingCaption must be a direct child of listing");
      if (Object.hasOwn(node, "attributes"))
        fail("listingCaption must not duplicate its parent number or target identity");
    }
    validateCaptionParents(node.children, node.type);
  }
};
for (const page of compiledPages) validateCaptionParents(page.blocks);
if (
  bookNodes.some((node) => node.type === "typedElement" && node.attributes?.element === "listing")
)
  fail("Rust Book listing remained a generic typedElement");
if (noteCallouts.length !== 46)
  fail(`expected 46 typed Rust Book notes, found ${noteCallouts.length}`);
if (noteCallouts.filter((node) => node.attributes?.variant === "label").length !== 32)
  fail("expected 32 Rust Book Note:-label callouts");
if (noteCallouts.filter((node) => node.attributes?.variant === "heading").length !== 14)
  fail("expected 14 Rust Book heading-first callouts");
if (bookNodes.filter((node) => node.type === "blockquote").length !== 3)
  fail("expected exactly three ordinary Rust Book blockquotes after note preprocessing");
let blockquotedFencedCode = 0;
const countBlockquotedFences = (nodes, underSourceQuote = false) => {
  for (const node of nodes ?? []) {
    const quoted = underSourceQuote || node.type === "blockquote" || node.type === "noteCallout";
    if (quoted && node.type === "codeBlock") blockquotedFencedCode += 1;
    countBlockquotedFences(node.children, quoted);
  }
};
for (const page of compiledPages) countBlockquotedFences(page.blocks);
if (blockquotedFencedCode !== 6)
  fail(`expected six blockquoted fenced blocks, found ${blockquotedFencedCode}`);
if (bookIncludes !== 707) fail(`expected 707 Rust Book include directives, found ${bookIncludes}`);
if (bookAssets !== 28) fail(`expected 28 Rust Book referenced assets, found ${bookAssets}`);
const uniqueIncludeTargets = new Set(
  compiledPages.flatMap((page) => page.includes.map((include) => include.sourcePath)),
);
if (uniqueIncludeTargets.size !== 669)
  fail(`expected 669 unique Rust Book include targets, found ${uniqueIncludeTargets.size}`);
if (rustBookDocuments.redirects?.length !== 22)
  fail(`expected 22 configured Rust Book redirects, found ${rustBookDocuments.redirects?.length}`);
if (bookFencedCode !== 956)
  fail(
    `expected 956 literal Rust Book fenced blocks at the pinned commit, found ${bookFencedCode}`,
  );
if (bookIndentedCode !== 0)
  fail(
    `expected no Rust Book indented code blocks at the pinned commit, found ${bookIndentedCode}`,
  );
if (bookFencedCode + bookIndentedCode !== 956)
  fail("Rust Book must preserve all 956 rendered code nodes");
for (const code of allNodes.filter((node) => node.type === "codeBlock")) {
  if (
    !new Set(["display", "runnable", "compile_fail", "panic", "context_fragment"]).has(
      code.attributes?.classification,
    )
  )
    fail("Rust Book code block has an invalid classification");
  if (code.attributes?.runnable !== false)
    fail("G1 must not mark unreviewed Rust Book code blocks runnable");
}
if (rustBookSource?.sourceCommit !== "05d114287b7d6f6c9253d5242540f00fbd6172ab")
  fail("Rust Book release source commit is not pinned");
if (rustBookSource?.documentSha256 !== sha256(rustBookText))
  fail("Rust Book release document hash does not match the typed artifact");
for (const [notice, expectedHash] of [
  ["LICENSE-MIT", "0621878e61f0d0fda054bcbe02df75192c28bde1ecc8289cbd86aeba2dd72720"],
  ["LICENSE-APACHE", "0f2763086f981043fb18879abfa15e75ecfc188219ef9eba4483f45ce7438e1c"],
  ["COPYRIGHT", "5acc946020b533f2ebfbbc87a35e56ab05dd48c269675cf20e289e0357e27fe8"],
]) {
  const content = await readFile(resolve(bookSnapshotRoot, notice)).catch(() => null);
  if (!content) fail(`Rust Book notice is missing: ${notice}`);
  else if (sha256(content) !== expectedHash) fail(`Rust Book notice hash differs: ${notice}`);
}

const mainmatterRawForCoverage = JSON.parse(
  await readFile(resolve(root, "content/curriculum-v2/mainmatter.json"), "utf8"),
);
if (knowledgeMappings.schemaVersion !== 1 || knowledgeMappings.reviewState !== "reviewed")
  fail("knowledge-mappings.json must be the reviewed, reviewer-controlled v1 artifact");
if (
  knowledgeMappings.canonicalGraph?.path !== "knowledge/feed/generated/tutor-feed.json" ||
  knowledgeMappings.canonicalGraph?.projection !== "graphProjection" ||
  knowledgeMappings.canonicalGraph?.requiredRecordReviewState !== "accepted"
)
  fail("knowledge-mappings.json must name the accepted canonical graph projection contract");
if (
  release.knowledgeMapping?.path !== "content/curriculum-v2/knowledge-mappings.json" ||
  release.knowledgeMapping?.sha256 !== sha256(knowledgeMappingsText) ||
  release.knowledgeMapping?.canonicalGraphPath !== "knowledge/feed/generated/tutor-feed.json" ||
  release.knowledgeMapping?.canonicalGraphSha256 !== sha256(canonicalGraphText) ||
  release.knowledgeMapping?.extensionPath !== "content/curriculum-v2/knowledge-extension.json" ||
  release.knowledgeMapping?.extensionSha256 !== sha256(knowledgeExtensionText)
)
  fail("release knowledge mapping provenance does not bind all authored inputs by SHA-256");

let reviewedKnowledge;
try {
  reviewedKnowledge = validateKnowledgeExtension(
    canonicalGraph,
    canonicalGraphText,
    knowledgeExtension,
  );
} catch (error) {
  fail(error.message);
  reviewedKnowledge = { nodes: new Map(), extensionSources: new Map(), relationships: [] };
}
requireArray(knowledgeExtension.newNodes, "knowledgeExtension.newNodes", 1);
requireArray(knowledgeExtension.promotions, "knowledgeExtension.promotions", 1);
requireArray(knowledgeExtension.relationships, "knowledgeExtension.relationships", 1);
const extensionMustReject = (label, mutate) => {
  const tampered = structuredClone(knowledgeExtension);
  mutate(tampered);
  try {
    validateKnowledgeExtension(canonicalGraph, canonicalGraphText, tampered);
    fail(`knowledge extension tamper regression accepted ${label}`);
  } catch {
    // Expected: every extension identity and promotion assumption is fail-closed.
  }
};
extensionMustReject("duplicate new ID", (extension) =>
  extension.newNodes.push(structuredClone(extension.newNodes[0])),
);
extensionMustReject("changed promotion target", (extension) => {
  extension.promotions[0].id = extension.promotions[1].id;
});
extensionMustReject("missing promotion target", (extension) => {
  extension.promotions[0].id = "CON-RUST-MISSING-PROMOTION-001";
});
extensionMustReject("promotion node hash drift", (extension) => {
  extension.promotions[0].expectedNodeSha256 = "0".repeat(64);
});
extensionMustReject("promotion kind drift", (extension) => {
  extension.promotions[0].expectedKind = "learning_outcome";
});
extensionMustReject("promotion review-state drift", (extension) => {
  extension.promotions[0].expectedReviewState = "accepted";
});
extensionMustReject("unsupported promoted review state", (extension) => {
  extension.promotions[0].promotedReviewState = "accepted_on_demand";
});
extensionMustReject("wrong new-node kind", (extension) => {
  extension.newNodes[0].kind = "rust_feature";
});
extensionMustReject("unsupported new-node review state", (extension) => {
  extension.newNodes[0].reviewState = "accepted_on_demand";
});
extensionMustReject("duplicate promotion", (extension) =>
  extension.promotions.push(structuredClone(extension.promotions[0])),
);
extensionMustReject("unsupported relationship kind", (extension) => {
  extension.relationships[0].kind = "practices";
});
extensionMustReject("missing relationship endpoint", (extension) => {
  extension.relationships[0].targetId = "OUT-RUST-MISSING-001";
});
extensionMustReject("duplicate relationship", (extension) =>
  extension.relationships.push(structuredClone(extension.relationships[0])),
);
extensionMustReject("extension node without topology", (extension) => {
  extension.relationships.pop();
});

const bookMappings = requireArray(knowledgeMappings.bookPages, "knowledgeMappings.bookPages", 109);
const exerciseMappings = requireArray(
  knowledgeMappings.mainmatterExercises,
  "knowledgeMappings.mainmatterExercises",
  98,
);
if (bookMappings.length !== 109)
  fail(`knowledge mapping must contain exactly 109 Book pages, found ${bookMappings.length}`);
if (exerciseMappings.length !== 98)
  fail(
    `knowledge mapping must contain exactly 98 Mainmatter exercises, found ${exerciseMappings.length}`,
  );
const duplicateMappingKeys = (records, key, label) => {
  const values = records.map((record) => record[key]);
  if (new Set(values).size !== values.length) fail(`${label} contains duplicate ${key} values`);
};
for (const key of ["sourcePath", "pageId"])
  duplicateMappingKeys(bookMappings, key, "book mappings");
duplicateMappingKeys(exerciseMappings, "exerciseId", "exercise mappings");
if (
  !sameIds(
    bookMappings.map((mapping) => mapping.sourcePath),
    compiledPages.map((page) => page.sourcePath),
  )
)
  fail("knowledge mappings do not cover the 109 compiled Book source paths exactly once");
if (
  !sameIds(
    exerciseMappings.map((mapping) => mapping.exerciseId),
    mainmatterRawForCoverage.exercises.map((exercise) => exercise.id),
  )
)
  fail("knowledge mappings do not cover the 98 pinned Mainmatter exercise IDs exactly once");

const canonicalNodes = [...reviewedKnowledge.nodes.values()];
const canonicalNodeById = new Map(canonicalNodes.map((node) => [node.id, node]));
const usedConceptIds = new Set();
const usedOutcomeIds = new Set();
const validateMapping = (mapping, label, sourceId, requireOutcome) => {
  requireText(mapping.rationale, `${label}.rationale`, 20);
  if (mapping.sourceId !== sourceId) fail(`${label} has the wrong sourceId`);
  if (mapping.mappingSource !== "content/curriculum-v2/knowledge-mappings.json")
    fail(`${label} does not identify the authored evidence contract`);
  for (const [field, kind, used, minimum] of [
    ["conceptIds", "concept", usedConceptIds, 1],
    ["outcomeIds", "learning_outcome", usedOutcomeIds, requireOutcome ? 1 : 0],
  ]) {
    const values = requireArray(mapping[field], `${label}.${field}`, minimum);
    if (new Set(values).size !== values.length) fail(`${label}.${field} contains duplicates`);
    for (const id of values) {
      const node = canonicalNodeById.get(id);
      if (!node) fail(`${label} maps to missing canonical node ${id}`);
      else {
        if (node.kind !== kind)
          fail(`${label} maps ${id} as ${kind}, but its kind is ${node.kind}`);
        if (node.reviewState !== "accepted")
          fail(`${label} maps ${id}, whose reviewState is ${node.reviewState}`);
      }
      used.add(id);
    }
  }
};
for (const mapping of bookMappings)
  validateMapping(mapping, `book mapping ${mapping.sourcePath}`, "SRC-RUST-BOOK-STABLE", false);
for (const mapping of exerciseMappings)
  validateMapping(mapping, `exercise mapping ${mapping.exerciseId}`, "SRC-MAINMATTER-100", true);

const allMappings = [...bookMappings, ...exerciseMappings];
if (new Set(allMappings.map((mapping) => mapping.rationale)).size !== allMappings.length)
  fail("every authored knowledge mapping rationale must be unique");
const bannedMappingTemplates = [
  /practices its reviewed Rust topic/i,
  /requires diagnostic-led repair without weakening/i,
  /fallback.*CON-BORROW-001/i,
  /mapped solely by (?:chapter|arc|upstream) order/i,
  /is selected because the pinned/i,
  /is observable only through committed/i,
  /can provide evidence for/i,
];
for (const mapping of allMappings)
  if (bannedMappingTemplates.some((pattern) => pattern.test(mapping.rationale)))
    fail(`${mapping.pageId ?? mapping.exerciseId} retains a banned generic mapping template`);

const forbiddenMappingEndpoints = new Map([
  ["LESSON-BOOK-03", ["CON-RUST-COPY-SEMANTICS-001"]],
  ["LESSON-BOOK-13", ["OUT-RUST-BUILD-ITERATOR-PIPELINE-001"]],
  [
    "LESSON-BOOK-14",
    ["CON-RUST-REPRODUCIBLE-BUILD-001", "CON-RUST-QUALITY-GATE-001", "OUT-RUST-PROVE-RELEASE-001"],
  ],
  ["LESSON-BOOK-14-04", ["CON-RUST-RELEASE-PACKAGE-001", "OUT-RUST-PROVE-RELEASE-001"]],
  ["LESSON-BOOK-14-05", ["CON-RUST-QUALITY-GATE-001", "OUT-RUST-SELECT-QUALITY-COMMAND-001"]],
  ["LESSON-BOOK-20-02", ["CON-RUST-PUBLIC-REEXPORT-001"]],
  [
    "LESSON-BOOK-APPENDIX-E",
    [
      "CON-RUST-TOOLCHAIN-RESOLUTION-001",
      "CON-RUST-REPRODUCIBLE-BUILD-001",
      "OUT-RUST-VERIFY-ACTIVE-TOOLCHAIN-001",
      "OUT-RUST-PROVE-RELEASE-001",
    ],
  ],
  ["mainmatter-01-intro-00-welcome", ["OUT-RUST-SELECT-QUALITY-COMMAND-001"]],
  [
    "mainmatter-02-basic_calculator-07-for",
    ["CON-RUST-ITERATION-OWNERSHIP-001", "OUT-RUST-TRACE-ITERATION-OWNERSHIP-001"],
  ],
  ["mainmatter-03-ticket_v1-07-setters", ["OUT-RUST-REPAIR-BORROW-CONFLICT-001"]],
  ["mainmatter-04-traits-07-deref", ["OUT-RUST-DESIGN-SMART-POINTER-BOUNDARY-001"]],
  [
    "mainmatter-05-ticket_v2-11-dependencies",
    ["CON-RUST-REPRODUCIBLE-BUILD-001", "OUT-RUST-PROVE-RELEASE-001"],
  ],
  [
    "mainmatter-06-ticket_management-03-resizing",
    ["CON-RUST-COLLECTION-ACCESS-001", "OUT-RUST-CHOOSE-COLLECTION-001"],
  ],
  ["mainmatter-08-futures-04-future", ["OUT-RUST-TRACE-FUTURE-PROGRESS-001"]],
]);
const mappingByIdForRegression = new Map(
  allMappings.map((mapping) => [mapping.pageId ?? mapping.exerciseId, mapping]),
);
for (const [id, forbiddenIds] of forbiddenMappingEndpoints) {
  const mapping = mappingByIdForRegression.get(id);
  const actual = new Set([...(mapping?.conceptIds ?? []), ...(mapping?.outcomeIds ?? [])]);
  for (const forbiddenId of forbiddenIds)
    if (actual.has(forbiddenId)) fail(`${id} restored rejected semantic endpoint ${forbiddenId}`);
}
for (const mapping of exerciseMappings)
  if (mapping.outcomeIds.includes("OUT-RUST-DEBUG-ROOT-CAUSE-001"))
    fail(
      `${mapping.exerciseId} cannot claim root-cause repair without process/regression evidence`,
    );

const exactEndpointReasons = new Set();
const bannedEndpointTemplates = [
  /is selected because the pinned/i,
  /is observable only through committed/i,
  /gives executable practice for the reviewed/i,
  /committed checks can assess/i,
  /pinned compile or visible-test contract assesses/i,
];
if (!bannedEndpointTemplates.some((pattern) => pattern.test("is selected because the pinned")))
  fail("endpoint-template regression fixture is not rejected");
const endpointObservations = new Set([
  "source_context",
  "compile",
  "runtime_assertion",
  "committed_answer_explanation",
]);
const validateEndpointRationales = (mapping, label, family) => {
  const expected = [...mapping.conceptIds, ...mapping.outcomeIds];
  const rationales = requireArray(
    mapping.endpointRationales,
    `${label}.endpointRationales`,
    expected.length,
  );
  if (
    !sameIds(
      expected,
      rationales.map((rationale) => rationale.id),
    )
  )
    fail(`${label}.endpointRationales must cover every mapped endpoint exactly once`);
  for (const rationale of rationales) {
    requireText(rationale.reason, `${label}.${rationale.id}.reason`, 80);
    if (exactEndpointReasons.has(rationale.reason))
      fail(`${label}.${rationale.id} reuses another endpoint rationale`);
    exactEndpointReasons.add(rationale.reason);
    if (bannedEndpointTemplates.some((pattern) => pattern.test(rationale.reason)))
      fail(`${label}.${rationale.id} retains a rejected endpoint template`);
    if (!["practices", "assesses"].includes(rationale.relation))
      fail(`${label}.${rationale.id}.relation must be practices or assesses`);
    if (!endpointObservations.has(rationale.observationKind))
      fail(`${label}.${rationale.id}.observationKind is unsupported`);
    const refs = requireArray(rationale.evidenceRefs, `${label}.${rationale.id}.evidenceRefs`, 1);
    if (new Set(refs).size !== refs.length)
      fail(`${label}.${rationale.id}.evidenceRefs contains duplicates`);
    const allowedRefs = family === "book" ? ["source"] : ["source", "starter", "verification"];
    for (const ref of refs)
      if (!allowedRefs.includes(ref))
        fail(`${label}.${rationale.id} has unsupported evidence ref ${ref}`);
    const node = canonicalNodeById.get(rationale.id);
    const canonicalCapability = node?.definition ?? node?.observableBehavior ?? node?.summary ?? "";
    if (rationale.capabilityDefinition !== canonicalCapability)
      fail(`${label}.${rationale.id}.capabilityDefinition differs from the accepted node`);
    requireText(rationale.evidenceBoundary, `${label}.${rationale.id}.evidenceBoundary`, 40);
    if (node?.kind === "concept" && rationale.relation !== "practices")
      fail(`${label}.${rationale.id}: concepts can only be practiced`);
    if (family === "book" && rationale.relation !== "practices")
      fail(
        `${label}.${rationale.id}: Book source context cannot assess before a reviewed BK check`,
      );
    if (family === "book" && rationale.observationKind !== "source_context")
      fail(`${label}.${rationale.id}: Book mappings are source_context in G2`);
    if (rationale.relation === "assesses") {
      if (node?.kind !== "learning_outcome")
        fail(`${label}.${rationale.id}: only learning outcomes can be assessed`);
      if (rationale.observationKind === "source_context")
        fail(`${label}.${rationale.id}: source context is not assessment evidence`);
      if (!refs.includes("verification"))
        fail(`${label}.${rationale.id}: assessment requires exact verification evidence`);
      fail(
        `${label}.${rationale.id}: no current G2 evaluator observes an accepted outcome in full`,
      );
    }
  }
};
const normalizeHeading = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replaceAll(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase();
const sourceSection = (document, source, anchor) => {
  const heading = document.headings?.find((candidate) => candidate.id === anchor);
  if (!heading) return null;
  const headings = [];
  const pattern = /^(?:>\s*)*(#{1,6})[ \t]+(.+?)\s*$/gm;
  let match = pattern.exec(source);
  while (match) {
    headings.push({
      level: match[1].length,
      title: normalizeHeading(match[2]),
      start: match.index,
      bodyStart: pattern.lastIndex,
    });
    match = pattern.exec(source);
  }
  const index = headings.findIndex(
    (candidate) => candidate.title === normalizeHeading(heading.text),
  );
  if (index < 0) return null;
  const selected = headings[index];
  let end = source.length;
  for (const candidate of headings.slice(index + 1))
    if (candidate.level <= selected.level) {
      end = candidate.start;
      break;
    }
  return source.slice(selected.start, end);
};
const validateSourceEvidence = (mapping, document, source, label) => {
  const evidence = mapping.evidence;
  if (!evidence || typeof evidence !== "object") {
    fail(`${label}.evidence must be an object`);
    return;
  }
  if (evidence.sourcePath !== mapping.sourcePath && evidence.sourcePath !== document.sourcePath)
    fail(`${label}.evidence.sourcePath differs from the pinned document`);
  if (evidence.sourceSha256 !== document.sha256 || sha256(source) !== document.sha256)
    fail(`${label}.evidence.sourceSha256 differs from the pinned bytes`);
  if (!document.headings?.some((heading) => heading.id === evidence.anchor))
    fail(`${label}.evidence.anchor is not a heading in the pinned typed document`);
  const section = sourceSection(document, source, evidence.anchor);
  if (section === null) fail(`${label}.evidence.anchor cannot be located in pinned source bytes`);
  requireText(evidence.term, `${label}.evidence.term`, 2);
  requireText(evidence.sourceExcerpt, `${label}.evidence.sourceExcerpt`, 40);
  if (!section?.includes(evidence.term))
    fail(`${label}.evidence.term is not exact text from the anchored source section`);
  if (!section?.includes(evidence.sourceExcerpt))
    fail(`${label}.evidence.sourceExcerpt is outside the anchored source section`);
  validateEndpointRationales(mapping, label, mapping.pageId ? "book" : "mainmatter");
};
const bookDocumentByPath = new Map(compiledPages.map((page) => [page.sourcePath, page]));
{
  const introduction = bookDocumentByPath.get("src/ch00-00-introduction.md");
  const source = await readFile(resolve(bookSnapshotRoot, "src/ch00-00-introduction.md"), "utf8");
  const who = sourceSection(introduction, source, "who-rust-is-for");
  const how = sourceSection(introduction, source, "how-to-use-this-book");
  const foreignExcerpt = how?.split(/\n\s*\n/).find((paragraph) => paragraph.trim().length > 40);
  if (!who || !foreignExcerpt || who.includes(foreignExcerpt.trim()))
    fail("out-of-section evidence regression fixture was accepted");
}
for (const mapping of bookMappings) {
  const label = `book mapping ${mapping.sourcePath}`;
  const document = bookDocumentByPath.get(mapping.sourcePath);
  const source = await readFile(resolve(bookSnapshotRoot, mapping.sourcePath), "utf8").catch(
    () => null,
  );
  if (!document || source === null) fail(`${label} cannot resolve its pinned source bytes`);
  else validateSourceEvidence(mapping, document, source, label);
}
const mainmatterDocumentById = new Map(
  mainmatterDocuments.exercises.map((document) => [document.exerciseId, document]),
);
const mainmatterRawById = new Map(
  mainmatterRawForCoverage.exercises.map((exercise) => [exercise.id, exercise]),
);
for (const mapping of exerciseMappings) {
  const label = `exercise mapping ${mapping.exerciseId}`;
  const document = mainmatterDocumentById.get(mapping.exerciseId);
  const raw = mainmatterRawById.get(mapping.exerciseId);
  if (!document || !raw) {
    fail(`${label} cannot resolve its pinned source package`);
    continue;
  }
  validateSourceEvidence(mapping, document, raw.sourceLesson.markdown, label);
  const evidence = mapping.evidence;
  const starter = raw.starter.files.find((file) => file.path === evidence.starterPath);
  if (
    !starter ||
    starter.sha256 !== evidence.starterSha256 ||
    sha256(starter.content) !== evidence.starterSha256
  )
    fail(`${label}.evidence starter path/hash does not bind a pinned starter file`);
  else {
    requireText(evidence.starterExcerpt, `${label}.evidence.starterExcerpt`, 2);
    if (!starter.content.includes(evidence.starterExcerpt))
      fail(`${label}.evidence.starterExcerpt is not exact pinned starter text`);
  }
  const verification = evidence.verification;
  const verificationFile = raw.starter.files.find((file) => file.path === verification?.path);
  if (
    !verificationFile ||
    verificationFile.sha256 !== verification?.sha256 ||
    sha256(verificationFile.content) !== verification?.sha256
  )
    fail(`${label}.evidence verification path/hash does not bind a pinned package file`);
  if (verification?.kind === "visible_test") {
    requireText(verification.excerpt, `${label}.evidence.verification.excerpt`, 8);
    if (!verificationFile?.content.includes(verification.excerpt))
      fail(`${label}.evidence verification excerpt is not exact pinned test text`);
    if (!/#\[(?:[A-Za-z0-9_]+::)?test\]/.test(verificationFile?.content ?? ""))
      fail(`${label}.evidence visible-test file has no pinned test function`);
  } else if (["compile_only", "compile_contract"].includes(verification?.kind)) {
    requireText(verification.limitation, `${label}.evidence.verification.limitation`, 60);
    if (verification.excerpt && !verificationFile?.content.includes(verification.excerpt))
      fail(`${label}.evidence compile excerpt is not exact pinned starter text`);
  } else fail(`${label}.evidence.verification.kind is unsupported`);

  for (const endpoint of mapping.endpointRationales ?? []) {
    if (endpoint.observationKind === "runtime_assertion" && verification?.kind !== "visible_test")
      fail(`${label}.${endpoint.id}: runtime assertion is not bound to a visible test`);
    if (
      endpoint.observationKind === "compile" &&
      !["compile_only", "compile_contract"].includes(verification?.kind)
    )
      fail(`${label}.${endpoint.id}: compile observation is not bound to a compile contract`);
    if (endpoint.observationKind === "committed_answer_explanation")
      fail(`${label}.${endpoint.id}: Mainmatter has no committed answer/explanation contract`);
  }
}

// These are explicit regression fixtures for the mappings repaired in the G2 review. They
// preserve the human-reviewed endpoint and evidence choices; they do not claim to automate
// semantic review of the other mappings.
const exactMappingLocks = [
  [
    "LESSON-BOOK-INTRO",
    ["CON-RUST-BOOK-ORIENTATION-001"],
    ["OUT-RUST-NAVIGATE-BOOK-001"],
    "how-to-use-this-book",
    "dcb6c7d9646baef20667d5cfd736c4dc636e7d2485bc63fe02f63bbaebacd4df",
  ],
  [
    "LESSON-BOOK-14",
    ["CON-CARGO-PROFILE-001"],
    ["OUT-RUST-CONFIGURE-RELEASE-PROFILE-001"],
    "customizing-builds-with-release-profiles",
    "a681d12ec25bcce409caf6f3e7e4226c1e23c3941b02c53fa7097d71987e4d47",
  ],
  [
    "LESSON-BOOK-APPENDIX-E",
    ["CON-RUST-EDITION-SEMANTICS-001"],
    ["OUT-RUST-SELECT-EDITION-001"],
    "appendix-e-editions",
    "ef28746d0d8c5f51dfd407e965b9b632c24502bc6d80d71454f77125d99a3f28",
  ],
  [
    "LESSON-BOOK-18-00",
    ["CON-RUST-OOP-IDIOM-COMPARISON-001"],
    ["OUT-RUST-COMPARE-OOP-DESIGN-001"],
    "object-oriented-programming-features",
    "fd0c924dcab2e233a81abfced9c162f05bfa80b1bd28ddff5b0e8835e71d5c79",
  ],
  [
    "LESSON-BOOK-01-00",
    ["CON-RUST-GETTING-STARTED-ROADMAP-001"],
    ["OUT-RUST-SELECT-GETTING-STARTED-STEP-001"],
    "getting-started",
    "61072e25e328a126b513f0b0428248ec001564f490065f356c14bb34f4a554be",
  ],
  [
    "LESSON-BOOK-03-02",
    ["CON-RUST-TYPE-INTERPRETATION-001"],
    ["OUT-RUST-CLASSIFY-BUILT-IN-DATA-TYPE-001"],
    "data-types",
    "b13035e4df89ddbe0a7bae745582d5290254fb66dba50272e3c4c837ac11ea66",
  ],
  [
    "LESSON-BOOK-17-04",
    ["CON-RUST-ASYNC-STREAM-001"],
    ["OUT-RUST-COMPOSE-ASYNC-STREAM-001"],
    "streams-futures-in-sequence",
    "c103e28b7c0dc04816bd953c817d0cea59d787cb2fdaa8c3fa201e03b75e5046",
  ],
  [
    "LESSON-BOOK-17-05",
    ["CON-RUST-FUTURE-POLL-STATE-001"],
    ["OUT-RUST-TRACE-FUTURE-PROGRESS-001"],
    "the-future-trait",
    "8b787cae4e946501ebc4d26cf77387e7b523c9a9ae21c98359b37843e0252268",
  ],
  [
    "LESSON-BOOK-19",
    ["CON-RUST-PATTERN-CONTEXT-001"],
    ["OUT-RUST-CLASSIFY-PATTERN-CONTEXT-001"],
    "all-the-places-patterns-can-be-used",
    "1ce8590e1cc71955a95be44e827ead8983adc60760d3a889e0b6746f649f0354",
  ],
  [
    "LESSON-BOOK-APPENDIX-D",
    ["CON-RUST-DEVELOPMENT-TOOL-ROLE-001"],
    ["OUT-RUST-SELECT-DEVELOPMENT-TOOL-001"],
    "appendix-d-useful-development-tools",
    "30bae228cc99a1bf6a5e13096a47e0c79696e5cd1f86223fcfea1a8a0e64dd44",
  ],
  [
    "LESSON-BOOK-APPENDIX-G",
    ["CON-RUST-RELEASE-CHANNEL-001"],
    ["OUT-RUST-SELECT-RELEASE-CHANNEL-001"],
    "choo-choo-release-channels-and-riding-the-trains",
    "1aaaa64213129e30a5b6e4472e689b841af9d8b3fa5fdd8abd039c6c48eea8b5",
  ],
  [
    "LESSON-BOOK-20-04",
    ["CON-RUST-FUNCTION-CONTRACT-001", "CON-RUST-CLOSURE-CAPTURE-001", "CON-RUST-IMPL-TRAIT-001"],
    ["OUT-RUST-USE-CALLABLE-BOUNDARY-001"],
    "returning-closures",
    "ffd01966d91abf47052a9775e5e4ab9ee4693d932f5847f101c224a3587c95f9",
  ],
  [
    "mainmatter-01-intro-00-welcome",
    ["CON-RUST-FUNCTION-CONTRACT-001", "CON-RUST-UNIT-TEST-001"],
    ["OUT-RUST-TRACE-EXPRESSION-VALUE-001"],
    "structure",
    "50b1455a5234d98e6aa5ae5085b9a1768be8f5fb16864d5eebab05fd51d337b2",
  ],
  [
    "mainmatter-07-threads-05-channels",
    ["CON-RUST-MESSAGE-PASSING-001", "CON-RUST-CHANNEL-CLOSURE-001"],
    ["OUT-RUST-DESIGN-THREAD-COMMUNICATION-001"],
    "channels",
    "08bacdad84247961ce2bc695566b3bd4588e914c1b11b584e82fd97148abc15b",
  ],
  [
    "mainmatter-07-threads-06-interior-mutability",
    [
      "CON-RUST-INTERIOR-MUTABILITY-001",
      "CON-RUST-REFERENCE-COUNTED-OWNERSHIP-001",
      "CON-RUST-SCOPE-DROP-001",
    ],
    ["OUT-RUST-DESIGN-SMART-POINTER-BOUNDARY-001"],
    "interior-mutability",
    "6a7edddea57b2a97a92f223c76bc73e6e209d8c704e1d934b245ae72889e66be",
  ],
  [
    "mainmatter-07-threads-07-ack",
    ["CON-RUST-MESSAGE-PASSING-001"],
    ["OUT-RUST-DESIGN-THREAD-COMMUNICATION-001"],
    "two-way-communication",
    "6ac506e2388c78cab3a59b16d19c1140b0895f761b960c2742201efbed9a8ff9",
  ],
  [
    "mainmatter-07-threads-13-without-channels",
    ["CON-RUST-SHARED-STATE-001", "CON-RUST-LOCK-SCOPE-001"],
    ["OUT-RUST-CHOOSE-CONCURRENCY-MODEL-001"],
    "design-review",
    "f8a35d8e2c1d53447f39d3eacf61a314faea8b50fc74caaede1490f540ca788c",
  ],
  [
    "mainmatter-07-threads-14-sync",
    ["CON-RUST-SEND-SYNC-001"],
    ["OUT-RUST-CLASSIFY-SEND-SYNC-001"],
    "sync",
    "6d5f47bf4d169ca5c37d5e6aab789ba31b29646226c876e50caf1bc5854f470c",
  ],
  [
    "mainmatter-08-futures-02-spawn",
    ["CON-RUST-SPAWNED-TASK-OWNERSHIP-001", "CON-RUST-ASYNC-TASK-LIFECYCLE-001"],
    ["OUT-RUST-CHOOSE-ASYNC-BOUNDARY-001"],
    "spawning-tasks",
    "1ceeddab400418cbc146dc84b2eb381708b8adccd42a6c409085553cfe6542f9",
  ],
  [
    "mainmatter-08-futures-03-runtime",
    [
      "CON-RUST-SPAWNED-TASK-OWNERSHIP-001",
      "CON-RUST-SEND-SYNC-001",
      "CON-RUST-ASYNC-TASK-LIFECYCLE-001",
    ],
    ["OUT-RUST-CLASSIFY-SEND-SYNC-001", "OUT-RUST-CHOOSE-ASYNC-BOUNDARY-001"],
    "runtime-architecture",
    "3c2bd06ef893d41c5d847fc9244333e5a6654cde7bbd0ca054a3c7e0eeee7c26",
  ],
  [
    "mainmatter-08-futures-04-future",
    ["CON-RUST-SPAWNED-TASK-OWNERSHIP-001"],
    ["OUT-RUST-TRACE-ASYNC-SUSPENSION-SEND-001"],
    "the-local-rc-problem",
    "4f4e753337a60ca2a8d4112f3448afbc3ce665b861c984df2696b5ff806f0508",
  ],
  [
    "mainmatter-06-ticket_management-09-impl-trait-2",
    ["CON-RUST-IMPL-TRAIT-001", "CON-RUST-NAMED-GENERIC-RELATION-001", "CON-RUST-TRAIT-BOUND-001"],
    ["OUT-RUST-DESIGN-GENERIC-API-001"],
    "impl-trait-in-argument-position",
    "6a6ebeea333c20aebeda32cf31761f30910e50981f9fac7cadff824bd7b7a18f",
  ],
];
const authoredMappingById = new Map(
  [...bookMappings, ...exerciseMappings].map((mapping) => [
    mapping.pageId ?? mapping.exerciseId,
    mapping,
  ]),
);
for (const [id, expectedConcepts, expectedOutcomes, anchor, excerptSha256] of exactMappingLocks) {
  const mapping = authoredMappingById.get(id);
  if (
    !mapping ||
    !sameIds(mapping.conceptIds, expectedConcepts) ||
    !sameIds(mapping.outcomeIds, expectedOutcomes) ||
    mapping.evidence?.anchor !== anchor ||
    sha256(mapping.evidence?.sourceExcerpt ?? "") !== excerptSha256
  )
    fail(`${id}: human-reviewed G2 mapping lock changed`);
}
const welcomeLock = authoredMappingById.get("mainmatter-01-intro-00-welcome");
if (
  welcomeLock?.evidence?.starterExcerpt !==
    "fn greeting() -> &'static str {\n    // TODO: fix me 👇\n    \"I'm ready to __!\"\n}" ||
  welcomeLock?.evidence?.verification?.kind !== "visible_test" ||
  welcomeLock?.evidence?.verification?.excerpt !==
    'assert_eq!(greeting(), "I\'m ready to learn Rust!");' ||
  !welcomeLock.endpointRationales.every(
    (endpoint) => endpoint.observationKind === "runtime_assertion",
  )
)
  fail("mainmatter welcome exact greeting signature/runtime contract changed");
for (const [id, excerpt] of [
  ["mainmatter-08-futures-04-future", 'yield_now().await;\n    println!("{}", non_send);'],
  [
    "mainmatter-06-ticket_management-09-impl-trait-2",
    "store.add_ticket::<TicketDraft>(TicketDraft {",
  ],
]) {
  const mapping = authoredMappingById.get(id);
  if (
    mapping?.evidence?.verification?.kind !== "compile_only" ||
    mapping?.evidence?.verification?.excerpt !== excerpt ||
    mapping.endpointRationales.filter((endpoint) => endpoint.observationKind === "compile")
      .length !== 1 ||
    mapping.endpointRationales.find((endpoint) => endpoint.observationKind === "compile")?.id !==
      mapping.outcomeIds[0]
  )
    fail(`${id}: exact compile-sensitive G2 contract changed`);
}

const mainmatterDocumentByPath = new Map(
  mainmatterDocuments.exercises.map((document) => [document.sourcePath, document]),
);
const mainmatterSourceByPath = new Map(
  mainmatterRawForCoverage.exercises.map((exercise) => [
    exercise.sourceLesson.path,
    exercise.sourceLesson.markdown,
  ]),
);
for (const owner of [...knowledgeExtension.newNodes, ...knowledgeExtension.promotions]) {
  const label = `knowledge extension ${owner.id}`;
  requireText(owner.justification ?? owner.summary, `${label}.summaryOrJustification`, 40);
  const evidenceRecords = requireArray(owner.sourceEvidence, `${label}.sourceEvidence`, 1);
  for (const evidence of evidenceRecords) {
    const bookEvidence = evidence.sourceId === "SRC-RUST-BOOK-STABLE";
    const mainmatterEvidence = evidence.sourceId === "SRC-MAINMATTER-100";
    if (!bookEvidence && !mainmatterEvidence) {
      fail(`${label}: sourceEvidence has unsupported sourceId ${evidence.sourceId}`);
      continue;
    }
    const document = bookEvidence
      ? bookDocumentByPath.get(evidence.sourcePath)
      : mainmatterDocumentByPath.get(evidence.sourcePath);
    const source = bookEvidence
      ? await readFile(resolve(bookSnapshotRoot, evidence.sourcePath), "utf8").catch(() => null)
      : mainmatterSourceByPath.get(evidence.sourcePath);
    if (!document || source == null) {
      fail(`${label}: cannot resolve ${evidence.sourcePath}`);
      continue;
    }
    if (evidence.sourceSha256 !== document.sha256 || sha256(source) !== document.sha256)
      fail(`${label}: sourceEvidence hash differs from pinned bytes`);
    const section = sourceSection(document, source, evidence.anchor);
    if (section === null) fail(`${label}: sourceEvidence anchor is not in the pinned document`);
    requireText(evidence.claim, `${label}.sourceEvidence.claim`, 40);
    requireText(evidence.term, `${label}.sourceEvidence.term`, 2);
    requireText(evidence.sourceExcerpt, `${label}.sourceEvidence.sourceExcerpt`, 40);
    if (!section?.includes(evidence.term))
      fail(`${label}: sourceEvidence term is outside its anchored section`);
    if (!section?.includes(evidence.sourceExcerpt))
      fail(`${label}: sourceEvidence excerpt is outside its anchored section`);
  }
}
const exactExtensionEvidenceLocks = {
  "CON-RUST-GETTING-STARTED-ROADMAP-001": [
    [
      "src/ch01-00-getting-started.md",
      "getting-started",
      "61072e25e328a126b513f0b0428248ec001564f490065f356c14bb34f4a554be",
    ],
  ],
  "OUT-RUST-SELECT-GETTING-STARTED-STEP-001": [
    [
      "src/ch01-00-getting-started.md",
      "getting-started",
      "759d55f9717821e64e61dc9732370b9874ad5a1a6052b95bb1691c2b7ca50229",
    ],
  ],
  "OUT-RUST-CLASSIFY-BUILT-IN-DATA-TYPE-001": [
    [
      "src/ch03-02-data-types.md",
      "data-types",
      "b13035e4df89ddbe0a7bae745582d5290254fb66dba50272e3c4c837ac11ea66",
    ],
  ],
  "CON-RUST-DEVELOPMENT-TOOL-ROLE-001": [
    [
      "src/appendix-04-useful-development-tools.md",
      "appendix-d-useful-development-tools",
      "30bae228cc99a1bf6a5e13096a47e0c79696e5cd1f86223fcfea1a8a0e64dd44",
    ],
  ],
  "OUT-RUST-SELECT-DEVELOPMENT-TOOL-001": [
    [
      "src/appendix-04-useful-development-tools.md",
      "appendix-d-useful-development-tools",
      "f255add80fe0f1b4738e1b8e07edffce607ca60619162f6562a00cc28c41bcb7",
    ],
  ],
  "CON-RUST-FUTURE-POLL-STATE-001": [
    [
      "src/ch17-05-traits-for-async.md",
      "the-future-trait",
      "935562934fc2a51e360579b40807b70e8369e8a575e0b6491d1128ff79165778",
    ],
  ],
  "CON-RUST-INTERIOR-MUTABILITY-001": [
    [
      "src/ch15-05-interior-mutability.md",
      "enforcing-borrowing-rules-at-runtime",
      "855eeec753bb7b4082e289cfcb2ee9bb86eb2dd73d6eada997c3876bac750ca4",
    ],
    [
      "book/src/07_threads/06_interior_mutability.md",
      "interior-mutability",
      "6a7edddea57b2a97a92f223c76bc73e6e209d8c704e1d934b245ae72889e66be",
    ],
  ],
  "CON-RUST-SEND-SYNC-001": [
    [
      "src/ch16-04-extensible-concurrency-sync-and-send.md",
      "transferring-ownership-between-threads",
      "9c3c8427073c29ab52024047b5da2ab70b49e7030e45bdc45bc08162f7787237",
    ],
    [
      "book/src/07_threads/14_sync.md",
      "sync",
      "6d5f47bf4d169ca5c37d5e6aab789ba31b29646226c876e50caf1bc5854f470c",
    ],
  ],
  "OUT-RUST-NAVIGATE-BOOK-001": [
    [
      "src/ch00-00-introduction.md",
      "how-to-use-this-book",
      "dcb6c7d9646baef20667d5cfd736c4dc636e7d2485bc63fe02f63bbaebacd4df",
    ],
    [
      "src/ch00-00-introduction.md",
      "how-to-use-this-book",
      "14f0f8907490d1636472a40941412dd8ea0638a4406764c624b79a4a16ce4850",
    ],
    [
      "src/ch00-00-introduction.md",
      "source-code",
      "ab0c0ea8438845079832cd4a2a4d26416a304bd664ac94bfd28dbf3ee77338af",
    ],
    [
      "src/appendix-06-translation.md",
      "appendix-f-translations-of-the-book",
      "8061c177f75f08f5689bb8083142bb737bc0f702f0a9bf1305d20e22c95c692d",
    ],
  ],
  "OUT-RUST-TRACE-CLOSURE-CAPTURE-001": [
    [
      "src/ch13-01-closures.md",
      "capturing-references-or-moving-ownership",
      "0a3332a2855b98345b77ecdd31a9ed5ae67a962d1231375dd57838f927453f8f",
    ],
    [
      "src/ch13-01-closures.md",
      "capturing-references-or-moving-ownership",
      "e4e4bcca1170fbec98ce8e0250da9108be25d0d0779c941f431d6cad11b0cd5c",
    ],
  ],
  "OUT-RUST-TRACE-FUTURE-PROGRESS-001": [
    [
      "src/ch17-05-traits-for-async.md",
      "the-future-trait",
      "935562934fc2a51e360579b40807b70e8369e8a575e0b6491d1128ff79165778",
    ],
    [
      "src/ch17-05-traits-for-async.md",
      "the-future-trait",
      "47df9cbef2830eb38eea90e00420ce77d7f2d9d362468ad3e580cfec47889059",
    ],
    [
      "book/src/08_futures/04_future.md",
      "poll",
      "d106c1f5a52da051f0a2217154f481d294c44dd5b979f8756ea02ff20209bda3",
    ],
  ],
  "OUT-RUST-DESIGN-SMART-POINTER-BOUNDARY-001": [
    [
      "src/ch15-06-reference-cycles.md",
      "preventing-reference-cycles-using-weakt",
      "7a66f3abd26991040d82e7ccd04ce4f533626d481ca2d73e8eb50e2e4cf8c2c1",
    ],
    [
      "src/ch15-01-box.md",
      "using-boxt-to-point-to-data-on-the-heap",
      "535930fd93bb4a49664aaff996d03df20250641580afa2e91fb81a468e654456",
    ],
    [
      "src/ch15-05-interior-mutability.md",
      "enforcing-borrowing-rules-at-runtime",
      "9de3ea9bfefa778abf07838ca8ce8e92b83b6c63a21ae186f5c08289e0bec376",
    ],
    [
      "src/ch04-02-references-and-borrowing.md",
      "the-rules-of-references",
      "48e6d23a942b53e6d1ab99f196ce7e587f285e32dd9b50b25393c63181b5e012",
    ],
  ],
  "OUT-RUST-COMPOSE-FUTURES-001": [
    [
      "src/ch17-05-traits-for-async.md",
      "the-pin-type-and-the-unpin-trait",
      "5b9bdc745d4034a602440e52f7c886084e558024c82625f895b100b7aca75abb",
    ],
    [
      "src/ch17-03-more-futures.md",
      "yielding-control-to-the-runtime",
      "2eaab70c11f35b4ae68783be858b32796c99afd0d46374beb35554cda8633164",
    ],
  ],
  "OUT-RUST-USE-CALLABLE-BOUNDARY-001": [
    [
      "src/ch20-04-advanced-functions-and-closures.md",
      "function-pointers",
      "0664bcb7be4cf3e00468c0207322398076bbb9db2d39f910ce688623f3330190",
    ],
    [
      "src/ch20-04-advanced-functions-and-closures.md",
      "returning-closures",
      "328829874f0cf37e02414ffefb5bd8c0e54e4fadc5478ad5904be9c0aee1086c",
    ],
  ],
  "CON-RUST-UNSAFE-OBLIGATION-001": [
    [
      "src/ch20-01-unsafe-rust.md",
      "calling-an-unsafe-function-or-method",
      "21b9852ce9c9294a42f3193f8006048c6527f420bce23c94aa92aac8f37c10c1",
    ],
  ],
  "OUT-RUST-AUDIT-UNSAFE-BOUNDARY-001": [
    [
      "src/ch20-01-unsafe-rust.md",
      "performing-unsafe-superpowers",
      "44f1fccf25c808f233196a1c6ef8fdf385626da5706cb80c79ff4057300c0381",
    ],
    [
      "src/ch20-01-unsafe-rust.md",
      "creating-a-safe-abstraction-over-unsafe-code",
      "d5ad6489dbf5e58e39529285359f87c2ef14d18421db398d74c3bf7fe1e8e192",
    ],
  ],
  "OUT-RUST-TRACE-ASYNC-SUSPENSION-SEND-001": [
    [
      "book/src/08_futures/04_future.md",
      "the-local-rc-problem",
      "4f4e753337a60ca2a8d4112f3448afbc3ce665b861c984df2696b5ff806f0508",
    ],
    [
      "book/src/08_futures/04_future.md",
      "async-fn-and-futures",
      "d7bc739f3a47c492a5c1c5b84b67e75333b8ab7c301a91ac683a3fc781c33b84",
    ],
  ],
  "OUT-RUST-TRACE-CANCELLATION-EFFECTS-001": [
    [
      "book/src/08_futures/07_cancellation.md",
      "cancellation",
      "f7ddfdc1d0e5e0031825787f03af976d81c804c7f4cc000ac74aacaef493e114",
    ],
    [
      "book/src/08_futures/07_cancellation.md",
      "clean-up",
      "5c16ccdc7281bfaba745e113ea569c85a00ef3842913f94de82a9ee4962bed7b",
    ],
  ],
};
const extensionById = new Map(
  [...knowledgeExtension.newNodes, ...knowledgeExtension.promotions].map((node) => [node.id, node]),
);
for (const [id, expectedEvidence] of Object.entries(exactExtensionEvidenceLocks)) {
  const actualEvidence = extensionById
    .get(id)
    ?.sourceEvidence.map((evidence) => [
      evidence.sourcePath,
      evidence.anchor,
      sha256(evidence.sourceExcerpt),
    ]);
  if (JSON.stringify(actualEvidence) !== JSON.stringify(expectedEvidence))
    fail(`${id}: human-reviewed G2 source-evidence lock changed`);
}

const mappingBySubject = new Map([
  ...bookMappings.map((mapping) => [mapping.pageId, { mapping, subjectType: "book_page" }]),
  ...exerciseMappings.map((mapping) => [
    mapping.exerciseId,
    { mapping, subjectType: "mainmatter_exercise" },
  ]),
]);
const gapDecisions = requireArray(
  knowledgeExtension.gapDecisions,
  "knowledgeExtension.gapDecisions",
  mappingBySubject.size,
);
if (
  gapDecisions.length !== mappingBySubject.size ||
  !sameIds(
    gapDecisions.map((decision) => decision.subjectId),
    mappingBySubject.keys(),
  )
)
  fail("gap decisions must cover all 109 Book pages and 98 Mainmatter exercises exactly once");
const newKnowledgeIds = new Set(knowledgeExtension.newNodes.map((node) => node.id));
const promotedKnowledgeIds = new Set(
  knowledgeExtension.promotions.map((promotion) => promotion.id),
);
const usedExtensionIds = new Set();
const gapRationales = new Set();
for (const decision of gapDecisions) {
  const entry = mappingBySubject.get(decision.subjectId);
  if (!entry) continue;
  if (decision.subjectType !== entry.subjectType)
    fail(`${decision.subjectId}: gap decision has the wrong subjectType`);
  const endpointIds = [...entry.mapping.conceptIds, ...entry.mapping.outcomeIds];
  if (!sameIds(decision.endpointIds, endpointIds))
    fail(`${decision.subjectId}: gap decision endpoint set differs from its mapping`);
  for (const id of decision.endpointIds ?? [])
    if (newKnowledgeIds.has(id) || promotedKnowledgeIds.has(id)) usedExtensionIds.add(id);
  const newEndpoints = endpointIds.filter((id) => newKnowledgeIds.has(id));
  const promotedEndpoints = endpointIds.filter((id) => promotedKnowledgeIds.has(id));
  const outcomeEndpoints = entry.mapping.endpointRationales.filter((endpoint) =>
    entry.mapping.outcomeIds.includes(endpoint.id),
  );
  const contextual = outcomeEndpoints.every(
    (endpoint) => endpoint.observationKind === "source_context",
  );
  const expectedStatus = newEndpoints.length
    ? "new_node"
    : promotedEndpoints.length
      ? "promotion"
      : contextual
        ? "contextual_unassessed"
        : "covered_existing";
  if (decision.status !== expectedStatus)
    fail(`${decision.subjectId}: gap decision status must be ${expectedStatus}`);
  requireText(decision.rationale, `${decision.subjectId}.gapDecision.rationale`, 80);
  if (gapRationales.has(decision.rationale))
    fail(`${decision.subjectId}: gap decision rationale is duplicated`);
  gapRationales.add(decision.rationale);
}
for (const id of [...newKnowledgeIds, ...promotedKnowledgeIds])
  if (!usedExtensionIds.has(id)) fail(`${id}: extension node is not used by a mapping decision`);

const outroEvidence = exerciseMappings.find(
  (mapping) => mapping.exerciseId === "mainmatter-08-futures-08-outro",
);
const outroExercise = release.exercises.find(
  (exercise) => exercise.id === "mainmatter-08-futures-08-outro",
);
if (
  outroEvidence?.evidence?.verification?.kind !== "compile_contract" ||
  !/starter and solution are identical/i.test(outroEvidence.evidence.verification.limitation) ||
  !/no behavior tests/i.test(outroEvidence.evidence.verification.limitation) ||
  outroEvidence.releaseAdaptation?.kind !== "graded_api_surface" ||
  outroEvidence.releaseAdaptation?.functionSignature !==
    "pub fn required_endpoints() -> [&'static str; 3]" ||
  !sameIds(outroEvidence.releaseAdaptation?.requiredValues ?? [], [
    "POST /tickets",
    "GET /tickets/:id",
    "PATCH /tickets/:id",
  ]) ||
  !outroExercise?.scored ||
  !outroExercise?.starter?.files?.[0]?.content.includes("pub fn required_endpoints()") ||
  !outroExercise?.referenceSolution?.files
    ?.find((file) => file.path === "src/lib.rs")
    ?.content.includes('"PATCH /tickets/:id"') ||
  !outroExercise?.evaluator?.suiteSha256
)
  fail(
    "the open-ended Mainmatter outro must preserve its narrow, protected API-surface adaptation",
  );
const overflowEvidence = exerciseMappings.find(
  (mapping) => mapping.exerciseId === "mainmatter-02-basic_calculator-08-overflow",
);
const overflowExercise = release.exercises.find(
  (exercise) => exercise.id === "mainmatter-02-basic_calculator-08-overflow",
);
if (
  overflowEvidence?.releaseAdaptation?.kind !== "sandbox_safe_local_contract" ||
  overflowEvidence.releaseAdaptation.editablePath !== "src/lib.rs" ||
  !sameIds(overflowExercise?.evaluator?.editableFiles ?? [], ["src/lib.rs"]) ||
  !overflowExercise?.starter?.files
    ?.find((file) => file.path === "src/lib.rs")
    ?.content.includes("u32 wrapping arithmetic; manifests are locked") ||
  overflowExercise?.tests?.visible?.some((test) =>
    test.content.includes("customization needs to be done in the `Cargo.toml`"),
  ) ||
  !overflowExercise?.referenceSolution?.files
    ?.find((file) => file.path === "src/lib.rs")
    ?.content.includes("result = result.wrapping_mul(i);") ||
  overflowExercise?.evaluator?.editableFiles?.some((path) => path.includes(".."))
)
  fail("the overflow exercise must preserve its sandbox-safe local wrapping contract");
const packagesEvidence = exerciseMappings.find(
  (mapping) => mapping.exerciseId === "mainmatter-05-ticket_v2-10-packages",
);
const packagesExercise = release.exercises.find(
  (exercise) => exercise.id === "mainmatter-05-ticket_v2-10-packages",
);
if (
  packagesEvidence?.releaseAdaptation?.kind !== "bounded_new_file" ||
  packagesEvidence.releaseAdaptation.editablePath !== "src/lib.rs" ||
  !packagesExercise?.starter?.files
    ?.find((file) => file.path === "src/lib.rs" && file.editable === true)
    ?.content.includes("todo!") ||
  !packagesExercise?.referenceSolution?.files
    ?.find((file) => file.path === "src/lib.rs")
    ?.content.includes("pub fn hello_world()")
)
  fail("the packages exercise must preserve its bounded editable library-target adaptation");
if (!sameIds(conceptIds, usedConceptIds))
  fail("release concept IDs differ from the exact canonical concept IDs used by mappings");
if (!sameIds(outcomeIds, usedOutcomeIds))
  fail("release outcome IDs differ from the exact canonical outcome IDs used by mappings");
for (const [records, kind] of [
  [concepts, "concept"],
  [outcomes, "learning_outcome"],
]) {
  for (const record of records) {
    const canonical = canonicalNodeById.get(record.id);
    const expectedMappingSource =
      reviewedKnowledge.extensionSources.get(record.id) ??
      "knowledge/feed/generated/tutor-feed.json#graphProjection";
    if (
      canonical?.kind !== kind ||
      canonical.reviewState !== "accepted" ||
      record.reviewState !== "accepted" ||
      record.title !== canonical.title ||
      record.summary !== canonical.summary ||
      record.mappingSource !== expectedMappingSource
    )
      fail(`${record.id} is not an exact public projection of an accepted canonical ${kind}`);
  }
}
const unicodeTreeFixture = [
  ["z.rs", "z"],
  ["é.rs", "accent"],
  ["α.rs", "alpha"],
  ["a.rs", "a"],
].map(([path, content]) => ({ path, content, sha256: sha256(content) }));
const unicodeTreeHash = canonicalTreeSha256(unicodeTreeFixture, "UTF-8 ordering fixture");
if (unicodeTreeHash !== "eba866eeac2066a5e17e501870d809fbdb5288fea3fefe049961a003c64b7359")
  fail("canonical tree hash no longer uses the pinned UTF-8 byte ordering");
if (
  canonicalTreeSha256([...unicodeTreeFixture].reverse(), "reversed UTF-8 ordering fixture") !==
  unicodeTreeHash
)
  fail("canonical tree hash depends on input enumeration order");
const mainmatterHashes = mainmatterIntegrity(mainmatterRawForCoverage);
const hasExpectedPackageIntegrity = (exercise) => {
  const expected = mainmatterHashes.packageHashes.get(exercise.id);
  return (
    exercise.provenance?.packageHashAlgorithm === mainmatterHashes.algorithm &&
    exercise.provenance?.starterPackageSha256 === expected?.starterPackageSha256 &&
    exercise.provenance?.solutionPackageSha256 === expected?.solutionPackageSha256 &&
    exercise.provenance?.starterSharedWorkspaceSha256 ===
      mainmatterHashes.starterSharedWorkspaceSha256 &&
    exercise.provenance?.solutionSharedWorkspaceSha256 ===
      mainmatterHashes.solutionSharedWorkspaceSha256
  );
};
const aggregateTamperFixture = structuredClone(
  release.exercises.find((exercise) => exercise.family === "mainmatter"),
);
aggregateTamperFixture.provenance.starterPackageSha256 = "0".repeat(64);
if (hasExpectedPackageIntegrity(aggregateTamperFixture))
  fail("Mainmatter integrity regression: aggregate hash tampering was accepted");
for (const [label, mutate] of [
  ["source lesson", (raw) => (raw.exercises[0].sourceLesson.markdown += "tampered")],
  ["starter file", (raw) => (raw.exercises[0].starter.files[0].content += "tampered")],
  ["starter declared hash", (raw) => (raw.exercises[0].starter.files[0].sha256 = "0".repeat(64))],
  ["solution file", (raw) => (raw.exercises[0].referenceSolution.files[0].content += "tampered")],
  ["shared workspace file", (raw) => (raw.sharedWorkspaceFiles[0].content += "tampered")],
]) {
  const tampered = structuredClone(mainmatterRawForCoverage);
  mutate(tampered);
  try {
    mainmatterIntegrity(tampered);
    fail(`Mainmatter integrity regression: ${label} byte tampering was accepted`);
  } catch {
    // Expected: declared per-file/source hashes must bind the imported bytes.
  }
}
if (
  mainmatterSource?.snapshotMetadata?.starterSharedWorkspaceSha256 !==
    mainmatterHashes.starterSharedWorkspaceSha256 ||
  mainmatterSource?.snapshotMetadata?.solutionSharedWorkspaceSha256 !==
    mainmatterHashes.solutionSharedWorkspaceSha256
)
  fail("Mainmatter release source has incorrect shared-workspace aggregate hashes");
const typedMainmatter = requireArray(
  mainmatterDocuments.exercises,
  "mainmatter-documents.exercises",
  98,
);
if (typedMainmatter.length !== 98)
  fail(`expected 98 typed Mainmatter source documents, found ${typedMainmatter.length}`);
if (
  typedMainmatter.map((document) => document.exerciseId).join("\n") !==
  mainmatterRawForCoverage.exercises.map((exercise) => exercise.id).join("\n")
)
  fail("typed Mainmatter documents do not map one-to-one to the 98 pinned exercises");
for (const [index, document] of typedMainmatter.entries()) {
  const raw = mainmatterRawForCoverage.exercises[index];
  if (document.sourcePath !== raw.sourceLesson.path)
    fail(`${document.exerciseId} typed source path differs from the pinned source`);
  if (document.sha256 !== raw.sourceLesson.sha256)
    fail(`${document.exerciseId} typed source hash differs from the pinned source`);
  if (!sameCodeEvidence(codeEvidenceFromNodes(document.blocks), document.codeBlocks))
    fail(`${document.exerciseId} ordered code evidence differs from its serialized nodes`);
  walkNodes(document.blocks);
}
const goingFurther = requireArray(
  mainmatterDocuments.resources,
  "mainmatter-documents.resources",
  1,
).find((resource) => resource.id === "MAINMATTER-GOING-FURTHER");
if (goingFurther?.scored !== false)
  fail("Mainmatter going_further.md must be a separate unscored final resource");
const goingFurtherSource = await readFile(
  resolve(root, "content/curriculum-v2/sources/mainmatter/book/src/going_further.md"),
);
if (goingFurther?.sha256 !== sha256(goingFurtherSource))
  fail("Mainmatter going_further.md hash does not match its pinned source");
if (!sameCodeEvidence(codeEvidenceFromNodes(goingFurther?.blocks), goingFurther?.codeBlocks))
  fail("Mainmatter going_further.md code evidence differs from its serialized nodes");
const mainmatterTargetById = new Map(
  [...typedMainmatter, goingFurther].map((document) => [
    document.exerciseId ?? document.id,
    document,
  ]),
);
let mainmatterLinkCount = 0;
let staleAnchorAliases = 0;
for (const document of [...typedMainmatter, goingFurther]) {
  for (const link of document.links ?? []) {
    mainmatterLinkCount += 1;
    if (Object.hasOwn(link, "internal") || typeof link.sourceTarget !== "string")
      fail(`${document.exerciseId ?? document.id} retains the obsolete raw/internal link contract`);
    if (validateResolvedTarget && !validateResolvedTarget(link.target))
      fail(
        `${document.exerciseId ?? document.id} resolved target fails schema: ${ajv.errorsText(validateResolvedTarget.errors)}`,
      );
    if (link.target?.kind === "sourceDocument") {
      const target = mainmatterTargetById.get(link.target.documentId);
      if (!target || target.sourcePath !== link.target.sourcePath)
        fail(
          `${document.exerciseId ?? document.id} resolved link points to a missing source document`,
        );
      if (link.target.anchor && !target?.anchors?.includes(link.target.anchor))
        fail(
          `${document.exerciseId ?? document.id} resolved link points to a missing source anchor`,
        );
      if (link.target.compatibilityAlias) {
        staleAnchorAliases += 1;
        if (
          link.sourceTarget !== "00_welcome.md#wr-the-workshop-runner" ||
          link.target.anchor !== "workshop-runner-wr" ||
          link.target.compatibilityAlias !== "wr-the-workshop-runner"
        )
          fail("unexpected Mainmatter anchor compatibility alias");
      }
    }
    if (link.sourceTarget.startsWith("../") && link.target?.kind !== "sourceDocument")
      fail(`${document.exerciseId ?? document.id} cross-arc link did not resolve to a document`);
  }
}
if (mainmatterLinkCount !== 133)
  fail(`expected 133 resolved Mainmatter links, found ${mainmatterLinkCount}`);
if (staleAnchorAliases !== 1)
  fail(`expected exactly one pinned Mainmatter stale-anchor alias, found ${staleAnchorAliases}`);
const actualArcCounts = Object.fromEntries(
  mainmatterRawForCoverage.arcs.map((arc) => [
    arc.id,
    mainmatterRawForCoverage.exercises.filter((exercise) => exercise.arc?.id === arc.id).length,
  ]),
);
if (
  JSON.stringify(Object.values(actualArcCounts)) !== JSON.stringify([2, 11, 13, 15, 16, 17, 15, 9])
)
  fail(`Mainmatter arc mapping differs: ${JSON.stringify(actualArcCounts)}`);
const mainmatterReadme = await readFile(
  resolve(root, "content/curriculum-v2/sources/mainmatter/README.md"),
  "utf8",
);
if (!mainmatterReadme.includes("creativecommons.org/licenses/by-nc/4.0/"))
  fail("Mainmatter README license grant is missing");
if (sha256(mainmatterReadme) !== "1bd7f5789cdf20385a339631de24adf76d47faba2cd06e711d646bc874cba429")
  fail("Mainmatter README differs from the pinned license grant");
if (
  sha256(goingFurtherSource) !== "50bd880eeb3b9a8fe9e49d076d1a824ab188449eb0e1c3998c683732991cd739"
)
  fail("Mainmatter going_further.md differs from the pinned source");
if (mainmatterSource?.documentSha256 !== sha256(mainmatterDocumentsText))
  fail("Mainmatter release document hash does not match the typed artifact");
if (stableJson(await buildSourceManifest()) !== stableJson(sourceManifest))
  fail("source-manifest.json is not the deterministic pinned-source manifest");
if (sourceManifest.schemaVersion !== 1 || sourceManifest.sources?.length !== 2)
  fail("source-manifest.json has the wrong shape");
const rustBookManifest = sourceManifest.sources.find(
  (source) => source.id === "SRC-RUST-BOOK-STABLE",
);
const mdbookTrplManifestFiles = (rustBookManifest?.files ?? []).filter((file) =>
  file.path.startsWith("content/curriculum-v2/sources/rust-book/packages/mdbook-trpl/"),
);
if (mdbookTrplManifestFiles.length !== 20)
  fail(
    `source manifest must hash all 20 mdbook-trpl files, found ${mdbookTrplManifestFiles.length}`,
  );
const mainmatterManifest = sourceManifest.sources.find(
  (source) => source.id === "SRC-MAINMATTER-100",
);
if (
  mainmatterManifest?.integrity?.algorithm !== mainmatterHashes.algorithm ||
  mainmatterManifest?.integrity?.packages?.length !== 98 ||
  mainmatterManifest?.integrity?.starterSharedWorkspaceSha256 !==
    mainmatterHashes.starterSharedWorkspaceSha256 ||
  mainmatterManifest?.integrity?.solutionSharedWorkspaceSha256 !==
    mainmatterHashes.solutionSharedWorkspaceSha256
)
  fail("source-manifest.json has incomplete Mainmatter package/workspace integrity metadata");

const expectedLegacyBookLessonIds = [
  "LESSON-BOOK-01",
  "LESSON-BOOK-01-02",
  "LESSON-BOOK-01-03",
  "LESSON-BOOK-02",
  "LESSON-BOOK-03",
  "LESSON-BOOK-03-02",
  "LESSON-BOOK-03-03",
  "LESSON-BOOK-03-04",
  "LESSON-BOOK-03-05",
  "LESSON-BOOK-04",
  "LESSON-BOOK-04-02",
  "LESSON-BOOK-04-03",
  "LESSON-BOOK-05",
  "LESSON-BOOK-05-02",
  "LESSON-BOOK-05-03",
  "LESSON-BOOK-06",
  "LESSON-BOOK-06-02",
  "LESSON-BOOK-06-03",
  "LESSON-BOOK-07",
  "LESSON-BOOK-07-02",
  "LESSON-BOOK-07-03",
  "LESSON-BOOK-07-04",
  "LESSON-BOOK-07-05",
  "LESSON-BOOK-08",
  "LESSON-BOOK-08-02",
  "LESSON-BOOK-08-03",
  "LESSON-BOOK-09",
  "LESSON-BOOK-09-02",
  "LESSON-BOOK-09-03",
  "LESSON-BOOK-10",
  "LESSON-BOOK-10-02",
  "LESSON-BOOK-10-03",
  "LESSON-BOOK-11",
  "LESSON-BOOK-11-02",
  "LESSON-BOOK-11-03",
  "LESSON-BOOK-12",
  "LESSON-BOOK-12-02",
  "LESSON-BOOK-12-03",
  "LESSON-BOOK-12-04",
  "LESSON-BOOK-12-05",
  "LESSON-BOOK-12-06",
  "LESSON-BOOK-13",
  "LESSON-BOOK-13-02",
  "LESSON-BOOK-13-03",
  "LESSON-BOOK-13-04",
  "LESSON-BOOK-14",
  "LESSON-BOOK-14-02",
  "LESSON-BOOK-14-03",
  "LESSON-BOOK-14-04",
  "LESSON-BOOK-14-05",
  "LESSON-BOOK-15",
  "LESSON-BOOK-15-02",
  "LESSON-BOOK-15-03",
  "LESSON-BOOK-15-04",
  "LESSON-BOOK-15-05",
  "LESSON-BOOK-15-06",
  "LESSON-BOOK-16",
  "LESSON-BOOK-16-02",
  "LESSON-BOOK-16-03",
  "LESSON-BOOK-16-04",
  "LESSON-BOOK-17",
  "LESSON-BOOK-17-02",
  "LESSON-BOOK-17-03",
  "LESSON-BOOK-17-04",
  "LESSON-BOOK-17-05",
  "LESSON-BOOK-17-06",
  "LESSON-BOOK-18",
  "LESSON-BOOK-18-02",
  "LESSON-BOOK-18-03",
  "LESSON-BOOK-19",
  "LESSON-BOOK-19-02",
  "LESSON-BOOK-19-03",
  "LESSON-BOOK-20",
  "LESSON-BOOK-20-02",
  "LESSON-BOOK-20-03",
  "LESSON-BOOK-20-04",
  "LESSON-BOOK-20-05",
  "LESSON-BOOK-21",
  "LESSON-BOOK-21-02",
  "LESSON-BOOK-21-03",
];
const expectedNewBookPageIds = [
  "LESSON-BOOK-INTRO",
  "LESSON-BOOK-01-00",
  "LESSON-BOOK-03-00",
  "LESSON-BOOK-04-00",
  "LESSON-BOOK-05-00",
  "LESSON-BOOK-06-00",
  "LESSON-BOOK-07-00",
  "LESSON-BOOK-08-00",
  "LESSON-BOOK-09-00",
  "LESSON-BOOK-10-00",
  "LESSON-BOOK-11-00",
  "LESSON-BOOK-12-00",
  "LESSON-BOOK-13-00",
  "LESSON-BOOK-14-00",
  "LESSON-BOOK-15-00",
  "LESSON-BOOK-16-00",
  "LESSON-BOOK-17-00",
  "LESSON-BOOK-18-00",
  "LESSON-BOOK-19-00",
  "LESSON-BOOK-20-00",
  "LESSON-BOOK-21-00",
  "LESSON-BOOK-APPENDIX-00",
  "LESSON-BOOK-APPENDIX-A",
  "LESSON-BOOK-APPENDIX-B",
  "LESSON-BOOK-APPENDIX-C",
  "LESSON-BOOK-APPENDIX-D",
  "LESSON-BOOK-APPENDIX-E",
  "LESSON-BOOK-APPENDIX-F",
  "LESSON-BOOK-APPENDIX-G",
];
const expectedBookModuleIds = [
  "MOD-BOOK-INTRO",
  "MOD-BOOK-01",
  "MOD-BOOK-02",
  "MOD-BOOK-03",
  "MOD-BOOK-04",
  "MOD-BOOK-05",
  "MOD-BOOK-06",
  "MOD-BOOK-07",
  "MOD-BOOK-08",
  "MOD-BOOK-09",
  "MOD-BOOK-10",
  "MOD-BOOK-11",
  "MOD-BOOK-12",
  "MOD-BOOK-13",
  "MOD-BOOK-14",
  "MOD-BOOK-15",
  "MOD-BOOK-16",
  "MOD-BOOK-17",
  "MOD-BOOK-18",
  "MOD-BOOK-19",
  "MOD-BOOK-20",
  "MOD-BOOK-21",
  "MOD-BOOK-APPENDICES",
];
if (!sameIds(moduleIds, expectedBookModuleIds))
  fail("Book containers must be exactly Introduction, chapters 1-21, and Appendices");
if (!sameIds(lessonIds, [...expectedLegacyBookLessonIds, ...expectedNewBookPageIds]))
  fail(
    "Book page IDs must preserve the explicit 80 legacy IDs and add exactly the explicit 29 IDs",
  );
if (lessons.length !== 109)
  fail(`expected exactly 109 mapped Rust Book pages, found ${lessons.length}`);
const moduleNumbers = [...modules].map((module) => module.number).sort((a, b) => a - b);
if (moduleNumbers.join(",") !== Array.from({ length: 23 }, (_, i) => i).join(","))
  fail("Book container numbers must cover 0 through 22 exactly once");
const bookMappingByPageId = new Map(bookMappings.map((mapping) => [mapping.pageId, mapping]));
const compiledPageBySourcePath = new Map(compiledPages.map((page) => [page.sourcePath, page]));
const bookCheckPrompts = new Set();
const bookCheckExplanations = new Set();
for (const module of modules) {
  if (!module.sourceIds?.includes("SRC-RUST-BOOK-STABLE"))
    fail(`${module.id} must cite the Rust Book source`);
  for (const id of requireArray(module.lessonIds, `${module.id}.lessonIds`, 1))
    if (!lessonIds.has(id)) fail(`${module.id} references missing lesson ${id}`);
  for (const id of module.prerequisiteModuleIds ?? [])
    if (!moduleIds.has(id)) fail(`${module.id} references missing prerequisite module ${id}`);
  if ((module.prerequisiteModuleIds ?? []).length !== 0)
    fail(`${module.id} turns Book display order into a module prerequisite`);
}

for (const [index, lesson] of lessons.entries()) {
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
  const recallChecks = requireArray(lesson.recallChecks, `${lesson.id}.recallChecks`, 1);
  for (const check of recallChecks) {
    requireText(check.id, `${lesson.id}.recallCheck.id`);
    requireText(check.prompt, `${check.id}.prompt`, 30);
    requireText(check.explanation, `${check.id}.explanation`, 80);
    const options = requireArray(check.options, `${check.id}.options`, 2);
    if (new Set(options).size !== options.length)
      fail(`${check.id} contains duplicate answer options`);
    if (
      !Number.isInteger(check.answerIndex) ||
      check.answerIndex < 0 ||
      check.answerIndex >= options.length
    )
      fail(`${check.id} has an invalid answer index`);
    if (bookCheckPrompts.has(check.prompt)) fail(`${check.id} reuses another Book check prompt`);
    if (bookCheckExplanations.has(check.explanation))
      fail(`${check.id} reuses another Book check explanation`);
    bookCheckPrompts.add(check.prompt);
    bookCheckExplanations.add(check.explanation);
  }
  requireArray(lesson.practiceBridge, `${lesson.id}.practiceBridge`);
  requireArray(lesson.projectTransfer, `${lesson.id}.projectTransfer`, 1);
  const readings = requireArray(lesson.furtherReading, `${lesson.id}.furtherReading`, 3);
  for (const reading of readings) {
    if (!libraryIds.has(reading.libraryId))
      fail(`${lesson.id} cites unknown library entry ${reading.libraryId}`);
    if (!/^https:\/\//.test(reading.url ?? ""))
      fail(`${lesson.id} further reading must use an https link`);
    if ((reading.why ?? "").length < 20)
      fail(`${lesson.id} further reading ${reading.url} needs an authored reason`);
  }
  const citations = requireArray(lesson.sectionSources, `${lesson.id}.sectionSources`, 1);
  if (
    !citations.every((citation) =>
      /^https:\/\/doc\.rust-lang\.org\/book\//.test(citation.url ?? ""),
    )
  )
    fail(`${lesson.id} must use an official Rust Book link`);
  if (lesson.review?.status !== "reviewed") fail(`${lesson.id} is not reviewed`);
  for (const id of lesson.prerequisiteIds ?? [])
    if (!lessonIds.has(id)) fail(`${lesson.id} references missing prerequisite lesson ${id}`);
  if ((lesson.prerequisiteIds ?? []).length !== 0)
    fail(`${lesson.id} turns Book display order into a lesson prerequisite`);
  const mapping = bookMappingByPageId.get(lesson.id);
  const page = compiledPageBySourcePath.get(mapping?.sourcePath);
  if (!mapping || !page) fail(`${lesson.id} lacks an exact authored Book mapping`);
  else {
    const conceptDefinition = mapping.endpointRationales?.[0]?.capabilityDefinition;
    const outcomeDefinition = mapping.endpointRationales?.[1]?.capabilityDefinition;
    const renderedOverlay = JSON.stringify({
      summary: lesson.summary,
      mentalModel: lesson.mentalModel,
      keyTerms: lesson.keyTerms,
      syntaxExamples: lesson.syntaxExamples,
      workedTrace: lesson.workedTrace,
      misconceptions: lesson.misconceptions,
      terminalWork: lesson.terminalWork,
      recap: lesson.recap,
    });
    if (
      !conceptDefinition ||
      !outcomeDefinition ||
      !lesson.mentalModel.includes(conceptDefinition) ||
      !lesson.recallChecks.every((check) => check.explanation.includes(outcomeDefinition))
    )
      fail(`${lesson.id} tutor overlay is not bound to its reviewed concept and outcome`);
    if (
      renderedOverlay.includes("surrounding type and ownership contract") ||
      renderedOverlay.includes("count meaningful lines") ||
      (lesson.terminalWork?.files?.length ?? 0) !== 0
    )
      fail(`${lesson.id} retains a synthetic generic Book workbench or explanation`);
    if (
      lesson.pageSequence !== index + 1 ||
      lesson.pageSequence !== page.sequence ||
      lesson.sourceDocumentId !== page.id ||
      lesson.sourcePath !== mapping.sourcePath ||
      lesson.sourceSha256 !== page.sha256 ||
      lesson.canonicalUrl !== page.canonicalUrl ||
      lesson.moduleId !== mapping.containerId ||
      !sameIds(lesson.conceptIds, mapping.conceptIds) ||
      !sameIds(lesson.outcomeIds, mapping.outcomeIds) ||
      lesson.mappingRationale !== mapping.rationale ||
      lesson.mappingSource !== mapping.mappingSource
    )
      fail(`${lesson.id} release projection differs from its authored Book mapping`);
    const previous = lessons[index - 1]?.id ?? null;
    const next = lessons[index + 1]?.id ?? null;
    if (lesson.previousPageId !== previous || lesson.nextPageId !== next)
      fail(`${lesson.id} has incorrect adjacent-page IDs`);
  }
}
const sectionUrls = lessons.flatMap((lesson) => lesson.sectionSources.map((source) => source.url));
if (new Set(sectionUrls).size !== 109)
  fail("every Book page must cite its distinct pinned source page");
const sectionCounts = Object.fromEntries(
  modules.map((module) => [module.number, module.lessonIds.length]),
);
const expectedSectionCounts = [1, 4, 1, 6, 4, 4, 4, 6, 4, 4, 4, 4, 7, 5, 6, 7, 5, 7, 4, 4, 6, 4, 8];
for (const [number, count] of expectedSectionCounts.entries())
  if (sectionCounts[number] !== count)
    fail(`Book container ${number} expected ${count} page(s), found ${sectionCounts[number]}`);

const expectedAliases = {
  "hello-rust": "LESSON-BOOK-01-02",
  variables: "LESSON-BOOK-03",
  types: "LESSON-BOOK-03-02",
  "functions-flow": "LESSON-BOOK-03-03",
  ownership: "LESSON-BOOK-04",
  borrowing: "LESSON-BOOK-04-02",
  "slices-strings": "LESSON-BOOK-04-03",
  structs: "LESSON-BOOK-05",
  "enums-matching": "LESSON-BOOK-06",
  collections: "LESSON-BOOK-08",
  errors: "LESSON-BOOK-09",
  abstraction: "LESSON-BOOK-10",
};
if (JSON.stringify(release.aliases) !== JSON.stringify(expectedAliases))
  fail("the release must preserve the exact 12 legacy alias targets");

const mainmatter = exercises.filter((exercise) => exercise.family === "mainmatter");
const interview = exercises.filter((exercise) => exercise.family === "interview");
const exerciseMappingById = new Map(
  exerciseMappings.map((mapping) => [mapping.exerciseId, mapping]),
);
if (mainmatter.length !== 98)
  fail(`expected exactly 98 Mainmatter exercises, found ${mainmatter.length}`);
if (interview.length !== 48)
  fail(`expected exactly 48 distinct authored interview exercises, found ${interview.length}`);
const expectedPatterns = Object.fromEntries([
  ["arrays-hash-maps", 4],
  ["two-pointers-sliding-window", 4],
  ["stacks-queues", 4],
  ["binary-search", 4],
  ["linked-lists", 4],
  ["trees-bst", 4],
  ["heaps", 4],
  ["intervals-greedy", 4],
  ["backtracking", 4],
  ["graphs-union-find-topological", 4],
  ["dynamic-programming", 4],
  ["bit-math", 4],
]);
for (const [pattern, count] of Object.entries(expectedPatterns)) {
  const actual = interview.filter((exercise) => exercise.category === pattern).length;
  if (actual !== count) fail(`${pattern}: expected ${count} interview exercises, found ${actual}`);
}
if (new Set(interview.map((exercise) => exercise.variant)).size !== interview.length)
  fail("every interview exercise must own a distinct authored variant");
const interviewContracts = interview.map((exercise) =>
  stableJson({
    prompt: exercise.prompt,
    tests: exercise.tests,
    referenceSolution: exercise.referenceSolution,
  }),
);
if (new Set(interviewContracts).size !== interview.length)
  fail("interview exercises may not repeat a prompt, test, and solution contract");
const expectedLoopbackExercises = new Set([
  "mainmatter-08-futures-01-async-fn",
  "mainmatter-08-futures-02-spawn",
  "mainmatter-08-futures-03-runtime",
  "mainmatter-08-futures-05-blocking",
  "mainmatter-08-futures-07-cancellation",
]);
for (const exercise of mainmatter) {
  const allowsLoopback = exercise.evaluator?.runtimePolicy?.loopback === true;
  if (allowsLoopback !== expectedLoopbackExercises.has(exercise.id))
    fail(`${exercise.id} has an incorrect loopback sandbox policy`);
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
    const mapping = exerciseMappingById.get(exercise.id);
    if (
      !mapping ||
      !sameIds(exercise.concepts, mapping.conceptIds) ||
      !sameIds(exercise.conceptIds, mapping.conceptIds) ||
      !sameIds(exercise.outcomes, mapping.outcomeIds) ||
      !sameIds(exercise.outcomeIds, mapping.outcomeIds) ||
      exercise.mappingRationale !== mapping.rationale ||
      exercise.mappingSource !== mapping.mappingSource
    )
      fail(`${exercise.id} release projection differs from its authored Mainmatter mapping`);
    for (const id of exercise.conceptIds ?? [])
      if (!conceptIds.has(id)) fail(`${exercise.id} references missing canonical concept ${id}`);
    for (const id of exercise.outcomeIds ?? [])
      if (!outcomeIds.has(id)) fail(`${exercise.id} references missing canonical outcome ${id}`);
    if (exercise.provenance?.license !== "CC-BY-NC-4.0")
      fail(`${exercise.id} must retain CC-BY-NC-4.0`);
    if (exercise.provenance?.starterCommit !== "57d145e6d393dfffeadb97fc61e814255c3b6ffe")
      fail(`${exercise.id} has wrong starter commit`);
    if (exercise.provenance?.solutionCommit !== "e77613749a55c19c63cf78e3b30cafc007f53dab")
      fail(`${exercise.id} has wrong solution commit`);
    for (const field of [
      "originalPath",
      "sourcePath",
      "sourceCommit",
      "sha256",
      "starterPath",
      "starterCanonicalUrl",
      "solutionPath",
      "solutionCanonicalUrl",
      "packageHashAlgorithm",
      "starterPackageSha256",
      "solutionPackageSha256",
      "starterSharedWorkspaceSha256",
      "solutionSharedWorkspaceSha256",
    ])
      requireText(exercise.provenance?.[field], `${exercise.id}.provenance.${field}`);
    requireText(exercise.provenance?.canonicalUrl, `${exercise.id}.provenance.canonicalUrl`);
    const raw = mainmatterRawForCoverage.exercises.find((item) => item.id === exercise.id);
    if (!raw) fail(`${exercise.id} is not present in the pinned Mainmatter source`);
    else {
      if (
        !sameIds(
          exercise.sourceOutcomeStatements,
          raw.outcomes.map((outcome) => outcome.statement),
        )
      )
        fail(`${exercise.id} does not preserve its upstream outcome statements separately`);
      if (exercise.provenance.sourcePath !== raw.sourceLesson.path)
        fail(`${exercise.id} has the wrong source lesson path`);
      if (exercise.provenance.sha256 !== raw.sourceLesson.sha256)
        fail(`${exercise.id} has the wrong source lesson hash`);
      if (exercise.provenance.starterPath !== raw.provenance.starter.path)
        fail(`${exercise.id} has the wrong starter snapshot path`);
      if (exercise.provenance.solutionPath !== raw.provenance.solution.path)
        fail(`${exercise.id} has the wrong solution snapshot path`);
      const expectedHashes = mainmatterHashes.packageHashes.get(exercise.id);
      if (exercise.provenance.packageHashAlgorithm !== mainmatterHashes.algorithm)
        fail(`${exercise.id} has the wrong package hash algorithm`);
      if (exercise.provenance.starterPackageSha256 !== expectedHashes?.starterPackageSha256)
        fail(`${exercise.id} has the wrong starter package aggregate hash`);
      if (exercise.provenance.solutionPackageSha256 !== expectedHashes?.solutionPackageSha256)
        fail(`${exercise.id} has the wrong solution package aggregate hash`);
      if (
        exercise.provenance.starterSharedWorkspaceSha256 !==
          mainmatterHashes.starterSharedWorkspaceSha256 ||
        exercise.provenance.solutionSharedWorkspaceSha256 !==
          mainmatterHashes.solutionSharedWorkspaceSha256
      )
        fail(`${exercise.id} has the wrong shared-workspace aggregate hashes`);
    }
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

const expectedPilotIds = [
  "mainmatter-01-intro-00-welcome",
  "mainmatter-02-basic_calculator-05-factorial",
  "mainmatter-03-ticket_v1-02-validation",
  "mainmatter-04-traits-01-trait",
  "mainmatter-05-ticket_v2-11-dependencies",
  "mainmatter-06-ticket_management-04-iterators",
  "mainmatter-07-threads-12-rw-lock",
  "mainmatter-08-futures-07-cancellation",
];
const pilotContracts = requireArray(
  mainmatterPilotContracts.pilots,
  "mainmatterPilotContracts.pilots",
  8,
);
const releasedPilots = exercises.filter((exercise) => exercise.pilot === true);
if (
  mainmatterPilotContracts.schemaVersion !== 1 ||
  pilotContracts.length !== 8 ||
  !sameIds(
    pilotContracts.map((pilot) => pilot.id),
    expectedPilotIds,
  ) ||
  !sameIds(
    releasedPilots.map((pilot) => pilot.id),
    expectedPilotIds,
  )
)
  fail("G3 must release exactly the reviewed one-per-arc eight-pilot matrix");
if (new Set(releasedPilots.map((pilot) => pilot.arc?.id)).size !== 8)
  fail("G3 pilots must cover each Mainmatter arc exactly once");
// Every published Mainmatter unit now has a protected compiler or behavior
// contract. A tautological generated stub proves nothing about learner code and
// is therefore a release failure rather than a practice-only fallback.
const TAUTOLOGICAL_SUITE = /assert!\(true\)/u;
for (const exercise of exercises.filter((item) => item.family === "mainmatter")) {
  const suites = JSON.stringify([exercise.tests?.hidden ?? [], exercise.tests?.regression ?? []]);
  const placeholder = TAUTOLOGICAL_SUITE.test(suites);
  if (placeholder) fail(`${exercise.id}: protected suite is still a generated stub`);
  if (exercise.suiteReview !== "reviewed" || !exercise.scored)
    fail(`${exercise.id}: every protected Mainmatter suite must be reviewed and scored`);
  if (!exercise.sourceDocument)
    fail(`${exercise.id}: the typed pinned source document must accompany the exercise`);
  const expectedSuiteSha = sha256(
    JSON.stringify({ hidden: exercise.tests.hidden, regression: exercise.tests.regression }),
  );
  if (
    !exercise.evaluator?.suiteId ||
    exercise.evaluator?.suiteSha256 !== expectedSuiteSha ||
    exercise.evaluator?.packageRoot !== exercise.starter?.workspaceRoot
  )
    fail(`${exercise.id}: protected evaluator identity or checksum drifted`);
  for (const [kind, tests] of Object.entries({
    hidden: exercise.tests.hidden,
    regression: exercise.tests.regression,
  })) {
    if (!Array.isArray(tests) || tests.length < 1)
      fail(`${exercise.id}: ${kind} suite must contain a protected check`);
    for (const test of tests ?? []) {
      if (!["append", "write"].includes(test.mode))
        fail(`${exercise.id}: ${kind} test ${test.name} has no safe mount mode`);
      if (!test.content.includes(test.name))
        fail(`${exercise.id}: ${kind} test ${test.name} is not represented in its source`);
      if (/contract_mounts|upstream_package_builds/u.test(test.content))
        fail(`${exercise.id}: ${kind} suite is not behavior- or compiler-discriminating`);
    }
  }
}

const pilotContractById = new Map(pilotContracts.map((pilot) => [pilot.id, pilot]));
const typedDocumentById = new Map(
  mainmatterDocuments.exercises.map((document) => [document.exerciseId, document]),
);
for (const exercise of releasedPilots) {
  const contract = pilotContractById.get(exercise.id);
  const document = typedDocumentById.get(exercise.id);
  const suites = { hidden: contract?.hidden, regression: contract?.regression };
  if (!contract || !document) {
    fail(`${exercise.id}: pilot contract or typed source document is missing`);
    continue;
  }
  if (JSON.stringify(exercise.sourceDocument) !== JSON.stringify(document))
    fail(`${exercise.id}: public source document differs from the pinned typed artifact`);
  if (JSON.stringify(exercise.tests.hidden) !== JSON.stringify(contract.hidden))
    fail(`${exercise.id}: hidden suite differs from its authored service-owned contract`);
  if (JSON.stringify(exercise.tests.regression) !== JSON.stringify(contract.regression))
    fail(`${exercise.id}: regression suite differs from its authored service-owned contract`);
  const suiteSha256 = sha256(JSON.stringify(suites));
  if (
    exercise.evaluator?.suiteId !== contract.suiteId ||
    exercise.evaluator?.suiteSha256 !== suiteSha256 ||
    exercise.evaluator?.packageRoot !== exercise.starter?.workspaceRoot ||
    JSON.stringify(exercise.evaluator?.manifestPolicy) !==
      JSON.stringify(contract.manifestPolicy) ||
    exercise.evaluator?.runtimePolicy?.loopback !== (contract.runtimePolicy?.loopback === true)
  )
    fail(`${exercise.id}: evaluator pilot contract or suite checksum drifted`);
  for (const [kind, tests] of Object.entries(suites)) {
    if (!Array.isArray(tests) || tests.length < 1)
      fail(`${exercise.id}: ${kind} suite must contain behavior tests`);
    for (const test of tests ?? []) {
      if (!["append", "write"].includes(test.mode))
        fail(`${exercise.id}: ${kind} test ${test.name} has no safe mount mode`);
      if (/assert!\s*\(\s*true\s*\)|contract_mounts/u.test(test.content))
        fail(`${exercise.id}: ${kind} test ${test.name} is still a placeholder`);
      if (!test.content.includes(test.name))
        fail(`${exercise.id}: ${kind} test ${test.name} does not execute its named behavior`);
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

const expectedEdgeKinds = [
  "prerequisite_of",
  "practices",
  "assesses",
  "part_of",
  "stage_after",
  "transfers_to",
  "precedes",
];
const knownEdgeKinds = new Set(edgeKinds.map((entry) => entry.kind));
if (!sameIds(knownEdgeKinds, expectedEdgeKinds))
  fail(
    "edge vocabulary must be exactly prerequisite_of, practices, assesses, part_of, stage_after, transfers_to, and precedes",
  );
for (const [index, edge] of edges.entries()) {
  if (!ids.has(edge.sourceId)) fail(`${edge.id} has dangling source ${edge.sourceId}`);
  if (!ids.has(edge.targetId)) fail(`${edge.id} has dangling target ${edge.targetId}`);
  if (!knownEdgeKinds.has(edge.kind)) fail(`${edge.id} uses undefined edge kind ${edge.kind}`);
  requireText(edge.rationale, `${edge.id}.rationale`, 10);
  requireText(edge.provenance, `${edge.id}.provenance`, 10);
  const semanticId = `EDGE-${edge.kind.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "-")}-${edge.sourceId}-TO-${edge.targetId}`;
  if (edge.id !== semanticId) fail(`${edge.id} is not the stable semantic edge id ${semanticId}`);
  const legacyId = `EDGE-${String(index + 1).padStart(5, "0")}`;
  if (!Array.isArray(edge.aliases) || edge.aliases.length !== 1 || edge.aliases[0] !== legacyId)
    fail(`${edge.id} must preserve positional compatibility alias ${legacyId}`);
}
for (const kind of expectedEdgeKinds.filter((kind) => kind !== "assesses"))
  if (!edges.some((edge) => edge.kind === kind)) fail(`edge kind ${kind} has no records`);
const orderedMainmatter = [...mainmatter].sort((left, right) => left.sequence - right.sequence);
if (
  JSON.stringify(orderedMainmatter.map((exercise) => exercise.sequence)) !==
  JSON.stringify(Array.from({ length: 98 }, (_, index) => index + 1))
)
  fail("Mainmatter release sequence must be exactly 1 through 98");
const expectedMainmatterOrder = orderedMainmatter
  .slice(0, -1)
  .map((exercise, index) => `${exercise.id}\0${orderedMainmatter[index + 1].id}`);
const mainmatterIds = new Set(mainmatter.map((exercise) => exercise.id));
const mainmatterOrderEdges = edges.filter(
  (edge) =>
    edge.kind === "precedes" &&
    (mainmatterIds.has(edge.sourceId) || mainmatterIds.has(edge.targetId)),
);
const actualMainmatterOrder = mainmatterOrderEdges.map(
  (edge) => `${edge.sourceId}\0${edge.targetId}`,
);
if (mainmatterOrderEdges.length !== 97 || !sameIds(actualMainmatterOrder, expectedMainmatterOrder))
  fail("Mainmatter precedes edges must be the exact 97-pair pinned global sequence");
const mainmatterById = new Map(mainmatter.map((exercise) => [exercise.id, exercise]));
const crossArcOrderEdges = mainmatterOrderEdges.filter(
  (edge) =>
    mainmatterById.get(edge.sourceId)?.arc?.id !== mainmatterById.get(edge.targetId)?.arc?.id,
);
if (crossArcOrderEdges.length !== 7)
  fail(
    `Mainmatter global order must include exactly 7 arc transitions, found ${crossArcOrderEdges.length}`,
  );
const selectedKnowledgeIds = new Set([...conceptIds, ...outcomeIds]);
const expectedPrerequisiteKeys = canonicalGraph.graphProjection.edges
  .filter(
    (edge) =>
      edge.kind === "prerequisite_of" &&
      edge.reviewState === "accepted" &&
      selectedKnowledgeIds.has(edge.sourceId) &&
      selectedKnowledgeIds.has(edge.targetId),
  )
  .map((edge) => `${edge.sourceId}\0${edge.targetId}`);
expectedPrerequisiteKeys.push(
  ...reviewedKnowledge.relationships
    .filter(
      (edge) =>
        edge.kind === "prerequisite_of" &&
        selectedKnowledgeIds.has(edge.sourceId) &&
        selectedKnowledgeIds.has(edge.targetId),
    )
    .map((edge) => `${edge.sourceId}\0${edge.targetId}`),
);
const actualPrerequisiteKeys = edges
  .filter((edge) => edge.kind === "prerequisite_of")
  .map((edge) => `${edge.sourceId}\0${edge.targetId}`);
if (!sameIds(actualPrerequisiteKeys, expectedPrerequisiteKeys))
  fail("prerequisite_of edges differ from the accepted canonical subgraph");
checkDag(edges);
const orderDagErrorCount = errors.length;
checkDag([
  { sourceId: "ORDER-A", targetId: "ORDER-B", kind: "precedes" },
  { sourceId: "ORDER-B", targetId: "ORDER-A", kind: "precedes" },
  { sourceId: "STAGE-A", targetId: "STAGE-B", kind: "stage_after" },
  { sourceId: "STAGE-B", targetId: "STAGE-A", kind: "stage_after" },
]);
if (errors.length !== orderDagErrorCount)
  fail("display or stage order incorrectly participates in prerequisite DAG validation");

const rebuilt = stableJson(await buildRelease());
const checkedIn = await readFile(releasePath, "utf8");
if (rebuilt !== checkedIn)
  fail("release.json is not the deterministic output of build-curriculum.mjs");

if (process.argv.includes("--run-solutions") && errors.length === 0) {
  await runReferenceSolutions(release);
  console.log("all 98 upstream and 75 distinct generated reference workspaces pass offline");
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
