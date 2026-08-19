#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patternGuides, patternVariants } from "./interview-bank.mjs";
import { furtherReadingFor, libraryCatalog } from "./reference-library.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const contentDir = resolve(root, "content/curriculum-v2");
const releasePath = resolve(contentDir, "release.json");
const rustBookPath = resolve(contentDir, "rust-book.json");
const mainmatterDocumentsPath = resolve(contentDir, "mainmatter-documents.json");
const sourceManifestPath = resolve(contentDir, "source-manifest.json");
const knowledgeMappingsPath = resolve(contentDir, "knowledge-mappings.json");
const knowledgeExtensionPath = resolve(contentDir, "knowledge-extension.json");
const mainmatterPilotContractsPath = resolve(contentDir, "mainmatter-pilot-contracts.json");
const canonicalGraphPath = resolve(root, "knowledge/feed/generated/tutor-feed.json");
const libraryPath = resolve(root, "apps/web/src/data/reference-library.json");
const importedAt = "2026-07-22";
const rustBookCommit = "05d114287b7d6f6c9253d5242540f00fbd6172ab";
const mainmatterStarterCommit = "57d145e6d393dfffeadb97fc61e814255c3b6ffe";
const mainmatterSolutionCommit = "e77613749a55c19c63cf78e3b30cafc007f53dab";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalTreeHashAlgorithm = "sha256(canonical-json[path,byteLength,sha256]-v1)";

export function canonicalTreeSha256(files, label) {
  const entries = files
    .map((file) => {
      if (typeof file?.path !== "string" || typeof file?.content !== "string")
        throw new Error(`${label}: snapshot file needs path and content`);
      const actual = sha256(file.content);
      if (file.sha256 !== actual)
        throw new Error(`${label}: ${file.path} SHA-256 differs from its bytes`);
      return { path: file.path, byteLength: Buffer.byteLength(file.content), sha256: actual };
    })
    // Canonical paths are ordered by their UTF-8 bytes. Buffer.compare is
    // locale-independent, so the same tree has the same hash on every host.
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")),
    );
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length)
    throw new Error(`${label}: duplicate snapshot path`);
  return sha256(JSON.stringify(entries));
}

export function mainmatterIntegrity(raw) {
  const packageHashes = new Map();
  for (const exercise of raw.exercises ?? []) {
    const sourceLessonHash = sha256(exercise.sourceLesson?.markdown ?? "");
    if (exercise.sourceLesson?.sha256 !== sourceLessonHash)
      throw new Error(`${exercise.id}: source lesson SHA-256 differs from its bytes`);
    const manifest = exercise.starter?.manifest;
    const starterFiles = [manifest, ...(exercise.starter?.files ?? [])];
    const solutionFiles = exercise.referenceSolution?.files ?? [];
    packageHashes.set(exercise.id, {
      starterPackageSha256: canonicalTreeSha256(starterFiles, `${exercise.id}.starter`),
      solutionPackageSha256: canonicalTreeSha256(solutionFiles, `${exercise.id}.solution`),
    });
  }
  const starterSharedFiles = raw.sharedWorkspaceFiles ?? [];
  const solutionOverrides = new Map(
    mainmatterSolutionWorkspaceOverrides.map((file) => [file.path, file]),
  );
  const solutionSharedFiles = starterSharedFiles.map((file) => {
    const override = solutionOverrides.get(file.path);
    if (!override) return file;
    solutionOverrides.delete(file.path);
    return { ...override, sha256: sha256(override.content) };
  });
  for (const override of solutionOverrides.values())
    solutionSharedFiles.push({ ...override, sha256: sha256(override.content) });
  return {
    algorithm: canonicalTreeHashAlgorithm,
    starterSharedWorkspaceSha256: canonicalTreeSha256(
      starterSharedFiles,
      "Mainmatter starter shared workspace",
    ),
    solutionSharedWorkspaceSha256: canonicalTreeSha256(
      solutionSharedFiles,
      "Mainmatter solution shared workspace",
    ),
    packageHashes,
  };
}

const bookChapters = [
  [
    1,
    "Getting Started",
    "Install the toolchain and use Cargo to create, build, run, format, and inspect a small Rust program.",
    "Treat Cargo as the repeatable boundary around source, dependencies, compiler settings, and tests.",
    ["rustup", "cargo new", "cargo run"],
  ],
  [
    2,
    "Programming a Guessing Game",
    "Build a complete input loop while meeting variables, matching, error handling, crates, and generated random values in context.",
    "A small vertical slice is a map of Rust: data enters as text, becomes typed state, is compared, and controls another iteration.",
    ["stdin", "match", "loop"],
  ],
  [
    3,
    "Common Programming Concepts",
    "Use bindings, types, functions, expressions, and control flow while letting the type checker expose ambiguous intent.",
    "Bindings make state explicit; expressions transform it; types constrain which transformations are legal.",
    ["let", "fn", "if"],
  ],
  [
    4,
    "Understanding Ownership",
    "Predict moves, copies, borrows, slices, and drop points without trial-and-error compilation.",
    "Every value has an owner, ownership may move, and borrows provide time-bounded access without taking responsibility for cleanup.",
    ["move", "borrow", "slice"],
  ],
  [
    5,
    "Using Structs to Structure Related Data",
    "Model domain data with structs, methods, associated functions, and derived traits.",
    "A struct gives related facts one name and methods place valid behavior beside the representation it protects.",
    ["struct", "impl", "derive"],
  ],
  [
    6,
    "Enums and Pattern Matching",
    "Represent alternatives with enums and exhaustively transform them with match and if let.",
    "An enum is a closed set of states; pattern matching forces every state to be considered where data is consumed.",
    ["enum", "match", "Option"],
  ],
  [
    7,
    "Managing Growing Projects",
    "Organize crates and modules, choose visibility deliberately, and import names without hiding ownership boundaries.",
    "The module tree is both a navigation map and an access-control boundary; paths say where responsibility lives.",
    ["mod", "pub", "use"],
  ],
  [
    8,
    "Common Collections",
    "Choose vectors, strings, and hash maps, then traverse and update them without violating borrowing rules.",
    "Collections trade fixed layout for runtime growth; their APIs encode allocation, indexing, Unicode, and aliasing costs.",
    ["Vec", "String", "HashMap"],
  ],
  [
    9,
    "Error Handling",
    "Separate recoverable failures from invariant violations using Result, propagation, and deliberate panic boundaries.",
    "Errors are data until a boundary decides they are unrecoverable; `?` preserves context while returning responsibility upward.",
    ["Result", "panic!", "?"],
  ],
  [
    10,
    "Generic Types, Traits, and Lifetimes",
    "Express shared behavior with generics and traits, and use lifetimes to relate borrowed inputs and outputs.",
    "Generics abstract representation, traits constrain behavior, and lifetimes describe relationships rather than extending values.",
    ["<T>", "trait", "'a"],
  ],
  [
    11,
    "Writing Automated Tests",
    "Write focused unit and integration tests, assert useful evidence, and control which test subsets run.",
    "A test is an executable claim with an observable oracle; good boundaries make failures local and explanations specific.",
    ["#[test]", "assert_eq!", "tests/"],
  ],
  [
    12,
    "An I/O Project: Building a Command Line Program",
    "Build a minigrep-style CLI by separating argument parsing, file I/O, domain logic, and user-facing errors.",
    "A useful binary is a thin adapter around testable library logic; each boundary converts errors into the next layer's language.",
    ["env::args", "fs::read_to_string", "eprintln!"],
  ],
  [
    13,
    "Functional Language Features",
    "Use closures and iterators to describe transformations while retaining ownership and performance control.",
    "Iterator adapters build a lazy plan; a consuming adapter decides when values move and work actually happens.",
    ["closure", "Iterator", "collect"],
  ],
  [
    14,
    "More about Cargo and Crates.io",
    "Tune release profiles, document public APIs, structure workspaces, and reason about publishing contracts.",
    "Cargo metadata is part of the product: it fixes build behavior, dependency resolution, documentation, and release boundaries.",
    ["profile", "cargo doc", "workspace"],
  ],
  [
    15,
    "Smart Pointers",
    "Use Box, Rc, RefCell, Drop, and Deref where plain ownership cannot express recursive or shared structures.",
    "Smart pointers add a policy to a pointer: allocation, sharing, runtime borrow checking, coercion, or cleanup behavior.",
    ["Box", "Rc", "RefCell"],
  ],
  [
    16,
    "Fearless Concurrency",
    "Coordinate threads with ownership transfer, channels, mutexes, and thread-safe sharing traits.",
    "Concurrency moves correctness questions into types: who owns work, who may share state, and how shutdown becomes observable.",
    ["thread::spawn", "mpsc", "Mutex"],
  ],
  [
    17,
    "Async and Await",
    "Compose futures, cancellation, streams, and concurrent tasks without confusing concurrency with parallelism.",
    "A future is inert state that advances when polled; an executor schedules progress, while cancellation is usually dropping that state.",
    ["async", ".await", "Future"],
  ],
  [
    18,
    "Object-Oriented Programming Features",
    "Evaluate encapsulation, trait objects, and state patterns as design tools rather than language labels.",
    "Rust separates data, behavior, and dispatch choices so static and dynamic polymorphism can be selected per boundary.",
    ["dyn Trait", "encapsulation", "state pattern"],
  ],
  [
    19,
    "Patterns and Matching",
    "Destructure nested values with precise refutable and irrefutable patterns, guards, bindings, and ranges.",
    "A pattern is a structural query over a value; its context determines whether failure must be impossible or explicitly handled.",
    ["while let", "@", "match guard"],
  ],
  [
    20,
    "Advanced Features",
    "Use unsafe Rust, advanced traits and types, macros, and function pointers behind reviewed safe abstractions.",
    "Advanced features widen what can be expressed, but each use should reduce—not export—the amount of proof callers must perform.",
    ["unsafe", "macro_rules!", "extern"],
  ],
  [
    21,
    "Final Project: Multithreaded Web Server",
    "Assemble networking, thread pools, graceful shutdown, and protocol parsing into a bounded server.",
    "A server is a set of resource and lifecycle boundaries: accept, parse, schedule, respond, observe, and shut down without losing work.",
    ["TcpListener", "ThreadPool", "Drop"],
  ],
];

const legacyAliases = [
  ["hello-rust", 1, 2],
  ["variables", 3, 1],
  ["types", 3, 2],
  ["functions-flow", 3, 3],
  ["ownership", 4, 1],
  ["borrowing", 4, 2],
  ["slices-strings", 4, 3],
  ["structs", 5, 1],
  ["enums-matching", 6, 1],
  ["collections", 8, 1],
  ["errors", 9, 1],
  ["abstraction", 10, 1],
];

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const moduleId = (n) => `MOD-BOOK-${String(n).padStart(2, "0")}`;
const lessonId = (n) => `LESSON-BOOK-${String(n).padStart(2, "0")}`;
const sectionLessonId = (n, index) =>
  index === 1 ? lessonId(n) : `${lessonId(n)}-${String(index).padStart(2, "0")}`;
