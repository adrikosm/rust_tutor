/**
 * Per-chapter companions for the from-zero course, and ordered learning paths
 * through the reference library.
 *
 * Every row cites a library entry by ID (validated in course-companions.test.ts)
 * and stores only a deep link plus a locally authored reason to open it now.
 * Nothing upstream is republished.
 */

export type Companion = {
  libraryId: string;
  title: string;
  url: string;
  why: string;
  /** "read" explains; "drill" gives extra repetitions; "check" tests you. */
  mode: "read" | "drill" | "check";
};

const book = (path: string) => `https://doc.rust-lang.org/book/${path}`;
const brown = (path: string) => `https://rust-book.cs.brown.edu/${path}`;
const rbe = (path: string) => `https://doc.rust-lang.org/rust-by-example/${path}`;
const rustlings = (dir: string) =>
  `https://github.com/rust-lang/rustlings/tree/main/exercises/${dir}`;
const std = (path: string) => `https://doc.rust-lang.org/std/${path}`;
const errorCode = (code: string) => `https://doc.rust-lang.org/error_codes/${code}.html`;

export const chapterCompanions: Record<string, Companion[]> = {
  "hello-rust": [
    {
      libraryId: "LIB-BOOK",
      title: "Getting Started",
      url: book("ch01-00-getting-started.html"),
      why: "Installation, Hello World, and Cargo in the canonical long form.",
      mode: "read",
    },
    {
      libraryId: "LIB-RBE",
      title: "Hello World",
      url: rbe("hello.html"),
      why: "The same first program with formatted printing explored line by line.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "00_intro",
      url: rustlings("00_intro"),
      why: "Set up the compiler-driven exercise loop you can use alongside every chapter.",
      mode: "drill",
    },
    {
      libraryId: "LIB-PLAYGROUND",
      title: "Rust Playground",
      url: "https://play.rust-lang.org/",
      why: "A zero-install place to try a one-line change when you are away from this app.",
      mode: "drill",
    },
  ],
  variables: [
    {
      libraryId: "LIB-BOOK",
      title: "Variables and Mutability",
      url: book("ch03-01-variables-and-mutability.html"),
      why: "Constants, shadowing, and mut with the Book's worked compiler errors.",
      mode: "read",
    },
    {
      libraryId: "LIB-RBE",
      title: "Variable Bindings",
      url: rbe("variable_bindings.html"),
      why: "Mutability, scope, shadowing, and freezing as tiny runnable programs.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "01_variables",
      url: rustlings("01_variables"),
      why: "Six fix-the-compiler-error drills on exactly this chapter.",
      mode: "drill",
    },
    {
      libraryId: "LIB-ERROR-INDEX",
      title: "E0384: assign twice to immutable variable",
      url: errorCode("E0384"),
      why: "The first error this chapter trains you to read.",
      mode: "read",
    },
  ],
  types: [
    {
      libraryId: "LIB-BOOK",
      title: "Data Types",
      url: book("ch03-02-data-types.html"),
      why: "Integer widths, overflow behaviour, floats, chars, tuples, and arrays.",
      mode: "read",
    },
    {
      libraryId: "LIB-RBE",
      title: "Primitives",
      url: rbe("primitives.html"),
      why: "Literal suffixes, operators, tuples, and arrays with edge cases to run.",
      mode: "read",
    },
    {
      libraryId: "LIB-RBE",
      title: "Casting",
      url: rbe("types/cast.html"),
      why: "Exactly what `as` does when a value does not fit — including the surprising cases.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "04_primitive_types",
      url: rustlings("04_primitive_types"),
      why: "Arrays, slices, and tuples as quick compiler-checked repetitions.",
      mode: "drill",
    },
  ],
  "functions-flow": [
    {
      libraryId: "LIB-BOOK",
      title: "Functions",
      url: book("ch03-03-how-functions-work.html"),
      why: "Statements versus expressions — the rule behind every missing-semicolon bug.",
      mode: "read",
    },
    {
      libraryId: "LIB-BOOK",
      title: "Control Flow",
      url: book("ch03-05-control-flow.html"),
      why: "if as an expression, loop labels, and returning values from loop.",
      mode: "read",
    },
    {
      libraryId: "LIB-RBE",
      title: "Flow of Control",
      url: rbe("flow_control.html"),
      why: "Loop labels, for with ranges, and while let in isolation.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "02_functions and 03_if",
      url: rustlings("02_functions"),
      why: "Signature and return-expression drills; continue straight into 03_if.",
      mode: "drill",
    },
  ],
  ownership: [
    {
      libraryId: "LIB-BROWN-BOOK",
      title: "What Is Ownership? (with quizzes)",
      url: brown("ch04-01-what-is-ownership.html"),
      why: "The research edition's stack/heap diagrams and embedded quizzes — the best-studied ownership explanation available.",
      mode: "check",
    },
    {
      libraryId: "LIB-RUST-BY-PRACTICE",
      title: "Ownership",
      url: "https://practice.rs/ownership/ownership.html",
      why: "Fix-the-move exercises that force you to choose between clone, borrow, and restructure.",
      mode: "drill",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "06_move_semantics",
      url: rustlings("06_move_semantics"),
      why: "Five compiler-led drills on moves into functions and back out.",
      mode: "drill",
    },
    {
      libraryId: "LIB-ERROR-INDEX",
      title: "E0382: use of moved value",
      url: errorCode("E0382"),
      why: "The error you will meet most this chapter, with its minimal reproduction.",
      mode: "read",
    },
  ],
  borrowing: [
    {
      libraryId: "LIB-BROWN-BOOK",
      title: "References and Borrowing (permissions model)",
      url: brown("ch04-02-references-and-borrowing.html"),
      why: "Read/write/own permissions make the borrow rules predictable instead of memorised.",
      mode: "check",
    },
    {
      libraryId: "LIB-RUST-BY-PRACTICE",
      title: "Reference and Borrowing",
      url: "https://practice.rs/ownership/borrowing.html",
      why: "Short exercises mixing shared and mutable borrows until the rule is automatic.",
      mode: "drill",
    },
    {
      libraryId: "LIB-ERROR-INDEX",
      title: "E0502: cannot borrow as mutable because it is also borrowed as immutable",
      url: errorCode("E0502"),
      why: "The aliasing-XOR-mutation rule stated as a compiler error.",
      mode: "read",
    },
    {
      libraryId: "LIB-ERROR-INDEX",
      title: "E0499: cannot borrow as mutable more than once",
      url: errorCode("E0499"),
      why: "The other half of the rule, with the standard repairs.",
      mode: "read",
    },
  ],
  "slices-strings": [
    {
      libraryId: "LIB-BOOK",
      title: "The Slice Type",
      url: book("ch04-03-slices.html"),
      why: "Why first_word returns &str and how that prevents a use-after-clear bug.",
      mode: "read",
    },
    {
      libraryId: "LIB-BOOK",
      title: "Storing UTF-8 Encoded Text with Strings",
      url: book("ch08-02-strings.html"),
      why: "Bytes versus chars versus grapheme clusters — why s[0] does not compile.",
      mode: "read",
    },
    {
      libraryId: "LIB-STD",
      title: "primitive str",
      url: std("primitive.str.html"),
      why: "Every str method you will actually use: split, trim, find, char_indices.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "09_strings",
      url: rustlings("09_strings"),
      why: "String versus &str conversion drills.",
      mode: "drill",
    },
  ],
  structs: [
    {
      libraryId: "LIB-BOOK",
      title: "Using Structs to Structure Related Data",
      url: book("ch05-00-structs.html"),
      why: "Field init shorthand, update syntax, and method receivers.",
      mode: "read",
    },
    {
      libraryId: "LIB-RBE",
      title: "Structures",
      url: rbe("custom_types/structs.html"),
      why: "Tuple, unit, and named structs side by side.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "07_structs",
      url: rustlings("07_structs"),
      why: "Struct definition and method drills.",
      mode: "drill",
    },
    {
      libraryId: "LIB-API-GUIDELINES",
      title: "Naming",
      url: "https://rust-lang.github.io/api-guidelines/naming.html",
      why: "Name constructors, getters, and conversions the way the ecosystem expects.",
      mode: "read",
    },
  ],
  "enums-matching": [
    {
      libraryId: "LIB-BOOK",
      title: "Enums and Pattern Matching",
      url: book("ch06-00-enums.html"),
      why: "Option, match exhaustiveness, and if let from the source.",
      mode: "read",
    },
    {
      libraryId: "LIB-BROWN-BOOK",
      title: "Ownership Inventory #1",
      url: brown("ch06-04-inventory.html"),
      why: "Real-world ownership scenarios from StackOverflow questions — a cumulative check of chapters 5–9 here.",
      mode: "check",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "08_enums and 12_options",
      url: rustlings("08_enums"),
      why: "Variant, match, and Option drills; 12_options continues the thread.",
      mode: "drill",
    },
    {
      libraryId: "LIB-ERROR-INDEX",
      title: "E0004: non-exhaustive patterns",
      url: errorCode("E0004"),
      why: "Exhaustiveness is a checklist; this is the error that reads it to you.",
      mode: "read",
    },
  ],
  collections: [
    {
      libraryId: "LIB-BOOK",
      title: "Common Collections",
      url: book("ch08-00-common-collections.html"),
      why: "Vec, String, and HashMap with the borrowing rules applied to each.",
      mode: "read",
    },
    {
      libraryId: "LIB-STD",
      title: "std::collections — when to use which collection",
      url: std("collections/index.html"),
      why: "The selection guide at the top of this page is the whole chapter, compressed.",
      mode: "read",
    },
    {
      libraryId: "LIB-BROWN-BOOK",
      title: "Ownership Inventory #2",
      url: brown("ch08-04-inventory.html"),
      why: "Collections-heavy ownership scenarios that test transfer, not recall.",
      mode: "check",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "05_vecs and 11_hashmaps",
      url: rustlings("11_hashmaps"),
      why: "Entry-API and iteration drills.",
      mode: "drill",
    },
  ],
  errors: [
    {
      libraryId: "LIB-BOOK",
      title: "Error Handling",
      url: book("ch09-00-error-handling.html"),
      why: "panic versus Result, the ? operator, and the 'to panic or not' guidance.",
      mode: "read",
    },
    {
      libraryId: "LIB-RBE",
      title: "Error handling",
      url: rbe("error.html"),
      why: "Option combinators, boxing errors, and wrapping errors — the patterns real crates use.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "13_error_handling",
      url: rustlings("13_error_handling"),
      why: "Six drills from unwrap to custom error enums.",
      mode: "drill",
    },
    {
      libraryId: "LIB-CLI-BOOK",
      title: "Nicer error reporting",
      url: "https://rust-cli.github.io/book/tutorial/errors.html",
      why: "How error context turns a cryptic failure into an actionable message.",
      mode: "read",
    },
  ],
  abstraction: [
    {
      libraryId: "LIB-BOOK",
      title: "Generic Types, Traits, and Lifetimes",
      url: book("ch10-00-generics.html"),
      why: "Monomorphization, trait bounds, and lifetime elision from first principles.",
      mode: "read",
    },
    {
      libraryId: "LIB-BROWN-BOOK",
      title: "Ownership Inventory #3",
      url: brown("ch10-04-inventory.html"),
      why: "Lifetime-heavy scenarios that check whether the elision rules have stuck.",
      mode: "check",
    },
    {
      libraryId: "LIB-RUST-BY-PRACTICE",
      title: "Lifetime basics",
      url: "https://practice.rs/lifetime/basic.html",
      why: "Annotate-until-it-compiles exercises for the three elision rules.",
      mode: "drill",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "14_generics, 15_traits, 16_lifetimes",
      url: rustlings("15_traits"),
      why: "Three short sets; do them in order.",
      mode: "drill",
    },
  ],
  modules: [
    {
      libraryId: "LIB-BOOK",
      title: "Packages, Crates, and Modules",
      url: book("ch07-00-managing-growing-projects-with-packages-crates-and-modules.html"),
      why: "The module tree, paths, pub, and use — with the file-layout rules.",
      mode: "read",
    },
    {
      libraryId: "LIB-RBE",
      title: "Modules",
      url: rbe("mod.html"),
      why: "Visibility and struct privacy as runnable fragments.",
      mode: "read",
    },
    {
      libraryId: "LIB-CARGO",
      title: "Cargo Targets",
      url: "https://doc.rust-lang.org/cargo/reference/cargo-targets.html",
      why: "How lib.rs, main.rs, tests/, and examples/ become separate crates.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "10_modules",
      url: rustlings("10_modules"),
      why: "Visibility and use-path drills.",
      mode: "drill",
    },
  ],
  testing: [
    {
      libraryId: "LIB-BOOK",
      title: "Writing Automated Tests",
      url: book("ch11-00-testing.html"),
      why: "Unit versus integration tests, should_panic, and test filtering.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTDOC-BOOK",
      title: "Documentation tests",
      url: "https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html",
      why: "Examples in doc comments are compiled and run by cargo test — free extra coverage.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "17_tests",
      url: rustlings("17_tests"),
      why: "Assertion and should_panic drills.",
      mode: "drill",
    },
    {
      libraryId: "LIB-FUZZ-BOOK",
      title: "Fuzzing with cargo-fuzz",
      url: "https://rust-fuzz.github.io/book/cargo-fuzz.html",
      why: "Stretch: let the machine find the input you did not think to test.",
      mode: "read",
    },
  ],
  "closures-iterators": [
    {
      libraryId: "LIB-BOOK",
      title: "Functional Language Features",
      url: book("ch13-00-functional-features.html"),
      why: "Fn, FnMut, FnOnce, and iterator adaptors — plus the performance comparison.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUST-BY-PRACTICE",
      title: "Closure",
      url: "https://practice.rs/functional-programing/cloure.html",
      why: "Capture-mode puzzles: predict which Fn trait the compiler picks.",
      mode: "drill",
    },
    {
      libraryId: "LIB-STD",
      title: "trait Iterator",
      url: std("iter/trait.Iterator.html"),
      why: "Scan the provided methods once; most loops you write have a named adaptor.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "18_iterators",
      url: rustlings("18_iterators"),
      why: "Replace loops with adaptor chains until it feels natural.",
      mode: "drill",
    },
  ],
  "trait-objects": [
    {
      libraryId: "LIB-BOOK",
      title: "Using Trait Objects to Abstract over Shared Behavior",
      url: book("ch18-02-trait-objects.html"),
      why: "dyn Trait, vtables, and when static dispatch is the better choice.",
      mode: "read",
    },
    {
      libraryId: "LIB-RBE",
      title: "Returning Traits with dyn",
      url: rbe("trait/dyn.html"),
      why: "Why a function returning different types must box them.",
      mode: "read",
    },
    {
      libraryId: "LIB-REFERENCE",
      title: "Dyn compatibility",
      url: "https://doc.rust-lang.org/reference/items/traits.html#dyn-compatibility",
      why: "The exact rules for which traits can become trait objects.",
      mode: "read",
    },
    {
      libraryId: "LIB-PATTERNS",
      title: "Strategy pattern",
      url: "https://rust-unofficial.github.io/patterns/patterns/behavioural/strategy.html",
      why: "A classic design problem solved with both generics and trait objects.",
      mode: "read",
    },
  ],
  "smart-pointers": [
    {
      libraryId: "LIB-BOOK",
      title: "Smart Pointers",
      url: book("ch15-00-smart-pointers.html"),
      why: "Box, Deref, Drop, Rc, RefCell, and reference cycles in one sequence.",
      mode: "read",
    },
    {
      libraryId: "LIB-TOO-MANY-LISTS",
      title: "A Persistent Stack",
      url: "https://rust-unofficial.github.io/too-many-lists/third.html",
      why: "Rc in a real data structure; the book's best chapter on shared ownership.",
      mode: "read",
    },
    {
      libraryId: "LIB-CHEATS",
      title: "Memory layout of standard types",
      url: "https://cheats.rs/#standard-library-types",
      why: "Diagrams of what Box, Rc, and RefCell look like in memory.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "19_smart_pointers",
      url: rustlings("19_smart_pointers"),
      why: "Box, Rc, Arc, and Cow drills.",
      mode: "drill",
    },
  ],
  concurrency: [
    {
      libraryId: "LIB-BOOK",
      title: "Fearless Concurrency",
      url: book("ch16-00-concurrency.html"),
      why: "Threads, move closures, channels, and Send/Sync.",
      mode: "read",
    },
    {
      libraryId: "LIB-RBE",
      title: "Channels",
      url: rbe("std_misc/channels.html"),
      why: "A minimal producer/consumer you can modify and rerun.",
      mode: "read",
    },
    {
      libraryId: "LIB-RUSTLINGS",
      title: "20_threads",
      url: rustlings("20_threads"),
      why: "Spawning, joining, and channel drills.",
      mode: "drill",
    },
    {
      libraryId: "LIB-ERROR-INDEX",
      title: "E0373: closure may outlive the current function",
      url: errorCode("E0373"),
      why: "The error that teaches `move` on thread closures.",
      mode: "read",
    },
  ],
  "shared-state": [
    {
      libraryId: "LIB-BOOK",
      title: "Shared-State Concurrency",
      url: book("ch16-03-shared-state.html"),
      why: "Mutex<T> and Arc<T>, and why Rc cannot cross threads.",
      mode: "read",
    },
    {
      libraryId: "LIB-ATOMICS",
      title: "Rust Atomics and Locks, chapter 1",
      url: "https://mara.nl/atomics/basics.html",
      why: "Scoped threads, interior mutability, and locking explained by a std library maintainer.",
      mode: "read",
    },
    {
      libraryId: "LIB-STD",
      title: "std::sync",
      url: std("sync/index.html"),
      why: "The full synchronisation toolbox: Mutex, RwLock, Condvar, OnceLock, atomics.",
      mode: "read",
    },
    {
      libraryId: "LIB-CRUST-OF-RUST",
      title: "Crust of Rust",
      url: "https://www.youtube.com/@jonhoo",
      why: "The channels and atomics episodes build these primitives from scratch.",
      mode: "read",
    },
  ],
  "road-ahead": [
    {
      libraryId: "LIB-ASYNC",
      title: "Asynchronous Programming in Rust",
      url: "https://rust-lang.github.io/async-book/",
      why: "Futures, executors, and pinning — the model beneath async/await.",
      mode: "read",
    },
    {
      libraryId: "LIB-TOKIO",
      title: "Tokio tutorial",
      url: "https://tokio.rs/tokio/tutorial",
      why: "Build a mini Redis client and server with the most used async runtime.",
      mode: "read",
    },
    {
      libraryId: "LIB-NOMICON",
      title: "The Rustonomicon",
      url: "https://doc.rust-lang.org/nomicon/",
      why: "What unsafe code must guarantee, and how std wraps it safely.",
      mode: "read",
    },
    {
      libraryId: "LIB-MACROS",
      title: "The Little Book of Rust Macros",
      url: "https://veykril.github.io/tlborm/",
      why: "macro_rules! from matchers to hygiene; then try the proc-macro workshop.",
      mode: "read",
    },
  ],
};

