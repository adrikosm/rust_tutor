// Reference library: the curated set of openly licensed Rust books, references,
// and exercise repositories this tutor points learners at.
//
// Nothing here republishes upstream prose. Each entry stores identity, license,
// and a stable deep link, plus locally authored "why read this now" guidance.
// That keeps the content contract (see docs/contributing/content-license-checklist.md)
// at "link-only" for every third-party work in this file.

/** @typedef {{id:string,title:string,author:string,url:string,repo?:string,license:string,use:"link-only",kind:string,level:"foundation"|"intermediate"|"advanced"|"reference"|"practice",blurb:string}} LibraryEntry */

/** @type {LibraryEntry[]} */
export const referenceLibraries = [
  {
    id: "LIB-BOOK",
    title: "The Rust Programming Language",
    author: "The Rust Project Developers",
    url: "https://doc.rust-lang.org/book/",
    repo: "https://github.com/rust-lang/book",
    license: "MIT OR Apache-2.0",
    use: "link-only",
    kind: "book",
    level: "foundation",
    blurb:
      "The canonical guided tour. This curriculum follows its chapter order so every module has an authoritative long-form counterpart.",
  },
  {
    id: "LIB-RBE",
    title: "Rust by Example",
    author: "The Rust Project Developers",
    url: "https://doc.rust-lang.org/rust-by-example/",
    repo: "https://github.com/rust-lang/rust-by-example",
    license: "MIT OR Apache-2.0",
    use: "link-only",
    kind: "book",
    level: "foundation",
    blurb:
      "Runnable snippets for the same concepts. Use it when you want to see the shape of the code before reading the argument for it.",
  },
  {
    id: "LIB-RUSTLINGS",
    title: "Rustlings",
    author: "The Rust Project Developers",
    url: "https://rustlings.rust-lang.org/",
    repo: "https://github.com/rust-lang/rustlings",
    license: "MIT",
    use: "link-only",
    kind: "exercises",
    level: "practice",
    blurb:
      "Small compiler-error-driven fixes. Closest external analogue to this app's terminal work; good for extra repetitions.",
  },
  {
    id: "LIB-STD",
    title: "The Rust Standard Library",
    author: "The Rust Project Developers",
    url: "https://doc.rust-lang.org/std/",
    license: "MIT OR Apache-2.0",
    use: "link-only",
    kind: "api",
    level: "reference",
    blurb:
      "Primary API reference. Every collection, trait, and guarantee named in a lesson is specified here first.",
  },
  {
    id: "LIB-REFERENCE",
    title: "The Rust Reference",
    author: "The Rust Project Developers",
    url: "https://doc.rust-lang.org/reference/",
    repo: "https://github.com/rust-lang/reference",
    license: "MIT OR Apache-2.0",
    use: "link-only",
    kind: "specification",
    level: "reference",
    blurb:
      "Language-level specification. Reach for it when you need the rule rather than an explanation of the rule.",
  },
  {
    id: "LIB-ERROR-INDEX",
    title: "The rustc Error Index",
    author: "The Rust Project Developers",
    url: "https://doc.rust-lang.org/error_codes/",
    license: "MIT OR Apache-2.0",
    use: "link-only",
    kind: "reference",
    level: "reference",
    blurb:
      "One page per E-code with a minimal reproduction and repair. The compiler-error nodes in the concept map link straight here.",
  },
  {
    id: "LIB-CARGO",
    title: "The Cargo Book",
    author: "The Rust Project Developers",
    url: "https://doc.rust-lang.org/cargo/",
    repo: "https://github.com/rust-lang/cargo",
    license: "MIT OR Apache-2.0",
    use: "link-only",
    kind: "tooling",
    level: "reference",
    blurb:
      "Manifest keys, profiles, workspaces, features, and publishing. The authority behind every cargo command this app runs.",
  },
  {
    id: "LIB-EDITION",
    title: "The Edition Guide",
    author: "The Rust Project Developers",
    url: "https://doc.rust-lang.org/edition-guide/",
    license: "MIT OR Apache-2.0",
    use: "link-only",
    kind: "reference",
    level: "reference",
    blurb:
      "What changed across 2015/2018/2021/2024. Read it before trusting an older blog post or Stack Overflow answer.",
  },
  {
    id: "LIB-COMPREHENSIVE",
    title: "Comprehensive Rust",
    author: "Google",
    url: "https://google.github.io/comprehensive-rust/",
    repo: "https://github.com/google/comprehensive-rust",
    license: "Apache-2.0",
    use: "link-only",
    kind: "course",
    level: "foundation",
    blurb:
      "A dense multi-day course with speaker notes, plus bare-metal, Android, and Chromium tracks the Book never covers.",
  },
  {
    id: "LIB-COOKBOOK",
    title: "The Rust Cookbook",
    author: "The Rust Project Developers",
    url: "https://rust-lang-nursery.github.io/rust-cookbook/",
    repo: "https://github.com/rust-lang-nursery/rust-cookbook",
    license: "CC0-1.0",
    use: "link-only",
    kind: "recipes",
    level: "intermediate",
    blurb:
      "Task-shaped recipes using well-known crates. Useful once you know the language and need the ecosystem's default answer.",
  },
  {
    id: "LIB-PATTERNS",
    title: "Rust Design Patterns",
    author: "rust-unofficial",
    url: "https://rust-unofficial.github.io/patterns/",
    repo: "https://github.com/rust-unofficial/patterns",
    license: "MPL-2.0",
    use: "link-only",
    kind: "book",
    level: "intermediate",
    blurb:
      "Idioms, patterns, and named anti-patterns. The vocabulary layer between 'it compiles' and 'a reviewer would accept it'.",
  },
  {
    id: "LIB-EFFECTIVE",
    title: "Effective Rust",
    author: "David Drysdale",
    url: "https://effective-rust.com/",
    license: "CC-BY-NC-ND-4.0",
    use: "link-only",
    kind: "book",
    level: "intermediate",
    blurb:
      "Thirty-five specific pieces of advice on types, traits, dependencies, and tooling. Commercially published, so this app links to it and never reproduces it.",
  },
  {
    id: "LIB-API-GUIDELINES",
    title: "Rust API Guidelines",
    author: "The Rust Library Team",
    url: "https://rust-lang.github.io/api-guidelines/",
    repo: "https://github.com/rust-lang/api-guidelines",
    license: "MIT OR Apache-2.0",
    use: "link-only",
    kind: "checklist",
    level: "intermediate",
    blurb:
      "The checklist library authors are held to: naming, interoperability, flexibility, future proofing.",
  },
  {
    id: "LIB-NOMICON",
    title: "The Rustonomicon",
    author: "The Rust Project Developers",
    url: "https://doc.rust-lang.org/nomicon/",
    repo: "https://github.com/rust-lang/nomicon",
    license: "MIT OR Apache-2.0",
    use: "link-only",
    kind: "book",
    level: "advanced",
    blurb:
      "The dark arts of unsafe Rust: aliasing, variance, drop order, and the invariants you now have to uphold by hand.",
  },
  {
    id: "LIB-TOO-MANY-LISTS",
    title: "Learn Rust With Entirely Too Many Linked Lists",
    author: "Aria Beingessner",
    url: "https://rust-unofficial.github.io/too-many-lists/",
    repo: "https://github.com/rust-unofficial/too-many-lists",
    license: "MIT",
    use: "link-only",
    kind: "book",
    level: "advanced",
    blurb:
      "The best available treatment of ownership under pressure. Work it after Chapter 15; it turns smart pointers into muscle memory.",
  },
  {
    id: "LIB-ATOMICS",
    title: "Rust Atomics and Locks",
    author: "Mara Bos",
    url: "https://mara.nl/atomics/",
    license: "CC-BY-NC-ND-4.0",
    use: "link-only",
    kind: "book",
    level: "advanced",
    blurb:
      "Free online edition covering memory ordering, building your own locks, and what the OS actually does underneath.",
  },
  {
    id: "LIB-ASYNC",
    title: "Asynchronous Programming in Rust",
    author: "The Rust Project Developers",
    url: "https://rust-lang.github.io/async-book/",
    repo: "https://github.com/rust-lang/async-book",
    license: "MIT",
    use: "link-only",
    kind: "book",
    level: "advanced",
    blurb:
      "Futures, executors, pinning, and cancellation from first principles rather than from one runtime's API surface.",
  },
  {
    id: "LIB-TOKIO",
    title: "Tokio Tutorial",
    author: "The Tokio Contributors",
    url: "https://tokio.rs/tokio/tutorial",
    repo: "https://github.com/tokio-rs/website",
    license: "MIT",
    use: "link-only",
    kind: "tutorial",
    level: "advanced",
    blurb:
      "The concrete counterpart to the async book: tasks, channels, select, shared state, and graceful shutdown in a real runtime.",
  },
  {
    id: "LIB-MACROS",
    title: "The Little Book of Rust Macros",
    author: "Veykril (community edition)",
    url: "https://veykril.github.io/tlborm/",
    repo: "https://github.com/veykril/tlborm",
    license: "MIT",
    use: "link-only",
    kind: "book",
    level: "advanced",
    blurb:
      "macro_rules! from fragment specifiers to hygiene, then the bridge into procedural macros.",
  },
  {
    id: "LIB-PERF",
    title: "The Rust Performance Book",
    author: "Nicholas Nethercote",
    url: "https://nnethercote.github.io/perf-book/",
    repo: "https://github.com/nnethercote/perf-book",
    license: "MIT OR Apache-2.0",
    use: "link-only",
    kind: "book",
    level: "advanced",
    blurb:
      "Profiling first, then measured wins: allocation, hashing, bounds checks, build configuration, and benchmarking discipline.",
  },
  {
    id: "LIB-RUST-QUIZ",
    title: "Rust Quiz",
    author: "David Tolnay",
    url: "https://dtolnay.github.io/rust-quiz/",
    repo: "https://github.com/dtolnay/rust-quiz",
    license: "CC-BY-SA-4.0",
    use: "link-only",
    kind: "quiz",
    level: "advanced",
    blurb:
      "Short programs with surprising output and a full explanation. Excellent calibration for how well you actually read Rust.",
  },
  {
    id: "LIB-ALGORITHMS",
    title: "TheAlgorithms / Rust",
    author: "TheAlgorithms community",
    url: "https://github.com/TheAlgorithms/Rust",
    repo: "https://github.com/TheAlgorithms/Rust",
    license: "MIT",
    use: "link-only",
    kind: "code",
    level: "practice",
    blurb:
      "Reference implementations for classic algorithms in idiomatic-ish Rust. Compare against your own after you have solved a pattern.",
  },
  {
    id: "LIB-EXERCISM",
    title: "Exercism Rust Track",
    author: "Exercism",
    url: "https://exercism.org/tracks/rust",
    repo: "https://github.com/exercism/rust",
    license: "MIT",
    use: "link-only",
    kind: "exercises",
    level: "practice",
    blurb:
      "Around a hundred graded exercises with published community solutions — the widest source of alternative idiom for a solved problem.",
  },
];