const bookSections = `
1|Installation|ch01-01-installation.html
1|Hello, World!|ch01-02-hello-world.html
1|Hello, Cargo!|ch01-03-hello-cargo.html
2|Programming a Guessing Game|ch02-00-guessing-game-tutorial.html
3|Variables and Mutability|ch03-01-variables-and-mutability.html
3|Data Types|ch03-02-data-types.html
3|Functions|ch03-03-how-functions-work.html
3|Comments|ch03-04-comments.html
3|Control Flow|ch03-05-control-flow.html
4|What Is Ownership?|ch04-01-what-is-ownership.html
4|References and Borrowing|ch04-02-references-and-borrowing.html
4|The Slice Type|ch04-03-slices.html
5|Defining and Instantiating Structs|ch05-01-defining-structs.html
5|An Example Program Using Structs|ch05-02-example-structs.html
5|Methods|ch05-03-method-syntax.html
6|Defining an Enum|ch06-01-defining-an-enum.html
6|The match Control Flow Construct|ch06-02-match.html
6|Concise Control Flow with if let and let...else|ch06-03-if-let.html
7|Packages and Crates|ch07-01-packages-and-crates.html
7|Control Scope and Privacy with Modules|ch07-02-defining-modules-to-control-scope-and-privacy.html
7|Paths for Referring to an Item in the Module Tree|ch07-03-paths-for-referring-to-an-item-in-the-module-tree.html
7|Bringing Paths Into Scope with use|ch07-04-bringing-paths-into-scope-with-the-use-keyword.html
7|Separating Modules into Different Files|ch07-05-separating-modules-into-different-files.html
8|Storing Lists of Values with Vectors|ch08-01-vectors.html
8|Storing UTF-8 Encoded Text with Strings|ch08-02-strings.html
8|Storing Keys with Associated Values in Hash Maps|ch08-03-hash-maps.html
9|Unrecoverable Errors with panic!|ch09-01-unrecoverable-errors-with-panic.html
9|Recoverable Errors with Result|ch09-02-recoverable-errors-with-result.html
9|To panic! or Not to panic!|ch09-03-to-panic-or-not-to-panic.html
10|Generic Data Types|ch10-01-syntax.html
10|Defining Shared Behavior with Traits|ch10-02-traits.html
10|Validating References with Lifetimes|ch10-03-lifetime-syntax.html
11|How to Write Tests|ch11-01-writing-tests.html
11|Controlling How Tests Are Run|ch11-02-running-tests.html
11|Test Organization|ch11-03-test-organization.html
12|Accepting Command Line Arguments|ch12-01-accepting-command-line-arguments.html
12|Reading a File|ch12-02-reading-a-file.html
12|Refactoring for Modularity and Error Handling|ch12-03-improving-error-handling-and-modularity.html
12|Adding Functionality with Test-Driven Development|ch12-04-testing-the-librarys-functionality.html
12|Working with Environment Variables|ch12-05-working-with-environment-variables.html
12|Redirecting Errors to Standard Error|ch12-06-writing-to-stderr-instead-of-stdout.html
13|Closures|ch13-01-closures.html
13|Processing a Series of Items with Iterators|ch13-02-iterators.html
13|Improving the I/O Project|ch13-03-improving-our-io-project.html
13|Performance in Loops vs. Iterators|ch13-04-performance.html
14|Customizing Builds with Release Profiles|ch14-01-release-profiles.html
14|Publishing a Crate to Crates.io|ch14-02-publishing-to-crates-io.html
14|Cargo Workspaces|ch14-03-cargo-workspaces.html
14|Installing Binaries with cargo install|ch14-04-installing-binaries.html
14|Extending Cargo with Custom Commands|ch14-05-extending-cargo.html
15|Using Box<T> to Point to Data on the Heap|ch15-01-box.html
15|Treating Smart Pointers Like Regular References|ch15-02-deref.html
15|Running Code on Cleanup with Drop|ch15-03-drop.html
15|Rc<T>, the Reference Counted Smart Pointer|ch15-04-rc.html
15|RefCell<T> and Interior Mutability|ch15-05-interior-mutability.html
15|Reference Cycles Can Leak Memory|ch15-06-reference-cycles.html
16|Using Threads to Run Code Simultaneously|ch16-01-threads.html
16|Transferring Data Between Threads with Message Passing|ch16-02-message-passing.html
16|Shared-State Concurrency|ch16-03-shared-state.html
16|Extensible Concurrency with Send and Sync|ch16-04-extensible-concurrency-sync-and-send.html
17|Futures and the async Syntax|ch17-01-futures-and-syntax.html
17|Applying Concurrency with async|ch17-02-concurrency-with-async.html
17|Working with Any Number of Futures|ch17-03-more-futures.html
17|Streams: Futures in Sequence|ch17-04-streams.html
17|A Closer Look at the Traits for async|ch17-05-traits-for-async.html
17|Futures, Tasks, and Threads|ch17-06-futures-tasks-threads.html
18|Characteristics of Object-Oriented Languages|ch18-01-what-is-oo.html
18|Using Trait Objects for Shared Behavior|ch18-02-trait-objects.html
18|Implementing an Object-Oriented Design Pattern|ch18-03-oo-design-patterns.html
19|All the Places Patterns Can Be Used|ch19-01-all-the-places-for-patterns.html
19|Refutability: Whether a Pattern Might Fail|ch19-02-refutability.html
19|Pattern Syntax|ch19-03-pattern-syntax.html
20|Unsafe Rust|ch20-01-unsafe-rust.html
20|Advanced Traits|ch20-02-advanced-traits.html
20|Advanced Types|ch20-03-advanced-types.html
20|Advanced Functions and Closures|ch20-04-advanced-functions-and-closures.html
20|Macros|ch20-05-macros.html
21|Building a Single-Threaded Web Server|ch21-01-single-threaded.html
21|From Single-Threaded to Multithreaded Server|ch21-02-multithreaded.html
21|Graceful Shutdown and Cleanup|ch21-03-graceful-shutdown-and-cleanup.html
`
  .trim()
  .split("\n")
  .map((line) => {
    const [chapter, title, path] = line.split("|");
    return { chapter: Number(chapter), title, path };
  });

const sources = [
  {
    id: "SRC-RUST-BOOK-STABLE",
    title: "The Rust Programming Language",
    publisher: "The Rust Project Developers",
    canonicalUrl: "https://doc.rust-lang.org/book/",
    snapshot: `commit ${rustBookCommit}; stable Rust 1.97.1; edition 2024`,
    license: "MIT OR Apache-2.0",
    attribution: "Copyright The Rust Project Developers; adapted under the MIT license.",
    use: "adapted",
  },
  {
    id: "SRC-MAINMATTER-100",
    title: "100 Exercises To Learn Rust",
    publisher: "Mainmatter",
    canonicalUrl: "https://github.com/mainmatter/100-exercises-to-learn-rust",
    snapshot: `starter ${mainmatterStarterCommit}; solutions ${mainmatterSolutionCommit}`,
    license: "CC-BY-NC-4.0",
    attribution:
      "Mainmatter's 100 Exercises To Learn Rust, adapted with changes; no endorsement implied.",
    use: "adapted-noncommercial",
  },
  {
    id: "SRC-RUST-TUTOR-ORIGINAL",
    title: "Rust Tutor original curriculum",
    publisher: "Rust Tutor contributors",
    canonicalUrl: "https://github.com/",
    snapshot: "curriculum-v2 2026-07-22",
    license: "MIT",
    attribution: "Original Rust Tutor material.",
    use: "original",
  },
];

const mainmatterSolutionWorkspaceOverrides = [
  {
    path: "Cargo.toml",
    content: `[workspace]\nmembers = [\n  "exercises/*/*",\n  "helpers/common",\n  "helpers/ticket_fields",\n]\nresolver = "2"\n\n[profile.dev.package.copy]\noverflow-checks = true\n\n[profile.dev]\noverflow-checks = false\n`,
    sourceCommit: "e77613749a55c19c63cf78e3b30cafc007f53dab",
  },
];

function makeBook(rustBookDocuments, knowledgeMappings) {
  const pageByPath = new Map(rustBookDocuments.pages.map((page) => [page.sourcePath, page]));
  const mappingByPath = new Map(
    knowledgeMappings.bookPages.map((mapping) => [mapping.sourcePath, mapping]),
  );
  const aliases = Object.fromEntries(
    legacyAliases.map(([old, n, section]) => [old, sectionLessonId(n, section)]),
  );
  const modules = [];
  const lessons = [];
  for (const [number, title, summary, model, terms] of bookChapters) {
    const sections = bookSections.filter((section) => section.chapter === number);
    const sectionIds = sections.map((_, index) => sectionLessonId(number, index + 1));
    modules.push({
      id: moduleId(number),
      number,
      title,
      summary,
      lessonIds: sectionIds,
      sourceIds: ["SRC-RUST-BOOK-STABLE"],
      prerequisiteModuleIds: [],
    });
    sections.forEach((section, index) => {
      const sectionNumber = index + 1;
      const id = sectionLessonId(number, sectionNumber);
      const checkId = `${id}-CHECK-01`;
      const sectionSummary = `${section.title} turns the ${title} chapter model into a focused skill: ${summary}`;
      lessons.push({
        id,
        moduleId: moduleId(number),
        title: section.title,
        slug: `book-${String(number).padStart(2, "0")}-${String(sectionNumber).padStart(2, "0")}-${slug(section.title)}`,
        aliases: legacyAliases
          .filter(([, n, targetSection]) => n === number && targetSection === sectionNumber)
          .map(([old]) => old),
        summary: sectionSummary,
        estimateMinutes: 25 + (sectionNumber % 3) * 10,
        difficulty: number < 4 ? "beginner" : number < 15 ? "intermediate" : "advanced",
        objectives: [
          `Explain ${section.title.toLowerCase()} using the chapter's core model and identify when it applies.`,
          `Write and run a focused Rust example that uses ${terms.slice(0, 2).join(" and ")} at an explicit boundary.`,
          `Diagnose one compiler or runtime failure by naming the contract it violates.`,
        ],
        prerequisiteIds: [],
        mentalModel: `${model} In this section, use that model specifically to reason about ${section.title.toLowerCase()} before changing code.`,
        keyTerms: terms.map((term, i) => ({
          term,
          definition: `${term} is a ${i === 0 ? "foundation" : "supporting tool"} for ${section.title.toLowerCase()}; use it only when the surrounding type and ownership contract makes intent explicit.`,
        })),
        syntaxExamples: [
          {
            title: `${section.title} in a small, inspectable boundary`,
            code: `pub fn chapter_${number}_section_${sectionNumber}(input: &str) -> usize {\n    // Keep the boundary typed and observable.\n    input.lines().filter(|line| !line.trim().is_empty()).count()\n}`,
            explanation: `The small function keeps the ${section.title.toLowerCase()} discussion attached to visible inputs and outputs. Add ${terms[1]} only when the contract requires it.`,
          },
        ],
        workedTrace: [
          {
            step: 1,
            state: "Read the boundary",
            explanation: `Name the values and observable result relevant to ${section.title.toLowerCase()}.`,
          },
          {
            step: 2,
            state: "Apply the section model",
            explanation: `${model} Track the choice that this section makes explicit.`,
          },
          {
            step: 3,
            state: "Check the observable",
            explanation:
              "Compile, run the focused test, and compare the result with the stated contract.",
          },
        ],
        misconceptions: [
          {
            symptom: `Copying the ${section.title} syntax without predicting ownership, types, or failure behavior.`,
            explanation:
              "Compiler acceptance proves language rules, not that the chosen boundary models the problem correctly.",
            repair: `State what ${section.title.toLowerCase()} must preserve, then make the smallest change and verify that observable.`,
          },
        ],
        recallChecks: [
          {
            id: checkId,
            prompt: `Which practice best demonstrates mastery of ${section.title}?`,
            options: [
              "Memorize syntax in isolation",
              "Predict state, implement the boundary, and verify the observable result",
              "Add an abstraction before a failing case exists",
            ],
            answerIndex: 1,
            explanation: `${section.title} is demonstrated by predicting the relevant ${terms[0]} behavior, implementing the smallest boundary that preserves it, and checking the observable result. Recognizing syntax without that evidence does not establish the model.`,
          },
        ],
        terminalWork: {
          files: [
            {
              path: "src/lib.rs",
              content: `pub fn inspect(input: &str) -> usize {\n    todo!("apply ${section.title.replaceAll('"', "")} to count meaningful lines")\n}\n`,
            },
          ],
          command: "cargo test --offline",
          instructions: `Implement the boundary, add one focused passing case and one boundary case, then explain how ${terms[0]} affects correctness.`,
        },
        practiceBridge: [],
        projectTransfer: [],
        recap: [
          sectionSummary,
          model,
          "Prefer a small executable proof over a large untested explanation.",
        ],
        sourceIds: ["SRC-RUST-BOOK-STABLE"],
        furtherReading: furtherReadingFor(number),
        sectionSources: [
          {
            title: `Chapter ${number}: ${section.title}`,
            url: `https://doc.rust-lang.org/book/${section.path}`,
          },
        ],
        completion: { requiredCheckIds: [checkId], requiredExerciseIds: [] },
        review: {
          status: "reviewed",
          reviewedAt: importedAt,
          reviewer: "Rust Tutor curriculum review",
        },
      });
    });
  }
  const existingById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const sourcePathFor = (lesson) =>
    `src/${new URL(lesson.sectionSources[0].url).pathname
      .split("/")
      .at(-1)
      .replace(/\.html$/, ".md")}`;
  for (const lesson of lessons) {
    const sourcePath = sourcePathFor(lesson);
    const mapping = mappingByPath.get(sourcePath);
    const page = pageByPath.get(sourcePath);
    if (!mapping || !page || mapping.pageId !== lesson.id)
      throw new Error(`${lesson.id}: missing or mismatched Book knowledge mapping`);
    Object.assign(
      lesson,
      mappedBookFields(mapping, page, knowledgeMappings.bookPages),
      sourceGroundedBookFields(mapping, page),
    );
  }

  modules.unshift({
    id: "MOD-BOOK-INTRO",
    number: 0,
    title: "Introduction",
    summary:
      "Orient to the complete Rust Book, its audience, its toolchain assumptions, and the evidence-first way this track links reading to practice.",
    lessonIds: ["LESSON-BOOK-INTRO"],
    sourceIds: ["SRC-RUST-BOOK-STABLE"],
    prerequisiteModuleIds: [],
  });
  modules.push({
    id: "MOD-BOOK-APPENDICES",
    number: 22,
    title: "Appendices",
    summary:
      "Use the Book appendices as reviewed references for language vocabulary, operators, derivable traits, tools, editions, translations, and Rust release channels.",
    lessonIds: knowledgeMappings.bookPages
      .filter((mapping) => mapping.containerId === "MOD-BOOK-APPENDICES")
      .map((mapping) => mapping.pageId),
    sourceIds: ["SRC-RUST-BOOK-STABLE"],
    prerequisiteModuleIds: [],
  });

  for (const mapping of knowledgeMappings.bookPages) {
    if (existingById.has(mapping.pageId)) continue;
    const page = pageByPath.get(mapping.sourcePath);
    if (!page) throw new Error(`${mapping.pageId}: mapped Book source page is missing`);
    const lesson = makeContextPageLesson(mapping, page, knowledgeMappings.bookPages);
    lessons.push(lesson);
    existingById.set(lesson.id, lesson);
    const module = modules.find((candidate) => candidate.id === mapping.containerId);
    if (!module) throw new Error(`${mapping.pageId}: mapped Book container is missing`);
    if (!module.lessonIds.includes(mapping.pageId)) module.lessonIds.unshift(mapping.pageId);
  }
  lessons.sort((left, right) => left.pageSequence - right.pageSequence);
  for (const module of modules) {
    module.lessonIds.sort(
      (left, right) => existingById.get(left).pageSequence - existingById.get(right).pageSequence,
    );
  }
  return { aliases, modules, lessons };
}

