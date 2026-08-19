import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const mappingsPath = resolve(root, "content/curriculum-v2/knowledge-mappings.json");
const mappings = JSON.parse(await readFile(mappingsPath, "utf8"));
const extension = JSON.parse(
  await readFile(resolve(root, "content/curriculum-v2/knowledge-extension.json"), "utf8"),
);
const feed = JSON.parse(
  await readFile(resolve(root, "knowledge/feed/generated/tutor-feed.json"), "utf8"),
);
const mainmatter = JSON.parse(
  await readFile(resolve(root, "content/curriculum-v2/mainmatter.json"), "utf8"),
);

const titles = new Map(
  [...(feed.graphProjection?.nodes ?? []), ...(extension.newNodes ?? [])].map((node) => [
    node.id,
    node.title,
  ]),
);
const mainmatterSources = new Map(
  mainmatter.exercises.map((exercise) => [
    exercise.sourceLesson.path,
    exercise.sourceLesson.markdown,
  ]),
);

function completeExcerpt(source, excerpt) {
  if (!source || !excerpt || /[.!?][”'`)\]]?$/u.test(excerpt.trim())) return excerpt;
  const start = source.indexOf(excerpt);
  if (start < 0) return excerpt;
  const tail = source.slice(start, start + 1_200);
  for (let index = Math.max(80, excerpt.length); index < tail.length; index += 1) {
    if (!".!?".includes(tail[index])) continue;
    const next = tail[index + 1] ?? "";
    if (next && !/[\s”'`)\]]/u.test(next)) continue;
    let end = index + 1;
    while (/[”'`)\]]/u.test(tail[end] ?? "")) end += 1;
    return tail.slice(0, end);
  }
  const paragraph = tail.indexOf("\n\n", excerpt.length);
  return paragraph > 0 ? tail.slice(0, paragraph).trimEnd() : excerpt;
}

function labels(ids) {
  return ids.map((id) => `“${titles.get(id) ?? id}”`).join(", ");
}

for (const mapping of mappings.bookPages) {
  const source = await readFile(
    resolve(root, "content/curriculum-v2/sources/rust-book", mapping.evidence.sourcePath),
    "utf8",
  );
  mapping.evidence.sourceExcerpt = completeExcerpt(source, mapping.evidence.sourceExcerpt);
  mapping.rationale = `${mapping.evidence.sourcePath}#${mapping.evidence.anchor} directly supports ${labels(
    [...mapping.conceptIds, ...mapping.outcomeIds],
  )}. This mapping records source-context practice only; reading the page does not establish mastery.`;
  for (const endpoint of mapping.endpointRationales) {
    endpoint.reason = `${mapping.evidence.sourcePath}#${mapping.evidence.anchor} supports “${titles.get(endpoint.id) ?? endpoint.id}” through ${endpoint.observationKind.replaceAll("_", " ")} evidence. This edge records ${endpoint.relation.replaceAll("_", " ")} only; it does not turn reading or navigation into mastery.`;
  }
}

for (const mapping of mappings.mainmatterExercises) {
  const source = mainmatterSources.get(mapping.evidence.sourcePath);
  mapping.evidence.sourceExcerpt = completeExcerpt(source, mapping.evidence.sourceExcerpt);
  mapping.rationale = `${mapping.exerciseId}'s pinned lesson, starter, and protected evaluator directly support ${labels(
    [...mapping.conceptIds, ...mapping.outcomeIds],
  )}. This mapping records executable practice; scored evidence requires the reviewed server suite to pass.`;
  for (const endpoint of mapping.endpointRationales) {
    endpoint.reason = `${mapping.exerciseId}'s lesson and learner-facing code support “${titles.get(endpoint.id) ?? endpoint.id}” through ${endpoint.observationKind.replaceAll("_", " ")} evidence. This edge records ${endpoint.relation.replaceAll("_", " ")}; only a passing protected suite can create scored evidence.`;
  }

  if (mapping.exerciseId === "mainmatter-08-futures-08-outro") {
    mapping.rationale = `${mapping.exerciseId} is open-ended upstream, so this release narrows it to one reviewable API-design slice: declaring the three required ticket endpoints. Passing proves that interface contract only, not a complete asynchronous service.`;
    mapping.releaseAdaptation = {
      kind: "graded_api_surface",
      editablePath: "src/lib.rs",
      functionSignature: "pub fn required_endpoints() -> [&'static str; 3]",
      requiredValues: ["POST /tickets", "GET /tickets/:id", "PATCH /tickets/:id"],
      evidenceBoundary:
        "The protected suite proves the declared method/path surface and nothing about routing, persistence, concurrency, framework selection, or production readiness.",
    };
  }
  if (mapping.exerciseId === "mainmatter-02-basic_calculator-08-overflow") {
    mapping.rationale = `${mapping.exerciseId} originally edits the shared workspace profile. The release preserves its wrapping-overflow outcome through a sandbox-safe local wrapping_mul implementation whose visible and protected assertions cover zero, small, and overflowing inputs.`;
    mapping.releaseAdaptation = {
      kind: "sandbox_safe_local_contract",
      editablePath: "src/lib.rs",
      replacement: "result = result.wrapping_mul(i);",
      evidenceBoundary:
        "Passing proves explicit wrapping factorial behavior; it does not prove knowledge of every Cargo profile setting or every overflow policy.",
    };
  }
  if (mapping.exerciseId === "mainmatter-05-ticket_v2-10-packages") {
    mapping.rationale = `${mapping.exerciseId} asks the learner to introduce a library target. The release materializes that new src/lib.rs path as an editable TODO stub so the sandbox can grade target discovery and public API linkage without opening arbitrary file creation.`;
    mapping.releaseAdaptation = {
      kind: "bounded_new_file",
      editablePath: "src/lib.rs",
      requiredSignature: "pub fn hello_world()",
      evidenceBoundary:
        "Passing proves that the package exposes the required library function and that the binary can link it; it does not prove broader package architecture skill.",
    };
  }
}

mappings.reviewState = "reviewed";
await writeFile(mappingsPath, `${JSON.stringify(mappings, null, 2)}\n`);
