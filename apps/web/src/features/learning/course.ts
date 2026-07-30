/**
 * The from-zero Rust course.
 *
 * Chapters are ordered reading + checkpoint + terminal work. Prose supports a
 * tiny inline markup rendered by LearningShared's RichText:
 *   [[GRAPH-ID|shown text]]  wiki link into the knowledge graph
 *   `code`                   inline code
 *   **text**                 emphasis
 *
 * Concept IDs must exist in the embedded knowledge feed (KG); they are the
 * same IDs the graph, curriculum, and evidence surfaces use.
 */

export type Stop = {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explain: string;
};

export type Section =
  | { kind: "prose"; eyebrow?: string; heading?: string; body: string[] }
  | { kind: "code"; title?: string; code: string; caption?: string }
  | { kind: "callout"; title: string; body: string }
  | { kind: "stop"; stop: Stop };

export type ChapterTerminal = {
  file: string;
  code: string;
  task: string;
  hints: string[];
  /** Present only when a reviewed hidden-test contract exists for this code. */
  exerciseId?: string;
};

export type Chapter = {
  id: string;
  number: number;
  title: string;
  strand: string;
  minutes: number;
  summary: string;
  concepts: string[];
  sections: Section[];
  terminal: ChapterTerminal;
};

export const chapters: Chapter[] = [
  {
    id: "hello-rust",
    number: 1,
    title: "Hello, Rust",
    strand: "Getting started",
    minutes: 10,
    summary:
      "Meet the compiler you will be working with. Rust turns source files into fast native binaries, and it checks your reasoning before anything runs.",
    concepts: ["CON-RUST-TOOLCHAIN-RESOLUTION-001", "CON-CARGO-MANIFEST-LOCK-001"],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "Rust compiles your whole program before it runs.",
        body: [
          "Many languages run your code line by line and report problems as they happen. Rust is different: the compiler, `rustc`, reads your **entire program first**, proves a set of rules about it, and only then produces a runnable binary. Most of the errors you would meet at 2 a.m. in another language show up at compile time instead.",
          "You will rarely call `rustc` directly. [[CON-CARGO-MANIFEST-LOCK-001|Cargo]] is Rust's build tool and package manager: it compiles, runs, tests, and formats your project with one command each. This whole tutor runs your code through real Cargo — nothing here is simulated.",
          "Every runnable Rust program has exactly one entry point: a function named `main`. When the binary starts, `main` runs; when `main` returns, the program ends.",
        ],
      },
      {
        kind: "code",
        title: "src/main.rs",
        code: 'fn main() {\n    // Lines starting with // are comments.\n    println!("Hello, Rust!");\n}',
        caption:
          "`fn` declares a function. `println!` writes a line to standard output — the `!` marks it as a macro, which you can treat as a smarter kind of function for now.",
      },
      {
        kind: "callout",
        title: "Read the error as the lesson.",
        body: "From the very first chapter, treat compiler messages as the tutor, not the enemy. rustc names the exact line, the rule involved, and usually the fix. Learning Rust is largely learning to read what it tells you.",
      },
      {
        kind: "stop",
        stop: {
          id: "hello-entry",
          prompt: "Where does a Rust binary begin executing?",
          options: [
            "At the top of the file",
            "In the function named main",
            "Wherever println! appears first",
          ],
          answerIndex: 1,
          explain:
            "The `main` function is the single entry point. File order matters for readability, not for where execution starts.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "hello-compile",
          prompt: "True or false — Rust reports most mistakes while the program is running.",
          options: ["True", "False — most are caught at compile time"],
          answerIndex: 1,
          explain:
            "rustc proves rules about the whole program before producing a binary, so the majority of mistakes never make it to runtime.",
        },
      },
    ],
    terminal: {
      file: "hello.rs",
      code: 'fn main() {\n    println!("Hello, Rust!");\n    // Add a second line that prints your name.\n}',
      task: "Run the program, then add a second println! with your own message and run it again.",
      hints: [
        'println! takes a string in double quotes: println!("like this");',
        "Each statement ends with a semicolon. Copy the existing line and change the text.",
      ],
    },
  },
  {
    id: "variables",
    number: 2,
    title: "Variables and mutability",
    strand: "Getting started",
    minutes: 12,
    summary:
      "Bindings name values. They are immutable until you say otherwise — and that one default quietly prevents a whole family of bugs.",
    concepts: ["CON-RUST-BINDING-001", "CON-RUST-SCOPE-DROP-001"],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "A binding is a name attached to a value.",
        body: [
          "`let name = value;` creates a [[CON-RUST-BINDING-001|binding]]. By default it is **immutable**: once a value is bound, that name cannot be reassigned. This is not a limitation to fight — it is information. When you read `let total = 40;` you know `total` is 40 for its whole life.",
          "When you genuinely need to change a value, say so with `mut`: `let mut count = 0;`. Now `count = count + 1;` is legal. The keyword is a signal to readers — and the compiler holds you to it: mutating a binding that isn't `mut` is a compile error, not a surprise at runtime.",
          'Rust also lets you **shadow** a binding: a second `let` with the same name creates a new binding that replaces the old one from that point on. Shadowing can even change the type — `let input = "42"; let input: i32 = 42;` is idiomatic when parsing.',
        ],
      },
      {
        kind: "code",
        title: "bindings.rs",
        code: 'fn main() {\n    let city = "Athens";      // immutable binding\n    let mut visits = 1;        // mutable binding\n    visits += 1;               // fine: visits is mut\n    let city = city.len();     // shadowing: city is now a number\n    println!("{visits} visits, name length {city}");\n}',
        caption:
          "Reassigning `city` without `let` would be an error; shadowing with `let` creates a fresh binding instead.",
      },
      {
        kind: "callout",
        title: "Why immutable by default?",
        body: "Every mutable thing in a program is something you must track in your head. Rust flips the default so the code itself tells you which few values actually change — and the compiler guarantees the list is complete.",
      },
      {
        kind: "stop",
        stop: {
          id: "var-mut",
          prompt: "let speed = 30; speed = 35; — what happens?",
          options: ["speed becomes 35", "Compile error: speed is not mutable", "Runtime panic"],
          answerIndex: 1,
          explain:
            "Reassignment requires `mut`. The compiler rejects the program before it runs — this is E0384, one of the first error codes most Rust programmers meet.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "var-shadow",
          prompt: "Shadowing (a second let with the same name) …",
          options: [
            "mutates the original value",
            "creates a new binding, and may even change the type",
            "is a compile error",
          ],
          answerIndex: 1,
          explain:
            "Shadowing replaces the name, not the value. The original binding simply stops being reachable — nothing was mutated.",
        },
      },
    ],
    terminal: {
      file: "bindings.rs",
      code: 'fn main() {\n    let score = 10;\n    // Make this compile by changing exactly one line:\n    score = score + 5;\n    println!("score: {score}");\n}',
      task: "This program does not compile. Run it, read the error, then make the smallest change that fixes it.",
      hints: [
        "Run it first — the compiler names the binding and the missing keyword.",
        "let mut score = 10; makes the later assignment legal. (Shadowing with a second let also works.)",
      ],
    },
  },
  {
    id: "types",
    number: 3,
    title: "Types that carry meaning",
    strand: "Getting started",
    minutes: 14,
    summary:
      "Every value has exactly one type, known at compile time. Inference keeps the noise down; annotations appear where intent matters.",
    concepts: ["CON-RUST-TYPE-INTERPRETATION-001"],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "Types are checked before the program exists.",
        body: [
          "Rust is statically typed: the [[CON-RUST-TYPE-INTERPRETATION-001|type of every value]] is settled at compile time. You usually don't write types, because the compiler **infers** them — `let x = 41;` gives `x` the default integer type `i32`.",
          "Integers come in explicit sizes: `i8` through `i128` (signed), `u8` through `u128` (unsigned), plus `usize` for indexing. Floats are `f32` and `f64`. `bool` is `true`/`false`, and `char` is a full Unicode character, written with single quotes.",
          "Two compound types complete the starter kit. A **tuple** groups a fixed set of possibly-different types: `let point: (i32, i32) = (3, 7);` — access fields with `point.0`. An **array** is a fixed-length list of one type: `let days = [1, 2, 3];` — length is part of the type.",
          "Rust never converts numeric types silently. Adding an `i32` to a `u8` is a compile error until you cast intentionally with `as` or a checked conversion. Every conversion in your program is one you chose.",
        ],
      },
      {
        kind: "code",
        title: "types.rs",
        code: "fn main() {\n    let temperature = 21.5;          // f64 by inference\n    let sunny: bool = true;\n    let initial = 'R';               // char, single quotes\n    let point = (4, 9);              // tuple (i32, i32)\n    let week = [1, 2, 3, 4, 5];      // array [i32; 5]\n    println!(\"{temperature}° sunny={sunny} {initial} x={} days={}\", point.0, week.len());\n}",
        caption:
          "Inference fills in the types; annotations like `: bool` document intent where it helps.",
      },
      {
        kind: "stop",
        stop: {
          id: "types-default",
          prompt: "let n = 7; — what type does n have?",
          options: ["u8", "i32 (the integer default)", "f64", "It has no type until used"],
          answerIndex: 1,
          explain:
            "Un-annotated integer literals default to i32. The type is fixed at compile time even though you never wrote it.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "types-mix",
          prompt: "Adding an i32 to a u8 without a cast …",
          options: ["silently widens the u8", "is a compile error", "rounds toward zero"],
          answerIndex: 1,
          explain:
            "Rust has no implicit numeric conversions. You must cast intentionally — which means every conversion is visible in the source.",
        },
      },
    ],
    terminal: {
      file: "types.rs",
      code: 'fn main() {\n    let items: u8 = 12;\n    let batches = 3;\n    // This line does not compile. Read the error, then fix it\n    // with an intentional conversion.\n    let total = items * batches;\n    println!("total: {total}");\n}',
      task: "Run it, read the type mismatch, then make the conversion explicit so it compiles.",
      hints: [
        "The error names two different integer types on either side of *.",
        "Either annotate batches as u8, or convert: items as i32 * batches, or i32::from(items) * batches.",
      ],
    },
  },
  {
    id: "functions-flow",
    number: 4,
    title: "Functions and control flow",
    strand: "Getting started",
    minutes: 14,
    summary:
      "Functions declare their full contract in the signature, and almost everything in Rust — including if — is an expression that produces a value.",
    concepts: [
      "CON-RUST-FUNCTION-CONTRACT-001",
      "CON-RUST-CONTROL-FLOW-001",
      "RFT-RUST-EXPRESSION-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "Signatures are contracts; blocks are expressions.",
        body: [
          "A [[CON-RUST-FUNCTION-CONTRACT-001|function signature]] states everything a caller may rely on: `fn area(width: u32, height: u32) -> u32`. Parameter types are mandatory — the compiler never guesses across function boundaries, which is why Rust code stays readable in large projects.",
          "Here is the habit that makes Rust click: [[RFT-RUST-EXPRESSION-001|almost everything is an expression]]. A block `{ … }` produces the value of its **last expression when it has no trailing semicolon**. That is why idiomatic functions end with a bare expression instead of `return`.",
          '[[CON-RUST-CONTROL-FLOW-001|Control flow]] follows the same rule. `if`/`else` is an expression: `let label = if hot { "tea" } else { "coffee" };`. Both arms must produce the same type — the compiler checks your branches agree.',
          "Loops: `loop` repeats forever until `break` (and `break value` returns a value from the loop), `while` repeats on a condition, and `for item in collection` is the loop you will write most — it iterates without index-out-of-bounds mistakes.",
        ],
      },
      {
        kind: "code",
        title: "flow.rs",
        code: 'fn classify(n: i32) -> &\'static str {\n    if n < 0 { "negative" } else if n == 0 { "zero" } else { "positive" }\n}\n\nfn main() {\n    for n in [-2, 0, 5] {\n        println!("{n} is {}", classify(n));\n    }\n}',
        caption:
          "No return keyword: the if/else chain is the function's final expression, so its value is the return value.",
      },
      {
        kind: "callout",
        title: "Semicolons change meaning.",
        body: "`x + 1` is an expression with a value. `x + 1;` is a statement that throws the value away. If a function 'returns ()' when you expected a number, look for a stray semicolon on the last line.",
      },
      {
        kind: "stop",
        stop: {
          id: "flow-expr",
          prompt: "fn double(x: i32) -> i32 { x * 2; } — what happens?",
          options: [
            "Returns x * 2",
            "Compile error: the semicolon makes the block return (), not i32",
            "Runtime panic",
          ],
          answerIndex: 1,
          explain:
            "The trailing semicolon turns the expression into a statement, so the block evaluates to `()`. The compiler points at the exact semicolon — try it in the terminal.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "flow-if",
          prompt: 'let s = if cold { "soup" } else { 42 }; — is this allowed?',
          options: [
            "Yes, s becomes either type",
            "No — both arms of an if expression must have the same type",
          ],
          answerIndex: 1,
          explain:
            "An expression has one type at compile time, so both branches must agree. This rule is what makes `if` usable as a value.",
        },
      },
    ],
    terminal: {
      file: "flow.rs",
      exerciseId: "EX-CH-FUNCTIONS-001",
      code: 'fn fizzbuzz(n: u32) -> String {\n    // Return "Fizz" for multiples of 3, "Buzz" for multiples of 5,\n    // "FizzBuzz" for both, and the number itself otherwise.\n    // (String::from and n.to_string() build owned strings.)\n    n.to_string()\n}\n\nfn main() {\n    for n in 1..=15 {\n        println!("{}", fizzbuzz(n));\n    }\n}',
      task: "Implement fizzbuzz using if/else as an expression — no return keyword needed.",
      hints: [
        "n % 3 == 0 tests divisibility. Check the 'both' case first.",
        'if n % 15 == 0 { String::from("FizzBuzz") } else if … } else { n.to_string() } — the whole chain is the function body\'s final expression.',
      ],
    },
  },
  {
    id: "ownership",
    number: 5,
    title: "Ownership and moves",
    strand: "Ownership & borrowing",
    minutes: 16,
    summary:
      "Every value has exactly one owner. Assignment of non-Copy values transfers that responsibility — this is the idea the rest of Rust is built on.",
    concepts: [
      "CON-RUST-OWNERSHIP-001",
      "CON-RUST-MOVE-SEMANTICS-001",
      "CON-RUST-COPY-SEMANTICS-001",
      "CON-RUST-EXPLICIT-CLONE-001",
      "CON-RUST-SCOPE-DROP-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "One value, one owner, one goodbye.",
        body: [
          "Rust has no garbage collector, yet you never call free. The trick is [[CON-RUST-OWNERSHIP-001|ownership]]: every value has exactly one owning binding, and when that owner [[CON-RUST-SCOPE-DROP-001|goes out of scope]], the value is dropped — memory released, files closed, deterministically.",
          "For heap values like `String`, assignment **moves** ownership: after `let second = first;`, `second` is the owner and `first` may no longer be used. The compiler enforces this — using a moved-from binding is error [[ERR-RUST-E0382-001|E0382]], and the message names both the move and the invalid use.",
          "Small fixed-size types (`i32`, `bool`, `char`, tuples of them) implement [[CON-RUST-COPY-SEMANTICS-001|Copy]]: assignment duplicates the bits and both bindings stay usable. That is why integers never trip E0382.",
          "When you genuinely need two owned copies of heap data, say so with [[CON-RUST-EXPLICIT-CLONE-001|.clone()]]. It's not a code smell — it's a visible receipt that duplication happens here.",
          "Function calls follow the same rule: passing a `String` by value moves it into the callee, and the caller loses it. The next chapter shows how to **lend** a value instead.",
        ],
      },
      {
        kind: "code",
        title: "moves.rs",
        code: 'fn main() {\n    let first = String::from("rust");\n    let second = first;          // ownership moves to second\n    // println!("{first}");      // E0382: value borrowed after move\n    println!("{second}");        // fine: second owns the String\n\n    let a = 7;\n    let b = a;                   // i32 is Copy: both stay usable\n    println!("{a} {b}");\n}',
        caption:
          "Uncomment the println! and run it — reading the E0382 message is the actual lesson.",
      },
      {
        kind: "callout",
        title: "A move costs nothing.",
        body: "Moving a String copies three machine words (pointer, length, capacity) — the heap text never moves. Ownership is about responsibility, not about copying data.",
      },
      {
        kind: "stop",
        stop: {
          id: "own-move",
          prompt: "After let second = first; where first is a String, using first …",
          options: ["works — both share the String", "is compile error E0382", "panics at runtime"],
          answerIndex: 1,
          explain:
            "Ownership moved to second. The compiler rejects the use at compile time and its message points at both the move and the invalid line.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "own-copy",
          prompt: "Why does the same pattern work fine with an i32?",
          options: [
            "Integers are special-cased by the borrow checker",
            "i32 implements Copy, so assignment duplicates the value",
            "It doesn't — it also fails",
          ],
          answerIndex: 1,
          explain:
            "Copy types are duplicated bit-for-bit on assignment, so no ownership transfer happens and both bindings remain valid.",
        },
      },
    ],
    terminal: {
      file: "measure.rs",
      exerciseId: "EX-OWNERSHIP-COMPLETION-001",
      code: 'fn measure(value: /* missing */) -> usize { value.len() }\n\nfn main() {\n    let label = String::from("rust");\n    let length = measure(/* pass label */);\n    println!("{label}: {length}");\n}',
      task: "Complete the signature so the caller can still print label after the call. This one runs the real hidden-test contract.",
      hints: [
        "Who must own the value after the call? The caller — so don't take String by value.",
        "measure only reads. A shared borrow &str (passed as &label) leaves ownership with the caller.",
      ],
    },
  },
  {
    id: "borrowing",
    number: 6,
    title: "Borrowing and references",
    strand: "Ownership & borrowing",
    minutes: 15,
    summary:
      "References let you use a value without taking ownership. The rule: any number of readers, or exactly one writer — never both at once.",
    concepts: ["CON-RUST-SHARED-BORROW-001", "CON-RUST-EXCLUSIVE-BORROW-001"],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "Lend, don't give.",
        body: [
          "Moving ownership into every function would be exhausting. A **reference** grants access without transfer: `&value` is a [[CON-RUST-SHARED-BORROW-001|shared borrow]] (read-only), `&mut value` is an [[CON-RUST-EXCLUSIVE-BORROW-001|exclusive borrow]] (read-write). The owner keeps the value; the borrower returns it implicitly when the reference's life ends.",
          "The borrow rule is short: **any number of shared borrows, or exactly one exclusive borrow — never both alive at the same time.** This one rule eliminates data races and iterator invalidation at compile time.",
          "Borrows end at their **last use**, not at the end of the block. That's why you can read a value, stop using the reference, and then mutate — the compiler tracks exactly where each loan is still live.",
          "References never keep a value alive. If a function tries to return a reference to its own local, the compiler stops you — the local dies with the function, and Rust will not hand out a pointer to freed memory.",
        ],
      },
      {
        kind: "code",
        title: "borrows.rs",
        code: 'fn shout(text: &str) -> String {\n    text.to_uppercase()          // reads through the shared borrow\n}\n\nfn punctuate(text: &mut String) {\n    text.push(\'!\');              // mutates through the exclusive borrow\n}\n\nfn main() {\n    let mut line = String::from("borrow me");\n    let loud = shout(&line);     // lend read access\n    punctuate(&mut line);        // lend write access (previous loan ended)\n    println!("{line} → {loud}");\n}',
        caption: "The owner (line) never changes. Each call lends exactly the access it needs.",
      },
      {
        kind: "callout",
        title: "Choose the narrowest access.",
        body: "Reading only? Take &str or &T. Mutating in place? Take &mut T. Keeping the value? Take ownership. Callers can read your signature and know exactly what will happen to their data.",
      },
      {
        kind: "stop",
        stop: {
          id: "borrow-rule",
          prompt: "While a shared borrow of a value is still in use, mutating that value is …",
          options: ["fine — reads and writes interleave", "a compile error", "undefined behavior"],
          answerIndex: 1,
          explain:
            "Readers are promised a value that doesn't change under them. The compiler (E0502) rejects the mutation while any shared loan is live.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "borrow-life",
          prompt: "True or false — taking a reference extends how long the value lives.",
          options: ["True", "False — references only describe access; the owner controls lifetime"],
          answerIndex: 1,
          explain:
            "A borrow must end before its owner is dropped; it never postpones the drop. Lifetimes describe the loan, not the value.",
        },
      },
    ],
    terminal: {
      file: "job.rs",
      exerciseId: "EX-OWNERSHIP-INDEPENDENT-001",
      code: 'fn job_len(job: &str) -> usize { todo!() }\n\nfn main() {\n    let job = String::from("compile");\n    assert_eq!(job_len(&job), 7);\n    println!("{job}");\n}',
      task: "Implement job_len through the shared borrow so main's assert passes and job stays usable.",
      hints: [
        "todo!() compiles anywhere but panics when reached — replace it with a real body.",
        "&str already gives read access: job.len() is the whole implementation.",
      ],
    },
  },
  {
    id: "slices-strings",
    number: 7,
    title: "Slices and strings",
    strand: "Ownership & borrowing",
    minutes: 14,
    summary:
      "A slice borrows a contiguous view into data someone else owns. Rust's two string types stop making sense the moment you forget that — and never confuse you again once you remember it.",
    concepts: ["RFT-RUST-SLICE-001", "RFT-RUST-STRING-001", "CON-ALG-RUST-STRING-UNIT-001"],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "A view, not a copy.",
        body: [
          "A [[RFT-RUST-SLICE-001|slice]] `&[T]` is a borrowed **view** into a run of elements: a pointer plus a length. `&scores[1..4]` doesn't copy three numbers — it points at them. Because a slice is a borrow, the usual rule applies: while the slice lives, the owner can't be mutated.",
          'Now [[RFT-RUST-STRING-001|the two string types]] make sense. `String` is the **owned, growable** buffer. `&str` is a **borrowed slice of text** — a view into a String, or into the program binary itself for literals like `"hi"`.',
          "Function arguments should almost always be `&str`: a `&String` coerces to `&str` automatically, so `&str` accepts both owned strings and literals. Return `String` when the function builds new text.",
          "One honest warning: Rust strings are UTF-8, so [[CON-ALG-RUST-STRING-UNIT-001|indexing by integer is not allowed]] — `s[0]` doesn't compile because byte 0 may be the middle of a character. Iterate with `.chars()` or `.bytes()` and say which unit you mean.",
        ],
      },
      {
        kind: "code",
        title: "slices.rs",
        code: 'fn first_word(text: &str) -> &str {\n    match text.find(\' \') {\n        Some(index) => &text[..index],\n        None => text,\n    }\n}\n\nfn main() {\n    let phrase = String::from("fearless concurrency");\n    let word = first_word(&phrase);   // a view into phrase\n    println!("first word: {word}");\n}',
        caption:
          "first_word returns a slice of its input — no allocation, no copy, and the compiler tracks the loan.",
      },
      {
        kind: "stop",
        stop: {
          id: "slice-view",
          prompt: "&values[2..5] gives you …",
          options: [
            "a new Vec with three copied elements",
            "a borrowed view of three elements",
            "ownership of three elements",
          ],
          answerIndex: 1,
          explain:
            "A slice is pointer + length into the original storage. Nothing is copied and nothing changes owner.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "slice-str",
          prompt: 'Which parameter type accepts both a String and a literal like "hi"?',
          options: ["String", "&String", "&str"],
          answerIndex: 2,
          explain:
            "&String coerces to &str, and literals already are &str — so &str is the most accepting read-only text parameter.",
        },
      },
    ],
    terminal: {
      file: "table.rs",
      exerciseId: "EX-OWNERSHIP-INDEPENDENT-002",
      code: 'fn table_len(table: &str) -> usize { todo!() }\n\nfn main() {\n    let mut table = String::from("users");\n    assert_eq!(table_len(&table), 5);\n    table.push_str("_archive");\n    println!("{table}");\n}',
      task: "Implement table_len, then notice why main can still mutate table afterwards: the borrow ended at its last use.",
      hints: [
        "The shared borrow &table ends after the assert line — that's why push_str is legal next.",
        "table.len() counts bytes; for this ASCII name that's also the character count.",
      ],
    },
  },
  {
    id: "structs",
    number: 8,
    title: "Structs and methods",
    strand: "Building vocabulary",
    minutes: 14,
    summary:
      "Structs group related data under one name; impl blocks attach behavior. Together they are how Rust programs grow their own vocabulary.",
    concepts: ["RFT-RUST-STRUCT-001", "CON-RUST-TRAIT-IMPLEMENTATION-001"],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "Name your data, then teach it verbs.",
        body: [
          "A [[RFT-RUST-STRUCT-001|struct]] gives a shape to related fields: `struct Meter { reading: f64, station: String }`. Construction names every field, so a reader never guesses argument order.",
          "Behavior lives in an `impl` block. Methods take `self` in one of the three ownership modes you already know: `&self` to read, `&mut self` to modify, `self` to consume. The borrow rules apply to method calls exactly as they did to function calls — nothing new to memorize.",
          "Functions in an impl block without self — like `Meter::new(…)` — are **associated functions**, Rust's constructors by convention.",
          "Add `#[derive(Debug)]` above a struct and `{:?}` formatting works immediately. Deriving standard behavior is everyday Rust; you will meet the mechanism behind it ([[RFT-RUST-TRAITS-001|traits]]) in chapter twelve.",
        ],
      },
      {
        kind: "code",
        title: "meter.rs",
        code: '#[derive(Debug)]\nstruct Meter {\n    station: String,\n    reading: f64,\n}\n\nimpl Meter {\n    fn new(station: &str) -> Self {\n        Self { station: station.to_string(), reading: 0.0 }\n    }\n\n    fn record(&mut self, value: f64) {\n        self.reading = value;\n    }\n\n    fn report(&self) -> String {\n        format!("{}: {:.1}", self.station, self.reading)\n    }\n}\n\nfn main() {\n    let mut meter = Meter::new("dock-9");\n    meter.record(21.4);\n    println!("{}", meter.report());\n    println!("{meter:?}");\n}',
        caption:
          "&mut self for record, &self for report — the signature tells callers exactly what each method may do.",
      },
      {
        kind: "stop",
        stop: {
          id: "struct-self",
          prompt: "A method that updates a field needs which receiver?",
          options: ["self", "&self", "&mut self"],
          answerIndex: 2,
          explain:
            "Mutation requires the exclusive borrow. `self` would consume the value; `&self` only reads.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "struct-derive",
          prompt: "#[derive(Debug)] exists so that …",
          options: [
            "the struct compiles in debug mode",
            "{:?} formatting is generated for the struct",
            "the compiler skips borrow checking",
          ],
          answerIndex: 1,
          explain:
            "Deriving writes the Debug implementation for you — instant inspectable printing for any struct made of printable parts.",
        },
      },
    ],
    terminal: {
      file: "meter.rs",
      exerciseId: "EX-CH-STRUCTS-001",
      code: '#[derive(Debug)]\nstruct Counter {\n    label: String,\n    count: u32,\n}\n\nimpl Counter {\n    fn new(label: &str) -> Self {\n        Self { label: label.to_string(), count: 0 }\n    }\n    // Add: fn bump(&mut self) that increases count by 1\n}\n\nfn main() {\n    let mut clicks = Counter::new("clicks");\n    // clicks.bump();\n    // clicks.bump();\n    println!("{clicks:?}");\n}',
      task: "Add the bump method, uncomment the calls, and run. Then try changing &mut self to &self and read the error.",
      hints: [
        "fn bump(&mut self) { self.count += 1; } inside the impl block.",
        "With &self the compiler rejects self.count += 1 — mutation through a shared borrow (E0594).",
      ],
    },
  },
  {
    id: "enums-matching",
    number: 9,
    title: "Enums and pattern matching",
    strand: "Building vocabulary",
    minutes: 15,
    summary:
      "An enum says 'exactly one of these shapes'. match forces you to handle every shape — which is how whole categories of bugs become compile errors.",
    concepts: ["RFT-RUST-ENUM-PATTERN-001", "RFT-RUST-OPTION-001"],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "Model the choices, then prove you handled them.",
        body: [
          "A Rust [[RFT-RUST-ENUM-PATTERN-001|enum]] is a type whose value is exactly one of several **variants** — and each variant can carry its own data: `enum Shape { Circle(f64), Rect { w: f64, h: f64 } }`. This models 'one of these, with its own payload' directly, instead of via nullable fields and comments.",
          "`match` takes a value apart by shape. The compiler checks the match is **exhaustive**: add a variant next month and every match that forgot it fails to compile, with a list of the missing cases. Your future refactors are already protected.",
          "The most important enum is [[RFT-RUST-OPTION-001|Option<T>]]: `Some(value)` or `None`. Rust has no null — a value that might be absent says so in its type, and the compiler makes you handle the None arm before you can touch the payload.",
          "When you only care about one shape, `if let Some(x) = maybe { … }` handles it without spelling out the rest.",
        ],
      },
      {
        kind: "code",
        title: "shapes.rs",
        code: 'enum Command {\n    Start,\n    Move { x: i32, y: i32 },\n    Say(String),\n}\n\nfn describe(command: &Command) -> String {\n    match command {\n        Command::Start => String::from("starting"),\n        Command::Move { x, y } => format!("moving to ({x}, {y})"),\n        Command::Say(text) => format!("saying {text:?}"),\n    }\n}\n\nfn main() {\n    let commands = [\n        Command::Start,\n        Command::Move { x: 4, y: -2 },\n        Command::Say(String::from("hello")),\n    ];\n    for command in &commands {\n        println!("{}", describe(command));\n    }\n}',
        caption:
          "Delete one match arm and run it — the compiler names the exact variant you stopped handling.",
      },
      {
        kind: "stop",
        stop: {
          id: "enum-exhaustive",
          prompt:
            "You add a new variant to an enum. Existing match expressions that don't handle it …",
          options: ["fall through silently", "fail to compile until updated", "panic at runtime"],
          answerIndex: 1,
          explain:
            "Exhaustiveness checking turns 'forgot a case' from a production bug into a compile-time todo list.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "enum-option",
          prompt: "Rust's answer to null is …",
          options: [
            "null, but checked at runtime",
            "Option<T> — absence is part of the type and must be handled",
            "zero values",
          ],
          answerIndex: 1,
          explain:
            "A possibly-absent value has type Option<T>. You cannot reach the T without going through Some/None — no forgotten null checks.",
        },
      },
    ],
    terminal: {
      file: "traffic.rs",
      exerciseId: "EX-CH-ENUMS-001",
      code: 'enum Light {\n    Red,\n    Yellow,\n    Green,\n}\n\nfn seconds(light: &Light) -> u32 {\n    // Return 30 for Red, 5 for Yellow, 45 for Green.\n    todo!()\n}\n\nfn main() {\n    for light in [Light::Red, Light::Yellow, Light::Green] {\n        println!("{}", seconds(&light));\n    }\n}',
      task: "Replace todo!() with a match over the three variants. Then delete an arm and read the exhaustiveness error.",
      hints: [
        "match light { Light::Red => 30, … } — the match is the function's final expression.",
        "With an arm missing, rustc says: pattern `Light::Green` not covered. That message is the feature.",
      ],
    },
  },
  {
    id: "collections",
    number: 10,
    title: "Collections: Vec and HashMap",
    strand: "Building vocabulary",
    minutes: 15,
    summary:
      "Vec is the growable list, HashMap the key-value store. Both follow the ownership and borrowing rules you already know — including inside loops.",
    concepts: [
      "RFT-RUST-VEC-001",
      "RFT-RUST-HASHMAP-001",
      "CON-RUST-COLLECTION-ACCESS-001",
      "CON-RUST-ITERATION-OWNERSHIP-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "Owned storage, borrowed iteration.",
        body: [
          "[[RFT-RUST-VEC-001|Vec<T>]] is the workhorse list: `let mut scores = vec![90, 84];` then `scores.push(77);`. The Vec owns its elements; drop the Vec and the elements go with it.",
          "[[CON-RUST-COLLECTION-ACCESS-001|Access can fail]], and Rust makes the two moods explicit: `scores[9]` panics on a missing index, while `scores.get(9)` returns an `Option` you can handle. Use `get` when absence is a normal case, indexing when it would be a bug.",
          "[[CON-RUST-ITERATION-OWNERSHIP-001|Iteration has ownership modes]] too: `for s in &scores` borrows each element, `for s in &mut scores` lets you edit in place, and `for s in scores` consumes the Vec. Pick the loop the same way you pick a parameter type.",
          "[[RFT-RUST-HASHMAP-001|HashMap<K, V>]] (from `std::collections`) stores values by key. The `entry` API handles the exists-or-not dance in one line: `*counts.entry(word).or_insert(0) += 1;` — the counting idiom you'll reuse forever.",
        ],
      },
      {
        kind: "code",
        title: "tally.rs",
        code: 'use std::collections::HashMap;\n\nfn main() {\n    let log = ["ok", "err", "ok", "ok", "err"];\n    let mut counts: HashMap<&str, u32> = HashMap::new();\n    for entry in log {\n        *counts.entry(entry).or_insert(0) += 1;\n    }\n    let mut pairs: Vec<_> = counts.iter().collect();\n    pairs.sort();\n    for (status, count) in pairs {\n        println!("{status}: {count}");\n    }\n}',
        caption:
          "entry().or_insert() borrows the slot mutably; the * dereferences it to bump the count.",
      },
      {
        kind: "callout",
        title: "Why can't I push while looping?",
        body: "for s in &scores holds a shared borrow of the Vec for the whole loop, and push needs an exclusive one. The E0502 error you get is the borrow rule protecting you from iterator invalidation — a real crash class in C++ — at compile time.",
      },
      {
        kind: "stop",
        stop: {
          id: "coll-get",
          prompt: "scores.get(9) on a 3-element Vec returns …",
          options: ["a panic", "None", "0"],
          answerIndex: 1,
          explain:
            "get returns Option<&T>: Some(&value) in range, None out of range. Indexing with [9] is the one that panics.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "coll-iter",
          prompt: "After for s in scores { … } (no &), the Vec is …",
          options: ["unchanged", "moved — consumed by the loop", "emptied but reusable"],
          answerIndex: 1,
          explain:
            "Iterating by value moves the Vec into the loop. Borrow with & when you need it afterwards.",
        },
      },
    ],
    terminal: {
      file: "tally.rs",
      code: 'use std::collections::HashMap;\n\nfn main() {\n    let words = ["the", "quick", "the", "lazy", "the"];\n    let mut counts: HashMap<&str, u32> = HashMap::new();\n    // Count each word with the entry API, then print the\n    // count for "the" (should be 3).\n    println!("{:?}", counts.get("the"));\n}',
      task: "Fill in the counting loop. Expected final output: Some(3).",
      hints: [
        "for word in words { *counts.entry(word).or_insert(0) += 1; }",
        "counts.get returns Option<&u32> — printing with {:?} shows Some(3), absence would be None.",
      ],
    },
  },
  {
    id: "errors",
    number: 11,
    title: "Errors: panic, Result, and ?",
    strand: "Building vocabulary",
    minutes: 15,
    summary:
      "Rust splits failures in two: bugs panic, expected failures return Result. The ? operator makes the honest path the ergonomic one.",
    concepts: [
      "RFT-RUST-RESULT-001",
      "CON-RUST-PANIC-INVARIANT-001",
      "CON-RUST-ERROR-PROPAGATION-001",
      "CON-RUST-ERROR-BOUNDARY-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "Bugs panic; weather returns Result.",
        body: [
          "First decide which kind of failure you have. A [[CON-RUST-PANIC-INVARIANT-001|panic]] means a **bug** — an invariant your code promised can't happen, happened; the program stops with a backtrace. An **expected failure** — file missing, input malformed, network down — is just weather, and weather is data: [[RFT-RUST-RESULT-001|Result<T, E>]] is `Ok(value)` or `Err(error)`.",
          "Because Result is an ordinary enum, the compiler will not let you touch the `Ok` value without acknowledging the `Err` arm. Errors cannot be silently ignored — there is no forgotten try/catch.",
          "[[CON-RUST-ERROR-PROPAGATION-001|The ? operator]] is how errors travel: `let n: i32 = text.trim().parse()?;` either yields the parsed value or **returns the error to the caller** right there. A fallible function reads like the happy path with question marks at each risky step.",
          'During development, `.unwrap()` or `.expect("why this can\'t fail")` converts an Err into a panic. That is a deliberate [[CON-RUST-ERROR-BOUNDARY-001|boundary decision]] — fine in main or tests, suspicious deep inside a library.',
        ],
      },
      {
        kind: "code",
        title: "parse.rs",
        code: 'use std::num::ParseIntError;\n\nfn add_prices(a: &str, b: &str) -> Result<i32, ParseIntError> {\n    let a: i32 = a.trim().parse()?;   // Err returns early to the caller\n    let b: i32 = b.trim().parse()?;\n    Ok(a + b)\n}\n\nfn main() {\n    println!("{:?}", add_prices("12", "30"));   // Ok(42)\n    println!("{:?}", add_prices("12", "x"));    // Err(ParseIntError { .. })\n}',
        caption:
          "Two question marks, no pyramid of matches — and the caller still sees every failure in the type.",
      },
      {
        kind: "stop",
        stop: {
          id: "err-kind",
          prompt: 'A user typed "abc" where a number was expected. Idiomatic Rust treats this as …',
          options: [
            "a panic — crash with a message",
            "a Result::Err the caller handles",
            "undefined behavior",
          ],
          answerIndex: 1,
          explain:
            "Bad input is expected weather, not a bug. Return Err and let the caller decide; reserve panics for broken invariants.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "err-question",
          prompt: "In a function returning Result, what does ? do on an Err?",
          options: [
            "panics with the error",
            "returns the error from the enclosing function immediately",
            "converts it to None",
          ],
          answerIndex: 1,
          explain:
            "? unwraps Ok values and early-returns Err values to the caller — propagation in one character.",
        },
      },
    ],
    terminal: {
      file: "parse.rs",
      exerciseId: "EX-CH-ERRORS-001",
      code: 'fn halve(text: &str) -> Result<i32, String> {\n    // Parse text as i32 (map parse errors to a String with\n    // .map_err(|e| e.to_string())), reject odd numbers with an\n    // Err of your own, and return Ok(n / 2) otherwise.\n    todo!()\n}\n\nfn main() {\n    println!("{:?}", halve("42"));   // expect Ok(21)\n    println!("{:?}", halve("7"));    // expect Err("7 is odd")\n    println!("{:?}", halve("x"));    // expect a parse Err\n}',
      task: "Implement halve so all three lines print what the comments promise.",
      hints: [
        "let n: i32 = text.trim().parse().map_err(|e: std::num::ParseIntError| e.to_string())?;",
        'if n % 2 != 0 { return Err(format!("{n} is odd")); } Ok(n / 2)',
      ],
    },
  },
  {
    id: "abstraction",
    number: 12,
    title: "Generics, traits, and lifetimes",
    strand: "Abstraction",
    minutes: 16,
    summary:
      "The capstone tour: write code once for many types, name shared behavior, and understand what 'a actually says. This chapter opens the door the rest of the curriculum walks through.",
    concepts: [
      "RFT-RUST-GENERICS-001",
      "RFT-RUST-TRAITS-001",
      "CON-RUST-TRAIT-BOUND-001",
      "CON-RUST-LIFETIME-ANNOTATION-001",
      "CON-RUST-LIFETIME-ELISION-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "Abstraction with receipts.",
        body: [
          "[[RFT-RUST-GENERICS-001|Generics]] let one function serve many types: `fn largest<T>(items: &[T]) -> &T`. But generic code can only do what it has declared: to compare items you need a [[CON-RUST-TRAIT-BOUND-001|bound]] like `T: PartialOrd`. The signature lists every capability the body uses — abstraction with receipts.",
          "A [[RFT-RUST-TRAITS-001|trait]] names shared behavior: `trait Summary { fn summarize(&self) -> String; }`, then `impl Summary for Article { … }`. You've been using traits all along — `#[derive(Debug)]`, Copy, Clone, and PartialOrd are all traits. Generics are compiled by **monomorphization**: a specialized copy per concrete type, so the abstraction costs nothing at runtime.",
          "Finally, the famous one. A [[CON-RUST-LIFETIME-ANNOTATION-001|lifetime annotation]] like `'a` does **not** make anything live longer — it *describes a relationship* between references the compiler then verifies. `fn longest<'a>(x: &'a str, y: &'a str) -> &'a str` says: the result borrows from x or y, so it lives no longer than the shorter of them.",
          "You've already written many functions with references and no `'a` in sight — [[CON-RUST-LIFETIME-ELISION-001|elision rules]] fill in the obvious cases. You only write lifetimes when two references could disagree and the compiler asks you to name the relationship.",
          "From here the path continues into the module system, testing, closures and iterators, smart pointers, and concurrency — each one a chapter ahead in this course. The compiler you've learned to read in these first twelve chapters is the same tutor for all of it.",
        ],
      },
      {
        kind: "code",
        title: "longest.rs",
        code: 'fn longest<\'a>(x: &\'a str, y: &\'a str) -> &\'a str {\n    if x.len() > y.len() { x } else { y }\n}\n\nfn main() {\n    let first = String::from("rust");\n    let second = String::from("tutor");\n    println!("longest: {}", longest(&first, &second));\n}',
        caption:
          "Delete <'a> and the three 'a markers, run it, and the compiler names the exact two lifetimes that disagree — that error is this chapter's final exam.",
      },
      {
        kind: "stop",
        stop: {
          id: "abs-bound",
          prompt: "In fn largest<T: PartialOrd>(items: &[T]), the bound exists because …",
          options: [
            "all generics need at least one bound",
            "the body compares items with >, and T must declare that capability",
            "PartialOrd makes the function faster",
          ],
          answerIndex: 1,
          explain:
            "Generic code can only use declared capabilities. The bound is the receipt for the > in the body.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "abs-lifetime",
          prompt: "True or false — 'a makes the strings live longer.",
          options: ["True", "False — it only describes the relationship between the borrows"],
          answerIndex: 1,
          explain:
            "Lifetimes are descriptions the compiler verifies, never instructions that extend anything. The owner still controls when a value dies.",
        },
      },
    ],
    terminal: {
      file: "longest.rs",
      code: "fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {\n    if x.len() > y.len() { x } else { y }\n}\n\nfn main() {\n    println!(\"{}\", longest(\"rust\", \"tutor\"));\n    // Experiment: delete <'a> and the 'a markers, run, and read\n    // the compiler's suggestion. Then put them back.\n}",
      task: "Run it, then do the deletion experiment in the comment — the error message is the lesson.",
      hints: [
        "Without 'a the compiler says: expected named lifetime parameter — and suggests the exact fix.",
        "The annotation ties the output's validity to the shorter-lived input; main's literals live for the whole program, so everything checks.",
      ],
    },
  },
  {
    id: "modules",
    number: 13,
    title: "Modules and crates",
    strand: "Organizing code",
    minutes: 14,
    summary:
      "One file stops scaling around three hundred lines. Modules give names a home, crates give code a unit of compilation, and `pub` decides what the outside world may touch.",
    concepts: [
      "CON-RUST-MODULE-DECLARATION-001",
      "CON-RUST-MODULE-TREE-001",
      "CON-RUST-VISIBILITY-001",
      "CON-RUST-PACKAGE-CRATE-001",
      "CON-RUST-ITEM-PATH-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "A package is a tree, not a pile.",
        body: [
          "A **package** is what Cargo builds: one `Cargo.toml` plus source. It contains one or more [[CON-RUST-PACKAGE-CRATE-001|crates]] — a library crate rooted at `src/lib.rs`, a binary crate rooted at `src/main.rs`, or both. Everything you `use` from another project is a crate too.",
          "Inside a crate, [[CON-RUST-MODULE-DECLARATION-001|modules]] form a tree. `mod parsing;` declares a child module and tells the compiler to find its body — inline in braces, or in the file `parsing.rs`. The tree starts at the crate root and every item lives at exactly one [[CON-RUST-ITEM-PATH-001|path]] in it, like `crate::parsing::read_header`.",
          "Unlike many languages, the file system does not define the module tree — `mod` declarations do. A file the tree never mentions is simply not compiled. If you have ever added a file and wondered why nothing changed: this is why.",
        ],
      },
      {
        kind: "code",
        title: "src/main.rs",
        code: 'mod readings {\n    pub struct Sample {\n        pub celsius: f64,\n    }\n\n    pub fn parse(token: &str) -> Option<Sample> {\n        let celsius = token.parse().ok()?;\n        Some(Sample { celsius })\n    }\n\n    fn plausible(sample: &Sample) -> bool {\n        sample.celsius > -90.0 && sample.celsius < 60.0\n    }\n\n    pub fn keep(sample: Sample) -> Option<Sample> {\n        if plausible(&sample) { Some(sample) } else { None }\n    }\n}\n\nuse readings::parse;\n\nfn main() {\n    let sample = parse("21.5").and_then(readings::keep);\n    println!("kept: {}", sample.is_some());\n}',
        caption:
          "`plausible` has no `pub`, so it is the module's private business — `main` can call `parse` and `keep` but cannot reach around them.",
      },
      {
        kind: "prose",
        eyebrow: "Visibility",
        heading: "Private by default, public on purpose.",
        body: [
          "Every item is private to its module unless marked `pub`. [[CON-RUST-VISIBILITY-001|Visibility]] is your API contract: the public items are promises, the private ones are free to change on a whim. Struct fields follow the same rule one level deeper — a `pub struct` can still keep its fields private, which forces outsiders through your constructors.",
          "`use` creates a shortcut, nothing more: `use readings::parse;` lets you write `parse(…)` instead of the full path. Idiomatic Rust imports the **parent** for functions (`use std::collections`, then `collections::HashMap::new`… actually for types you import the type itself: `use std::collections::HashMap`) — types by name, functions by parent, so a call site shows where the function came from.",
          "When the tree grows, split modules into files: `mod readings;` in `main.rs` plus a `readings.rs` file is the same program as the inline version. The [[CON-RUST-MODULE-TREE-001|tree]] stays identical; only the storage moved.",
        ],
      },
      {
        kind: "callout",
        title: "The error is a map reference.",
        body: "`error[E0603]: function `plausible` is private` names the module that owns the item and where the privacy boundary sits. Read it as: you are outside the wall; use the public door.",
      },
      {
        kind: "stop",
        stop: {
          id: "mod-file",
          prompt:
            "You add `src/helpers.rs` with useful functions but change nothing else. What happens?",
          options: [
            "Cargo compiles it and the functions are available under crate::helpers",
            "Nothing — no `mod helpers;` declaration means the file is never compiled",
            "It becomes a second binary crate",
          ],
          answerIndex: 1,
          explain:
            "The module tree is built from `mod` declarations, not from the directory listing. Undeclared files are invisible to the compiler.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "mod-pub",
          prompt: "A `pub struct Config` has a private field `path`. Code in another module can …",
          options: [
            "name the type Config, but not touch `path` directly",
            "do nothing with it — private field makes the struct private",
            "read `path` but not assign to it",
          ],
          answerIndex: 0,
          explain:
            "Visibility is per item: the type is public, the field is not. Outsiders construct and inspect it only through whatever public functions you provide.",
        },
      },
    ],
    terminal: {
      file: "src/main.rs",
      code: 'mod inventory {\n    pub struct Item {\n        pub name: String,\n        count: u32,\n    }\n\n    pub fn stock(name: &str, count: u32) -> Item {\n        Item { name: name.to_string(), count }\n    }\n\n    // TODO: main needs to read the count, but the field is private.\n    // Add a public method on Item that returns it (keep the field private):\n    //   impl Item { pub fn count(&self) -> u32 { … } }\n}\n\nfn main() {\n    let item = inventory::stock("bolts", 40);\n    // TODO: replace 0 with the real count via your method.\n    let count = 0;\n    assert_eq!(count, 40);\n    println!("{} in stock: {}", item.name, count);\n}',
      task: "Make the assert pass without making the `count` field public: expose it through a public method instead.",
      hints: [
        "Inside the module: `impl Item { pub fn count(&self) -> u32 { self.count } }` — methods of Item may read its private fields.",
        "In main, replace the 0 with `item.count()`.",
        "Try making the field `pub` instead and notice both work — then ask which one lets you rename the field next month without breaking main.",
      ],
    },
  },
  {
    id: "testing",
    number: 14,
    title: "Testing your code",
    strand: "Organizing code",
    minutes: 14,
    summary:
      "You have been graded by hidden tests all course. Now write your own: `#[test]` functions, assert macros, and the habit of proving a bug before fixing it.",
    concepts: [
      "CON-RUST-EXECUTED-TEST-001",
      "CON-RUST-INTEGRATION-TEST-001",
      "CON-RUST-DETERMINISTIC-TEST-001",
      "CON-RUST-REGRESSION-TEST-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "A test is a function the compiler runs against you.",
        body: [
          "Mark any function `#[test]` and `cargo test` compiles a special binary that runs it. The test passes if the function returns, fails if it panics — and `assert!`, `assert_eq!`, and `assert_ne!` are just panics with good error messages. An [[CON-RUST-EXECUTED-TEST-001|executed test]] is the only kind that counts; a test you never run is documentation at best.",
          "Tests live next to the code in a `#[cfg(test)] mod tests` block — compiled only when testing, invisible in your release binary. This is why this course's exercises could ship tests inside your file all along.",
          "`assert_eq!(left, right)` prints both values when it fails. That failure message is the same kind of teacher as a compile error: it names the expectation and the reality, and the gap between them is the bug.",
        ],
      },
      {
        kind: "code",
        title: "src/main.rs — a unit test in place",
        code: 'fn median_of_three(a: i32, b: i32, c: i32) -> i32 {\n    a.max(b).min(a.max(c)).min(b.max(c))\n}\n\nfn main() {\n    println!("median: {}", median_of_three(3, 9, 5));\n}\n\n#[cfg(test)]\nmod tests {\n    use super::median_of_three;\n\n    #[test]\n    fn middle_value_wins() {\n        assert_eq!(median_of_three(3, 9, 5), 5);\n    }\n\n    #[test]\n    fn ties_are_fine() {\n        assert_eq!(median_of_three(7, 7, 1), 7);\n    }\n}',
        caption:
          "`use super::median_of_three` reaches from the child test module up to the parent — the module tree from chapter thirteen, working for you.",
      },
      {
        kind: "prose",
        eyebrow: "Practice",
        heading: "Prove the bug, then fix it.",
        body: [
          "The professional loop is: see a bug, write the failing test that reproduces it, watch it fail for the right reason, then fix the code and watch it pass. The test stays behind as a [[CON-RUST-REGRESSION-TEST-001|regression guard]] — that exact bug can never return silently.",
          "Keep tests [[CON-RUST-DETERMINISTIC-TEST-001|deterministic]]: same input, same verdict, every run. Clocks, randomness, and thread timing make tests lie — flaky green is worse than honest red.",
          "Bigger projects add [[CON-RUST-INTEGRATION-TEST-001|integration tests]] in a `tests/` directory: separate files that use your library exactly as an outsider would, public API only. The interview exercises in this app's practice section grade you with precisely that layout.",
        ],
      },
      {
        kind: "callout",
        title: "Run one test, not the world.",
        body: "`cargo test middle` runs every test whose name contains `middle`. When a suite grows, filtering keeps the loop tight: edit, run the one test, repeat.",
      },
      {
        kind: "stop",
        stop: {
          id: "test-fail",
          prompt: "A #[test] function fails when …",
          options: [
            "it returns without printing anything",
            "it panics — which is exactly what a failed assert_eq! does",
            "it takes longer than one second",
          ],
          answerIndex: 1,
          explain:
            "Pass = returns, fail = panics. The assert macros are ergonomic panics that report both sides of the comparison.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "test-cfg",
          prompt: "What does #[cfg(test)] above `mod tests` do?",
          options: [
            "runs the module's tests in parallel",
            "compiles the module only for `cargo test`, keeping it out of normal builds",
            "marks the module as required before release",
          ],
          answerIndex: 1,
          explain:
            "It is conditional compilation: test-only code costs your users nothing and can never ship a test helper by accident.",
        },
      },
    ],
    terminal: {
      file: "src/main.rs",
      code: 'fn word_count(text: &str) -> usize {\n    // TODO: bug — empty strings report 1. Reproduce it in the test\n    // below, then fix this to use split_whitespace().\n    text.split(\' \').count()\n}\n\nfn main() {\n    assert_eq!(word_count("the compiler is the tutor"), 5);\n    // TODO: make this assert pass too — it is your failing test.\n    assert_eq!(word_count(""), 0);\n    assert_eq!(word_count("  spaced   out  "), 2);\n    println!("word_count checks pass");\n}',
      task: "Run it and watch the empty-string assert fail; then fix word_count so all three asserts pass.",
      hints: [
        "`\"\".split(' ')` yields one empty item — counting it gives 1. That is the reproduced bug.",
        "`split_whitespace()` skips leading, trailing, and repeated spaces — and yields nothing for an empty string.",
        "One-line fix: `text.split_whitespace().count()`.",
      ],
    },
  },
  {
    id: "closures-iterators",
    number: 15,
    title: "Closures and iterators",
    strand: "Abstraction",
    minutes: 16,
    summary:
      "Functions that capture their surroundings, and pipelines that do nothing until asked. Together they replace most loops you would otherwise write by hand.",
    concepts: [
      "CON-RUST-CLOSURE-CAPTURE-001",
      "CON-RUST-ITERATOR-ADAPTER-001",
      "CON-RUST-ITERATOR-CONSUMER-001",
      "CON-RUST-LAZY-ITERATOR-001",
      "CON-RUST-ITERATION-OWNERSHIP-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "A closure is a function plus its luggage.",
        body: [
          "`|x| x + tax` is a **closure**: an anonymous function that [[CON-RUST-CLOSURE-CAPTURE-001|captures]] `tax` from the scope around it. Capture follows the ownership rules you already know, in order of least privilege: borrow shared if reading, borrow exclusively if mutating, move if the closure must own the value.",
          "Add the `move` keyword to force ownership transfer: `move |x| x + tax` takes `tax` with it. You will need this whenever a closure outlives the scope that made it — returning it from a function, or handing it to a thread in chapter eighteen.",
        ],
      },
      {
        kind: "prose",
        eyebrow: "Pipelines",
        heading: "Adapters describe; consumers do.",
        body: [
          "An iterator is a value that yields items on demand. [[CON-RUST-ITERATOR-ADAPTER-001|Adapters]] like `map`, `filter`, and `take` transform one iterator into another — and do **no work yet**. Iterators are [[CON-RUST-LAZY-ITERATOR-001|lazy]]: nothing runs until a [[CON-RUST-ITERATOR-CONSUMER-001|consumer]] like `collect`, `sum`, or `for` pulls items through the pipeline.",
          "Choose the entry point by [[CON-RUST-ITERATION-OWNERSHIP-001|ownership]]: `.iter()` borrows (`&T` items), `.iter_mut()` borrows exclusively (`&mut T`), `.into_iter()` consumes the collection (`T`). The same three access levels as everywhere else in Rust — iteration is not special, it just makes you choose explicitly.",
          "The payoff: `readings.iter().filter(|r| r.is_finite()).map(|r| r * 9.0 / 5.0 + 32.0).sum::<f64>()` reads as a sentence, compiles to the same machine code as the hand-written loop, and cannot have an off-by-one.",
        ],
      },
      {
        kind: "code",
        title: "pipeline.rs",
        code: 'fn main() {\n    let readings = [21.4, f64::NAN, 19.8, 22.6, f64::NAN, 20.1];\n\n    let clean: Vec<f64> = readings\n        .iter()\n        .copied()\n        .filter(|r| r.is_finite())\n        .collect();\n\n    let average = clean.iter().sum::<f64>() / clean.len() as f64;\n    println!("{} clean readings, average {average:.1}", clean.len());\n}',
        caption:
          "`filter` never runs on its own — `collect` pulls each reading through it once. One pass, no index variable, no off-by-one to write.",
      },
      {
        kind: "callout",
        title: "The compiler still referees captures.",
        body: "If a closure borrows a Vec and you push to that Vec while the closure is alive, you get the borrow error from chapter six — same rule, new syntax. The closure is just another borrower.",
      },
      {
        kind: "stop",
        stop: {
          id: "clo-lazy",
          prompt: "`let it = data.iter().map(expensive);` — how many times has `expensive` run?",
          options: [
            "once per element",
            "zero — adapters are lazy until a consumer pulls",
            "once, to type-check the closure",
          ],
          answerIndex: 1,
          explain:
            "Adapters only describe the pipeline. Work happens when collect, sum, a for loop, or another consumer demands items.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "clo-move",
          prompt: "When do you need `move` in front of a closure?",
          options: [
            "whenever the closure mutates anything",
            "when the closure must own its captures — e.g. it outlives the current scope",
            "always, in 2024 edition Rust",
          ],
          answerIndex: 1,
          explain:
            "Borrowing captures fail the moment the closure travels beyond the borrowed data's scope; move gives the closure its own luggage.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "clo-entry",
          prompt:
            "You want to loop over a Vec<String> and keep using the Vec afterwards. Which entry point?",
          options: [".into_iter()", ".iter()", "either — they are equivalent"],
          answerIndex: 1,
          explain:
            "into_iter consumes the Vec and moves each String out; iter lends &String items and the collection survives.",
        },
      },
    ],
    terminal: {
      file: "src/main.rs",
      code: 'fn main() {\n    let words = ["borrow", "own", "move", "lend", "drop", "clone"];\n\n    // TODO: finish the pipeline: keep only words with len() <= 4,\n    // and uppercase each survivor with .map(|w| w.to_uppercase()).\n    let short: Vec<String> = words\n        .iter()\n        .map(|w| w.to_string())\n        .collect();\n\n    assert_eq!(short, ["OWN", "MOVE", "LEND", "DROP"]);\n    println!("pipeline result: {short:?}");\n}',
      task: "Complete the pipeline so the assert passes: filter to short words, uppercase each, collect.",
      hints: [
        "Order matters for reading but not correctness here: filter before map avoids uppercasing words you will discard.",
        "`collect()` needs to know the target type — the `Vec<String>` annotation on `short` provides it.",
        "Closure parameters in filter receive &&str here; `w.len()` works through the references without ceremony.",
      ],
    },
  },
  {
    id: "trait-objects",
    number: 16,
    title: "Trait objects and dynamic dispatch",
    strand: "Abstraction",
    minutes: 13,
    summary:
      "Generics pick the concrete type at compile time. Sometimes you cannot know it until runtime — `dyn Trait` trades a sliver of speed for that freedom.",
    concepts: [
      "CON-RUST-IMPL-TRAIT-001",
      "CON-RUST-TRAIT-IMPLEMENTATION-001",
      "CON-RUST-TRAIT-BOUND-001",
      "CON-RUST-BOX-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "One list, many shapes.",
        body: [
          "`Vec<T>` holds one concrete type. But a drawing app wants circles **and** squares in the same list; a logger wants console and file sinks in the same slot. The type you write is `Vec<Box<dyn Draw>>`: a vector of owned pointers to *some type that [[CON-RUST-TRAIT-IMPLEMENTATION-001|implements]] Draw*, decided at runtime.",
          "`dyn Trait` is a **trait object**. Calling `shape.draw()` through it looks up the right method in a small table at runtime — dynamic dispatch. Generics (`fn render<T: Draw>`) instead compile a specialized copy per type — static dispatch, no lookup, but every element of a `Vec<T>` must still be the same T.",
          "`impl Trait` in return position ([[CON-RUST-IMPL-TRAIT-001|impl Trait]]) is the third option: 'some concrete type implementing Trait, I am just not naming it.' Still static, still one type — a convenience for unnameable types like closures, not a runtime choice.",
        ],
      },
      {
        kind: "code",
        title: "shapes.rs",
        code: 'trait Describe {\n    fn describe(&self) -> String;\n}\n\nstruct Circle {\n    radius: f64,\n}\n\nstruct Label {\n    text: String,\n}\n\nimpl Describe for Circle {\n    fn describe(&self) -> String {\n        format!("circle r={}", self.radius)\n    }\n}\n\nimpl Describe for Label {\n    fn describe(&self) -> String {\n        format!("label \'{}\'", self.text)\n    }\n}\n\nfn main() {\n    let items: Vec<Box<dyn Describe>> = vec![\n        Box::new(Circle { radius: 2.0 }),\n        Box::new(Label { text: "hub".to_string() }),\n    ];\n    for item in &items {\n        println!("{}", item.describe());\n    }\n}',
        caption:
          "Two unrelated structs share one vector because the vector stores pointers to the trait, not the structs themselves. The Box is required: dyn Trait has no fixed size on its own.",
      },
      {
        kind: "callout",
        title: "Reach for generics first.",
        body: "Static dispatch is the default for a reason: faster, inlineable, checked harder. Choose dyn when you genuinely need mixed types in one place or plugin-like late binding — not as a habit.",
      },
      {
        kind: "stop",
        stop: {
          id: "dyn-why-box",
          prompt: "Why `Vec<Box<dyn Describe>>` and not `Vec<dyn Describe>`?",
          options: [
            "style convention from the standard library",
            "dyn Describe is unsized — elements need a pointer with a known size, like Box",
            "Vec requires Box for anything containing a String",
          ],
          answerIndex: 1,
          explain:
            "Different implementors have different sizes, so the vector stores uniform-size boxes pointing at them.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "dyn-dispatch",
          prompt:
            "fn render<T: Describe>(item: &T) versus fn render(item: &dyn Describe) — the generic version …",
          options: [
            "decides the method at runtime via a table",
            "compiles a specialized copy per concrete type, dispatching statically",
            "accepts mixed types in one call",
          ],
          answerIndex: 1,
          explain:
            "Monomorphization from chapter twelve: per-type copies, direct calls. The dyn version is one function using runtime lookup.",
        },
      },
    ],
    terminal: {
      file: "src/main.rs",
      code: 'trait Notify {\n    fn message(&self) -> String;\n}\n\nstruct Email {\n    to: String,\n}\n\nstruct Sms {\n    digits: String,\n}\n\nimpl Notify for Email {\n    fn message(&self) -> String {\n        format!("email -> {}", self.to)\n    }\n}\n\n// TODO: finish this impl so it reads "sms -> <digits>".\nimpl Notify for Sms {\n    fn message(&self) -> String {\n        String::new()\n    }\n}\n\nfn main() {\n    let queue: Vec<Box<dyn Notify>> = vec![\n        Box::new(Email { to: "ada@example.com".to_string() }),\n        Box::new(Sms { digits: "555-0100".to_string() }),\n    ];\n    let lines: Vec<String> = queue.iter().map(|n| n.message()).collect();\n    assert_eq!(lines, ["email -> ada@example.com", "sms -> 555-0100"]);\n    println!("{lines:?}");\n}',
      task: "Finish the Sms implementation so both notification kinds ride the same queue and the assert passes.",
      hints: [
        'Mirror the Email impl: `format!("sms -> {}", self.digits)`.',
        "The vector type Vec<Box<dyn Notify>> is what lets two different structs share the queue — no enum needed.",
      ],
    },
  },
  {
    id: "smart-pointers",
    number: 17,
    title: "Smart pointers: Box, Rc, RefCell",
    strand: "Ownership & borrowing",
    minutes: 16,
    summary:
      "Three standard-library types that bend the ownership rules without breaking them: heap allocation on demand, shared ownership with a count, and borrow checking moved to runtime.",
    concepts: [
      "CON-RUST-BOX-001",
      "CON-RUST-SCOPE-DROP-001",
      "CON-RUST-SHARED-BORROW-001",
      "CON-RUST-EXCLUSIVE-BORROW-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "Box: one owner, heap address.",
        body: [
          "[[CON-RUST-BOX-001|Box<T>]] moves a value to the heap and owns it from the stack. Ownership works exactly as in chapter five — one owner, [[CON-RUST-SCOPE-DROP-001|dropped at scope end]] — only the bytes live elsewhere. You reach for it for recursive types (`enum List { Cons(i32, Box<List>), Nil }` — without the Box the type would be infinitely large) and for trait objects like last chapter's `Box<dyn Notify>`.",
          "Deref makes boxes transparent: `*boxed` reaches the value, and method calls do it automatically — `boxed.len()` just works. Most of the time a Box behaves like the value it holds.",
        ],
      },
      {
        kind: "prose",
        eyebrow: "Sharing",
        heading: "Rc: ownership with a reference count.",
        body: [
          "Sometimes single ownership is genuinely the wrong shape: two playlist entries share one song. `Rc<T>` (reference counted) allows many owners: `Rc::clone(&song)` increments a counter instead of copying the song, and the value drops when the **last** owner goes. `Rc::strong_count` shows the live count.",
          "The price: an Rc hands out only [[CON-RUST-SHARED-BORROW-001|shared access]]. Many owners who could all mutate would be exactly the aliasing chaos the borrow checker exists to prevent — so Rc alone is read-only sharing.",
        ],
      },
      {
        kind: "prose",
        eyebrow: "Interior mutability",
        heading: "RefCell: the borrow checker at runtime.",
        body: [
          "`RefCell<T>` keeps the one-writer-or-many-readers law but enforces it **at runtime**: `.borrow()` and `.borrow_mut()` count active borrows and panic on a violation instead of failing the build. This is [[CON-RUST-EXCLUSIVE-BORROW-001|exclusive access]] checked by a bouncer instead of a building inspector.",
          "The classic pairing `Rc<RefCell<T>>` gives shared ownership **and** controlled mutation — several owners, each able to briefly borrow mutably. Powerful, occasionally necessary, and the first thing to reconsider when a design feels tangled: most programs want plain ownership most of the time.",
        ],
      },
      {
        kind: "code",
        title: "shared.rs",
        code: 'use std::cell::RefCell;\nuse std::rc::Rc;\n\nfn main() {\n    let scores = Rc::new(RefCell::new(vec![10, 20]));\n\n    let for_display = Rc::clone(&scores);\n    let for_updates = Rc::clone(&scores);\n\n    for_updates.borrow_mut().push(30);\n\n    println!("owners: {}", Rc::strong_count(&scores));\n    println!("scores: {:?}", for_display.borrow());\n}',
        caption:
          "Three owners of one growing vector. Swap the borrow_mut/borrow calls to overlap in one expression and the program still compiles — then panics: already borrowed. Runtime enforcement is real enforcement.",
      },
      {
        kind: "callout",
        title: "Rc is single-threaded on purpose.",
        body: "Its counter is not atomic — cheaper, but unsafe across threads, and the compiler will refuse to send one. The thread-safe sibling Arc arrives in the next chapter.",
      },
      {
        kind: "stop",
        stop: {
          id: "sp-rc-clone",
          prompt: "Rc::clone(&data) …",
          options: [
            "deep-copies the data like .clone() on a Vec",
            "increments the owner count; the data itself is not copied",
            "creates a weak reference that cannot keep the data alive",
          ],
          answerIndex: 1,
          explain:
            "Rc::clone is a counter bump — that is why the convention writes Rc::clone(&x) rather than x.clone(): it signals 'cheap share', not 'copy'.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "sp-refcell",
          prompt: "Two overlapping borrow_mut() calls on one RefCell …",
          options: [
            "fail to compile, as with & and &mut",
            "compile, then panic at runtime when the second borrow starts",
            "silently queue: the second waits for the first",
          ],
          answerIndex: 1,
          explain:
            "RefCell defers the exclusive-access check to runtime. The law is identical; only the enforcement moment moves.",
        },
      },
    ],
    terminal: {
      file: "src/main.rs",
      code: 'use std::cell::RefCell;\nuse std::rc::Rc;\n\nfn main() {\n    let log = Rc::new(RefCell::new(Vec::<String>::new()));\n\n    // TODO: `sensor` should be a second owner of `log`, not a separate\n    // fresh log. Share it with Rc::clone.\n    let sensor = Rc::new(RefCell::new(Vec::<String>::new()));\n\n    sensor.borrow_mut().push("21.4C".to_string());\n    log.borrow_mut().push("21.9C".to_string());\n\n    assert_eq!(Rc::strong_count(&log), 2);\n    assert_eq!(log.borrow().len(), 2);\n    println!("owners: {} entries: {:?}", Rc::strong_count(&log), log.borrow());\n}',
      task: "Make sensor a second owner of the same log — run it first and read which assert catches the separate-log bug.",
      hints: [
        "`let sensor = Rc::clone(&log);` — a counter bump, not a data copy. The separate Rc::new builds an unrelated log.",
        "Both pushes go through borrow_mut(), one at a time — sequential borrows are fine; overlapping ones panic.",
      ],
    },
  },
  {
    id: "concurrency",
    number: 18,
    title: "Fearless concurrency: threads and channels",
    strand: "Concurrency & beyond",
    minutes: 15,
    summary:
      "Spawn real OS threads and let ownership do what locks and luck do elsewhere: the data races that plague other languages simply fail to compile.",
    concepts: [
      "CON-RUST-THREAD-LIFECYCLE-001",
      "CON-RUST-THREAD-MOVE-CAPTURE-001",
      "CON-RUST-CHANNEL-CLOSURE-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "A thread takes its luggage or nothing.",
        body: [
          "`thread::spawn(|| …)` starts a real OS thread running your closure and returns a `JoinHandle`; calling `.join()` waits for it to finish. The [[CON-RUST-THREAD-LIFECYCLE-001|lifecycle]] rule: a spawned thread may outlive the function that spawned it, so it **cannot borrow** from that function's stack.",
          "That is why thread closures are almost always [[CON-RUST-THREAD-MOVE-CAPTURE-001|move closures]]: `thread::spawn(move || …)` transfers ownership of everything captured. Forget the `move` and the compiler explains it verbatim: closure may outlive the current function, but it borrows `data` — with the fix suggested. The data race you would have debugged at 3 a.m. in C++ is a compile error here.",
        ],
      },
      {
        kind: "prose",
        eyebrow: "Messages",
        heading: "Channels: ownership transfer as communication.",
        body: [
          "`std::sync::mpsc::channel()` gives a transmitter and a receiver. `tx.send(value)` **moves** the value to the other thread — after sending you cannot touch it, which is precisely what makes it safe. The receiver iterates: `for msg in rx` yields messages until every transmitter is dropped, then the loop [[CON-RUST-CHANNEL-CLOSURE-001|ends on its own]].",
          "That shutdown-by-drop is idiomatic: no sentinel values, no stop flags. When the senders go out of scope, the channel closes and the consumer finishes. Do not communicate by sharing memory; share memory by communicating.",
          "When you truly need shared mutable state across threads, the smart-pointer story completes: `Arc<Mutex<T>>` — Arc is Rc with an atomic count, Mutex hands out exclusive access one thread at a time. Same shapes as Rc<RefCell<T>>, enforcement tuned for threads.",
        ],
      },
      {
        kind: "code",
        title: "workers.rs",
        code: 'use std::sync::mpsc;\nuse std::thread;\n\nfn main() {\n    let (tx, rx) = mpsc::channel();\n\n    for id in 0..3 {\n        let tx = tx.clone();\n        thread::spawn(move || {\n            let checksum = (0..1_000u64).map(|n| n * (id + 1)).sum::<u64>();\n            tx.send(format!("worker {id}: {checksum}")).unwrap();\n        });\n    }\n    drop(tx); // the loop below ends when all senders are gone\n\n    for line in rx {\n        println!("{line}");\n    }\n    println!("all workers reported");\n}',
        caption:
          "Each worker owns its clone of the transmitter. Dropping the original in main means the receiver loop ends exactly when the last worker finishes — no counters, no flags.",
      },
      {
        kind: "callout",
        title: "Order is real concurrency.",
        body: "Run the workers example twice — the three reports can arrive in any order. What Rust guarantees is the absence of data races, not a schedule. Determinism of outcome, not of interleaving, is what your tests should assert.",
      },
      {
        kind: "stop",
        stop: {
          id: "conc-move",
          prompt:
            'Why does thread::spawn(|| println!("{data}")) fail to compile when `data` is a local String?',
          options: [
            "closures cannot print captured values",
            "the thread may outlive the function owning `data`, so borrowing is unsound — move is required",
            "String is not thread-safe",
          ],
          answerIndex: 1,
          explain:
            "The compiler cannot bound the thread's lifetime, so stack borrows are rejected; `move` transfers ownership and the problem dissolves.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "conc-send",
          prompt: "After tx.send(report) succeeds, the sending thread …",
          options: [
            "can keep reading `report` until the receiver takes it",
            "no longer owns `report` — send moved it, like any other move",
            "holds a shared borrow of `report`",
          ],
          answerIndex: 1,
          explain:
            "Channel transfer is ownership transfer. That is the whole safety argument: one owner at a time, even across threads.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "conc-close",
          prompt: "A `for msg in rx` loop ends when …",
          options: [
            "the receiver times out",
            "every transmitter has been dropped and the buffer is drained",
            "a special close message is sent",
          ],
          answerIndex: 1,
          explain:
            "Channel closure is structural: no senders left means no more messages can exist, so iteration completes. Shutdown falls out of ownership.",
        },
      },
    ],
    terminal: {
      file: "src/main.rs",
      code: 'use std::sync::mpsc;\nuse std::thread;\n\nfn main() {\n    let (tx, rx) = mpsc::channel();\n    let words = vec!["fear".to_string(), "less".to_string(), "concurrency".to_string()];\n\n    // TODO: this does not compile yet — the thread borrows `words` and\n    // `tx` but may outlive main\'s stack. One keyword fixes it.\n    let handle = thread::spawn(|| {\n        for word in words {\n            tx.send(word.len()).unwrap();\n        }\n    });\n\n    let total: usize = rx.iter().sum();\n    handle.join().unwrap();\n    assert_eq!(total, 19);\n    println!("total letters counted across threads: {total}");\n}',
      task: "Make it compile and pass by giving the spawned thread ownership of what it uses — one keyword.",
      hints: [
        "Run it as-is and read the full error: it names the borrow, the escape, and suggests the exact keyword.",
        "`thread::spawn(move || …)` — the closure takes `words` and `tx` as its own luggage.",
        "The receiver loop ends because the thread's `tx` is dropped when the closure finishes — that is why sum() returns at all.",
      ],
    },
  },
  {
    id: "shared-state",
    number: 19,
    title: "Shared state: Arc and Mutex",
    strand: "Concurrency & beyond",
    minutes: 13,
    summary:
      "When threads must write to one place, pair the atomic reference count with a lock. The type system makes the lock impossible to forget.",
    concepts: [
      "CON-RUST-MUTEX-POISONING-001",
      "CON-RUST-THREAD-MOVE-CAPTURE-001",
      "CON-RUST-EXCLUSIVE-BORROW-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "The model",
        heading: "The lock owns the data.",
        body: [
          "In most languages a mutex sits **beside** the data it guards, and remembering to lock is a convention. Rust's `Mutex<T>` **contains** its data: the only way to reach the `T` is `lock()`, which returns a guard giving [[CON-RUST-EXCLUSIVE-BORROW-001|exclusive access]]. When the guard drops at scope end, the lock releases itself. You cannot forget to lock; you cannot forget to unlock.",
          "To share that mutex across threads you need multi-owner ownership with an atomic counter: `Arc<T>` — Rc's thread-safe sibling. The pattern `Arc<Mutex<T>>` is the concurrent twin of `Rc<RefCell<T>>` from chapter seventeen: same two-layer shape, owners on the outside, controlled mutation inside.",
          "One honest wrinkle: if a thread panics while holding the lock, the mutex is [[CON-RUST-MUTEX-POISONING-001|poisoned]] — later `lock()` calls return an Err so you know the protected data may be half-updated. `unwrap()` on the lock is the common choice: if an invariant died, dying loudly beats limping.",
        ],
      },
      {
        kind: "code",
        title: "counter.rs",
        code: 'use std::sync::{Arc, Mutex};\nuse std::thread;\n\nfn main() {\n    let counter = Arc::new(Mutex::new(0u32));\n    let mut handles = Vec::new();\n\n    for _ in 0..8 {\n        let counter = Arc::clone(&counter);\n        handles.push(thread::spawn(move || {\n            for _ in 0..1_000 {\n                *counter.lock().unwrap() += 1;\n            }\n        }));\n    }\n    for handle in handles {\n        handle.join().unwrap();\n    }\n    println!("count: {}", *counter.lock().unwrap());\n}',
        caption:
          "Eight threads, eight thousand increments, exactly 8000 every run. Replace Arc with Rc and the compiler stops you: `Rc<Mutex<u32>> cannot be sent between threads safely` — the Send check is the fearless part.",
      },
      {
        kind: "callout",
        title: "Prefer messages; reach for locks knowingly.",
        body: "Channels move data and end cleanly; locks share data and contend. Both are safe in Rust — but a design that mostly sends messages usually has fewer places where threads can wait on each other.",
      },
      {
        kind: "stop",
        stop: {
          id: "shared-lock",
          prompt: "counter.lock().unwrap() returns a guard. When does the lock release?",
          options: [
            "when you call unlock() on the guard",
            "when the guard goes out of scope and drops",
            "when the thread ends",
          ],
          answerIndex: 1,
          explain:
            "Release is Drop — the scope rules from chapter five running your unlock. There is no unlock method to forget.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "shared-arc",
          prompt: "Why Arc and not Rc for the shared counter?",
          options: [
            "Arc's count updates are atomic, so it is safe (and allowed by the compiler) across threads",
            "Arc is faster in single-threaded code",
            "Rc cannot hold a Mutex",
          ],
          answerIndex: 0,
          explain:
            "Rc's cheap non-atomic counter is exactly what makes it not Send; the compiler enforces the boundary so you find out at build time.",
        },
      },
    ],
    terminal: {
      file: "src/main.rs",
      code: 'use std::sync::{Arc, Mutex};\nuse std::thread;\n\nfn main() {\n    let total = Arc::new(Mutex::new(0u64));\n    let mut handles = Vec::new();\n\n    for chunk in [1..=25u64, 26..=50, 51..=75, 76..=100] {\n        let total = Arc::clone(&total);\n        handles.push(thread::spawn(move || {\n            let part: u64 = chunk.sum();\n            // TODO: this overwrites instead of accumulating — each thread\n            // stomps the last one\'s work. Fix the operator.\n            *total.lock().unwrap() = part;\n        }));\n    }\n\n    for handle in handles {\n        handle.join().unwrap();\n    }\n    assert_eq!(*total.lock().unwrap(), 5050);\n    println!("1..=100 summed across 4 threads: {}", *total.lock().unwrap());\n}',
      task: "Run it a few times — the wrong answer changes between runs. Fix the accumulation so the classic 5050 comes out every time.",
      hints: [
        "`=` makes the final total whichever thread wrote last; `+=` accumulates under the lock.",
        "The wrong answers vary run to run because thread order varies — the lock made the writes safe, not correct.",
      ],
    },
  },
  {
    id: "road-ahead",
    number: 20,
    title: "The road ahead",
    strand: "Concurrency & beyond",
    minutes: 12,
    summary:
      "A guided look over the fence: richer patterns, async, unsafe, and macros — what each is for, and which door in this app continues the path.",
    concepts: [
      "CON-RUST-ASYNC-SUITABILITY-001",
      "CON-RUST-UNSAFE-OBLIGATION-001",
      "CON-RUST-MACRO-ACTIVATION-001",
    ],
    sections: [
      {
        kind: "prose",
        eyebrow: "Patterns",
        heading: "match is deeper than you have used it.",
        body: [
          "Patterns destructure as they test: `let Point { x, y } = origin;` pulls fields in one motion, `if let Some(name) = maybe` handles one case without ceremony, and match arms take guards (`Some(n) if n > threshold`), ranges (`1..=5`), bindings (`big @ 100..`), and or-patterns (`'a' | 'e' | 'i'`). Every place Rust binds a name accepts a pattern — function parameters and for loops included.",
          "The habit worth keeping: when data has shape, reach for a pattern before an accessor chain. The compiler checks exhaustiveness either way — patterns just let it check more of your intent.",
        ],
      },
      {
        kind: "code",
        title: "triage.rs",
        code: 'enum Reading {\n    Ok(f64),\n    Suspect { value: f64, sensor: u8 },\n    Offline,\n}\n\nfn triage(reading: &Reading) -> String {\n    match reading {\n        Reading::Ok(v) if *v < 100.0 => format!("nominal {v}"),\n        Reading::Ok(v) => format!("overrange {v}"),\n        Reading::Suspect { value, sensor } => format!("verify sensor {sensor}: {value}"),\n        Reading::Offline => "offline".to_string(),\n    }\n}\n\nfn main() {\n    for reading in [\n        Reading::Ok(98.6),\n        Reading::Ok(120.0),\n        Reading::Suspect { value: 61.2, sensor: 3 },\n        Reading::Offline,\n    ] {\n        println!("{}", triage(&reading));\n    }\n}',
        caption:
          "Guards, struct destructuring, and exhaustiveness in one match. Delete the Offline arm and the compiler lists exactly what you failed to handle.",
      },
      {
        kind: "prose",
        eyebrow: "Async",
        heading: "Async: concurrency for waiting.",
        body: [
          "Threads shine when work is CPU; **async** shines when work is [[CON-RUST-ASYNC-SUITABILITY-001|waiting]] — thousands of network connections that mostly sit idle. `async fn` returns a future that does nothing until awaited; a runtime like tokio schedules thousands of them on a few threads. The ownership and borrowing rules you know are the same ones that make those futures safe to interleave.",
          "The standard library defines the mechanism but ships no runtime, so async Rust starts with picking one — that, plus futures' laziness and [[CON-RUST-ASYNC-CANCELLATION-001|cancellation]] being a drop, is why it deserves its own dedicated study once a network project demands it.",
        ],
      },
      {
        kind: "prose",
        eyebrow: "Unsafe & macros",
        heading: "The escape hatch and the code that writes code.",
        body: [
          "`unsafe` does not turn checks off — it marks a block where **you** carry [[CON-RUST-UNSAFE-OBLIGATION-001|the proof obligation]] the compiler normally carries: raw pointer dereferences, foreign function calls. The standard library is full of small audited unsafe blocks wrapped in safe APIs; that wrapping discipline is the entire craft, and most application code never writes one.",
          "[[CON-RUST-MACRO-ACTIVATION-001|Macros]] you have used since `println!` in chapter one: code expanded at compile time. `derive(Debug)`, `vec![]`, `assert_eq!` — reading what a macro expands to demystifies it; writing your own is a tool for when a pattern repeats past tolerance.",
          "From here, this app's path continues below this course: the **practice workbench** drills each pattern family, the **projects** build real tools stage by stage, and the **curriculum graph** maps every concept you have met to the evidence you have banked. The compiler stays the tutor; you now read it fluently.",
        ],
      },
      {
        kind: "callout",
        title: "You are past the hard part.",
        body: "Ownership, borrowing, lifetimes, traits — the concepts that make Rust feel foreign are behind you. Everything ahead is those same ideas wearing new clothes.",
      },
      {
        kind: "stop",
        stop: {
          id: "road-guard",
          prompt: "In `Reading::Ok(v) if *v < 100.0 => …`, when the guard is false …",
          options: [
            "the match panics",
            "matching falls through to try the later arms",
            "the arm returns a default value",
          ],
          answerIndex: 1,
          explain:
            "A failed guard means this arm did not match after all; the next arm gets its turn — which is why the plain Ok(v) arm below it is reachable.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "road-async",
          prompt: "Ten thousand mostly-idle network connections. Threads or async?",
          options: [
            "threads — one per connection is simplest",
            "async — tasks are cheap where threads are not, and the work is waiting",
            "neither works in Rust without unsafe",
          ],
          answerIndex: 1,
          explain:
            "Ten thousand OS threads is real memory and scheduler pressure; ten thousand futures on a runtime is routine. CPU-bound work reverses the advice.",
        },
      },
      {
        kind: "stop",
        stop: {
          id: "road-unsafe",
          prompt: "An `unsafe` block …",
          options: [
            "disables the borrow checker inside it",
            "permits a short list of extra operations, with you guaranteeing their soundness",
            "is required for calling any non-standard-library code",
          ],
          answerIndex: 1,
          explain:
            "Borrow checking still runs everywhere. Unsafe adds capabilities (raw pointers, FFI, …) and transfers the proof burden to the author — which is why good code keeps the blocks small and wrapped.",
        },
      },
    ],
    terminal: {
      file: "src/main.rs",
      code: 'enum Event {\n    Click { x: i32, y: i32 },\n    Key(char),\n    Quit,\n}\n\nfn label(event: &Event) -> String {\n    match event {\n        // TODO: this match is not exhaustive — run it and let the compiler\n        // list what is missing. Add, in this order:\n        //   Key(\'q\') => "quit key",  Key(c) => "key <c>",  Quit => "quit".\n        Event::Click { x, y } => format!("click at {x},{y}"),\n    }\n}\n\nfn main() {\n    let events = [Event::Click { x: 4, y: 2 }, Event::Key(\'q\'), Event::Key(\'w\'), Event::Quit];\n    let labels: Vec<String> = events.iter().map(label).collect();\n    assert_eq!(labels, ["click at 4,2", "quit key", "key w", "quit"]);\n    println!("{labels:?}");\n}',
      task: "Complete the match: a literal-pattern arm for 'q', a binding arm for other keys, and the Quit arm — exhaustiveness is your checklist.",
      hints: [
        "Delete the three lower arms and read the error: the compiler lists the exact patterns not covered.",
        "Arm order matters here: Key('q') must sit above Key(c), or the binding arm swallows the literal.",
        "`events.iter().map(label)` works because label takes &Event — the iterator lends each event.",
      ],
    },
  },
];