// The typed page blocks live in the pinned rust-book.json artifact. Embedding
// the public projection here keeps one release checksum covering everything the
// Book track renders, and matches how Mainmatter exercises carry sourceDocument.
function bookSourceDocument(page) {
  return {
    pageId: page.id,
    title: page.title,
    sourcePath: page.sourcePath,
    sourceCommit: page.sourceCommit,
    canonicalUrl: page.canonicalUrl,
    sha256: page.sha256,
    resolvedSha256: page.resolvedSha256,
    license: page.license,
    attribution: page.attribution,
    changeNotes: page.changeNotes,
    headings: page.headings,
    blocks: page.blocks,
  };
}

function blockText(node) {
  return node?.type === "text" ? (node.text ?? "") : (node?.children ?? []).map(blockText).join("");
}

function firstCodeBlock(nodes) {
  for (const node of nodes ?? []) {
    if (node.type === "codeBlock") return node;
    const nested = firstCodeBlock(node.children);
    if (nested) return nested;
  }
  return null;
}

function sourceGroundedBookFields(mapping, page) {
  const [concept, outcome = concept] = mapping.endpointRationales;
  if (!concept?.capabilityDefinition || !outcome?.capabilityDefinition)
    throw new Error(`${mapping.pageId}: reviewed endpoint definitions are missing`);
  const excerpt = mapping.evidence.sourceExcerpt.replace(/\s+/gu, " ").trim();
  const boundary = concept.evidenceBoundary;
  const example = firstCodeBlock(page.blocks);
  const exampleText = example ? blockText(example).trimEnd() : excerpt;
  const exampleKind = example
    ? `${example.attributes?.classification ?? "display"} ${example.attributes?.info ?? "source"} block`
    : "reviewed prose excerpt";
  const checkId = `${mapping.pageId}-CHECK-01`;
  return {
    summary: `${page.title} develops this reviewed capability: ${concept.capabilityDefinition}`,
    objectives: [
      `Explain this technical model: ${concept.capabilityDefinition}`,
      `Demonstrate this observable outcome: ${outcome.capabilityDefinition}`,
      "Distinguish reading the source from producing evidence that the outcome was achieved.",
    ],
    mentalModel: `Core model: ${concept.capabilityDefinition} Evidence limit: ${boundary}`,
    keyTerms: [
      { term: page.title, definition: excerpt },
      { term: "Concept boundary", definition: concept.capabilityDefinition },
      { term: "Observable evidence", definition: outcome.capabilityDefinition },
    ],
    syntaxExamples: [
      {
        title: example ? "First code example in the pinned page" : "Pinned source excerpt",
        code: exampleText,
        explanation: `This is a ${exampleKind} from the pinned page, presented in source context rather than relabelled as a generic runnable exercise. It supports the reviewed concept: ${concept.capabilityDefinition}`,
      },
    ],
    workedTrace: [
      { step: 1, state: "Read the cited passage", explanation: excerpt },
      {
        step: 2,
        state: "State the technical boundary",
        explanation: concept.capabilityDefinition,
      },
      {
        step: 3,
        state: "Name acceptable evidence",
        explanation: `${outcome.capabilityDefinition} Merely opening the page does not establish that outcome.`,
      },
    ],
    misconceptions: [
      {
        symptom: `Treating ${page.title} as proof of a nearby behavior that its reviewed source mapping does not establish.`,
        explanation: `${boundary} The reviewed model is: ${concept.capabilityDefinition}`,
        repair: `Use the observable outcome instead: ${outcome.capabilityDefinition}`,
      },
    ],
    recallChecks: [
      {
        id: checkId,
        prompt: `Which statement captures the reviewed technical model for ${page.title}?`,
        options: [
          concept.capabilityDefinition,
          `${page.title} is only a vocabulary lookup; no behavior or decision needs verification.`,
          `Opening ${page.title} is sufficient evidence that its learning outcome has been achieved.`,
        ],
        answerIndex: 0,
        explanation: `For ${page.title}, the reviewed concept is: ${concept.capabilityDefinition} The observable outcome is: ${outcome.capabilityDefinition} Reading supplies context, but the outcome still needs committed or executable evidence.`,
      },
    ],
    terminalWork: {
      files: [],
      command: "",
      instructions:
        "This source page has no synthetic workbench. Use its linked reviewed exercise when executable evidence is available.",
    },
    recap: [
      concept.capabilityDefinition,
      outcome.capabilityDefinition,
      `Evidence boundary: ${boundary}`,
    ],
  };
}

function mappedBookFields(mapping, page, orderedMappings) {
  const index = orderedMappings.findIndex((candidate) => candidate.pageId === mapping.pageId);
  return {
    pageSequence: page.sequence,
    pageRole:
      mapping.pageId.endsWith("-00") && mapping.pageId !== "LESSON-BOOK-02"
        ? "context"
        : mapping.containerId === "MOD-BOOK-APPENDICES"
          ? "reference"
          : "lesson",
    sourceDocumentId: page.id,
    sourcePath: page.sourcePath,
    canonicalUrl: page.canonicalUrl,
    sourceSha256: page.sha256,
    previousPageId: orderedMappings[index - 1]?.pageId ?? null,
    nextPageId: orderedMappings[index + 1]?.pageId ?? null,
    sourceDocument: bookSourceDocument(page),
    conceptIds: mapping.conceptIds,
    outcomeIds: mapping.outcomeIds,
    mappingRationale: mapping.rationale,
    mappingSource: mapping.mappingSource,
  };
}

function makeContextPageLesson(mapping, page, orderedMappings) {
  const fields = mappedBookFields(mapping, page, orderedMappings);
  const checkId = `${mapping.pageId}-CHECK-01`;
  const contextual = fields.pageRole === "context";
  return {
    id: mapping.pageId,
    moduleId: mapping.containerId,
    title: page.title,
    slug: `book-${String(page.sequence).padStart(3, "0")}-${slug(page.title)}`,
    aliases: [],
    summary: `${page.title} preserves the pinned Rust Book page and places it in the complete track with reviewed concept and outcome links.`,
    estimateMinutes: contextual ? 8 : 20,
    difficulty: page.sequence < 39 ? "beginner" : page.sequence < 84 ? "intermediate" : "advanced",
    objectives: [
      `Locate ${page.title.toLowerCase()} in the complete Rust Book sequence and state its purpose.`,
      "Connect the source page to the reviewed Rust concepts and observable outcomes without treating display order as a prerequisite.",
    ],
    prerequisiteIds: [],
    mentalModel:
      "This page is source material first: its position supports navigation, while explicit knowledge-graph edges alone determine prerequisites and evidence relationships.",
    keyTerms: [
      {
        term: "source page",
        definition: "A byte-verified document from the pinned Rust Book snapshot.",
      },
      {
        term: "display order",
        definition: "The previous/next reading sequence, separate from prerequisite closure.",
      },
      {
        term: "evidence",
        definition: "An observable check or exercise result, never a page-open event.",
      },
    ],
    syntaxExamples: [
      {
        title: "Pinned source document",
        code: `// Read source document ${page.id}; code blocks remain in its typed block stream.`,
        explanation:
          "The typed source document is rendered separately; this pointer does not rewrite or omit its code.",
      },
    ],
    workedTrace: [
      {
        step: 1,
        state: "Open the source",
        explanation: "Read the pinned page in its original document order.",
      },
      {
        step: 2,
        state: "Name the model",
        explanation: "Use the reviewed concept links to name what the page explains.",
      },
      {
        step: 3,
        state: "Choose evidence",
        explanation:
          "Follow an explicit outcome or practice edge when active recall is appropriate.",
      },
    ],
    misconceptions: [
      {
        symptom: "Treating the previous page as a mandatory knowledge prerequisite.",
        explanation:
          "Book order is useful navigation but does not prove a prerequisite relationship.",
        repair: "Use only prerequisite_of edges when computing readiness or closure.",
      },
    ],
    recallChecks: [
      {
        id: checkId,
        prompt: `What does opening ${page.title} prove?`,
        options: ["Mastery", "Reading position only", "Exercise completion"],
        answerIndex: 1,
        explanation: `${page.title} is contextual source material, so opening it records where the learner read. Mastery still requires a committed check or executable exercise mapped to an observable outcome.`,
      },
    ],
    terminalWork: {
      files: [
        {
          path: "src/lib.rs",
          content: "// Choose a linked practice item when executable evidence is needed.\n",
        },
      ],
      command: "cargo test --offline",
      instructions:
        "Use a linked reviewed exercise instead of manufacturing a runnable workspace from a context or reference page.",
    },
    practiceBridge: [],
    projectTransfer: [],
    recap: [
      "The original page remains the source of truth.",
      "Display order and prerequisites are different graph relationships.",
      "Reading, exercise completion, and mastery remain separate states.",
    ],
    sourceIds: ["SRC-RUST-BOOK-STABLE"],
    furtherReading: furtherReadingFor(Math.max(1, Math.min(21, Math.ceil(page.sequence / 5)))),
    sectionSources: [{ title: page.title, url: page.canonicalUrl }],
    completion: { requiredCheckIds: contextual ? [] : [checkId], requiredExerciseIds: [] },
    review: { status: "reviewed", reviewedAt: importedAt, reviewer: "Rust Tutor mapping review" },
    ...fields,
    ...sourceGroundedBookFields(mapping, page),
  };
}

const patternDefinitions = [
  [
    "arrays-hash-maps",
    18,
    8,
    "Arrays and hash maps",
    "Count distinct readings",
    "Scan each value once while a HashSet records membership.",
    "O(n) expected time and O(n) space",
  ],
  [
    "two-pointers-sliding-window",
    16,
    8,
    "Two pointers and sliding windows",
    "Find a target pair",
    "Sort the values, then move two indices according to how their sum compares with the target.",
    "O(n log n) time and O(n) parsed storage",
  ],
  [
    "stacks-queues",
    12,
    13,
    "Stacks and queues",
    "Validate nested signals",
    "Push opening delimiters and require each closing delimiter to match the most recent opener.",
    "O(n) time and O(n) space",
  ],
  [
    "binary-search",
    10,
    13,
    "Binary search",
    "Locate a sorted checkpoint",
    "Maintain a half-open candidate range and discard the half that cannot contain the target.",
    "O(log n) time and O(n) parsed storage",
  ],
  [
    "linked-lists",
    10,
    15,
    "Linked lists",
    "Reverse a linked route",
    "Move each value into a singly linked list, then reverse links one node at a time.",
    "O(n) time and O(n) space",
  ],
  [
    "trees-bst",
    18,
    15,
    "Trees and BSTs",
    "Measure a sparse tree",
    "Traverse non-empty level-order positions and retain the deepest reachable level.",
    "O(n) time and O(n) input storage",
  ],
  [
    "heaps",
    8,
    15,
    "Heaps",
    "Keep the smallest priorities",
    "Maintain a max-heap of size k so the largest retained candidate is replaced first.",
    "O(n log k) time and O(k) space",
  ],
  [
    "intervals-greedy",
    10,
    13,
    "Intervals and greedy",
    "Merge reservation windows",
    "Sort by start time and extend the last output interval whenever ranges overlap.",
    "O(n log n) time and O(n) space",
  ],
  [
    "backtracking",
    10,
    13,
    "Backtracking",
    "Enumerate assignment orders",
    "Choose one unused option, recurse, and undo the choice before exploring the next branch.",
    "O(n!) time and O(n) search depth",
  ],
  [
    "graphs-union-find-topological",
    16,
    16,
    "Graphs, union-find, and topology",
    "Trace service reachability",
    "Build adjacency lists and use breadth-first search with a visited set.",
    "O(V + E) time and O(V + E) space",
  ],
  [
    "dynamic-programming",
    16,
    13,
    "Dynamic programming",
    "Count resilient step plans",
    "Store the number of ways to reach the previous two states and roll the recurrence forward.",
    "O(n) time and O(1) auxiliary space",
  ],
  [
    "bit-math",
    6,
    3,
    "Bit operations and math",
    "Audit active feature flags",
    "Use a population count to measure set bits in the input word.",
    "O(1) time and O(1) space",
  ],
];

const scenarioWords = [
  "harbor",
  "sensor",
  "archive",
  "transit",
  "orchard",
  "workshop",
  "clinic",
  "observatory",
  "warehouse",
  "library",
  "network",
  "expedition",
  "laboratory",
  "market",
  "studio",
  "fleet",
  "campus",
  "registry",
];

