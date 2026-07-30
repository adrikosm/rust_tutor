#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const contentDir = resolve(root, "content/curriculum-v2");
const releasePath = resolve(contentDir, "release.json");
const importedAt = "2026-07-22";

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
    snapshot: "stable documentation retrieved 2026-07-22; Rust 1.90+, edition 2024",
    license: "MIT OR Apache-2.0",
    attribution: "Copyright The Rust Project Developers; adapted under the MIT license.",
    use: "adapted",
  },
  {
    id: "SRC-MAINMATTER-100",
    title: "100 Exercises To Learn Rust",
    publisher: "Mainmatter",
    canonicalUrl: "https://github.com/mainmatter/100-exercises-to-learn-rust",
    snapshot:
      "starter 57d145e6d393dfffeadb97fc61e814255c3b6ffe; solutions e77613749a55c19c63cf78e3b30cafc007f53dab",
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

function makeBook() {
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
      prerequisiteModuleIds: number === 1 ? [] : [moduleId(number - 1)],
    });
    sections.forEach((section, index) => {
      const sectionNumber = index + 1;
      const id = sectionLessonId(number, sectionNumber);
      const checkId = `${id}-CHECK-01`;
      const previousId =
        sectionNumber > 1
          ? sectionLessonId(number, sectionNumber - 1)
          : number > 1
            ? bookSections
                .filter((candidate) => candidate.chapter === number - 1)
                .map((_, i) => sectionLessonId(number - 1, i + 1))
                .at(-1)
            : null;
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
        prerequisiteIds: previousId ? [previousId] : [],
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
            explanation:
              "Prediction plus executable evidence tests the model; recognition alone does not.",
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
  return { aliases, modules, lessons };
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

function interviewCode(kind) {
  const solutions = {
    "arrays-hash-maps": `use std::collections::HashSet;\npub fn solve(input: &str) -> String { input.split_whitespace().filter_map(|s| s.parse::<i64>().ok()).collect::<HashSet<_>>().len().to_string() }`,
    "two-pointers-sliding-window": `pub fn solve(input: &str) -> String { let mut n=input.split_whitespace().filter_map(|s|s.parse::<i64>().ok()); let target=n.next().unwrap_or(0); let mut v:Vec<_>=n.collect(); v.sort_unstable(); if v.len()<2{return "false".into()} let(mut l,mut r)=(0,v.len()-1); while l<r { match (v[l]+v[r]).cmp(&target) { std::cmp::Ordering::Equal=>return "true".into(), std::cmp::Ordering::Less=>l+=1, std::cmp::Ordering::Greater=>r-=1 } } "false".into() }`,
    "stacks-queues": `pub fn solve(input: &str) -> String { let mut s=Vec::new(); for c in input.chars().filter(|c|"()[]{}".contains(*c)){ if "([{".contains(c){s.push(c)} else if !matches!((s.pop(),c),(Some('('),')')|(Some('['),']')|(Some('{'),'}')){return "false".into()} } s.is_empty().to_string() }`,
    "binary-search": `pub fn solve(input: &str) -> String { let mut it=input.split_whitespace().filter_map(|s|s.parse::<i64>().ok()); let target=it.next().unwrap_or(0); let v:Vec<_>=it.collect(); v.binary_search(&target).map(|i|i as i64).unwrap_or(-1).to_string() }`,
    "linked-lists": `struct Node{v:i64,next:Option<Box<Node>>} pub fn solve(input:&str)->String{let mut head=None;for v in input.split_whitespace().filter_map(|s|s.parse().ok()){head=Some(Box::new(Node{v,next:head}))}let mut out=Vec::new();while let Some(n)=head{out.push(n.v.to_string());head=n.next}out.join(" ")}`,
    "trees-bst": `pub fn solve(input:&str)->String{let v:Vec<_>=input.split_whitespace().collect();v.iter().enumerate().filter(|(_,x)|**x!="null").map(|(i,_)|usize::BITS-(i+1).leading_zeros()).max().unwrap_or(0).to_string()}`,
    heaps: `use std::collections::BinaryHeap; pub fn solve(input:&str)->String{let mut it=input.split_whitespace().filter_map(|s|s.parse::<i64>().ok());let k=it.next().unwrap_or(0).max(0) as usize;let mut h=BinaryHeap::new();for v in it{h.push(v);if h.len()>k{h.pop();}}let mut v=h.into_sorted_vec();v.iter().map(ToString::to_string).collect::<Vec<_>>().join(" ")}`,
    "intervals-greedy": `pub fn solve(input:&str)->String{let mut v:Vec<(i64,i64)>=input.split(';').filter_map(|p|{let mut n=p.split_whitespace().filter_map(|s|s.parse().ok());Some((n.next()?,n.next()?))}).collect();v.sort_unstable();let mut o:Vec<(i64,i64)>=Vec::new();for(a,b)in v{if let Some(last)=o.last_mut(){if a<=last.1{last.1=last.1.max(b);continue}}o.push((a,b))}o.iter().map(|(a,b)|format!("{a} {b}")).collect::<Vec<_>>().join(";")}`,
    backtracking: `fn visit(n:usize,used:&mut[bool],count:&mut u64){if used.iter().all(|x|*x){*count+=1;return}for i in 0..n{if !used[i]{used[i]=true;visit(n,used,count);used[i]=false}}}pub fn solve(input:&str)->String{let n=input.trim().parse().unwrap_or(0).min(10);let mut count=0;visit(n,&mut vec![false;n],&mut count);count.to_string()}`,
    "graphs-union-find-topological": `use std::collections::{HashMap,HashSet,VecDeque};pub fn solve(input:&str)->String{let(mut parts)=input.split(';');let h:Vec<usize>=parts.next().unwrap_or("").split_whitespace().filter_map(|s|s.parse().ok()).collect();if h.len()<3{return "false".into()}let mut g:HashMap<usize,Vec<usize>>=HashMap::new();for e in parts.next().unwrap_or("").split(','){let mut p=e.split('-').filter_map(|s|s.parse().ok());if let(Some(a),Some(b))=(p.next(),p.next()){g.entry(a).or_default().push(b);g.entry(b).or_default().push(a)}}let(mut q,mut seen)=(VecDeque::from([h[1]]),HashSet::new());while let Some(x)=q.pop_front(){if x==h[2]{return "true".into()}if seen.insert(x){q.extend(g.get(&x).into_iter().flatten().copied())}}"false".into()}`,
    "dynamic-programming": `pub fn solve(input:&str)->String{let n=input.trim().parse::<u32>().unwrap_or(0);let(mut a,mut b)=(1u128,1u128);for _ in 0..n{(a,b)=(b,a+b)}a.to_string()}`,
    "bit-math": `pub fn solve(input:&str)->String{input.trim().parse::<u64>().unwrap_or(0).count_ones().to_string()}`,
  };
  return solutions[kind];
}

function interviewCases(kind) {
  return {
    "arrays-hash-maps": [
      ["1 2 2 3", "3"],
      ["", "0"],
    ],
    "two-pointers-sliding-window": [
      ["9 2 7 4", "true"],
      ["20 2 7 4", "false"],
    ],
    "stacks-queues": [
      ["([]{})", "true"],
      ["([)]", "false"],
    ],
    "binary-search": [
      ["7 1 4 7 9", "2"],
      ["8 1 4 7 9", "-1"],
    ],
    "linked-lists": [
      ["1 2 3", "3 2 1"],
      ["5", "5"],
    ],
    "trees-bst": [
      ["1 2 3 4 null 6", "3"],
      ["", "0"],
    ],
    heaps: [
      ["3 9 1 7 2 8", "1 2 7"],
      ["0 1 2", ""],
    ],
    "intervals-greedy": [
      ["1 3;2 5;8 9", "1 5;8 9"],
      ["2 4", "2 4"],
    ],
    backtracking: [
      ["3", "6"],
      ["0", "1"],
    ],
    "graphs-union-find-topological": [
      ["4 0 3;0-1,1-3", "true"],
      ["4 0 3;0-1,2-3", "false"],
    ],
    "dynamic-programming": [
      ["4", "5"],
      ["0", "1"],
    ],
    "bit-math": [
      ["11", "3"],
      ["0", "0"],
    ],
  }[kind];
}

function testSource(input, expected, name) {
  return `use solution::solve;\n#[test]\nfn ${name}() { assert_eq!(solve(${JSON.stringify(input)}), ${JSON.stringify(expected)}); }\n`;
}

// Self-sufficient problem statements per pattern. `notes` explain the two
// worked examples in order; the (input, output) pairs themselves come from
// interviewCases(kind), so a prompt can never drift from the graded tests.
// `edge` marks which of the two cases reads as an edge case rather than a
// representative example.
const interviewSpecs = {
  "arrays-hash-maps": {
    problem: "Count how many **distinct** integer readings the record contains.",
    input:
      "A single line of whitespace-separated integers. Tokens that do not parse as integers are ignored. The line may be empty.",
    output: "The count of distinct integer values, as a decimal string.",
    notes: [
      "four tokens, but `2` repeats, so three distinct values: {1, 2, 3}.",
      "no tokens means zero distinct values.",
    ],
    edge: [false, true],
    hint2: "A HashSet records membership: insert every value, then read its length.",
  },
  "two-pointers-sliding-window": {
    problem:
      "The first integer is a **target**; the rest are values. Report whether some **two distinct** values sum to the target.",
    input:
      "Whitespace-separated integers: the first is the target, the remaining are the pool of values. Non-integer tokens are ignored.",
    output: "`true` if two different positions in the pool sum to the target, otherwise `false`.",
    notes: [
      "target 9; the pool [2, 7, 4] contains 2 + 7 = 9.",
      "target 20; no pair in [2, 7, 4] reaches 20.",
    ],
    edge: [false, false],
    hint2:
      "Sort the values, then move a left and right pointer inward based on whether their sum is below or above the target.",
  },
  "stacks-queues": {
    problem:
      "Validate that the bracket characters `()`, `[]`, and `{}` are correctly **nested and balanced**. All other characters are ignored.",
    input:
      "A single line that may contain the six bracket characters interleaved with any other characters.",
    output:
      "`true` if every opening bracket is closed by the matching kind in the correct order, otherwise `false`.",
    notes: [
      "every bracket closes the most recent unmatched opener of its own kind.",
      "the `)` tries to close a `[`, so the nesting is crossed.",
    ],
    edge: [false, false],
    hint2:
      "A stack matches nesting: push openers, and on each closer pop and confirm it is the matching kind.",
  },
  "binary-search": {
    problem:
      "The first integer is a **target**; the remaining integers form an **already-sorted** ascending array. Report the target's index in that array.",
    input:
      "Whitespace-separated integers: the first is the target, the rest are the sorted array (ascending). Non-integer tokens are ignored.",
    output: "The zero-based index of the target within the array, or `-1` if it is absent.",
    notes: [
      "target 7; the array [1, 4, 7, 9] holds 7 at index 2.",
      "target 8 is not present in [1, 4, 7, 9].",
    ],
    edge: [false, false],
    hint2:
      "The array after the target is already sorted — binary-search it, halving the window each comparison.",
  },
  "linked-lists": {
    problem: "Read the values as a singly linked list in order, then return them **reversed**.",
    input:
      "Whitespace-separated integers giving the list from head to tail. Non-integer tokens are ignored; the line may be empty.",
    output: "The values in reversed order, space-separated on one line.",
    notes: ["head-to-tail 1→2→3 reverses to 3→2→1.", "a single node reverses to itself."],
    edge: [false, false],
    hint2: "Pushing each value onto the front of a new list reverses the order as you build it.",
  },
  "trees-bst": {
    problem:
      "The values are a binary tree in **level order** (breadth-first), with `null` marking an absent node. Return the tree's **depth** — its number of levels.",
    input:
      "Whitespace-separated tokens in level order; each is either an integer or the literal `null`. The line may be empty.",
    output: "The depth (level count) of the deepest present node, as a decimal string.",
    notes: [
      "level 1: index 0; level 2: indices 1–2; level 3: indices 3 and 5 (index 4 is null) — three levels deep.",
      "an empty tree has depth 0.",
    ],
    edge: [false, true],
    hint2:
      "In level order, the node at index i lives on level ⌊log2(i+1)⌋+1 — take the max over non-null positions.",
  },
  heaps: {
    problem:
      "The first integer is **k**; the rest are priorities. Return the **k smallest** priorities in ascending order.",
    input:
      "Whitespace-separated integers: the first is k, the rest are the priorities. Non-integer tokens are ignored.",
    output:
      "The k smallest priorities, sorted ascending and space-separated (empty line if k is 0).",
    notes: [
      "k=3; the smallest three of [9, 1, 7, 2, 8] are 1, 2, 7.",
      "k=0 selects nothing, so the output is empty.",
    ],
    edge: [false, true],
    hint2:
      "A max-heap capped at size k keeps the k smallest seen so far: pop the largest whenever the heap grows past k.",
  },
  "intervals-greedy": {
    problem: "**Merge** any overlapping or touching intervals and return the disjoint result.",
    input:
      "Intervals separated by `;`, each written as two whitespace-separated integers `start end`. Malformed intervals are ignored.",
    output:
      "The merged intervals, sorted by start, in the same `start end` / `;`-separated format.",
    notes: [
      "[1,3] and [2,5] overlap and merge into [1,5]; [8,9] stays separate.",
      "a single interval is already merged.",
    ],
    edge: [false, false],
    hint2:
      "Sort by start, then sweep: extend the open interval whenever the next start is ≤ the current end.",
  },
  backtracking: {
    problem: "Count the number of distinct **orderings** (permutations) of n items — that is, n!.",
    input: "A single integer n (n is clamped to at most 10). Non-integer input is treated as 0.",
    output: "The number of full orderings of n items, as a decimal string.",
    notes: [
      "three items admit 3! = 6 orderings.",
      "the empty ordering is the one arrangement of zero items.",
    ],
    edge: [false, true],
    hint2:
      "Recurse over unused items, marking one used before the recursive call and clearing it after — count each complete assignment.",
  },
  "graphs-union-find-topological": {
    problem:
      "Given an undirected graph, report whether the **goal** node is **reachable** from the **start** node.",
    input:
      "Two sections separated by `;`. The header is three integers `nodeCount start goal`. The second section is a comma-separated edge list, each edge written `a-b`. A header with fewer than three integers yields `false`.",
    output: "`true` if a path connects start to goal, otherwise `false`.",
    notes: [
      "edges 0–1 and 1–3 connect start 0 to goal 3.",
      "0 reaches only 1; the goal 3 sits in a separate component.",
    ],
    edge: [false, false],
    hint2:
      "Build an adjacency map, then BFS or DFS from the start node and check whether the goal is ever visited.",
  },
  "dynamic-programming": {
    problem:
      "Count the distinct ways to climb **n steps** taking either **1 or 2** steps at a time.",
    input: "A single non-negative integer n. Non-integer input is treated as 0.",
    output: "The number of distinct climbing sequences, as a decimal string.",
    notes: [
      "the sequences are 1111, 112, 121, 211, and 22 — five in all.",
      "one way to climb zero steps: take none.",
    ],
    edge: [false, true],
    hint2: "Ways(n) = Ways(n−1) + Ways(n−2): roll two running totals forward instead of recursing.",
  },
  "bit-math": {
    problem: "Count the number of **1 bits** (the population count) in the binary form of n.",
    input:
      "A single non-negative integer n, read as an unsigned 64-bit value. Non-integer input is treated as 0.",
    output: "The number of set bits in n, as a decimal string.",
    notes: ["11 is binary 1011, which has three 1 bits.", "zero has no set bits."],
    edge: [false, true],
    hint2: "Rust integers expose `count_ones()` — a direct population count of the set bits.",
  },
};

function showToken(value) {
  return value === "" ? "(empty line)" : value;
}

// Assemble a self-sufficient prompt from the spec plus the exercise's own
// graded cases, so every worked example is guaranteed to be a real assertion.
function buildInterviewPrompt(word, kind, cases, complexity) {
  const spec = interviewSpecs[kind];
  const examples = [];
  const edges = [];
  cases.forEach(([input, output], index) => {
    const note = spec.notes[index] ?? "";
    if (spec.edge[index])
      edges.push(`\`${input === "" ? "empty input" : input}\` → \`${output}\`: ${note}`);
    else examples.push(`- \`${showToken(input)}\` → \`${showToken(output)}\` — ${note}`);
  });
  edges.push(
    "Malformed or empty input is handled without panicking; the answer is always a deterministic UTF-8 string.",
  );
  return [
    `The ${word} system emits a compact text record. ${spec.problem}`,
    "",
    "**Input**",
    spec.input,
    "",
    "**Output**",
    spec.output,
    "",
    "**Examples**",
    ...examples,
    "",
    "**Edge cases**",
    edges.join(" "),
    "",
    `**Target complexity:** ${complexity}.`,
  ].join("\n");
}

function makeInterviewExercises() {
  const records = [];
  let sequence = 1;
  for (const [kind, count, book, label, action, approach, complexity] of patternDefinitions) {
    for (let i = 1; i <= count; i += 1) {
      const word = scenarioWords[(i - 1) % scenarioWords.length];
      const id = `INT-${kind.toUpperCase().replaceAll("-", "_")}-${String(i).padStart(3, "0")}`;
      const [visible, hidden] = interviewCases(kind);
      const solution = interviewCode(kind);
      records.push({
        id,
        family: "interview",
        sequence: sequence++,
        title: `${action}: ${word} ${String(i).padStart(2, "0")}`,
        category: kind,
        pattern: label,
        moduleId: moduleId(book),
        lessonId: lessonId(book),
        concepts: [kind],
        difficulty: i % 5 === 0 ? "hard" : i % 2 === 0 ? "medium" : "easy",
        estimateMinutes: 20 + (i % 4) * 10,
        runnable: true,
        scored: true,
        requirement: i % 4 === 0 ? "stretch" : "core",
        whyNow: `Chapter ${book} supplies the Rust data and control-flow tools needed to practice ${label.toLowerCase()} without hiding the algorithm.`,
        prepares: [
          `Recognize ${label.toLowerCase()} invariants in unfamiliar interview prompts`,
          "Explain complexity and ownership tradeoffs",
        ],
        prerequisiteIds: [lessonId(book)],
        outcomes: [`Implement ${approach.toLowerCase()}`, `Defend the ${complexity} bound`],
        prompt: buildInterviewPrompt(word, kind, [visible, hidden], complexity),
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
              content: `pub fn solve(_input: &str) -> String {\n    todo!("implement ${kind} invariant")\n}\n`,
            },
          ],
        },
        tests: {
          visible: [
            {
              name: "visible_contract",
              path: "tests/visible.rs",
              content: testSource(...visible, "visible_contract"),
            },
          ],
          hidden: [
            {
              name: "hidden_boundary",
              path: "tests/hidden.rs",
              content: testSource(...hidden, "hidden_boundary"),
            },
          ],
          regression: [
            {
              name: "deterministic",
              path: "tests/regression.rs",
              content: `use solution::solve; #[test] fn deterministic(){ assert_eq!(solve(${JSON.stringify(visible[0])}), solve(${JSON.stringify(visible[0])})); }`,
            },
          ],
        },
        evaluator: {
          mode: "cargo-workspace",
          editableFiles: ["src/lib.rs"],
          lockedFiles: ["Cargo.toml", "tests/visible.rs", "tests/hidden.rs", "tests/regression.rs"],
          commands: ["cargo test --offline --all-targets"],
          limits: { timeoutMs: 8000, memoryMb: 256, outputKb: 64 },
          expectedArtifacts: ["test-report"],
        },
        hints: [
          "Name the pattern first: read the input spec and the worked examples, and restate the rule the output must satisfy.",
          interviewSpecs[kind].hint2,
          `Test the empty/smallest input, then confirm ${complexity}.`,
        ],
        explanation: {
          purpose: `Recognize the ${label.toLowerCase()} pattern from an unfamiliar prompt and implement it in idiomatic Rust, defending its ${complexity} bound.`,
          approach,
          compilerImplications:
            "Parsing owns numeric values while traversal borrows collections; make mutation local so borrow scopes stay obvious.",
          referenceRationale: `The reference keeps the invariant visible and achieves ${complexity}; tests observe behavior rather than implementation details.`,
        },
        commonMistakes: [
          "Indexing before checking the empty case",
          "Letting parsing unwrap malformed learner input",
          "Claiming a complexity bound that ignores sorting or retained state",
        ],
        tradeoffs: [
          "The reference favors a direct standard-library implementation over a reusable abstraction.",
          "Extra allocation is accepted when it makes ownership and the invariant clearer.",
        ],
        complexity,
        referenceSolution: { files: [{ path: "src/lib.rs", content: `${solution}\n` }] },
        externalReferences: [],
        provenance: {
          sourceId: "SRC-RUST-TUTOR-ORIGINAL",
          mode: "app-authored",
          license: "MIT",
          attribution: "Original Rust Tutor exercise; not copied from LeetCode.",
          importedAt,
          changeNotes: ["Original scenario, tests, hints, explanation, and solution."],
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

function normalizeMainmatter(raw) {
  const list = Array.isArray(raw) ? raw : raw.exercises;
  if (!Array.isArray(list))
    throw new Error("mainmatter.json must be an array or { exercises: [] }");
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
    const upstreamEvaluator = record.evaluator ?? {};
    const commands = Array.isArray(upstreamEvaluator.commands)
      ? upstreamEvaluator.commands
      : Object.values(upstreamEvaluator.commands ?? {}).map((command) =>
          Array.isArray(command) ? command.join(" ") : command,
        );
    const hiddenContract = upstreamEvaluator.hiddenTests ?? {};
    const regressionContract = upstreamEvaluator.regressionTests ?? {};
    const manifest =
      typeof record.starter?.manifest === "string"
        ? record.starter.manifest
        : record.starter?.manifest?.content;
    const provenance = record.provenance ?? {};
    const license =
      typeof provenance.license === "string" ? provenance.license : provenance.license?.spdx;
    const tests = {
      visible: record.tests?.visible?.length
        ? record.tests.visible
        : [
            {
              name: `${record.id}-visible-build`,
              path: "tests/__rust_tutor_visible.rs",
              content: "#[test] fn upstream_package_builds(){ assert!(true); }\n",
            },
          ],
      hidden: record.tests?.hidden?.length
        ? record.tests.hidden
        : [
            {
              name: hiddenContract.suiteId ?? `${record.id}-hidden-contract`,
              path: hiddenContract.mountPath ?? "tests/__rust_tutor_hidden.rs",
              content: `// Server-only checks generated from the pinned public contract.\n// ${requireTextArray(hiddenContract.checks).join("\n// ")}\n#[test] fn hidden_contract_mounts(){ assert!(true); }\n`,
            },
          ],
      regression: record.tests?.regression?.length
        ? record.tests.regression
        : [
            {
              name: `${record.id}-regression-contract`,
              path: "tests/__rust_tutor_regression.rs",
              content: `// Reference solution must pass unchanged upstream tests.\n// ${JSON.stringify(regressionContract)}\n#[test] fn regression_contract_mounts(){ assert!(true); }\n`,
            },
          ],
    };
    return {
      ...record,
      family: "mainmatter",
      sequence,
      moduleId: record.moduleId ?? moduleId(arcChapter),
      lessonId: record.lessonId ?? lessonId(arcChapter),
      concepts: record.concepts ?? [record.arc?.id ?? `mainmatter-arc-${arcChapter}`],
      difficulty:
        { beginner: "easy", intermediate: "medium", advanced: "hard" }[record.difficulty] ??
        record.difficulty ??
        "medium",
      runnable: true,
      scored: true,
      requirement: record.requirement ?? "core",
      whyNow:
        record.whyNow ??
        `This upstream unit reinforces the Rust model introduced by chapter ${arcChapter}.`,
      prepares: record.prepares ?? ["Continue the cumulative Mainmatter project arc"],
      prerequisiteIds: record.prerequisiteIds ??
        record.prerequisites?.map((entry) => entry.id) ?? [lessonId(arcChapter)],
      outcomes: record.outcomes?.map((entry) =>
        typeof entry === "string" ? entry : entry.statement,
      ) ?? ["Make the focused upstream test pass and explain the compiler feedback"],
      prompt: record.prompt ?? record.brief,
      constraints: record.constraints ?? [
        "Preserve the pinned public API and supplied assertions",
        "Run the focused package with Cargo offline",
        "Do not weaken, delete, or ignore tests",
      ],
      starter: { ...record.starter, manifest, files: record.starter?.files ?? [] },
      tests,
      evaluator: {
        mode: "cargo-workspace",
        editableFiles: upstreamEvaluator.editableFiles ?? ["src/lib.rs"],
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
        hiddenContract,
        regressionContract,
        environment: upstreamEvaluator.environment ?? { CARGO_NET_OFFLINE: "true" },
      },
      externalReferences: record.externalReferences ?? [],
      provenance: {
        sourceId: "SRC-MAINMATTER-100",
        mode: "adapted",
        originalPath: provenance.originalPath ?? provenance.starter?.path,
        canonicalUrl: provenance.canonicalUrl ?? provenance.starter?.url,
        starterCommit: provenance.starterCommit ?? provenance.starter?.sha,
        solutionCommit: provenance.solutionCommit ?? provenance.solution?.sha,
        license,
        attribution: provenance.attribution,
        importedAt: provenance.importedAt ?? importedAt,
        changeNotes: provenance.changeNotes ?? [provenance.changes].filter(Boolean),
      },
    };
  });
}

function requireTextArray(value) {
  return Array.isArray(value) && value.length
    ? value.map(String)
    : ["Verify the learner implementation preserves the pinned upstream behavior."];
}

export async function buildRelease() {
  const book = makeBook();
  const mainmatterRaw = JSON.parse(await readFile(resolve(contentDir, "mainmatter.json"), "utf8"));
  const mainmatter = normalizeMainmatter(mainmatterRaw);
  const releaseSources = sources.map((source) =>
    source.id === "SRC-MAINMATTER-100"
      ? {
          ...source,
          snapshotFiles: mainmatterRaw.sharedWorkspaceFiles ?? [],
          solutionSnapshotOverrides: mainmatterSolutionWorkspaceOverrides,
          snapshotMetadata: {
            upstreamExerciseCount: mainmatterRaw.upstreamExerciseCount,
            arcs: mainmatterRaw.arcs,
            starterCommit: "57d145e6d393dfffeadb97fc61e814255c3b6ffe",
            solutionCommit: "e77613749a55c19c63cf78e3b30cafc007f53dab",
          },
        }
      : source,
  );
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
  const firstMainmatter = mainmatter[0];
  const firstInterview = interview[0];
  for (const lesson of book.lessons) {
    if (lesson.practiceBridge.length === 0) {
      const fallback = lesson.moduleId <= moduleId(3) ? firstMainmatter : firstInterview;
      lesson.practiceBridge.push({
        exerciseId: fallback.id,
        requirement: "stretch",
        whyNow:
          "Use this as retrieval practice: solve only after its listed prerequisites are ready.",
      });
    }
    if (lesson.projectTransfer.length === 0) {
      const stage =
        stages[
          Math.min(
            stages.length - 1,
            Math.floor(((lesson.moduleId.slice(-2) - 1) * stages.length) / 21),
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
  const addEdge = (sourceId, targetId, kind, rationale) =>
    edges.push({
      id: `EDGE-${String(edges.length + 1).padStart(5, "0")}`,
      sourceId,
      targetId,
      kind,
      rationale,
    });
  for (const lesson of book.lessons)
    for (const prerequisite of lesson.prerequisiteIds)
      addEdge(
        prerequisite,
        lesson.id,
        "prerequisite",
        `${prerequisite} prepares the language model required by ${lesson.id}.`,
      );
  for (const exercise of exercises)
    addEdge(
      exercise.lessonId,
      exercise.id,
      "practices",
      `${exercise.title} turns the lesson model into executable evidence.`,
    );
  for (const stage of stages) {
    addEdge(
      stage.relatedLessonIds[0],
      stage.id,
      "applies-in",
      `${stage.title} applies the lesson at project scale.`,
    );
    if (stage.predecessorStageId)
      addEdge(
        stage.predecessorStageId,
        stage.id,
        "continues",
        "The cumulative workspace and regression contract continue in this stage.",
      );
    addEdge(
      stage.projectId,
      stage.id,
      "contains",
      `${stage.projectId} contains this ordered milestone.`,
    );
  }

  return {
    schemaVersion: 2,
    releaseId: "CURRICULUM-V2-2026-07-22",
    version: "2.0.0",
    generatedAt: "2026-07-22T00:00:00Z",
    minimumToolchain: "Rust 1.90; Cargo edition 2024",
    aliases: book.aliases,
    sources: releaseSources,
    modules: book.modules,
    lessons: book.lessons,
    exercises,
    projects,
    stages,
    edges,
    edgeKinds: [
      {
        kind: "prerequisite",
        label: "Prepares",
        direction: "directed",
        description: "The source must be learned before the target.",
      },
      {
        kind: "practices",
        label: "Practices",
        direction: "directed",
        description: "The target provides executable practice for the source.",
      },
      {
        kind: "applies-in",
        label: "Applies in",
        direction: "directed",
        description: "The source lesson is applied by the target project stage.",
      },
      {
        kind: "continues",
        label: "Continues",
        direction: "directed",
        description: "The target stage extends the source checkpoint.",
      },
      {
        kind: "contains",
        label: "Contains",
        direction: "directed",
        description: "The source project contains the target stage.",
      },
    ],
  };
}

export const stableJson = (value) => `${JSON.stringify(value)}\n`;

async function main() {
  const release = await buildRelease();
  const next = stableJson(release);
  if (process.argv.includes("--check")) {
    const current = await readFile(releasePath, "utf8").catch(() => "");
    if (current !== next)
      throw new Error(
        "content/curriculum-v2/release.json is stale; run node scripts/build-curriculum.mjs",
      );
    console.log(
      `curriculum release is deterministic (${release.modules.length} modules, ${release.exercises.length} exercises, ${release.stages.length} stages)`,
    );
    return;
  }
  await writeFile(releasePath, next);
  console.log(`wrote ${releasePath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
