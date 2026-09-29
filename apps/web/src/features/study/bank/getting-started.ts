import { int, pick } from "../rng";
import type { SegmentBank } from "../types";
import { program, valueChoice } from "./helpers";

const helloRust: SegmentBank = {
  chapterId: "hello-rust",
  questions: [
    {
      id: "hello-q-main",
      kind: "choice",
      topic: "entry-point",
      difficulty: 1,
      prompt:
        "A binary crate has three functions: `setup`, `main`, and `run`. Which one does the program start in?",
      options: ["`setup`, because it is defined first", "`main`", "`run`, if `main` calls it"],
      answer: 1,
      feedback: [
        "Definition order never decides where execution starts.",
        null,
        "`run` may execute, but only because `main` started first and called it.",
      ],
      explain:
        "Every Rust binary has exactly one entry point, `fn main`. Other functions run only when something reachable from `main` calls them.",
    },
    {
      id: "hello-q-macro-bang",
      kind: "choice",
      topic: "entry-point",
      difficulty: 1,
      prompt: "What does the `!` in `println!` tell you?",
      options: [
        "The call can panic",
        "It is a macro, expanded at compile time",
        "The output is flushed immediately",
      ],
      answer: 1,
      explain:
        "A trailing `!` marks a macro invocation. `println!` expands into code that checks its format string against its arguments at compile time.",
    },
    {
      id: "hello-q-cargo-run",
      kind: "recall",
      topic: "toolchain",
      difficulty: 1,
      prompt: "Type the Cargo command that compiles the current package and then runs its binary.",
      accept: ["cargo run"],
      explain:
        "`cargo run` builds if anything changed and then executes the binary. `cargo build` only builds.",
    },
    {
      id: "hello-q-cargo-check",
      kind: "recall",
      topic: "toolchain",
      difficulty: 2,
      prompt:
        "Type the Cargo command that type-checks the package as fast as possible without producing an executable.",
      accept: ["cargo check"],
      explain:
        "`cargo check` runs the compiler's analysis without code generation, so it is the fastest feedback loop while editing.",
    },
    {
      id: "hello-q-lockfile",
      kind: "choice",
      topic: "toolchain",
      difficulty: 2,
      prompt: "What is the job of `Cargo.lock`?",
      options: [
        "It declares which dependencies the package wants",
        "It records the exact resolved dependency versions so builds are reproducible",
        "It prevents two Cargo processes from building at once",
      ],
      answer: 1,
      feedback: [
        'That is `Cargo.toml`: requirements such as `rand = "0.8"`.',
        null,
        "Build locking is internal to Cargo; `Cargo.lock` is about dependency versions.",
      ],
      explain:
        "`Cargo.toml` states requirements; `Cargo.lock` pins what resolution chose. Committing the lock file makes a binary build identically on another machine.",
    },
    {
      id: "hello-q-cargo-new",
      kind: "multi",
      topic: "toolchain",
      difficulty: 2,
      prompt: "Select every file `cargo new hello` creates before you build anything.",
      options: [
        "`hello/Cargo.toml`",
        "`hello/src/main.rs`",
        "`hello/Cargo.lock`",
        "`hello/target/`",
      ],
      answers: [0, 1],
      explain:
        "`cargo new` writes the manifest and a hello-world `src/main.rs` (plus a Git repository). `Cargo.lock` and `target/` appear on the first build.",
    },
    {
      id: "hello-q-release-dir",
      kind: "choice",
      topic: "toolchain",
      difficulty: 2,
      prompt: "Where does `cargo build --release` place the optimised binary?",
      options: ["`target/debug/`", "`target/release/`", "`bin/`"],
      answer: 1,
      explain:
        "Each profile has its own directory. Debug builds go to `target/debug/`; release builds with optimisations go to `target/release/`.",
    },
    {
      id: "hello-q-when-checked",
      kind: "choice",
      topic: "compile-model",
      difficulty: 1,
      prompt:
        "You mistype a variable name deep inside a function that only runs on Sundays. When does Rust tell you?",
      options: [
        "On the first Sunday the function runs",
        "When the program is compiled, before it can run at all",
        "Only if a test covers that function",
      ],
      answer: 1,
      explain:
        "rustc resolves every name in the whole program during compilation. An unknown name is error E0425 and no binary is produced.",
    },
    {
      id: "hello-q-format-sum",
      kind: "output",
      topic: "printing",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    println!("{} + {} = {}", 2, 3, 2 + 3);\n}',
      answer: "2 + 3 = 5",
      explain:
        "Each `{}` is filled, in order, by the next argument. The third argument is the expression `2 + 3`, evaluated before formatting.",
    },
    {
      id: "hello-q-print-vs-println",
      kind: "output",
      topic: "printing",
      difficulty: 2,
      prompt: "What exactly does this print? (Type each line on its own line.)",
      code: 'fn main() {\n    print!("a");\n    print!("b");\n    println!("c");\n    println!("d");\n}',
      answer: "abc\nd",
      explain:
        "`print!` writes without a newline; `println!` appends one. So a, b, and c share a line.",
    },
    {
      id: "hello-q-debug-quotes",
      kind: "output",
      topic: "printing",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    println!("{:?}", "hi");\n}',
      answer: '"hi"',
      explain:
        "`{:?}` uses the `Debug` format, which shows a string with its quotes (and escapes) so you can see exactly what it contains. `{}` would print `hi`.",
    },
    {
      id: "hello-q-inline-args",
      kind: "compiles",
      topic: "printing",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let name = "Ferris";\n    println!("Hello, {name}!");\n}',
      compiles: true,
      explain:
        "Format strings can capture variables in scope by name (`{name}`). The macro still checks at compile time that `name` exists.",
    },
    {
      id: "hello-q-missing-semicolon",
      kind: "compiles",
      topic: "compile-model",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    println!("one")\n    println!("two");\n}',
      compiles: false,
      explain:
        "Two statements need a `;` between them. The parser rejects the file before type checking; rustc points at the exact place and suggests the semicolon.",
    },
    {
      id: "hello-q-arg-count",
      kind: "compiles",
      topic: "printing",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    println!("{} and {}", 1);\n}',
      compiles: false,
      explain:
        "`println!` checks its format string at compile time: two placeholders but one argument is a compile error, not a runtime surprise.",
    },
    {
      id: "hello-q-fmt-clippy",
      kind: "choice",
      topic: "toolchain",
      difficulty: 1,
      prompt: "Which pairing is correct?",
      options: [
        "`cargo fmt` formats code; `cargo clippy` suggests idiomatic fixes and catches common mistakes",
        "`cargo fmt` finds bugs; `cargo clippy` formats code",
        "Both only work on nightly Rust",
      ],
      answer: 0,
      explain:
        "rustfmt enforces the standard layout so reviews focus on meaning; Clippy adds hundreds of lints beyond the compiler's own.",
    },
    {
      id: "hello-q-comment",
      kind: "output",
      topic: "printing",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    // println!("first");\n    println!("second"); // println!("third");\n}',
      answer: "second",
      explain: "`//` comments out the rest of its line, including code after a statement.",
    },
  ],
  generators: [
    {
      id: "hello-g-arith",
      topic: "printing",
      difficulty: 2,
      make: (rng) => {
        const a = int(rng, 2, 9);
        const b = int(rng, 2, 9);
        const c = int(rng, 2, 9);
        const d = int(rng, 10, 40);
        const e = int(rng, 2, 7);
        const value = a + b * c - Math.trunc(d / e);
        return {
          kind: "output",
          prompt:
            "Integer arithmetic follows normal precedence and `/` truncates. What does this print?",
          code: program(`println!("{}", ${a} + ${b} * ${c} - ${d} / ${e});`),
          answer: String(value),
          explain: `Multiplication and division bind tighter than + and -: ${b} * ${c} = ${b * c} and ${d} / ${e} = ${Math.trunc(d / e)} (integer division drops the remainder), so ${a} + ${b * c} - ${Math.trunc(d / e)} = ${value}.`,
        };
      },
    },
    {
      id: "hello-g-align",
      topic: "printing",
      difficulty: 3,
      make: (rng) => {
        const width = int(rng, 4, 7);
        const text = pick(rng, ["ab", "rs", "ok", "go"]);
        const align = pick(rng, ["<", ">", "^"] as const);
        const pad = width - text.length;
        const render = (mode: string) =>
          mode === "<"
            ? `[${text}${" ".repeat(pad)}]`
            : mode === ">"
              ? `[${" ".repeat(pad)}${text}]`
              : `[${" ".repeat(Math.floor(pad / 2))}${text}${" ".repeat(pad - Math.floor(pad / 2))}]`;
        const correct = render(align);
        const others = ["<", ">", "^"].filter((mode) => mode !== align).map(render);
        return valueChoice(rng, {
          prompt: `Which line does this print? (\`${align}\` controls alignment inside a field of width ${width}.)`,
          code: program(`println!("[{:${align}${width}}]", "${text}");`),
          correct,
          distractors: [...others, `[${text}]`],
          expectStdout: correct,
          explain:
            "`<` left-aligns, `>` right-aligns, and `^` centres; when centring leaves an odd number of spaces, the extra one goes on the right.",
        });
      },
    },
  ],
  cards: [
    {
      id: "hello-c-entry",
      front: "What is the single entry point of every Rust binary?",
      back: "`fn main()`",
      why: "Execution begins in `main` and the program ends when `main` returns.",
    },
    {
      id: "hello-c-bang",
      front: "What does a trailing `!` (as in `println!`) mark?",
      back: "A macro invocation, expanded at compile time.",
      why: "That is how `println!` can check its format string against its arguments before the program runs.",
    },
    {
      id: "hello-c-check",
      front: "Fastest Cargo command to see whether code compiles?",
      back: "`cargo check`",
      why: "It skips code generation, so it runs much faster than `cargo build`.",
    },
    {
      id: "hello-c-lock",
      front: "`Cargo.toml` versus `Cargo.lock`: which pins exact dependency versions?",
      back: "`Cargo.lock`",
      why: "`Cargo.toml` states requirements; the lock file records what resolution picked, for reproducible builds.",
    },
    {
      id: "hello-c-debug",
      front: "Which format placeholder uses the `Debug` representation?",
      back: "`{:?}` (or `{:#?}` for pretty-printed)",
      why: "Debug output is for programmers: strings keep their quotes and collections show their structure.",
    },
    {
      id: "hello-c-release",
      front: "Which flag builds an optimised binary, and where does it go?",
      back: "`cargo build --release` → `target/release/`",
    },
    {
      id: "hello-c-compile-time",
      front: "When does rustc report an unknown variable name in a rarely-run function?",
      back: "At compile time — no binary is produced until it is fixed.",
      why: "The whole program is analysed before code generation; unknown names are error E0425.",
    },
    {
      id: "hello-c-inline",
      front: "How do you print a variable `x` using inline format capture?",
      back: '`println!("{x}");`',
    },
  ],
};