function testSource(input, expected, name) {
  return `use solution::solve;\n#[test]\nfn ${name}() { assert_eq!(solve(${JSON.stringify(input)}), ${JSON.stringify(expected)}); }\n`;
}

function showToken(value) {
  return value === "" ? "(empty line)" : value;
}

// Renders the pattern-level teaching material that every variant of a pattern
// shares: how to recognise it, the invariant that makes it correct, where the
// complexity comes from, and the idiomatic Rust it is usually written in.
function renderPatternGuide(kind, label) {
  const guide = patternGuides[kind];
  const bullets = (items) => items.map((item) => `- ${item}`).join("\n");
  return [
    `### Pattern: ${label}`,
    "",
    `**Invariant.** ${guide.invariant}`,
    "",
    "**How to recognise it**",
    bullets(guide.cues),
    "",
    "**Where the cost comes from**",
    guide.derivation,
    "",
    "**Idiomatic Rust for this pattern**",
    bullets(guide.idiomatic),
    "",
    "**Ownership and borrow traps**",
    bullets(guide.pitfalls),
  ].join("\n");
}

// Assemble a self-sufficient prompt from the variant plus its own graded
// cases, so a worked example can never drift from a real assertion.
function buildInterviewPrompt(word, kind, label, variant) {
  const examples = [];
  const edges = [];
  variant.cases.forEach(([input, output], index) => {
    const note = variant.notes[index] ?? "";
    const line = `- \`${showToken(input)}\` → \`${showToken(output)}\` — ${note}`;
    if (variant.edge[index]) edges.push(line);
    else examples.push(line);
  });
  edges.push(
    "- Malformed or empty input is handled without panicking; the answer is always a deterministic UTF-8 string.",
  );
  return [
    `The ${word} system emits a compact text record. ${variant.problem}`,
    "",
    "**Input**",
    variant.input,
    "",
    "**Output**",
    variant.output,
    "",
    "**Worked examples**",
    examples.length > 0 ? examples.join("\n") : "- See the edge cases below.",
    "",
    "**Edge cases**",
    edges.join("\n"),
    "",
    `**Target complexity:** ${variant.complexity}.`,
    "",
    "---",
    "",
    renderPatternGuide(kind, label),
    "",
    "**Once it passes, answer these**",
    patternGuides[kind].followUps.map((item) => `- ${item}`).join("\n"),
  ].join("\n");
}

function makeInterviewExercises() {
  const records = [];
  let sequence = 1;
  for (const [kind, _requestedCount, book, label] of patternDefinitions) {
    const variants = patternVariants[kind];
    if (!variants || variants.length === 0) throw new Error(`no variants authored for ${kind}`);
    const guide = patternGuides[kind];
    if (!guide) throw new Error(`no pattern guide authored for ${kind}`);
    // Publish every authored problem exactly once. Re-labelling the same four
    // implementations until a target count is reached inflates the catalog
    // without adding a new contract, invariant, or assessment.
    for (let i = 1; i <= variants.length; i += 1) {
      const variant = variants[i - 1];
      if (
        variant.cases.length < 2 ||
        new Set(variant.cases.map((testCase) => JSON.stringify(testCase))).size < 2
      )
        throw new Error(`${kind}/${variant.slug}: needs two distinct graded cases`);
      const word = scenarioWords[(i - 1) % scenarioWords.length];
      const id = `INT-${kind.toUpperCase().replaceAll("-", "_")}-${String(i).padStart(3, "0")}`;
      const [visible, hidden] = variant.cases;
      const regression = variant.cases[2];
      const visibleTest = {
        name: "visible_contract",
        path: "tests/visible.rs",
        content: testSource(...visible, "visible_contract"),
      };
      const hiddenTest = {
        name: "hidden_boundary",
        path: "tests/hidden.rs",
        content: testSource(...hidden, "hidden_boundary"),
      };
      const regressionTest = {
        name: "regression_contract",
        path: "tests/regression.rs",
        content: regression
          ? testSource(...regression, "regression_contract")
          : 'use solution::solve;\n#[test]\nfn regression_contract() { let first = solve("malformed input"); let second = solve("malformed input"); assert_eq!(first, second); }\n',
      };
      records.push({
        id,
        family: "interview",
        sequence: sequence++,
        title: `${variant.action}: ${word} ${String(i).padStart(2, "0")}`,
        category: kind,
        pattern: label,
        variant: variant.slug,
        moduleId: moduleId(book),
        lessonId: lessonId(book),
        concepts: [kind],
        difficulty: variant.tier,
        estimateMinutes: variant.tier === "hard" ? 45 : variant.tier === "medium" ? 30 : 20,
        runnable: true,
        scored: true,
        suiteReview: "reviewed",
        requirement: variant.tier === "hard" ? "stretch" : "core",
        whyNow: `Chapter ${book} supplies the Rust data and control-flow tools needed to practice ${label.toLowerCase()} without hiding the algorithm.`,
        prepares: [
          `Recognize ${label.toLowerCase()} invariants in unfamiliar interview prompts`,
          "Explain complexity and ownership tradeoffs",
          `State the invariant out loud: ${guide.invariant}`,
        ],
        prerequisiteIds: [lessonId(book)],
        outcomes: [
          `Implement ${variant.approach.toLowerCase()}`,
          `Defend the ${variant.complexity} bound`,
          `Choose the idiomatic Rust container and iterator for ${label.toLowerCase()}`,
        ],
        brief: `${variant.problem} Parse the stated record, preserve the ${label.toLowerCase()} invariant, and meet the ${variant.complexity} target.`,
        prompt: buildInterviewPrompt(word, kind, label, variant),
        constraints: [
          "Parse malformed or empty input without panicking",
          "Do not perform network or filesystem I/O",
          "Return a deterministic UTF-8 string",
        ],
        starter: {
          manifest: `[package]\nname="solution"\nversion="0.1.0"\nedition="2024"\n`,
          files: [
            {
              path: "src/lib.rs",
              content: `// ${variant.action}\n// Invariant to hold: ${guide.invariant}\n// Target: ${variant.complexity}\npub fn solve(_input: &str) -> String {\n    todo!("implement the ${label.toLowerCase()} invariant")\n}\n`,
            },
          ],
        },
        tests: {
          visible: [visibleTest],
          hidden: [hiddenTest],
          regression: [regressionTest],
        },
        evaluator: {
          mode: "cargo-workspace",
          editableFiles: ["src/lib.rs"],
          lockedFiles: ["Cargo.toml", "tests/visible.rs", "tests/hidden.rs", "tests/regression.rs"],
          commands: ["cargo test --offline --all-targets"],
          limits: { timeoutMs: 8000, memoryMb: 256, outputKb: 64 },
          expectedArtifacts: ["test-report"],
          suiteId: `${id}-reviewed-v1`,
          suiteSha256: sha256(
            JSON.stringify({ hidden: [hiddenTest], regression: [regressionTest] }),
          ),
          manifestPolicy: { editable: false, dependencies: {} },
          runtimePolicy: { loopback: false },
        },
        // A five-rung ladder: name the pattern, then the invariant, then the
        // Rust that expresses it, then the boundary to test, and only then
        // the shape of the reference.
        hints: [
          "Restate the rule the output must satisfy in one sentence, using the worked examples — do not write code yet.",
          `Recognition: ${guide.cues[0]} ${variant.hintPattern}`,
          `Rust: ${variant.hintImpl}`,
          `Boundary: run the smallest and the empty input first, then argue why the bound is ${variant.complexity}.`,
          `Shape: ${variant.approach}`,
        ],
        explanation: {
          purpose: `Recognize the ${label.toLowerCase()} pattern from an unfamiliar prompt and implement it in idiomatic Rust, defending its ${variant.complexity} bound.`,
          approach: variant.approach,
          invariant: guide.invariant,
          complexityDerivation: guide.derivation,
          idiomaticRust: guide.idiomatic,
          compilerImplications:
            "Parsing owns numeric values while traversal borrows collections; keep mutation local so borrow scopes stay obvious.",
          referenceRationale: `The reference keeps the invariant visible and achieves ${variant.complexity}; tests observe behavior rather than implementation details.`,
          followUps: guide.followUps,
        },
        commonMistakes: [...variant.mistakes, ...guide.pitfalls],
        tradeoffs: [
          variant.tradeoff,
          "The reference favors a direct standard-library implementation over a reusable abstraction.",
        ],
        complexity: variant.complexity,
        referenceSolution: { files: [{ path: "src/lib.rs", content: `${variant.solution}\n` }] },
        externalReferences: [],
        provenance: {
          sourceId: "SRC-RUST-TUTOR-ORIGINAL",
          mode: "app-authored",
          license: "MIT",
          attribution: "Original Rust Tutor exercise; not copied from LeetCode.",
          importedAt,
          changeNotes: [
            "Original scenario, tests, hints, explanation, and solution.",
            `Authored variant '${variant.slug}' of the ${label.toLowerCase()} pattern.`,
          ],
        },
      });
    }
  }
  return records;
}

const projectDefinitions = [
  [
    "PULSE",
    "Data reliability and cost-control platform",
    [
      "Problem, design, threat model, and SLO",
      "Fixture-first domain model and schema",
      "Read-only warehouse connector and resume",
      "Cost attribution and rollups",
      "Rules, anomaly, and quality engine",
      "API, reports, and dashboard",
      "Authorization and tenant isolation",
      "Scheduling, recovery, observability, and SLO",
      "Correctness, performance, package, and release",
    ],
  ],
  [
    "QUAY",
    "Local lakehouse query service",
    [
      "Problem, design, correctness oracle, and SLO",
      "Local Parquet and query engine",
      "Object storage boundary",
      "Catalog, snapshots, and pruning",
      "Streaming, cancellation, and backpressure",
      "Metering, authorization, quotas, and tenancy",
      "Caching, observability, and recovery",
      "Oracle, fuzzing, performance, and profile",
      "Reproducible package and release",
    ],
  ],
  [
    "TESSERA",
    "Offline provenance-preserving knowledge assistant",
    [
      "Problem, design, privacy, threat model, and evaluation",
      "Provenance-preserving ingest and chunking",
      "Lexical index and retrieval",
      "Local embeddings and vector retrieval",
      "Hybrid fusion and reranking",
      "Citation-grounded local generation",
      "Bounded tool interface",
      "Evaluation, observability, privacy, and offline proof",
      "Authorization, package, and release",
    ],
  ],
];

function makeProjects() {
  const projects = [];
  const stages = [];
  for (const [code, subtitle, titles] of projectDefinitions) {
    const projectId = `PRJ-${code}`;
    // Preserve the existing public stage IDs (00–08) while the authored
    // sequence remains the human-facing one-based order (1–9).
    const stageIds = titles.map((_, i) => `${projectId}-${String(i).padStart(2, "0")}`);
    projects.push({
      id: projectId,
      title: `${code} — ${subtitle}`,
      summary: `A nine-stage cumulative Rust project that turns chapter models into reviewed engineering evidence.`,
      stageIds,
      sourceIds: ["SRC-RUST-TUTOR-ORIGINAL"],
    });
    titles.forEach((title, index) => {
      const sequence = index + 1;
      const id = stageIds[index];
      const predecessorStageId = index === 0 ? null : stageIds[index - 1];
      const lesson = lessonId(Math.min(21, 10 + Math.floor((index * 11) / 8)));
      const marker = `${code.toLowerCase()}-${sequence}`;
      const solution = `pub fn stage_marker() -> &'static str { "${marker}" }\npub fn validate(input:&str)->Result<(),String>{if input.trim().is_empty(){Err("input must not be empty".into())}else{Ok(())}}\n`;
      stages.push({
        id,
        projectId,
        sequence,
        title,
        brief: `Extend ${code}'s cumulative workspace with ${title.toLowerCase()}. Keep the boundary offline, deterministic, observable, and small enough to test independently.`,
        boundaries: [
          "All evaluation runs with network access disabled",
          "Domain logic stays in the library; adapters translate external data",
          "Every accepted change leaves executable evidence",
        ],
        nonGoals: [
          "Production credentials or live cloud services",
          "Unbounded background work",
          "Framework abstractions without a stage requirement",
        ],
        entryReadiness: [
          `Complete ${lesson}`,
          predecessorStageId
            ? `Restore accepted checkpoint ${predecessorStageId}`
            : "Write the initial design note",
        ],
        relatedLessonIds: [lesson],
        relatedExerciseIds: [],
        predecessorStageId,
        starter: {
          manifest: `[package]\nname="${marker}"\nversion="0.1.0"\nedition="2024"\n`,
          files: [
            {
              path: "src/lib.rs",
              content: `pub fn stage_marker() -> &'static str { todo!("return the ${marker} contract marker") }\npub fn validate(_input:&str)->Result<(),String>{todo!("validate this stage boundary")}\n`,
            },
          ],
        },
        tests: {
          visible: [
            {
              name: "stage_contract",
              path: "tests/visible.rs",
              content: `use ${marker.replaceAll("-", "_")}::{stage_marker,validate};#[test]fn stage_contract(){assert_eq!(stage_marker(),"${marker}");assert!(validate("fixture").is_ok())}`,
            },
          ],
          hidden: [
            {
              name: "rejects_empty",
              path: "tests/hidden.rs",
              content: `use ${marker.replaceAll("-", "_")}::validate;#[test]fn rejects_empty(){assert!(validate("  ").is_err())}`,
            },
          ],
          regression: [
            {
              name: "stable_marker",
              path: "tests/regression.rs",
              content: `use ${marker.replaceAll("-", "_")}::stage_marker;#[test]fn stable_marker(){assert!(!stage_marker().is_empty())}`,
            },
          ],
        },
        evaluator: {
          mode: "cargo-workspace",
          editableFiles: ["src/lib.rs", "artifacts/*.md"],
          lockedFiles: ["Cargo.toml", "tests/visible.rs", "tests/hidden.rs", "tests/regression.rs"],
          commands: ["cargo test --offline --all-targets"],
          limits: { timeoutMs: 12000, memoryMb: 512, outputKb: 128 },
          expectedArtifacts: [`artifacts/${sequence}-evidence.md`, "test-report"],
        },
        definitionOfDone: [
          "Visible, hidden, and prior regression tests pass offline",
          "The stage boundary rejects invalid input with actionable errors",
          "The evidence note records the decision, alternative, and observed result",
        ],
        rubric: [
          {
            criterion: "Correctness",
            evidence: "All deterministic evaluator suites pass",
            weight: 50,
          },
          {
            criterion: "Boundary design",
            evidence: "Public API and failure behavior match the brief",
            weight: 30,
          },
          {
            criterion: "Engineering evidence",
            evidence: "Required artifact explains the verified tradeoff",
            weight: 20,
          },
        ],
        artifacts: [
          {
            id: `ART-${code}-${String(sequence).padStart(2, "0")}`,
            title: `${title} evidence`,
            template:
              "# Decision\n\n# Alternative considered\n\n# Test evidence\n\n# Remaining risk\n",
            required: true,
          },
        ],
        hints: [
          "Start with the visible observable, not the final architecture.",
          "Keep parsing/adapters outside the domain function.",
          "Run the predecessor regression suite before accepting the checkpoint.",
        ],
        referenceSolution: { files: [{ path: "src/lib.rs", content: solution }] },
        relationships: [
          {
            kind: "applies",
            targetId: lesson,
            rationale: `This stage applies the model introduced by ${lesson}.`,
          },
          ...(predecessorStageId
            ? [
                {
                  kind: "continues",
                  targetId: predecessorStageId,
                  rationale:
                    "The workspace and regression evidence accumulate from the prior stage.",
                },
              ]
            : []),
        ],
      });
    });
  }
  return { projects, stages };
}