export type LearningPath = {
  id: string;
  title: string;
  audience: string;
  steps: { libraryId: string; note: string }[];
};

/**
 * Ordered routes through the library. Order matters: each step assumes the
 * previous ones, following the same prerequisite-first principle as the course.
 */
export const learningPaths: LearningPath[] = [
  {
    id: "PATH-FOUNDATIONS",
    title: "From zero to productive",
    audience: "New to Rust; working through chapters 1–14 here.",
    steps: [
      { libraryId: "LIB-BROWN-BOOK", note: "Read one chapter, answer its quizzes." },
      { libraryId: "LIB-RBE", note: "Run the matching examples and change one line each." },
      { libraryId: "LIB-RUSTLINGS", note: "Clear the exercise folder for the chapter." },
      { libraryId: "LIB-RUST-BY-PRACTICE", note: "Second round of repetitions a few days later." },
      {
        libraryId: "LIB-CLI-BOOK",
        note: "First complete project once errors (chapter 11) feel easy.",
      },
      { libraryId: "LIB-EXERCISM", note: "Mentored problems for feedback from a human." },
    ],
  },
  {
    id: "PATH-IDIOMS",
    title: "Writing idiomatic Rust",
    audience: "Code compiles, but reviewers suggest a 'more Rusty' way.",
    steps: [
      { libraryId: "LIB-API-GUIDELINES", note: "Checklist for public interfaces." },
      { libraryId: "LIB-EFFECTIVE", note: "Thirty-five items on types, traits, and dependencies." },
      { libraryId: "LIB-PATTERNS", note: "Idioms and anti-patterns with rationale." },
      { libraryId: "LIB-DATA-CLIPPY-LINTS", note: "One lint category per week." },
      { libraryId: "LIB-RIPGREP", note: "Read production code that applies all of the above." },
    ],
  },
  {
    id: "PATH-CONCURRENCY",
    title: "Concurrency and async",
    audience: "Finished chapters 18–20 here; building networked services next.",
    steps: [
      { libraryId: "LIB-ATOMICS", note: "Memory ordering and locks from first principles." },
      { libraryId: "LIB-ASYNC", note: "What a future is before choosing a runtime." },
      { libraryId: "LIB-TOKIO", note: "The runtime most crates assume." },
      { libraryId: "LIB-MINI-REDIS", note: "Read a complete async server." },
      { libraryId: "LIB-AXUM-EXAMPLES", note: "Web services on the same foundations." },
    ],
  },
  {
    id: "PATH-SYSTEMS",
    title: "Unsafe and systems programming",
    audience: "Comfortable with safe Rust; needs FFI, custom data structures, or no_std.",
    steps: [
      { libraryId: "LIB-TOO-MANY-LISTS", note: "Where safe Rust runs out, one list at a time." },
      { libraryId: "LIB-NOMICON", note: "The obligations unsafe code takes on." },
      { libraryId: "LIB-UCG", note: "The precise layout and validity rules." },
      { libraryId: "LIB-MIRI", note: "Test every unsafe block under Miri." },
      { libraryId: "LIB-OS-PHIL-OPP", note: "A long project that uses all of it." },
      {
        libraryId: "LIB-RESEARCH-RUSTBELT",
        note: "Optional: the proof that the approach is sound.",
      },
    ],
  },
  {
    id: "PATH-EMBEDDED",
    title: "Embedded Rust",
    audience: "Wants to program microcontrollers.",
    steps: [
      { libraryId: "LIB-DISCOVERY", note: "Hands-on with a cheap board." },
      { libraryId: "LIB-EMBEDDED-BOOK", note: "The concepts behind the HAL crates." },
      { libraryId: "LIB-EMBEDONOMICON", note: "Build the runtime yourself." },
      { libraryId: "LIB-AWESOME-EMBEDDED", note: "Find drivers and board-support crates." },
    ],
  },
  {
    id: "PATH-PERFORMANCE",
    title: "Measured performance",
    audience: "Has working code that needs to be faster, and wants evidence.",
    steps: [
      { libraryId: "LIB-CRITERION", note: "Measure first." },
      { libraryId: "LIB-PERF", note: "The catalogue of known techniques." },
      { libraryId: "LIB-GODBOLT", note: "Confirm what the compiler actually emitted." },
    ],
  },
  {
    id: "PATH-COMPILER",
    title: "Reading the compiler fluently",
    audience: "Wants errors to become instant, and to understand how rustc decides.",
    steps: [
      { libraryId: "LIB-ERROR-INDEX", note: "Look up every E-code you meet." },
      {
        libraryId: "LIB-DATA-UI-TESTS",
        note: "Predict the diagnostic for a random UI test, then check.",
      },
      { libraryId: "LIB-RUSTC-BOOK", note: "Lint levels and compiler flags." },
      { libraryId: "LIB-RFCS", note: "The design reasoning behind a rule that surprised you." },
      { libraryId: "LIB-RUSTC-DEV-GUIDE", note: "How the borrow checker is implemented." },
    ],
  },
  {
    id: "PATH-MACROS",
    title: "Macros and metaprogramming",
    audience: "Repeating the same boilerplate across types.",
    steps: [
      { libraryId: "LIB-MACROS", note: "macro_rules! thoroughly." },
      {
        libraryId: "LIB-PROC-MACRO-WORKSHOP",
        note: "Build derive and attribute macros test-first.",
      },
      { libraryId: "LIB-SERDE", note: "Study the best-known derive in the ecosystem." },
    ],
  },
  {
    id: "PATH-SECURITY",
    title: "Security and reliability",
    audience: "Shipping Rust where failures matter.",
    steps: [
      { libraryId: "LIB-DATA-RUSTSEC", note: "Learn from real advisories." },
      { libraryId: "LIB-FUZZ-BOOK", note: "Find crashes before attackers do." },
      { libraryId: "LIB-MIRI", note: "Catch undefined behaviour in tests." },
    ],
  },
  {
    id: "PATH-FROM-CPP",
    title: "Coming from C or C++",
    audience: "Experienced systems programmer new to Rust.",
    steps: [
      { libraryId: "LIB-R4CPPP", note: "Map familiar ownership idioms." },
      { libraryId: "LIB-COMPREHENSIVE", note: "Fast, complete tour designed for engineers." },
      { libraryId: "LIB-CHEATS", note: "Keep open as a daily reference." },
    ],
  },
];