export const strands = [...new Set(chapters.map((chapter) => chapter.strand))];

export function chapterById(id: string): Chapter | undefined {
  return chapters.find((chapter) => chapter.id === id);
}

export function chapterNeighbors(id: string): { previous?: Chapter; next?: Chapter } {
  const index = chapters.findIndex((chapter) => chapter.id === id);
  if (index < 0) return {};
  return { previous: chapters[index - 1], next: chapters[index + 1] };
}

/* ---- client-side chapter progress (stops cleared + terminal ran) ---- */

const PROGRESS_KEY = "rust-tutor:course-progress:v1";

export type ChapterProgress = { stops: string[]; ran: boolean };

function readProgress(): Record<string, ChapterProgress> {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ChapterProgress>;
  } catch {
    return {};
  }
}

export function chapterProgress(id: string): ChapterProgress {
  return readProgress()[id] ?? { stops: [], ran: false };
}

export function saveChapterProgress(id: string, update: Partial<ChapterProgress>): ChapterProgress {
  const all = readProgress();
  const current = all[id] ?? { stops: [], ran: false };
  const next: ChapterProgress = {
    stops: update.stops ? [...new Set(update.stops)] : current.stops,
    ran: update.ran ?? current.ran,
  };
  all[id] = next;
  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  return next;
}

export function chapterIsComplete(chapter: Chapter): boolean {
  const progress = chapterProgress(chapter.id);
  const stopCount = chapter.sections.filter((section) => section.kind === "stop").length;
  return progress.ran && progress.stops.length >= stopCount;
}

/**
 * Fold durable server progress into the localStorage cache (union of stops,
 * OR of ran), so a cleared browser re-hydrates from SQLite. Returns whether the
 * cache changed, so callers can trigger a re-render only when needed.
 */
export function mergeServerProgress(
  rows: { chapterId: string; clearedStops: string[]; ran: boolean }[],
): boolean {
  const all = readProgress();
  let changed = false;
  for (const row of rows) {
    const current = all[row.chapterId] ?? { stops: [], ran: false };
    const stops = [...new Set([...current.stops, ...row.clearedStops])];
    const ran = current.ran || row.ran;
    if (stops.length !== current.stops.length || ran !== current.ran) {
      all[row.chapterId] = { stops, ran };
      changed = true;
    }
  }
  if (changed) window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  return changed;
}