function rustIdentifier(value) {
  return value.replaceAll(/[^a-zA-Z0-9_]/gu, "_");
}

function pairedMainmatterContract(recordId, path, mode, body) {
  const stem = rustIdentifier(recordId.replace(/^mainmatter-/u, ""));
  const build = (kind) => {
    const name = `rust_tutor_${kind}_${stem}`;
    return {
      name,
      path: mode === "write" ? path.replace(/\.rs$/u, `_${kind}.rs`) : path,
      mode,
      content: body.replaceAll("__MODULE__", name).replaceAll("__TEST__", name),
    };
  };
  return { hidden: [build("hidden")], regression: [build("regression")] };
}

function protectedUpstreamContract(record) {
  const visible = record.tests?.visible?.find((test) =>
    /#\[(?:tokio::)?test(?:\([^\]]*\))?\]/u.test(test.content),
  );
  if (!visible) return undefined;
  // Some Mainmatter exercises deliberately put TODOs inside the test module
  // itself (for example, casting drills). Preserve the reviewed assertions
  // from the solution snapshot rather than cloning those incomplete TODOs
  // into the server-owned suite.
  const contractContent =
    record.referenceSolution?.files?.find((file) => file.path === visible.path)?.content ??
    visible.content;
  const stem = rustIdentifier(record.id.replace(/^mainmatter-/u, ""));
  const build = (kind) => {
    const name = `rust_tutor_${kind}_${stem}`;
    if (visible.path.startsWith("src/")) {
      const marker = contractContent.lastIndexOf("#[cfg(test)]");
      if (marker < 0)
        throw new Error(`${record.id}: inline upstream tests have no cfg(test) boundary`);
      const content = contractContent.slice(marker).replace(/\bmod\s+tests\b/u, `mod ${name}`);
      if (!content.includes(`mod ${name}`))
        throw new Error(`${record.id}: inline upstream test module could not be isolated`);
      return { name, path: visible.path, mode: "append", content: `\n${content}\n` };
    }
    const content = contractContent.replace(
      /(#\[(?:tokio::)?test(?:\([^\]]*\))?\]\s*(?:async\s+)?fn\s+)([a-zA-Z0-9_]+)/gu,
      `$1${name}_$2`,
    );
    if (!content.includes(name))
      throw new Error(`${record.id}: external upstream test names could not be isolated`);
    return {
      name,
      path: `tests/__rust_tutor_${kind}.rs`,
      mode: "write",
      content: `// Protected copy of the pinned upstream test contract.\n${content}\n`,
    };
  };
  return { hidden: [build("hidden")], regression: [build("regression")] };
}

function compileOnlyMainmatterContract(record) {
  const contracts = {
    "mainmatter-03-ticket_v1-03-modules": [
      "src/lib.rs",
      "append",
      `\n#[cfg(test)]\nmod __MODULE__ {\n    use super::*;\n    #[test]\n    fn __TEST__() {\n        let ticket = Ticket::new("title".into(), "description".into(), "To-Do".into());\n        assert_eq!(ticket.status, "To-Do");\n    }\n}\n`,
    ],
    "mainmatter-03-ticket_v1-04-visibility": [
      "src/lib.rs",
      "append",
      `\n#[cfg(test)]\nmod __MODULE__ {\n    use super::ticket::Ticket;\n    #[test]\n    fn __TEST__() {\n        let _ = Ticket::new("title".into(), "description".into(), "To-Do".into());\n    }\n}\n`,
    ],
    "mainmatter-04-traits-02-orphan-rule": [
      "tests/__rust_tutor_contract.rs",
      "write",
      `struct Local(u32);\nimpl PartialEq for Local { fn eq(&self, other: &Self) -> bool { self.0 == other.0 } }\n#[test]\nfn __TEST__() { assert!(Local(7) == Local(7)); }\n`,
    ],
    "mainmatter-04-traits-05-trait-bounds": [
      "tests/__rust_tutor_contract.rs",
      "write",
      `use trait_bounds::min;\n#[test]\nfn __TEST__() { assert_eq!(min(String::from("z"), String::from("a")), "a"); }\n`,
    ],
    "mainmatter-04-traits-08-sized": [
      "tests/__rust_tutor_contract.rs",
      "write",
      `#[test]\nfn __TEST__() { sized::example(); assert_eq!(std::mem::size_of::<&str>(), 2 * std::mem::size_of::<usize>()); }\n`,
    ],
    "mainmatter-04-traits-09-from": [
      "tests/__rust_tutor_contract.rs",
      "write",
      `use from::WrappingU32;\n#[test]\nfn __TEST__() { let _: WrappingU32 = 42_u32.into(); let _ = WrappingU32::from(7_u32); }\n`,
    ],
    "mainmatter-04-traits-11-clone": [
      "tests/__rust_tutor_contract.rs",
      "write",
      `use clone::{summary, Ticket};\n#[test]\nfn __TEST__() {\n    let ticket = Ticket { title: "t".into(), description: "d".into(), status: "To-Do".into() };\n    let (ticket, summary) = summary(ticket);\n    assert_eq!((ticket.title, summary.title, summary.status), ("t".into(), "t".into(), "To-Do".into()));\n}\n`,
    ],
    "mainmatter-05-ticket_v2-10-packages": [
      "tests/__rust_tutor_contract.rs",
      "write",
      `#[test]\nfn __TEST__() { packages::hello_world(); }\n`,
    ],
    "mainmatter-08-futures-04-future": [
      "src/lib.rs",
      "append",
      `\n#[cfg(test)]\nmod __MODULE__ {\n    use super::*;\n    #[test]\n    fn __TEST__() { let _: fn() = spawner; }\n}\n`,
    ],
    "mainmatter-08-futures-08-outro": [
      "tests/__rust_tutor_contract.rs",
      "write",
      `use outro_08::required_endpoints;\n#[test]\nfn __TEST__() {\n    assert_eq!(required_endpoints(), ["POST /tickets", "GET /tickets/:id", "PATCH /tickets/:id"]);\n}\n`,
    ],
  };
  const contract = contracts[record.id];
  return contract ? pairedMainmatterContract(record.id, ...contract) : undefined;
}

function specializedMainmatterContract(record) {
  if (record.id !== "mainmatter-08-futures-05-blocking") return undefined;
  return pairedMainmatterContract(
    record.id,
    "src/lib.rs",
    "append",
    `
#[cfg(test)]
mod __MODULE__ {
    use super::*;
    use std::time::{Duration, Instant};

    #[tokio::test(flavor = "current_thread")]
    async fn __TEST__() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = std::net::TcpStream::connect(address).unwrap();
        let release_client = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(500));
            drop(client);
        });
        tokio::spawn(echo(listener));
        tokio::task::yield_now().await;
        let started = Instant::now();
        tokio::time::sleep(Duration::from_millis(25)).await;
        let scheduler_delay = started.elapsed();
        release_client.join().unwrap();
        assert!(
            scheduler_delay < Duration::from_millis(200),
            "blocking socket I/O stalled the async executor for {scheduler_delay:?}"
        );
    }
}
`,
  );
}

function mainmatterManifestPolicy(record) {
  if (record.starter?.manifest?.editable !== true) return { editable: false, dependencies: {} };
  const solutionManifest = record.referenceSolution?.files?.find(
    (file) => file.path === "Cargo.toml",
  )?.content;
  if (!solutionManifest) throw new Error(`${record.id}: editable manifest has no reference`);
  let section = "";
  const packageFields = {};
  const dependencies = {};
  for (const rawLine of solutionManifest.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }
    const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"$/u);
    if (!match) continue;
    if (section === "package") packageFields[match[1]] = match[2];
    if (section === "dependencies") dependencies[match[1]] = match[2];
  }
  return { editable: true, package: packageFields, dependencies };
}

function reviewedMainmatterContract(record, authored) {
  if (authored) return authored;
  const generated =
    specializedMainmatterContract(record) ??
    protectedUpstreamContract(record) ??
    compileOnlyMainmatterContract(record);
  if (!generated) throw new Error(`${record.id}: no behavior or compiler contract is available`);
  const needsLoopback = record.referenceSolution?.files?.some((file) =>
    /(?:TcpListener|TcpStream|UdpSocket)[\s\S]*127\.0\.0\.1|127\.0\.0\.1[\s\S]*(?:TcpListener|TcpStream|UdpSocket)/u.test(
      file.content,
    ),
  );
  return {
    id: record.id,
    suiteId: `${record.id}-reviewed-v1`,
    manifestPolicy: mainmatterManifestPolicy(record),
    runtimePolicy: { loopback: needsLoopback === true },
    ...generated,
  };
}