const libraryById = new Map(referenceLibraries.map((entry) => [entry.id, entry]));

/**
 * Chapter-scoped further reading. Each row is
 * [libraryId, section title, deep link, locally authored reason to read it now].
 */
const chapterReading = {
  1: [
    [
      "LIB-RBE",
      "Hello World",
      "https://doc.rust-lang.org/rust-by-example/hello.html",
      "The same first program with every line annotated.",
    ],
    [
      "LIB-CARGO",
      "Why Cargo Exists",
      "https://doc.rust-lang.org/cargo/guide/why-cargo-exists.html",
      "Explains what cargo new actually buys you before you build habits around it.",
    ],
    [
      "LIB-COMPREHENSIVE",
      "Welcome to Comprehensive Rust",
      "https://google.github.io/comprehensive-rust/",
      "A second, faster on-ramp if the Book's pace feels slow.",
    ],
  ],
  2: [
    [
      "LIB-RBE",
      "Standard Library Types",
      "https://doc.rust-lang.org/rust-by-example/std.html",
      "The types the guessing game leans on, isolated one at a time.",
    ],
    [
      "LIB-STD",
      "std::io::stdin",
      "https://doc.rust-lang.org/std/io/fn.stdin.html",
      "Read the actual signature you are calling instead of copying the call.",
    ],
    [
      "LIB-CARGO",
      "Dependencies",
      "https://doc.rust-lang.org/cargo/guide/dependencies.html",
      "What adding rand to Cargo.toml commits you to.",
    ],
  ],
  3: [
    [
      "LIB-RBE",
      "Primitives",
      "https://doc.rust-lang.org/rust-by-example/primitives.html",
      "Integer, float, and tuple behaviour with runnable edge cases.",
    ],
    [
      "LIB-REFERENCE",
      "Expressions",
      "https://doc.rust-lang.org/reference/expressions.html",
      "The rule that makes if and match expressions rather than statements.",
    ],
    [
      "LIB-RUSTLINGS",
      "variables & functions",
      "https://github.com/rust-lang/rustlings",
      "Extra repetitions on exactly these constructs, compiler-first.",
    ],
  ],
  4: [
    [
      "LIB-RBE",
      "Scoping rules",
      "https://doc.rust-lang.org/rust-by-example/scope.html",
      "RAII, moves, borrows, and lifetimes shown as short programs.",
    ],
    [
      "LIB-ERROR-INDEX",
      "E0382: use of moved value",
      "https://doc.rust-lang.org/error_codes/E0382.html",
      "The error you will meet most this chapter, with its minimal repro.",
    ],
    [
      "LIB-COMPREHENSIVE",
      "Memory Management",
      "https://google.github.io/comprehensive-rust/memory-management.html",
      "Stack/heap diagrams that make the move rule concrete.",
    ],
    [
      "LIB-NOMICON",
      "Ownership and Lifetimes",
      "https://doc.rust-lang.org/nomicon/ownership.html",
      "Stretch reading: why the rule exists, stated as an aliasing invariant.",
    ],
  ],
  5: [
    [
      "LIB-RBE",
      "Structures",
      "https://doc.rust-lang.org/rust-by-example/custom_types/structs.html",
      "Tuple, unit, and named structs side by side.",
    ],
    [
      "LIB-API-GUIDELINES",
      "Naming",
      "https://rust-lang.github.io/api-guidelines/naming.html",
      "Name constructors and accessors the way the ecosystem expects from day one.",
    ],
    [
      "LIB-STD",
      "Derivable traits",
      "https://doc.rust-lang.org/std/index.html#primitives",
      "What each #[derive] actually generates and requires.",
    ],
  ],
  6: [
    [
      "LIB-RBE",
      "Enums",
      "https://doc.rust-lang.org/rust-by-example/custom_types/enum.html",
      "Data-carrying variants and match ergonomics in small programs.",
    ],
    [
      "LIB-STD",
      "Option",
      "https://doc.rust-lang.org/std/option/enum.Option.html",
      "The combinator list is the real lesson; read it once end to end.",
    ],
    [
      "LIB-PATTERNS",
      "Idioms",
      "https://rust-unofficial.github.io/patterns/idioms/index.html",
      "How experienced Rust uses enums instead of booleans and flags.",
    ],
    [
      "LIB-EFFECTIVE",
      "Item 1: Use the type system to express your data structures",
      "https://effective-rust.com/use-types.html",
      "Why an enum beats a bool plus a comment, argued in production terms.",
    ],
  ],
  7: [
    [
      "LIB-RBE",
      "Modules",
      "https://doc.rust-lang.org/rust-by-example/mod.html",
      "Visibility and paths demonstrated rather than described.",
    ],
    [
      "LIB-CARGO",
      "Package Layout",
      "https://doc.rust-lang.org/cargo/guide/project-layout.html",
      "The conventional directory shape Cargo assumes without being told.",
    ],
    [
      "LIB-API-GUIDELINES",
      "Future proofing",
      "https://rust-lang.github.io/api-guidelines/future-proofing.html",
      "Why pub is a commitment, not a convenience.",
    ],
  ],
  8: [
    [
      "LIB-STD",
      "std::collections",
      "https://doc.rust-lang.org/std/collections/index.html",
      "The selection guide at the top of this page is the whole chapter, compressed.",
    ],
    [
      "LIB-RBE",
      "Vectors",
      "https://doc.rust-lang.org/rust-by-example/std/vec.html",
      "Growth, indexing, and iteration with runnable examples.",
    ],
    [
      "LIB-PERF",
      "Collections",
      "https://nnethercote.github.io/perf-book/collections.html",
      "The allocation costs behind the convenience.",
    ],
  ],
  9: [
    [
      "LIB-RBE",
      "Error handling",
      "https://doc.rust-lang.org/rust-by-example/error.html",
      "panic, Option, Result, and ? built up in order.",
    ],
    [
      "LIB-ERROR-INDEX",
      "E0277: trait not satisfied",
      "https://doc.rust-lang.org/error_codes/E0277.html",
      "The error ? produces when your error types do not line up yet.",
    ],
    [
      "LIB-PATTERNS",
      "Anti-patterns: unwrap",
      "https://rust-unofficial.github.io/patterns/anti_patterns/index.html",
      "Where unwrap is fine and where it is a latent outage.",
    ],
    [
      "LIB-API-GUIDELINES",
      "Interoperability",
      "https://rust-lang.github.io/api-guidelines/interoperability.html",
      "Implement std::error::Error properly so callers can compose your failures.",
    ],
  ],
  10: [
    [
      "LIB-RBE",
      "Generics",
      "https://doc.rust-lang.org/rust-by-example/generics.html",
      "Bounds, where clauses, and associated items as short programs.",
    ],
    [
      "LIB-REFERENCE",
      "Lifetime elision",
      "https://doc.rust-lang.org/reference/lifetime-elision.html",
      "The exact three rules the compiler applies before it asks you for annotations.",
    ],
    [
      "LIB-ERROR-INDEX",
      "E0106: missing lifetime specifier",
      "https://doc.rust-lang.org/error_codes/E0106.html",
      "Read the repair pattern once and this error stops being mysterious.",
    ],
    [
      "LIB-NOMICON",
      "Subtyping and Variance",
      "https://doc.rust-lang.org/nomicon/subtyping.html",
      "Stretch reading for why some lifetime errors resist the obvious fix.",
    ],
  ],
  11: [
    [
      "LIB-RBE",
      "Testing",
      "https://doc.rust-lang.org/rust-by-example/testing.html",
      "Unit, integration, and doc tests with their directory conventions.",
    ],
    [
      "LIB-CARGO",
      "cargo test",
      "https://doc.rust-lang.org/cargo/commands/cargo-test.html",
      "Filters, --nocapture, and harness flags you will use constantly.",
    ],
    [
      "LIB-API-GUIDELINES",
      "Documentation",
      "https://rust-lang.github.io/api-guidelines/documentation.html",
      "Doc examples are tests; write them as evidence, not decoration.",
    ],
  ],
  12: [
    [
      "LIB-COOKBOOK",
      "Command line",
      "https://rust-lang-nursery.github.io/rust-cookbook/cli.html",
      "Argument parsing and ANSI output the way the ecosystem does it.",
    ],
    [
      "LIB-STD",
      "std::process::exit",
      "https://doc.rust-lang.org/std/process/fn.exit.html",
      "Exit codes are part of a CLI's contract with the shell.",
    ],
    [
      "LIB-PATTERNS",
      "Structuring a CLI",
      "https://rust-unofficial.github.io/patterns/patterns/index.html",
      "Separating parse, run, and report so the program stays testable.",
    ],
  ],
  13: [
    [
      "LIB-RBE",
      "Iterators",
      "https://doc.rust-lang.org/rust-by-example/trait/iter.html",
      "Implementing Iterator by hand before leaning on adapters.",
    ],
    [
      "LIB-STD",
      "Iterator",
      "https://doc.rust-lang.org/std/iter/trait.Iterator.html",
      "The full adapter and consumer list; laziness is stated per method.",
    ],
    [
      "LIB-PERF",
      "Iterators",
      "https://nnethercote.github.io/perf-book/iterators.html",
      "When an adapter chain is free and when it is not.",
    ],
    [
      "LIB-RUST-QUIZ",
      "Closure captures",
      "https://dtolnay.github.io/rust-quiz/",
      "Calibrate whether you actually predict capture modes correctly.",
    ],
  ],
  14: [
    [
      "LIB-CARGO",
      "Workspaces",
      "https://doc.rust-lang.org/cargo/reference/workspaces.html",
      "The multi-crate layout this tutor itself uses.",
    ],
    [
      "LIB-CARGO",
      "Features",
      "https://doc.rust-lang.org/cargo/reference/features.html",
      "Additive features and the unification rule that surprises everyone once.",
    ],
    [
      "LIB-API-GUIDELINES",
      "Necessities",
      "https://rust-lang.github.io/api-guidelines/necessities.html",
      "License, metadata, and docs.rs requirements before you publish anything.",
    ],
  ],
  15: [
    [
      "LIB-TOO-MANY-LISTS",
      "A Bad Stack",
      "https://rust-unofficial.github.io/too-many-lists/first.html",
      "The single best exercise for Box, Option, and ownership under pressure.",
    ],
    [
      "LIB-STD",
      "Rc",
      "https://doc.rust-lang.org/std/rc/struct.Rc.html",
      "Read the cycle warning and Weak section, not just the constructor.",
    ],
    [
      "LIB-NOMICON",
      "Drop Check",
      "https://doc.rust-lang.org/nomicon/dropck.html",
      "Why drop order is a type-system concern and not merely a convention.",
    ],
  ],
  16: [
    [
      "LIB-ATOMICS",
      "Basics of Rust Concurrency",
      "https://marabos.nl/atomics/basics.html",
      "Threads, scoped threads, and shared ownership stated precisely.",
    ],
    [
      "LIB-ATOMICS",
      "Memory Ordering",
      "https://marabos.nl/atomics/memory-ordering.html",
      "The chapter that turns 'use Ordering::SeqCst' into an actual decision.",
    ],
    [
      "LIB-STD",
      "Send and Sync",
      "https://doc.rust-lang.org/std/marker/trait.Send.html",
      "The two markers behind almost every concurrency compile error you will hit.",
    ],
    [
      "LIB-ERROR-INDEX",
      "E0373: closure may outlive",
      "https://doc.rust-lang.org/error_codes/E0373.html",
      "The spawn error, and why move is the honest fix.",
    ],
  ],
  17: [
    [
      "LIB-ASYNC",
      "Under the Hood: Executing Futures",
      "https://rust-lang.github.io/async-book/02_execution/01_chapter.html",
      "Build the mental model of poll and wake before using any runtime.",
    ],
    [
      "LIB-TOKIO",
      "Shared state",
      "https://tokio.rs/tokio/tutorial/shared-state",
      "How async and locks interact once tasks outlive a single scope.",
    ],
    [
      "LIB-TOKIO",
      "Graceful shutdown",
      "https://tokio.rs/tokio/tutorial/graceful-shutdown",
      "Cancellation is a design decision; this shows the standard shape.",
    ],
    [
      "LIB-STD",
      "std::future::Future",
      "https://doc.rust-lang.org/std/future/trait.Future.html",
      "The whole trait is four lines; read them once and async demystifies.",
    ],
  ],
  18: [
    [
      "LIB-PATTERNS",
      "Newtype",
      "https://rust-unofficial.github.io/patterns/patterns/behavioural/newtype.html",
      "The Rust answer to a class hierarchy you were about to reach for.",
    ],
    [
      "LIB-REFERENCE",
      "Trait objects",
      "https://doc.rust-lang.org/reference/types/trait-object.html",
      "Object safety stated as rules rather than as compiler complaints.",
    ],
    [
      "LIB-ERROR-INDEX",
      "E0038: not object safe",
      "https://doc.rust-lang.org/error_codes/E0038.html",
      "Exactly which trait shapes cannot become dyn Trait.",
    ],
  ],
  19: [
    [
      "LIB-REFERENCE",
      "Patterns",
      "https://doc.rust-lang.org/reference/patterns.html",
      "The complete pattern grammar, including the forms the Book skips.",
    ],
    [
      "LIB-RBE",
      "match",
      "https://doc.rust-lang.org/rust-by-example/flow_control/match.html",
      "Guards, bindings, and destructuring as runnable examples.",
    ],
    [
      "LIB-RUST-QUIZ",
      "Pattern binding modes",
      "https://dtolnay.github.io/rust-quiz/",
      "Match ergonomics are where confident readers still get it wrong.",
    ],
  ],
  20: [
    [
      "LIB-MACROS",
      "macro_rules!",
      "https://veykril.github.io/tlborm/decl-macros.html",
      "Fragment specifiers, repetition, and hygiene done properly.",
    ],
    [
      "LIB-NOMICON",
      "Meet Safe and Unsafe",
      "https://doc.rust-lang.org/nomicon/meet-safe-and-unsafe.html",
      "What unsafe actually turns off, which is less than most people assume.",
    ],
    [
      "LIB-REFERENCE",
      "Type coercions",
      "https://doc.rust-lang.org/reference/type-coercions.html",
      "Deref coercion and the other implicit conversions behind 'advanced' errors.",
    ],
    [
      "LIB-ERROR-INDEX",
      "E0133: unsafe operation",
      "https://doc.rust-lang.org/error_codes/E0133.html",
      "The obligation you take on the moment you write unsafe.",
    ],
  ],
  21: [
    [
      "LIB-TOO-MANY-LISTS",
      "An Ok Unsafe Queue",
      "https://rust-unofficial.github.io/too-many-lists/fifth.html",
      "A capstone in reasoning about aliasing while something still has to work.",
    ],
    [
      "LIB-PERF",
      "Profiling",
      "https://nnethercote.github.io/perf-book/profiling.html",
      "Measure the server before tuning the thread pool.",
    ],
    [
      "LIB-TOKIO",
      "Tokio tutorial",
      "https://tokio.rs/tokio/tutorial",
      "The async counterpart to the Book's thread-pool server.",
    ],
  ],
};

/** Always-available companions, appended to every lesson. */
const standingReading = [
  [
    "LIB-BOOK",
    "The Rust Programming Language",
    "https://doc.rust-lang.org/book/",
    "The long-form chapter this lesson compresses.",
  ],
  [
    "LIB-ERROR-INDEX",
    "The rustc Error Index",
    "https://doc.rust-lang.org/error_codes/",
    "Look up any E-code the terminal prints instead of guessing at it.",
  ],
];

/**
 * Further reading for a Book chapter, resolved against the library catalog.
 * @param {number} chapter
 */
export function furtherReadingFor(chapter) {
  const rows = [...(chapterReading[chapter] ?? []), ...standingReading];
  const seen = new Set();
  const readings = [];
  for (const [libraryId, title, url, why] of rows) {
    const entry = libraryById.get(libraryId);
    if (!entry || seen.has(url)) continue;
    seen.add(url);
    readings.push({
      libraryId,
      library: entry.title,
      title,
      url,
      why,
      license: entry.license,
      level: entry.level,
    });
  }
  return readings;
}

export function libraryCatalog() {
  return referenceLibraries.map((entry) => ({ ...entry }));
}