const variables: SegmentBank = {
  chapterId: "variables",
  questions: [
    {
      id: "var-q-reassign",
      kind: "compiles",
      topic: "mutability",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let total = 40;\n    total = 42;\n    println!("{total}");\n}',
      compiles: false,
      codeError: "E0384",
      explain:
        "Bindings are immutable unless declared `let mut`. Assigning twice to an immutable binding is E0384; rustc suggests adding `mut`.",
    },
    {
      id: "var-q-shadow-ok",
      kind: "compiles",
      topic: "shadowing",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let total = 40;\n    let total = total + 2;\n    println!("{total}");\n}',
      compiles: true,
      explain:
        "The second `let` creates a new binding that shadows the first. Nothing is mutated; the old value is simply no longer reachable by that name.",
    },
    {
      id: "var-q-shadow-scope",
      kind: "output",
      topic: "shadowing",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let x = 5;\n    let x = x * 2;\n    {\n        let x = x + 1;\n        println!("{x}");\n    }\n    println!("{x}");\n}',
      answer: "11\n10",
      explain:
        "Inside the block, a new `x` (11) shadows the outer one. When the block ends, that binding goes out of scope and the outer `x` (10) is visible again.",
    },
    {
      id: "var-q-shadow-type",
      kind: "compiles",
      topic: "shadowing",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let spaces = "   ";\n    let spaces = spaces.len();\n    println!("{spaces}");\n}',
      compiles: true,
      explain:
        "Shadowing makes a brand-new binding, so the type may change from `&str` to `usize`. This is idiomatic for parse-and-rename steps.",
    },
    {
      id: "var-q-mut-type",
      kind: "compiles",
      topic: "shadowing",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let mut spaces = "   ";\n    spaces = spaces.len();\n    println!("{spaces}");\n}',
      compiles: false,
      codeError: "E0308",
      explain:
        "`mut` lets you assign a new value of the same type. `spaces` is `&str`, so assigning a `usize` is a type mismatch (E0308). Shadowing, not `mut`, is how you change type.",
    },
    {
      id: "var-q-uninit",
      kind: "compiles",
      topic: "initialisation",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let x: i32;\n    println!("{x}");\n}',
      compiles: false,
      codeError: "E0381",
      explain:
        "A binding may be declared before it is assigned, but it must be definitely initialised on every path before use. Reading `x` here is E0381.",
    },
    {
      id: "var-q-deferred-init",
      kind: "compiles",
      topic: "initialisation",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let hot = true;\n    let label;\n    if hot {\n        label = "summer";\n    } else {\n        label = "winter";\n    }\n    println!("{label}");\n}',
      compiles: true,
      explain:
        "`label` is assigned exactly once on every path before it is read, so it needs no `mut`. The compiler tracks initialisation per path.",
    },
    {
      id: "var-q-const",
      kind: "choice",
      topic: "constants",
      difficulty: 2,
      prompt: "Which statement about `const` is true?",
      options: [
        "A `const` must have an explicit type and a value computable at compile time",
        "A `const` is a `let` binding that cannot be shadowed",
        "A `const` can be made mutable with `const mut`",
      ],
      answer: 0,
      feedback: [
        null,
        "Constants are items, not bindings; the rule is about types and compile-time values.",
        "There is no `const mut`; mutable global state needs `static` and synchronisation.",
      ],
      explain:
        "`const MAX: u32 = 100_000;` requires the type annotation and a constant expression. Constants may be declared in any scope, including module level.",
    },
    {
      id: "var-q-const-notype",
      kind: "compiles",
      topic: "constants",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'const LIMIT = 10;\n\nfn main() {\n    println!("{LIMIT}");\n}',
      compiles: false,
      explain: "Constants never infer their type: `const LIMIT: i32 = 10;` is required.",
    },
    {
      id: "var-q-compound",
      kind: "output",
      topic: "mutability",
      difficulty: 1,
      prompt: "What does this print?",
      code: 'fn main() {\n    let mut count = 0;\n    count += 3;\n    count *= 2;\n    count -= 1;\n    println!("{count}");\n}',
      answer: "5",
      explain: "0 + 3 = 3, then 3 × 2 = 6, then 6 − 1 = 5. Compound assignment needs `mut`.",
    },
    {
      id: "var-q-mut-keyword",
      kind: "recall",
      topic: "mutability",
      difficulty: 1,
      prompt: "Type the keyword you add after `let` so a binding may be reassigned.",
      accept: ["mut"],
      explain: "`let mut x = 0;` The keyword is a promise to readers that this value changes.",
    },
    {
      id: "var-q-why-immutable",
      kind: "choice",
      topic: "mutability",
      difficulty: 2,
      prompt: "Why is immutability the default?",
      options: [
        "Immutable values are always stored on the stack",
        "A reader can trust a binding never changes unless `mut` says so, and the compiler enforces it",
        "Mutation is slower in Rust than in other languages",
      ],
      answer: 1,
      explain:
        "Defaults encode intent. With `mut` opt-in, every place a value can change is visible, and accidental reassignments become compile errors.",
    },
    {
      id: "var-q-scope-end",
      kind: "compiles",
      topic: "scope",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    {\n        let inner = 7;\n    }\n    println!("{inner}");\n}',
      compiles: false,
      codeError: "E0425",
      explain:
        "`inner` exists only until the closing brace of its block. After that the name is not in scope (E0425), and its value has been dropped.",
    },
    {
      id: "var-q-shadow-vs-mut",
      kind: "multi",
      topic: "shadowing",
      difficulty: 3,
      prompt: "Select every true statement about shadowing with `let x = ...;` a second time.",
      options: [
        "It creates a new binding",
        "It can change the type associated with the name",
        "It mutates the original value in place",
        "An outer binding becomes visible again when an inner shadowing scope ends",
      ],
      answers: [0, 1, 3],
      explain:
        "Shadowing introduces a new binding; the old value is untouched (and still visible again after an inner scope ends). Mutation changes a value in place and keeps its type.",
    },
    {
      id: "var-q-unused-mut",
      kind: "choice",
      topic: "mutability",
      difficulty: 2,
      prompt: "You write `let mut x = 5;` but never reassign `x`. What happens?",
      options: [
        "Compile error E0384",
        "It compiles with an `unused_mut` warning",
        "The program panics at runtime",
      ],
      answer: 1,
      explain:
        "Unneeded `mut` is legal but the compiler warns, because it weakens the signal `mut` is supposed to send.",
    },
  ],
  generators: [
    {
      id: "var-g-updates",
      topic: "mutability",
      difficulty: 2,
      make: (rng) => {
        let value = int(rng, 1, 9);
        const lines = [`let mut n = ${value};`];
        const trace = [String(value)];
        for (let step = 0; step < 3; step += 1) {
          const op = pick(rng, ["+=", "-=", "*="] as const);
          const operand = op === "*=" ? int(rng, 2, 3) : int(rng, 1, 9);
          value = op === "+=" ? value + operand : op === "-=" ? value - operand : value * operand;
          lines.push(`n ${op} ${operand};`);
          trace.push(String(value));
        }
        lines.push('println!("{n}");');
        return {
          kind: "output",
          prompt: "Trace the updates. What does this print?",
          code: program(lines.join("\n")),
          answer: String(value),
          explain: `Each compound assignment updates the same mutable binding in order: ${trace.join(" → ")}.`,
        };
      },
    },
    {
      id: "var-g-shadow-chain",
      topic: "shadowing",
      difficulty: 2,
      make: (rng) => {
        const start = int(rng, 2, 9);
        const add = int(rng, 1, 9);
        const mul = int(rng, 2, 4);
        const inner = int(rng, 1, 9);
        const outerValue = (start + add) * mul;
        const innerValue = outerValue - inner;
        return {
          kind: "output",
          prompt: "Each `let` shadows. What exactly does this print?",
          code: program(
            `let v = ${start};\nlet v = v + ${add};\nlet v = v * ${mul};\n{\n    let v = v - ${inner};\n    println!("{v}");\n}\nprintln!("{v}");`,
          ),
          answer: `${innerValue}\n${outerValue}`,
          explain: `The outer chain gives (${start} + ${add}) × ${mul} = ${outerValue}. The block shadows it with ${outerValue} − ${inner} = ${innerValue}, which disappears when the block ends.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "var-c-default",
      front: "Are `let` bindings mutable by default?",
      back: "No. Add `mut` to allow reassignment.",
      why: "Immutability by default makes every mutation visible and compiler-checked.",
    },
    {
      id: "var-c-e0384",
      front: "Which error code means 'cannot assign twice to immutable variable'?",
      back: "E0384",
    },
    {
      id: "var-c-shadow",
      front: "What does a second `let x = ...;` in the same scope do?",
      back: "Creates a new binding that shadows the old one (and may change its type).",
    },
    {
      id: "var-c-shadow-type",
      front:
        "To turn `input: &str` into a number under the same name, do you use `mut` or shadowing?",
      back: "Shadowing: `let input: i32 = input.parse()?;`",
      why: "`mut` cannot change a binding's type; a new `let` can.",
    },
    {
      id: "var-c-const",
      front: "Two requirements for a `const`?",
      back: "An explicit type and a value computable at compile time.",
    },
    {
      id: "var-c-e0381",
      front: "What does E0381 report?",
      back: "Use of a possibly-uninitialised binding.",
      why: "A binding must be assigned on every path before it is read.",
    },
    {
      id: "var-c-scope",
      front: "When does a binding declared inside `{ }` stop being usable?",
      back: "At the block's closing brace — its scope ends and its value is dropped.",
    },
    {
      id: "var-c-deferred",
      front: "Does `let label; if c { label = 1 } else { label = 2 }` need `mut`?",
      back: "No — it is assigned exactly once on every path.",
    },
  ],
};

const types: SegmentBank = {
  chapterId: "types",
  questions: [
    {
      id: "types-q-default-int",
      kind: "choice",
      topic: "inference",
      difficulty: 1,
      prompt: "With no other constraints, what type does the literal in `let n = 42;` get?",
      options: ["`i64`", "`i32`", "`usize`", "`u32`"],
      answer: 1,
      explain:
        "Integer literals default to `i32` and float literals to `f64` when nothing else constrains them.",
    },
    {
      id: "types-q-mixed",
      kind: "compiles",
      topic: "inference",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let a: i32 = 5;\n    let b: i64 = 10;\n    let c = a + b;\n    println!("{c}");\n}',
      compiles: false,
      codeError: "E0308",
      explain:
        "Rust never widens numbers implicitly. `i32 + i64` is a mismatch (E0308); convert explicitly with `i64::from(a) + b`.",
    },
    {
      id: "types-q-int-div",
      kind: "output",
      topic: "arithmetic",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    println!("{} {}", 7 / 2, 7.0 / 2.0);\n}',
      answer: "3 3.5",
      explain: "Integer division truncates toward zero; float division keeps the fraction.",
    },
    {
      id: "types-q-neg-div",
      kind: "output",
      topic: "arithmetic",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let n: i32 = -7;\n    println!("{} {} {}", n / 2, n % 2, n.rem_euclid(2));\n}',
      answer: "-3 -1 1",
      explain:
        "`/` truncates toward zero (−3), so `%` has the sign of the dividend (−1). `rem_euclid` always returns a non-negative remainder (1).",
    },
    {
      id: "types-q-wrapping",
      kind: "output",
      topic: "overflow",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let x: u8 = 255;\n    println!("{} {:?} {}", x.wrapping_add(1), x.checked_add(1), x.saturating_add(1));\n}',
      answer: "0 None 255",
      explain:
        "`wrapping_*` wraps modulo 2⁸, `checked_*` returns `None` on overflow, and `saturating_*` clamps at the type's limit.",
    },
    {
      id: "types-q-overflow-debug",
      kind: "choice",
      topic: "overflow",
      difficulty: 2,
      prompt: "A `u8` computed at runtime overflows with plain `+` in a debug build. What happens?",
      options: [
        "It wraps silently",
        "The program panics with 'attempt to add with overflow'",
        "The value becomes 255",
      ],
      answer: 1,
      feedback: [
        "Wrapping is the default only when overflow checks are off, as in the default release profile.",
        null,
        "Clamping is `saturating_add`, never the default.",
      ],
      explain:
        "Debug builds enable overflow checks and panic. Release builds wrap by default. When the behaviour matters, say so with `wrapping_`, `checked_`, or `saturating_` methods.",
    },
    {
      id: "types-q-casts",
      kind: "output",
      topic: "casting",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let big: i32 = 300;\n    let neg: i32 = -1;\n    println!("{} {} {} {}", big as u8, neg as u8, 3.99_f64 as i32, -1.5_f64 as u32);\n}',
      answer: "44 255 3 0",
      explain:
        "Integer `as` casts truncate to the low bits (300 − 256 = 44; −1 is all ones = 255). Float-to-int casts truncate toward zero and saturate at the target range, so −1.5 → 0 for `u32`.",
    },
    {
      id: "types-q-char-size",
      kind: "output",
      topic: "text",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    println!("{} {}", std::mem::size_of::<char>(), "é".len());\n}',
      answer: "4 2",
      explain:
        "A `char` is a 4-byte Unicode scalar value. `str::len` counts UTF-8 bytes, and `é` takes two.",
    },
    {
      id: "types-q-tuple",
      kind: "output",
      topic: "compound",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: "fn main() {\n    let t = (1, 2.5, 'x');\n    let (a, _, c) = t;\n    println!(\"{} {} {}\", t.1, a, c);\n}",
      answer: "2.5 1 x",
      explain:
        "Tuples are indexed with `.0`, `.1`, …, and can be destructured with a pattern; `_` ignores a position.",
    },
    {
      id: "types-q-array-type",
      kind: "recall",
      topic: "compound",
      difficulty: 2,
      prompt: "Type the type of `[0u8; 4]`.",
      accept: ["[u8; 4]", "[u8;4]"],
      explain: "An array type is `[T; N]`: element type and a length fixed at compile time.",
    },
    {
      id: "types-q-const-index",
      kind: "compiles",
      topic: "compound",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let a = [1, 2, 3];\n    let x = a[5];\n    println!("{x}");\n}',
      compiles: false,
      explain:
        "With a constant index into a fixed-size array, the compiler can prove the access is out of bounds, and the deny-by-default `unconditional_panic` lint rejects it. With a runtime index it would compile and panic.",
    },
    {
      id: "types-q-annotation-parse",
      kind: "compiles",
      topic: "inference",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let n = "42".parse().unwrap();\n    println!("{n}");\n}',
      compiles: false,
      codeError: "E0284",
      explain:
        "`parse` can produce many types, and nothing here says which. Annotate `let n: i32` or use `parse::<i32>()`.",
    },
    {
      id: "types-q-bool-int",
      kind: "choice",
      topic: "casting",
      difficulty: 2,
      prompt: "Which conversion is written the way Rust requires?",
      options: ["`let n: i32 = true;`", "`let n = true as i32;`", "`let b: bool = 1;`"],
      answer: 1,
      explain:
        "`bool` never converts implicitly. `true as i32` is 1; going the other way requires a comparison such as `n != 0`.",
    },
    {
      id: "types-q-signed-range",
      kind: "choice",
      topic: "overflow",
      difficulty: 2,
      prompt: "What is the range of `i8`?",
      options: ["0 to 255", "−128 to 127", "−127 to 127", "−256 to 255"],
      answer: 1,
      fixedOrder: true,
      explain: "An n-bit signed integer stores −2ⁿ⁻¹ through 2ⁿ⁻¹ − 1 in two's complement.",
    },
    {
      id: "types-q-float-eq",
      kind: "output",
      topic: "arithmetic",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    println!("{}", 0.1 + 0.2 == 0.3);\n}',
      answer: "false",
      explain:
        "`f64` is binary floating point: 0.1 and 0.2 are not exact, and their sum is 0.30000000000000004. Compare floats with a tolerance.",
    },
  ],
  generators: [
    {
      id: "types-g-u8-ops",
      topic: "overflow",
      difficulty: 2,
      make: (rng) => {
        const a = int(rng, 200, 250);
        const b = int(rng, 10, 90);
        const method = pick(rng, ["wrapping_add", "saturating_add", "checked_add"] as const);
        const sum = a + b;
        const result =
          method === "wrapping_add"
            ? String(sum % 256)
            : method === "saturating_add"
              ? String(Math.min(sum, 255))
              : sum > 255
                ? "None"
                : `Some(${sum})`;
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(`let a: u8 = ${a};\nprintln!("{:?}", a.${method}(${b}));`),
          answer: result,
          explain: `${a} + ${b} = ${sum}, and u8 holds at most 255. \`wrapping_add\` gives ${sum % 256}, \`saturating_add\` gives ${Math.min(sum, 255)}, and \`checked_add\` gives ${sum > 255 ? "None" : `Some(${sum})`}.`,
        };
      },
    },
    {
      id: "types-g-as-u8",
      topic: "casting",
      difficulty: 3,
      make: (rng) => {
        const value = pick(rng, [int(rng, 256, 700), -int(rng, 1, 40)]);
        const result = ((value % 256) + 256) % 256;
        return {
          kind: "output",
          prompt: "Casting with `as` truncates to the target's bits. What does this print?",
          code: program(`let v: i32 = ${value};\nprintln!("{}", v as u8);`),
          answer: String(result),
          explain: `\`as u8\` keeps the low 8 bits, which is ${value} modulo 256 = ${result}. Prefer \`u8::try_from(v)\` when an out-of-range value should be an error.`,
        };
      },
    },
    {
      id: "types-g-divrem",
      topic: "arithmetic",
      difficulty: 2,
      make: (rng) => {
        const a = int(rng, 11, 60) * pick(rng, [1, -1]);
        const b = int(rng, 3, 9);
        const quotient = Math.trunc(a / b);
        const remainder = a - quotient * b;
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(`let a: i32 = ${a};\nlet b: i32 = ${b};\nprintln!("{} {}", a / b, a % b);`),
          answer: `${quotient} ${remainder}`,
          explain: `Integer \`/\` truncates toward zero (${a} / ${b} = ${quotient}), and \`%\` satisfies a == (a / b) * b + a % b, so the remainder is ${remainder}.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "types-c-defaults",
      front: "Default types for unconstrained integer and float literals?",
      back: "`i32` and `f64`.",
    },
    {
      id: "types-c-no-widen",
      front: "Does Rust implicitly convert `i32` to `i64` in `a + b`?",
      back: "No — convert explicitly, e.g. `i64::from(a) + b`.",
      why: "Implicit numeric conversions hide truncation and sign bugs, so Rust requires them to be written down.",
    },
    {
      id: "types-c-overflow",
      front: "Plain `+` overflows: behaviour in debug vs. default release builds?",
      back: "Debug panics; release wraps.",
      why: "Use `checked_`, `wrapping_`, or `saturating_` methods to make the intended behaviour explicit.",
    },
    {
      id: "types-c-checked",
      front: "What does `255u8.checked_add(1)` return?",
      back: "`None`",
    },
    {
      id: "types-c-char",
      front: "How many bytes is a `char`, and what does it hold?",
      back: "4 bytes; one Unicode scalar value.",
    },
    {
      id: "types-c-len",
      front: "Does `str::len()` count characters or bytes?",
      back: 'UTF-8 bytes. `"é".len()` is 2.',
    },
    {
      id: "types-c-array",
      front: "Write the type of an array of five `f64` values.",
      back: "`[f64; 5]`",
    },
    {
      id: "types-c-as",
      front: "What does `300_i32 as u8` produce, and why?",
      back: "44 — `as` keeps the low 8 bits (300 − 256).",
      why: "Use `u8::try_from` when out-of-range input should be an error rather than silently truncated.",
    },
    {
      id: "types-c-rem",
      front: "Sign of `a % b` for negative `a` in Rust?",
      back: "Same sign as `a` (the dividend). Use `rem_euclid` for a non-negative result.",
    },
  ],
};

const functionsFlow: SegmentBank = {
  chapterId: "functions-flow",
  questions: [
    {
      id: "flow-q-block-value",
      kind: "output",
      topic: "expressions",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let y = {\n        let x = 3;\n        x + 1\n    };\n    println!("{y}");\n}',
      answer: "4",
      explain: "A block is an expression; its value is its final expression without a semicolon.",
    },
    {
      id: "flow-q-semicolon-return",
      kind: "compiles",
      topic: "expressions",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn plus_one(x: i32) -> i32 {\n    x + 1;\n}\n\nfn main() {\n    println!("{}", plus_one(1));\n}',
      compiles: false,
      codeError: "E0308",
      explain:
        "The trailing `;` turns `x + 1` into a statement, so the body evaluates to `()` instead of `i32` (E0308). rustc suggests removing the semicolon.",
    },
    {
      id: "flow-q-if-types",
      kind: "compiles",
      topic: "conditionals",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let cold = true;\n    let n = if cold { 5 } else { "six" };\n    println!("{n}");\n}',
      compiles: false,
      codeError: "E0308",
      explain:
        "`if` is an expression with one type. Both arms must agree; an integer and a `&str` are incompatible arms.",
    },
    {
      id: "flow-q-if-bool",
      kind: "compiles",
      topic: "conditionals",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let n = 3;\n    if n {\n        println!("non-zero");\n    }\n}',
      compiles: false,
      codeError: "E0308",
      explain: "Conditions must be `bool`; there is no truthiness. Write `if n != 0`.",
    },
    {
      id: "flow-q-loop-break",
      kind: "output",
      topic: "loops",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let mut count = 0;\n    let result = loop {\n        count += 1;\n        if count == 10 {\n            break count * 2;\n        }\n    };\n    println!("{result}");\n}',
      answer: "20",
      explain:
        "`break value` ends a `loop` and makes the whole `loop` expression evaluate to `value`.",
    },
    {
      id: "flow-q-labels",
      kind: "output",
      topic: "loops",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: "fn main() {\n    let mut hits = 0;\n    'outer: for i in 0..3 {\n        for j in 0..3 {\n            if j == 2 {\n                continue 'outer;\n            }\n            if i == 2 {\n                break 'outer;\n            }\n            hits += 1;\n        }\n    }\n    println!(\"{hits}\");\n}",
      answer: "4",
      explain:
        "For i = 0 and i = 1, j = 0 and 1 count (2 hits each) before `continue 'outer` skips j = 2. At i = 2 the first inner step hits `break 'outer`. Total 4.",
    },
    {
      id: "flow-q-rev",
      kind: "output",
      topic: "loops",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let v: Vec<i32> = (1..4).rev().collect();\n    println!("{v:?}");\n}',
      answer: "[3, 2, 1]",
      explain: "`1..4` is half-open (1, 2, 3); `.rev()` walks it backwards.",
    },
    {
      id: "flow-q-inclusive",
      kind: "choice",
      topic: "loops",
      difficulty: 1,
      prompt: "How many times does `for i in 1..=5 { … }` run its body?",
      options: ["4", "5", "6"],
      answer: 1,
      fixedOrder: true,
      explain: "`..=` includes the end: 1, 2, 3, 4, 5. `1..5` would run four times.",
    },
    {
      id: "flow-q-param-types",
      kind: "compiles",
      topic: "functions",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn add(a, b) -> i32 {\n    a + b\n}\n\nfn main() {\n    println!("{}", add(1, 2));\n}',
      compiles: false,
      explain:
        "Function signatures are contracts: every parameter needs a type. Inference works inside bodies, not across the signature boundary.",
    },
    {
      id: "flow-q-let-statement",
      kind: "choice",
      topic: "expressions",
      difficulty: 2,
      prompt: "Why is `let x = (let y = 6);` rejected?",
      options: [
        "Parentheses are not allowed on the right of `let`",
        "`let` is a statement and produces no value to bind",
        "`y` shadows `x`",
      ],
      answer: 1,
      explain:
        "Statements perform an action and do not evaluate to a value. Expressions do. Only an expression can appear on the right of `=`.",
    },
    {
      id: "flow-q-while",
      kind: "output",
      topic: "loops",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let mut n = 3;\n    let mut out = String::new();\n    while n > 0 {\n        out.push_str(&n.to_string());\n        n -= 1;\n    }\n    println!("{out}");\n}',
      answer: "321",
      explain: "The loop appends 3, 2, 1 and stops when `n > 0` becomes false.",
    },
    {
      id: "flow-q-early-return",
      kind: "output",
      topic: "functions",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn classify(n: i32) -> &\'static str {\n    if n < 0 {\n        return "negative";\n    }\n    if n == 0 { "zero" } else { "positive" }\n}\n\nfn main() {\n    println!("{} {} {}", classify(-4), classify(0), classify(9));\n}',
      answer: "negative zero positive",
      explain:
        "`return` exits early; otherwise the function's value is its final expression, here an `if` expression.",
    },
    {
      id: "flow-q-unit",
      kind: "recall",
      topic: "functions",
      difficulty: 2,
      prompt: "Type the type a function returns when its signature has no `-> T`.",
      accept: ["()", "unit", "the unit type", "unit type"],
      explain: "Omitting the return type means the function returns `()`, the unit type.",
    },
    {
      id: "flow-q-shadow-loop-var",
      kind: "output",
      topic: "loops",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let mut total = 0;\n    for n in [4, 7, 10] {\n        if n % 2 == 1 {\n            continue;\n        }\n        total += n;\n    }\n    println!("{total}");\n}',
      answer: "14",
      explain: "`continue` skips the odd 7; the even values 4 and 10 sum to 14.",
    },
  ],
  generators: [
    {
      id: "flow-g-range-sum",
      topic: "loops",
      difficulty: 2,
      make: (rng) => {
        const start = int(rng, 1, 6);
        const end = start + int(rng, 3, 7);
        const inclusive = rng() < 0.5;
        const last = inclusive ? end : end - 1;
        let sum = 0;
        for (let i = start; i <= last; i += 1) sum += i;
        const range = `${start}..${inclusive ? "=" : ""}${end}`;
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let mut sum = 0;\nfor i in ${range} {\n    sum += i;\n}\nprintln!("{sum}");`,
          ),
          answer: String(sum),
          explain: `\`${range}\` covers ${start} through ${last}${inclusive ? " (inclusive end)" : " (the end is excluded)"}, which sum to ${sum}.`,
        };
      },
    },
    {
      id: "flow-g-break-value",
      topic: "loops",
      difficulty: 2,
      make: (rng) => {
        const step = int(rng, 2, 5);
        const limit = int(rng, 15, 40);
        let n = 0;
        let iterations = 0;
        while (n <= limit) {
          n += step;
          iterations += 1;
        }
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let mut n = 0;\nlet mut iterations = 0;\nlet last = loop {\n    n += ${step};\n    iterations += 1;\n    if n > ${limit} {\n        break n;\n    }\n};\nprintln!("{last} {iterations}");`,
          ),
          answer: `${n} ${iterations}`,
          explain: `n grows by ${step} each pass and the loop breaks with the first value above ${limit}: ${n}, after ${iterations} iterations.`,
        };
      },
    },
    {
      id: "flow-g-if-chain",
      topic: "conditionals",
      difficulty: 1,
      make: (rng) => {
        const n = int(rng, -20, 40);
        const label = n < 0 ? "cold" : n < 15 ? "mild" : n < 30 ? "warm" : "hot";
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let t = ${n};\nlet label = if t < 0 {\n    "cold"\n} else if t < 15 {\n    "mild"\n} else if t < 30 {\n    "warm"\n} else {\n    "hot"\n};\nprintln!("{label}");`,
          ),
          answer: label,
          explain: `Branches are tested top to bottom and the first true condition wins; ${n} selects "${label}".`,
        };
      },
    },
  ],
  cards: [
    {
      id: "flow-c-block",
      front: "What value does a block `{ ... }` evaluate to?",
      back: "Its final expression (the one without a trailing semicolon), or `()` if there is none.",
    },
    {
      id: "flow-c-semicolon",
      front: "What does adding `;` after a function's last expression do?",
      back: "Turns it into a statement; the function then returns `()`.",
      why: "That is the classic E0308 'expected i32, found ()' error.",
    },
    {
      id: "flow-c-if-expr",
      front: "Can `if` be used on the right-hand side of `let`?",
      back: "Yes — `if` is an expression; all arms must have the same type.",
    },
    {
      id: "flow-c-truthy",
      front: "Does `if 1 { … }` compile?",
      back: "No. Conditions must be `bool`; there is no truthiness.",
    },
    {
      id: "flow-c-break-value",
      front: "How do you return a value out of a `loop`?",
      back: "`break value;` — the `loop` expression evaluates to it.",
    },
    {
      id: "flow-c-labels",
      front: "How do you break an outer loop from inside an inner one?",
      back: "Label it (`'outer: for …`) and use `break 'outer;`.",
    },
    {
      id: "flow-c-ranges",
      front: "`1..5` vs `1..=5`?",
      back: "`1..5` excludes 5; `1..=5` includes it.",
    },
    {
      id: "flow-c-signature",
      front: "Must function parameters have type annotations?",
      back: "Yes, always. Signatures are contracts; inference stops at the boundary.",
    },
  ],
};

export const gettingStartedBanks: SegmentBank[] = [helloRust, variables, types, functionsFlow];