function normalizeMainmatter(
  raw,
  integrity,
  knowledgeMappings,
  pilotContracts,
  mainmatterDocuments,
) {
  const list = Array.isArray(raw) ? raw : raw.exercises;
  if (!Array.isArray(list))
    throw new Error("mainmatter.json must be an array or { exercises: [] }");
  const mappingByExercise = new Map(
    knowledgeMappings.mainmatterExercises.map((mapping) => [mapping.exerciseId, mapping]),
  );
  const pilotByExercise = new Map((pilotContracts.pilots ?? []).map((pilot) => [pilot.id, pilot]));
  if (pilotContracts.schemaVersion !== 1 || pilotByExercise.size !== 8)
    throw new Error("Mainmatter pilot contracts must contain exactly eight v1 pilots");
  const documentByExercise = new Map(
    (mainmatterDocuments.exercises ?? []).map((document) => [document.exerciseId, document]),
  );
  return list.map((record, index) => {
    const sequence = index + 1;
    const arcChapter =
      sequence <= 13
        ? 3
        : sequence <= 41
          ? 7
          : sequence <= 57
            ? 10
            : sequence <= 74
              ? 13
              : sequence <= 89
                ? 16
                : 17;
    const capstoneContract = record.id === "mainmatter-08-futures-08-outro";
    const overflowContract = record.id === "mainmatter-02-basic_calculator-08-overflow";
    const packagesContract = record.id === "mainmatter-05-ticket_v2-10-packages";
    const adaptOverflowSource = (content) =>
      content
        .replace(
          "// Customize the `dev` profile to wrap around on overflow.\n// Check Cargo's documentation to find out the right syntax:\n// https://doc.rust-lang.org/cargo/reference/profiles.html\n//\n// For reasons that we'll explain later, the customization needs to be done in the `Cargo.toml`\n// at the root of the repository, not in the `Cargo.toml` of the exercise.\n",
          "// Make overflow behavior explicit in this function.\n// Replace the multiplication below with u32 wrapping arithmetic; manifests are locked.\n",
        )
        .replace(
          "// With the default dev profile, this will panic when you run `cargo test`\n        // We want it to wrap around instead",
          "// Ordinary multiplication can panic when overflow checks are enabled.\n        // Explicit wrapping arithmetic must produce this stable result.",
        );
    const starterRecord = capstoneContract
      ? {
          ...record.starter,
          manifest: { ...record.starter.manifest, editable: false },
          files: [
            {
              path: "src/lib.rs",
              editable: true,
              role: "starter",
              content:
                '/// Declare the stable HTTP surface before selecting a framework.\n/// Return the three required method/path pairs in create, retrieve, patch order.\npub fn required_endpoints() -> [&\'static str; 3] {\n    todo!("define the ticket API surface")\n}\n',
            },
          ],
        }
      : overflowContract
        ? {
            ...record.starter,
            files: record.starter.files.map((file) =>
              file.path === "src/lib.rs"
                ? {
                    ...file,
                    editable: true,
                    role: "starter-and-visible-test",
                    content: adaptOverflowSource(file.content),
                  }
                : file,
            ),
          }
        : packagesContract
          ? {
              ...record.starter,
              files: [
                ...record.starter.files,
                {
                  path: "src/lib.rs",
                  editable: true,
                  role: "starter",
                  content:
                    '/// Public library target used by the binary.\npub fn hello_world() {\n    todo!("implement the library entrypoint")\n}\n',
                },
              ],
            }
          : record.starter;
    const referenceSolution = capstoneContract
      ? {
          disclosure: "locked-until-accepted-or-assisted-reveal",
          files: [
            { path: "Cargo.toml", content: record.starter.manifest.content },
            {
              path: "src/lib.rs",
              content:
                '/// Stable method/path contract for the ticket API.\npub fn required_endpoints() -> [&\'static str; 3] {\n    ["POST /tickets", "GET /tickets/:id", "PATCH /tickets/:id"]\n}\n',
            },
          ],
        }
      : overflowContract
        ? {
            ...record.referenceSolution,
            files: record.referenceSolution.files.map((file) =>
              file.path === "src/lib.rs"
                ? {
                    ...file,
                    content: file.content
                      .replace("let mut result = 1;", "let mut result: u32 = 1;")
                      .replace("result *= i;", "result = result.wrapping_mul(i);"),
                  }
                : file,
            ),
          }
        : record.referenceSolution;
    const contractRecord = { ...record, starter: starterRecord, referenceSolution };
    const upstreamEvaluator = record.evaluator ?? {};
    const commands = Array.isArray(upstreamEvaluator.commands)
      ? upstreamEvaluator.commands
      : Object.values(upstreamEvaluator.commands ?? {}).map((command) =>
          Array.isArray(command) ? command.join(" ") : command,
        );
    const hiddenContract = upstreamEvaluator.hiddenTests ?? {};
    const regressionContract = upstreamEvaluator.regressionTests ?? {};
    const manifest =
      typeof starterRecord?.manifest === "string"
        ? starterRecord.manifest
        : starterRecord?.manifest?.content;
    const provenance = record.provenance ?? {};
    const packageHashes = integrity.packageHashes.get(record.id);
    if (!packageHashes) throw new Error(`${record.id}: package integrity record is missing`);
    const mapping = mappingByExercise.get(record.id);
    if (!mapping) throw new Error(`${record.id}: canonical knowledge mapping is missing`);
    const pilot = pilotByExercise.get(record.id);
    const sourceDocument = documentByExercise.get(record.id);
    if (!sourceDocument)
      throw new Error(`${record.id}: typed Mainmatter source document is missing`);
    const reviewedContract = reviewedMainmatterContract(contractRecord, pilot);
    const license =
      typeof provenance.license === "string" ? provenance.license : provenance.license?.spdx;
    const tests = {
      visible: record.tests?.visible?.length
        ? record.tests.visible.map((test) => ({
            ...test,
            content: overflowContract ? adaptOverflowSource(test.content) : test.content,
          }))
        : [
            {
              name: `${record.id}-visible-build`,
              path: "tests/__rust_tutor_visible.rs",
              content: "// Compiler-only unit; acceptance comes from the protected server suite.\n",
            },
          ],
      hidden: reviewedContract.hidden.map((test) => ({
        ...test,
        content: overflowContract ? adaptOverflowSource(test.content) : test.content,
      })),
      regression: reviewedContract.regression.map((test) => ({
        ...test,
        content: overflowContract ? adaptOverflowSource(test.content) : test.content,
      })),
    };
    const suiteSha256 = sha256(
      JSON.stringify({ hidden: tests.hidden, regression: tests.regression }),
    );
    const capstoneExplanation = {
      purpose:
        "A network service should begin with an explicit public surface. This adaptation asks for the three method/path pairs that define ticket creation, retrieval, and patching before framework or runtime choices can blur that boundary.",
      approach:
        "Implement required_endpoints as a fixed three-element array in create, retrieve, patch order. Preserve the exact HTTP methods, plural resource path, identifier placeholder, and return type; no router or allocation is needed.",
      compilerImplications:
        "The array length is part of the return type, and &'static str makes each endpoint a program-lifetime string literal. The compiler therefore checks the result shape while the protected assertions check order and exact spelling.",
      referenceRationale:
        "The reference uses literals in a fixed array because the contract is static. A Vec, framework dependency, or runtime would add failure modes without proving anything more about the required API surface.",
    };
    return {
      ...record,
      family: "mainmatter",
      sequence,
      moduleId: record.moduleId ?? moduleId(arcChapter),
      lessonId: record.lessonId ?? lessonId(arcChapter),
      concepts: mapping.conceptIds,
      conceptIds: mapping.conceptIds,
      difficulty:
        { beginner: "easy", intermediate: "medium", advanced: "hard" }[record.difficulty] ??
        record.difficulty ??
        "medium",
      runnable: true,
      scored: true,
      suiteReview: "reviewed",
      requirement: record.requirement ?? "core",
      whyNow: capstoneContract
        ? "The Futures arc ends by separating a stable service contract from framework and runtime choices; that boundary is the prerequisite for a maintainable async implementation."
        : overflowContract
          ? "After ordinary multiplication, this exercise makes overflow semantics an explicit domain choice and lets the protected tests distinguish checked from wrapping behavior."
          : `${record.title} belongs here because it turns “${
              record.outcomes?.[0]?.statement ?? record.brief
            }” into compiler- or test-observable evidence after chapter ${arcChapter}.`,
      prepares: capstoneContract
        ? [
            "Name an HTTP resource boundary before selecting an async framework",
            "Distinguish an interface contract from a full production service",
            "Use a fixed Rust type to make a small architecture decision executable",
          ]
        : (record.prepares ?? ["Continue the cumulative Mainmatter project arc"]),
      prerequisiteIds: record.prerequisiteIds ??
        record.prerequisites?.map((entry) => entry.id) ?? [lessonId(arcChapter)],
      outcomes: mapping.outcomeIds,
      outcomeIds: mapping.outcomeIds,
      sourceOutcomeStatements:
        record.outcomes?.map((entry) => (typeof entry === "string" ? entry : entry.statement)) ??
        [],
      mappingRationale: mapping.rationale,
      mappingSource: mapping.mappingSource,
      sourceDocument,
      ...(pilot ? { pilot: true } : {}),
      brief: capstoneContract
        ? "Declare the exact create, retrieve, and patch endpoints for the ticket resource as a fixed Rust array. This is a deliberately narrow architecture slice, not an implementation of the HTTP server."
        : overflowContract
          ? "Make factorial use explicit wrapping multiplication so its behavior is stable across Cargo profiles. Preserve the supplied zero, small-number, and factorial(20) assertions."
          : record.brief,
      prompt: capstoneContract
        ? "Define the smallest stable contract for the ticket REST API before choosing a framework: return the exact create, retrieve, and patch method/path pairs. This makes the API boundary reviewable and testable while the full asynchronous service remains a project-stage concern."
        : overflowContract
          ? "Replace profile-dependent integer multiplication with the u32 operation whose contract deliberately wraps on overflow. Keep factorial's signature and all supplied tests unchanged."
          : (record.prompt ?? record.brief),
      explanation: capstoneContract
        ? capstoneExplanation
        : record.explanation && typeof record.explanation === "object"
          ? {
              ...record.explanation,
              compilerImplications: record.explanation.compilerImplications?.replace(
                "whether the implementation truly ",
                "whether the implementation can ",
              ),
            }
          : record.explanation,
      constraints: capstoneContract
        ? [
            "Keep the required_endpoints signature and fixed array length",
            "Return exactly the three specified method/path pairs in contract order",
            "Do not add a runtime, router, network access, or filesystem access",
          ]
        : overflowContract
          ? [
              "Edit only src/lib.rs; workspace and package manifests remain locked",
              "Use explicit wrapping arithmetic rather than relying on Cargo profile defaults",
              "Preserve the factorial signature and all supplied assertions",
            ]
          : (record.constraints ?? [
              "Preserve the pinned public API and supplied assertions",
              "Run the focused package with Cargo offline",
              "Do not weaken, delete, or ignore tests",
            ]),
      hints: capstoneContract
        ? [
            {
              level: 1,
              title: "Read the return type",
              text: "The function must return exactly three static string slices; no heap allocation or async runtime is required.",
            },
            {
              level: 2,
              title: "Model the resource",
              text: "Use POST on the collection to create, then GET and PATCH on the identifier path for retrieval and partial update.",
            },
            {
              level: 3,
              title: "Check exactness",
              text: "Return POST /tickets, GET /tickets/:id, and PATCH /tickets/:id in that order with exact capitalization and punctuation.",
            },
          ]
        : record.hints,
      commonMistakes: capstoneContract
        ? [
            "Returning singular /ticket paths or putting the identifier on the create endpoint.",
            "Adding Tokio or a web framework even though the graded boundary is a static API declaration.",
            "Changing endpoint order or using PUT where the contract requires PATCH.",
          ]
        : record.commonMistakes,
      tradeoffs: capstoneContract
        ? [
            "A fixed array is intentionally closed and allocation-free; a richer route table belongs in the later service implementation.",
            "The :id spelling is framework-neutral documentation here, not a claim about one router's path-parameter syntax.",
          ]
        : record.tradeoffs,
      starter: { ...starterRecord, manifest, files: starterRecord?.files ?? [] },
      referenceSolution,
      tests,
      evaluator: {
        mode: "cargo-workspace",
        editableFiles: overflowContract
          ? ["src/lib.rs"]
          : (upstreamEvaluator.editableFiles ?? ["src/lib.rs"]).filter(
              (path) => path !== "Cargo.toml" || reviewedContract.manifestPolicy.editable,
            ),
        lockedFiles: upstreamEvaluator.lockedFiles ?? ["Cargo.toml"],
        commands: commands.length ? commands : ["cargo test --offline --all-targets"],
        limits: {
          timeoutMs:
            upstreamEvaluator.limits?.timeoutMs ?? upstreamEvaluator.limits?.wallTimeMs ?? 30000,
          memoryMb:
            upstreamEvaluator.limits?.memoryMb ?? upstreamEvaluator.limits?.memoryMiB ?? 512,
          outputKb:
            upstreamEvaluator.limits?.outputKb ?? upstreamEvaluator.limits?.outputKiB ?? 256,
        },
        expectedArtifacts: (upstreamEvaluator.expectedArtifacts ?? ["test-report"]).map(
          (artifact) =>
            typeof artifact === "string" ? artifact : (artifact.path ?? artifact.kind),
        ),
        hiddenContract: capstoneContract
          ? {
              serverOnly: true,
              suiteId: reviewedContract.suiteId,
              checks: [
                "required_endpoints returns the exact create, retrieve, and patch method/path pairs",
                "the fixed array preserves the declared order and contains no extra routes",
              ],
            }
          : hiddenContract,
        regressionContract: capstoneContract
          ? {
              referenceSolutionMustPass: true,
              starterMustFail: true,
              boundary: "The suite proves the route declaration only, not a running HTTP service.",
            }
          : regressionContract,
        environment: upstreamEvaluator.environment ?? { CARGO_NET_OFFLINE: "true" },
        packageRoot: starterRecord.workspaceRoot,
        suiteId: reviewedContract.suiteId,
        suiteSha256,
        manifestPolicy: reviewedContract.manifestPolicy,
        runtimePolicy: { loopback: reviewedContract.runtimePolicy?.loopback === true },
      },
      externalReferences: record.externalReferences ?? [],
      provenance: {
        sourceId: "SRC-MAINMATTER-100",
        mode: "adapted",
        originalPath: provenance.originalPath ?? provenance.starter?.path,
        sourcePath: record.sourceLesson?.path ?? provenance.starter?.lessonPath,
        sourceCommit: provenance.starterCommit ?? provenance.starter?.sha,
        canonicalUrl: provenance.canonicalUrl ?? provenance.starter?.url,
        starterPath: provenance.starter?.path ?? provenance.originalPath,
        starterCanonicalUrl: provenance.starter?.url ?? provenance.canonicalUrl,
        solutionPath: provenance.solution?.path ?? provenance.originalPath,
        solutionCanonicalUrl: provenance.solution?.url,
        sha256:
          record.sourceLesson?.sha256 ??
          sha256(
            JSON.stringify({
              sourceLesson: record.sourceLesson?.markdown,
              manifest,
              files: starterRecord?.files,
            }),
          ),
        starterCommit: provenance.starterCommit ?? provenance.starter?.sha,
        solutionCommit: provenance.solutionCommit ?? provenance.solution?.sha,
        packageHashAlgorithm: integrity.algorithm,
        starterPackageSha256: packageHashes.starterPackageSha256,
        solutionPackageSha256: packageHashes.solutionPackageSha256,
        starterSharedWorkspaceSha256: integrity.starterSharedWorkspaceSha256,
        solutionSharedWorkspaceSha256: integrity.solutionSharedWorkspaceSha256,
        license,
        attribution: provenance.attribution,
        importedAt: provenance.importedAt ?? importedAt,
        changeNotes: [
          ...(provenance.changeNotes ?? [provenance.changes].filter(Boolean)),
          ...(capstoneContract
            ? [
                "Scoped the unstructured REST capstone to a testable method/path contract; full service implementation remains in the project track.",
              ]
            : []),
          ...(overflowContract
            ? [
                "Replaced the unsafe workspace-root profile edit with an equivalent local wrapping_mul implementation contract.",
              ]
            : []),
          ...(packagesContract
            ? [
                "Added the requested src/lib.rs as an editable TODO stub so the browser workbench can create and grade the library target without allowing arbitrary paths.",
              ]
            : []),
        ],
      },
    };
  });
}

function runCompiler(args) {
  const result = spawnSync(
    "cargo",
    ["run", "--quiet", "-p", "curriculum-compiler", "--", ...args],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0)
    throw new Error(`curriculum compiler failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
}

export async function compileSourceDocuments({ check = false } = {}) {
  const temporary = check ? await mkdtemp(resolve(tmpdir(), "rust-tutor-content-")) : null;
  const nextBook = temporary ? resolve(temporary, "rust-book.json") : rustBookPath;
  const nextMainmatter = temporary
    ? resolve(temporary, "mainmatter-documents.json")
    : mainmatterDocumentsPath;
  try {
    runCompiler(["book", resolve(contentDir, "sources/rust-book"), nextBook]);
    runCompiler([
      "mainmatter",
      resolve(contentDir, "mainmatter.json"),
      resolve(contentDir, "sources/mainmatter/book/src/going_further.md"),
      nextMainmatter,
    ]);
    if (check) {
      for (const [current, next] of [
        [rustBookPath, nextBook],
        [mainmatterDocumentsPath, nextMainmatter],
      ]) {
        if ((await readFile(current, "utf8").catch(() => "")) !== (await readFile(next, "utf8")))
          throw new Error(`${relative(root, current)} is stale; run pnpm content:build:v2`);
      }
    }
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

async function listFiles(base) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(base);
  return files.sort();
}

export async function buildSourceManifest() {
  const roots = [
    {
      id: "SRC-RUST-BOOK-STABLE",
      commit: rustBookCommit,
      base: resolve(contentDir, "sources/rust-book"),
    },
    {
      id: "SRC-MAINMATTER-100",
      commit: mainmatterStarterCommit,
      solutionCommit: mainmatterSolutionCommit,
      base: resolve(contentDir, "sources/mainmatter"),
    },
  ];
  const sources = [];
  for (const source of roots) {
    const files = [];
    for (const path of await listFiles(source.base)) {
      const content = await readFile(path);
      files.push({
        path: relative(root, path).replaceAll("\\", "/"),
        bytes: content.byteLength,
        sha256: sha256(content),
      });
    }
    sources.push({
      id: source.id,
      commit: source.commit,
      ...(source.solutionCommit ? { solutionCommit: source.solutionCommit } : {}),
      files,
    });
  }
  const mainmatter = await readFile(resolve(contentDir, "mainmatter.json"));
  const mainmatterSource = sources.find((source) => source.id === "SRC-MAINMATTER-100");
  mainmatterSource.files.push({
    path: "content/curriculum-v2/mainmatter.json",
    bytes: mainmatter.byteLength,
    sha256: sha256(mainmatter),
  });
  const integrity = mainmatterIntegrity(JSON.parse(mainmatter.toString("utf8")));
  mainmatterSource.integrity = {
    algorithm: integrity.algorithm,
    starterSharedWorkspaceSha256: integrity.starterSharedWorkspaceSha256,
    solutionSharedWorkspaceSha256: integrity.solutionSharedWorkspaceSha256,
    packages: [...integrity.packageHashes.entries()].map(([exerciseId, hashes]) => ({
      exerciseId,
      ...hashes,
    })),
  };
  return {
    schemaVersion: 1,
    generatedFromPinnedSources: true,
    sources,
  };
}

export function validateKnowledgeExtension(graph, graphText, extension) {
  if (
    extension.schemaVersion !== 1 ||
    extension.reviewState !== "accepted" ||
    extension.canonicalGraph?.path !== "knowledge/feed/generated/tutor-feed.json" ||
    extension.canonicalGraph?.sha256 !== sha256(graphText)
  )
    throw new Error("knowledge extension is not bound to the canonical graph bytes");
  const feedNodes = new Map(graph.graphProjection.nodes.map((node) => [node.id, node]));
  const nodes = new Map(feedNodes);
  const extensionSources = new Map();
  for (const node of extension.newNodes ?? []) {
    if (nodes.has(node.id)) throw new Error(`${node.id}: new knowledge node duplicates the feed`);
    if (!["concept", "learning_outcome"].includes(node.kind) || node.reviewState !== "accepted")
      throw new Error(`${node.id}: new knowledge node has an unapproved kind or review state`);
    nodes.set(node.id, node);
    extensionSources.set(node.id, "content/curriculum-v2/knowledge-extension.json#newNodes");
  }
  const promotedIds = new Set();
  for (const promotion of extension.promotions ?? []) {
    if (promotedIds.has(promotion.id))
      throw new Error(`${promotion.id}: duplicate knowledge promotion`);
    promotedIds.add(promotion.id);
    const node = feedNodes.get(promotion.id);
    if (!node) throw new Error(`${promotion.id}: promotion target is missing from the feed`);
    if (
      node.kind !== promotion.expectedKind ||
      node.reviewState !== promotion.expectedReviewState ||
      sha256(JSON.stringify(node)) !== promotion.expectedNodeSha256 ||
      promotion.promotedReviewState !== "accepted"
    )
      throw new Error(`${promotion.id}: promotion target differs from its reviewed prior state`);
    nodes.set(promotion.id, {
      ...node,
      reviewState: promotion.promotedReviewState,
      provenanceIds: [
        ...new Set([
          ...(node.provenanceIds ?? []),
          ...(promotion.sourceEvidence ?? []).map((evidence) => evidence.sourceId),
        ]),
      ],
    });
    extensionSources.set(promotion.id, "content/curriculum-v2/knowledge-extension.json#promotions");
  }
  const relationshipKeys = new Set();
  const connectedExtensionIds = new Set();
  for (const relationship of graph.graphProjection.edges)
    if (
      relationship.kind === "prerequisite_of" &&
      relationship.reviewState === "accepted" &&
      nodes.has(relationship.sourceId) &&
      nodes.has(relationship.targetId)
    ) {
      if (extensionSources.has(relationship.sourceId))
        connectedExtensionIds.add(relationship.sourceId);
      if (extensionSources.has(relationship.targetId))
        connectedExtensionIds.add(relationship.targetId);
    }
  for (const relationship of extension.relationships ?? []) {
    if (relationship.kind !== "prerequisite_of")
      throw new Error(
        `${relationship.sourceId}->${relationship.targetId}: extension relationship must be prerequisite_of`,
      );
    if (!nodes.has(relationship.sourceId) || !nodes.has(relationship.targetId))
      throw new Error(
        `${relationship.sourceId}->${relationship.targetId}: extension relationship endpoint is missing`,
      );
    if (typeof relationship.rationale !== "string" || relationship.rationale.length < 40)
      throw new Error(
        `${relationship.sourceId}->${relationship.targetId}: extension relationship needs a reviewed rationale`,
      );
    const key = `${relationship.kind}:${relationship.sourceId}->${relationship.targetId}`;
    if (relationshipKeys.has(key)) throw new Error(`${key}: duplicate extension relationship`);
    relationshipKeys.add(key);
    if (extensionSources.has(relationship.sourceId))
      connectedExtensionIds.add(relationship.sourceId);
    if (extensionSources.has(relationship.targetId))
      connectedExtensionIds.add(relationship.targetId);
  }
  for (const id of extensionSources.keys())
    if (!connectedExtensionIds.has(id))
      throw new Error(`${id}: accepted extension node has no reviewed knowledge relationship`);
  return { nodes, extensionSources, relationships: extension.relationships ?? [] };
}

function canonicalKnowledge(graph, graphText, mappings, extension) {
  const conceptIds = new Set([
    ...mappings.bookPages.flatMap((mapping) => mapping.conceptIds),
    ...mappings.mainmatterExercises.flatMap((mapping) => mapping.conceptIds),
  ]);
  const outcomeIds = new Set([
    ...mappings.bookPages.flatMap((mapping) => mapping.outcomeIds),
    ...mappings.mainmatterExercises.flatMap((mapping) => mapping.outcomeIds),
  ]);
  const { nodes, extensionSources, relationships } = validateKnowledgeExtension(
    graph,
    graphText,
    extension,
  );
  const select = (ids, kind) =>
    [...ids].sort().map((id) => {
      const node = nodes.get(id);
      if (!node || node.kind !== kind || node.reviewState !== "accepted")
        throw new Error(`${id}: canonical ${kind} node is missing or not accepted`);
      return {
        id,
        title: node.title,
        summary: node.summary,
        reviewState: node.reviewState,
        mappingSource:
          extensionSources.get(id) ??
          `${mappings.canonicalGraph.path}#${mappings.canonicalGraph.projection}`,
      };
    });
  return {
    concepts: select(conceptIds, "concept"),
    outcomes: select(outcomeIds, "learning_outcome"),
    relationships,
  };
}

export async function buildRelease() {
  const mainmatterRaw = JSON.parse(await readFile(resolve(contentDir, "mainmatter.json"), "utf8"));
  const rustBookDocumentText = await readFile(rustBookPath, "utf8");
  const mainmatterDocumentText = await readFile(mainmatterDocumentsPath, "utf8");
  const knowledgeMappingText = await readFile(knowledgeMappingsPath, "utf8");
  const knowledgeExtensionText = await readFile(knowledgeExtensionPath, "utf8");
  const mainmatterPilotContractText = await readFile(mainmatterPilotContractsPath, "utf8");
  const canonicalGraphText = await readFile(canonicalGraphPath, "utf8");
  const mainmatterReadme = await readFile(resolve(contentDir, "sources/mainmatter/README.md"));
  const rustBookDocuments = JSON.parse(rustBookDocumentText);
  const mainmatterDocuments = JSON.parse(mainmatterDocumentText);
  const knowledgeMappings = JSON.parse(knowledgeMappingText);
  const knowledgeExtension = JSON.parse(knowledgeExtensionText);
  const mainmatterPilotContracts = JSON.parse(mainmatterPilotContractText);
  const canonicalGraph = JSON.parse(canonicalGraphText);
  const book = makeBook(rustBookDocuments, knowledgeMappings);
  const knowledge = canonicalKnowledge(
    canonicalGraph,
    canonicalGraphText,
    knowledgeMappings,
    knowledgeExtension,
  );
  const integrity = mainmatterIntegrity(mainmatterRaw);
  const mainmatter = normalizeMainmatter(
    mainmatterRaw,
    integrity,
    knowledgeMappings,
    mainmatterPilotContracts,
    mainmatterDocuments,
  );
  const releaseSources = sources.map((source) => {
    if (source.id === "SRC-RUST-BOOK-STABLE")
      return {
        ...source,
        sourceCommit: rustBookCommit,
        sourcePath: "content/curriculum-v2/sources/rust-book/src/SUMMARY.md",
        documentPath: "content/curriculum-v2/rust-book.json",
        documentSha256: sha256(rustBookDocumentText),
        snapshotMetadata: {
          summaryEntryCount: 111,
          selectedPageCount: rustBookDocuments.selectedPageCount,
          excludedPages: rustBookDocuments.excludedPages,
          codeBlockCount: rustBookDocuments.pages.reduce(
            (count, page) => count + page.codeBlockCount,
            0,
          ),
          referencedAssetCount: new Set(
            rustBookDocuments.pages.flatMap((page) => page.assets.map((asset) => asset.path)),
          ).size,
          includeDirectiveCount: rustBookDocuments.pages.reduce(
            (count, page) => count + page.includes.length,
            0,
          ),
          notices: ["LICENSE-MIT", "LICENSE-APACHE", "COPYRIGHT"],
        },
      };
    if (source.id === "SRC-MAINMATTER-100")
      return {
        ...source,
        sourceCommit: mainmatterStarterCommit,
        sourcePath: "content/curriculum-v2/mainmatter.json",
        documentPath: "content/curriculum-v2/mainmatter-documents.json",
        documentSha256: sha256(mainmatterDocumentText),
        snapshotFiles: mainmatterRaw.sharedWorkspaceFiles ?? [],
        solutionSnapshotOverrides: mainmatterSolutionWorkspaceOverrides,
        resources: mainmatterDocuments.resources,
        snapshotMetadata: {
          upstreamExerciseCount: mainmatterRaw.upstreamExerciseCount,
          arcs: mainmatterRaw.arcs,
          starterCommit: mainmatterStarterCommit,
          solutionCommit: mainmatterSolutionCommit,
          packageHashAlgorithm: integrity.algorithm,
          starterSharedWorkspaceSha256: integrity.starterSharedWorkspaceSha256,
          solutionSharedWorkspaceSha256: integrity.solutionSharedWorkspaceSha256,
          sourceDocumentCount: mainmatterDocuments.exerciseCount,
          pilotContractCount: mainmatterPilotContracts.pilots?.length ?? 0,
          pilotContractSha256: sha256(mainmatterPilotContractText),
          readmePath: "content/curriculum-v2/sources/mainmatter/README.md",
          readmeSha256: sha256(mainmatterReadme),
        },
      };
    return source;
  });
  const interview = makeInterviewExercises();
  const { projects, stages } = makeProjects();
  const exercises = [...mainmatter, ...interview];
  const lessonById = new Map(book.lessons.map((lesson) => [lesson.id, lesson]));
  for (const exercise of exercises) {
    const lesson = lessonById.get(exercise.lessonId);
    if (lesson && lesson.practiceBridge.length < 3)
      lesson.practiceBridge.push({
        exerciseId: exercise.id,
        requirement: exercise.requirement,
        whyNow: exercise.whyNow,
      });
  }
  for (const stage of stages) {
    const lesson = lessonById.get(stage.relatedLessonIds[0]);
    if (lesson && lesson.projectTransfer.length < 2)
      lesson.projectTransfer.push({
        stageId: stage.id,
        reason: `Apply the lesson model in ${stage.projectId}'s cumulative workspace.`,
      });
  }
  for (const lesson of book.lessons) {
    if (lesson.practiceBridge.length === 0) {
      const mappedPractice = mainmatter.find((exercise) =>
        exercise.conceptIds.some((conceptId) => lesson.conceptIds.includes(conceptId)),
      );
      if (mappedPractice)
        lesson.practiceBridge.push({
          exerciseId: mappedPractice.id,
          requirement: "stretch",
          whyNow: `This exercise shares the reviewed ${mappedPractice.conceptIds[0]} concept mapping with the page.`,
        });
    }
    if (lesson.projectTransfer.length === 0) {
      const stage =
        stages[
          Math.min(
            stages.length - 1,
            Math.floor(((lesson.pageSequence - 1) * stages.length) / book.lessons.length),
          )
        ];
      lesson.projectTransfer.push({
        stageId: stage.id,
        reason:
          "Preview where this lesson's boundary and evidence habits transfer into a cumulative project.",
      });
    }
  }
  for (const lesson of book.lessons)
    lesson.completion.requiredExerciseIds = lesson.practiceBridge
      .filter((p) => p.requirement === "core")
      .slice(0, 1)
      .map((p) => p.exerciseId);

  const edges = [];
  const edgeIds = new Set();
  const edgeProvenance = (sourceId, targetId) => {
    if ([sourceId, targetId].some((id) => id.startsWith("mainmatter-")))
      return "SRC-MAINMATTER-100";
    if ([sourceId, targetId].some((id) => id.startsWith("LESSON-BOOK-")))
      return "SRC-RUST-BOOK-STABLE";
    if ([sourceId, targetId].some((id) => /^(CON|OUT)-/.test(id)))
      return "knowledge/feed/generated/tutor-feed.json#graphProjection";
    return "SRC-RUST-TUTOR-ORIGINAL";
  };
  const addEdge = (sourceId, targetId, kind, rationale) => {
    const id = `EDGE-${kind.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "-")}-${sourceId}-TO-${targetId}`;
    if (edgeIds.has(id)) throw new Error(`duplicate semantic edge ${id}`);
    edgeIds.add(id);
    edges.push({
      id,
      aliases: [`EDGE-${String(edges.length + 1).padStart(5, "0")}`],
      sourceId,
      targetId,
      kind,
      rationale,
      provenance: edgeProvenance(sourceId, targetId),
    });
  };
  const canonicalIds = new Set([
    ...knowledge.concepts.map((concept) => concept.id),
    ...knowledge.outcomes.map((outcome) => outcome.id),
  ]);
  const bookMappingById = new Map(
    knowledgeMappings.bookPages.map((mapping) => [mapping.pageId, mapping]),
  );
  const exerciseMappingById = new Map(
    knowledgeMappings.mainmatterExercises.map((mapping) => [mapping.exerciseId, mapping]),
  );
  const mappedEndpoint = (mapping, id) => {
    const endpoint = mapping?.endpointRationales.find((candidate) => candidate.id === id);
    if (!endpoint) throw new Error(`${mapping?.pageId ?? mapping?.exerciseId}: missing ${id}`);
    return endpoint;
  };
  for (const edge of canonicalGraph.graphProjection.edges) {
    if (
      edge.kind === "prerequisite_of" &&
      edge.reviewState === "accepted" &&
      canonicalIds.has(edge.sourceId) &&
      canonicalIds.has(edge.targetId)
    )
      addEdge(edge.sourceId, edge.targetId, "prerequisite_of", edge.rationale);
  }
  for (const edge of knowledge.relationships)
    if (canonicalIds.has(edge.sourceId) && canonicalIds.has(edge.targetId))
      addEdge(edge.sourceId, edge.targetId, edge.kind, edge.rationale);
  for (const [index, lesson] of book.lessons.entries()) {
    const mapping = bookMappingById.get(lesson.id);
    addEdge(
      lesson.id,
      lesson.moduleId,
      "part_of",
      `${lesson.title} is contained by its reviewed Book track container.`,
    );
    addEdge(
      lesson.id,
      "SRC-RUST-BOOK-STABLE",
      "part_of",
      `${lesson.title} is sourced from the pinned stable Rust Book snapshot.`,
    );
    for (const conceptId of lesson.conceptIds) {
      const endpoint = mappedEndpoint(mapping, conceptId);
      addEdge(lesson.id, conceptId, endpoint.relation, endpoint.reason);
    }
    for (const outcomeId of lesson.outcomeIds) {
      const endpoint = mappedEndpoint(mapping, outcomeId);
      addEdge(lesson.id, outcomeId, endpoint.relation, endpoint.reason);
    }
    const next = book.lessons[index + 1];
    if (next)
      addEdge(
        lesson.id,
        next.id,
        "precedes",
        "The pinned SUMMARY.md places this page immediately before the target for display navigation only.",
      );
    for (const transfer of lesson.projectTransfer)
      addEdge(lesson.id, transfer.stageId, "transfers_to", transfer.reason);
  }
  for (const [index, exercise] of mainmatter.entries()) {
    const next = mainmatter[index + 1];
    if (next)
      addEdge(
        exercise.id,
        next.id,
        "precedes",
        `The pinned Mainmatter sequence places ${exercise.upstreamSequence} immediately before ${next.upstreamSequence}; this is soft display navigation and never a knowledge prerequisite.`,
      );
  }
  for (const exercise of exercises) {
    addEdge(
      exercise.id,
      exercise.lessonId,
      "practices",
      `${exercise.title} practices the linked lesson model through executable evidence.`,
    );
    addEdge(
      exercise.id,
      exercise.moduleId,
      "part_of",
      `${exercise.title} belongs to its curriculum module; sequence remains advisory.`,
    );
    if (exercise.family === "mainmatter") {
      const mapping = exerciseMappingById.get(exercise.id);
      addEdge(
        exercise.id,
        "SRC-MAINMATTER-100",
        "part_of",
        `${exercise.title} is sourced from the pinned noncommercial Mainmatter pack.`,
      );
      for (const conceptId of exercise.conceptIds) {
        const endpoint = mappedEndpoint(mapping, conceptId);
        addEdge(exercise.id, conceptId, endpoint.relation, endpoint.reason);
      }
      for (const outcomeId of exercise.outcomeIds) {
        const endpoint = mappedEndpoint(mapping, outcomeId);
        addEdge(exercise.id, outcomeId, endpoint.relation, endpoint.reason);
      }
    }
  }
  for (const stage of stages) {
    const transferId = `EDGE-TRANSFERS-TO-${stage.relatedLessonIds[0]}-TO-${stage.id}`;
    if (!edgeIds.has(transferId))
      addEdge(
        stage.relatedLessonIds[0],
        stage.id,
        "transfers_to",
        `${stage.title} applies the lesson at project scale.`,
      );
    if (stage.predecessorStageId)
      addEdge(
        stage.id,
        stage.predecessorStageId,
        "stage_after",
        "The cumulative workspace and regression contract continue in this stage.",
      );
    addEdge(
      stage.id,
      stage.projectId,
      "part_of",
      `${stage.projectId} contains this ordered milestone.`,
    );
  }

  return {
    schemaVersion: 2,
    // The release ID is stable so lesson aliases and imported graph rows keep
    // resolving; the version moves with each reviewed content change.
    releaseId: "CURRICULUM-V2-2026-07-22",
    version: "2.1.0",
    generatedAt: "2026-07-22T00:00:00Z",
    minimumToolchain: "Rust 1.97.1; Cargo edition 2024",
    aliases: book.aliases,
    sources: releaseSources,
    knowledgeMapping: {
      path: "content/curriculum-v2/knowledge-mappings.json",
      sha256: sha256(knowledgeMappingText),
      canonicalGraphPath: knowledgeMappings.canonicalGraph.path,
      canonicalGraphSha256: sha256(canonicalGraphText),
      extensionPath: "content/curriculum-v2/knowledge-extension.json",
      extensionSha256: sha256(knowledgeExtensionText),
    },
    concepts: knowledge.concepts,
    outcomes: knowledge.outcomes,
    library: libraryCatalog(),
    modules: book.modules,
    lessons: book.lessons,
    exercises,
    projects,
    stages,
    edges,
    edgeKinds: [
      {
        kind: "prerequisite_of",
        label: "Prepares",
        direction: "directed",
        description:
          "Reviewed knowledge required before the target; the only edge used for prerequisite closure.",
      },
      {
        kind: "practices",
        label: "Practices",
        direction: "directed",
        description:
          "The source rehearses or applies the target knowledge in guided or executable practice.",
      },
      {
        kind: "assesses",
        label: "Assesses",
        direction: "directed",
        description: "A committed check or evaluator contract measures an observable outcome.",
      },
      {
        kind: "part_of",
        label: "Part of",
        direction: "directed",
        description: "The source belongs to the target source pack, container, module, or project.",
      },
      {
        kind: "stage_after",
        label: "Stage after",
        direction: "directed",
        description:
          "The source stage continues the target stage without becoming a knowledge prerequisite.",
      },
      {
        kind: "transfers_to",
        label: "Transfers to",
        direction: "directed",
        description:
          "Knowledge or evidence from the source is applied at the target project stage.",
      },
      {
        kind: "precedes",
        label: "Precedes",
        direction: "directed",
        description: "Display and navigation order only; excluded from prerequisite closure.",
      },
    ],
  };
}

export const stableJson = (value) => `${JSON.stringify(value)}\n`;

async function main() {
  const check = process.argv.includes("--check");
  await compileSourceDocuments({ check });
  // This artifact is small enough for Biome to check, so generate the same
  // readable shape the formatter expects. `release.json` stays compact because
  // it is intentionally excluded from formatting.
  const nextSourceManifest = `${JSON.stringify(await buildSourceManifest(), null, 2)}\n`;
  const release = await buildRelease();
  const next = stableJson(release);
  const nextLibrary = `${JSON.stringify(release.library, null, 2)}\n`;
  if (check) {
    const current = await readFile(releasePath, "utf8").catch(() => "");
    if (current !== next)
      throw new Error(
        "content/curriculum-v2/release.json is stale; run node scripts/build-curriculum.mjs",
      );
    // Both files are build artifacts, so both belong in the determinism guard;
    // checking only release.json let a broken library export ship unnoticed.
    const currentLibrary = await readFile(libraryPath, "utf8").catch(() => "");
    if (currentLibrary !== nextLibrary)
      throw new Error(
        "apps/web/src/data/reference-library.json is stale; run node scripts/build-curriculum.mjs",
      );
    const currentSourceManifest = await readFile(sourceManifestPath, "utf8").catch(() => "");
    if (currentSourceManifest !== nextSourceManifest)
      throw new Error(
        "content/curriculum-v2/source-manifest.json is stale; run node scripts/build-curriculum.mjs",
      );
    console.log(
      `curriculum release is deterministic (${release.modules.length} modules, ${release.exercises.length} exercises, ${release.stages.length} stages)`,
    );
    return;
  }
  await writeFile(releasePath, next);
  await writeFile(sourceManifestPath, nextSourceManifest);
  await mkdir(dirname(libraryPath), { recursive: true });
  await writeFile(libraryPath, nextLibrary);
  console.log(`wrote ${releasePath}`);
  console.log(`wrote ${libraryPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
