import { distinctInts, int, pick, shuffle } from "../rng";
import type { SegmentBank } from "../types";
import { program } from "./helpers";

const abstraction: SegmentBank = {
  chapterId: "abstraction",
  questions: [
    {
      id: "abs-q-missing-bound",
      kind: "compiles",
      topic: "generics",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn largest<T>(items: &[T]) -> &T {\n    let mut best = &items[0];\n    for item in items {\n        if item > best {\n            best = item;\n        }\n    }\n    best\n}\n\nfn main() {\n    println!("{}", largest(&[3, 9, 2]));\n}',
      compiles: false,
      codeError: "E0369",
      explain:
        "A generic `T` promises nothing, so `>` is unavailable. Add the bound `T: PartialOrd` to say which capability the body needs.",
    },
    {
      id: "abs-q-default-method",
      kind: "output",
      topic: "traits",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'trait Greet {\n    fn name(&self) -> String;\n    fn greet(&self) -> String {\n        format!("Hello, {}!", self.name())\n    }\n}\n\nstruct En;\nstruct Pirate;\n\nimpl Greet for En {\n    fn name(&self) -> String {\n        "friend".into()\n    }\n}\n\nimpl Greet for Pirate {\n    fn name(&self) -> String {\n        "matey".into()\n    }\n    fn greet(&self) -> String {\n        format!("Ahoy, {}!", self.name())\n    }\n}\n\nfn main() {\n    println!("{} {}", En.greet(), Pirate.greet());\n}',
      answer: "Hello, friend! Ahoy, matey!",
      explain:
        "A trait can provide default method bodies built on required methods. Implementors may keep the default or override it.",
    },
    {
      id: "abs-q-longest-lifetime",
      kind: "compiles",
      topic: "lifetimes",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn longest(a: &str, b: &str) -> &str {\n    if a.len() >= b.len() { a } else { b }\n}\n\nfn main() {\n    println!("{}", longest("ab", "abc"));\n}',
      compiles: false,
      codeError: "E0106",
      explain:
        "With two reference inputs, elision cannot tell which one the output borrows from. `fn longest<'a>(a: &'a str, b: &'a str) -> &'a str` states the relationship.",
    },
    {
      id: "abs-q-lifetime-scope",
      kind: "compiles",
      topic: "lifetimes",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'fn longest<\'a>(a: &\'a str, b: &\'a str) -> &\'a str {\n    if a.len() >= b.len() { a } else { b }\n}\n\nfn main() {\n    let outer = String::from("long string");\n    let result;\n    {\n        let inner = String::from("xyz");\n        result = longest(outer.as_str(), inner.as_str());\n    }\n    println!("{result}");\n}',
      compiles: false,
      codeError: "E0597",
      explain:
        "`'a` becomes the shorter of the two input lifetimes. `inner` dies at the block's end, so `result` cannot be used after it — even though at runtime it would point to `outer`.",
    },
    {
      id: "abs-q-bound-fn",
      kind: "output",
      topic: "generics",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'use std::fmt::Display;\n\nfn bracket<T: Display>(value: T) -> String {\n    format!("[{value}]")\n}\n\nfn main() {\n    println!("{} {} {}", bracket(7), bracket("x"), bracket(2.5));\n}',
      answer: "[7] [x] [2.5]",
      explain:
        "One generic function works for any type implementing `Display`. The compiler generates a specialised copy per concrete type (monomorphization).",
    },
    {
      id: "abs-q-monomorph",
      kind: "choice",
      topic: "generics",
      difficulty: 2,
      prompt: "What does monomorphization mean for generic code's runtime cost?",
      options: [
        "Every call goes through a vtable lookup",
        "The compiler emits a specialised copy per concrete type, so calls are as fast as hand-written ones",
        "Generics are boxed on the heap",
      ],
      answer: 1,
      explain:
        "Static dispatch costs nothing at runtime; the trade-off is compile time and binary size. Trait objects (`dyn`) are the dynamic alternative.",
    },
    {
      id: "abs-q-elision",
      kind: "choice",
      topic: "lifetimes",
      difficulty: 3,
      prompt: "Why does `fn first_word(s: &str) -> &str` need no lifetime annotation?",
      options: [
        "String slices are always `'static`",
        "With exactly one input reference, the output is assumed to borrow from it (elision rule)",
        "The compiler inlines the function",
      ],
      answer: 1,
      explain:
        "Elision rules: each input reference gets its own lifetime; if there is exactly one, outputs get it; with `&self`, outputs get `self`'s lifetime.",
    },
    {
      id: "abs-q-orphan",
      kind: "compiles",
      topic: "traits",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'use std::fmt;\n\nimpl fmt::Display for Vec<i32> {\n    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {\n        write!(f, "{} items", self.len())\n    }\n}\n\nfn main() {\n    println!("{}", vec![1, 2]);\n}',
      compiles: false,
      codeError: "E0117",
      explain:
        "The orphan rule: you may implement a trait for a type only if the trait or the type is local to your crate. Wrap it in a newtype (`struct Items(Vec<i32>)`).",
    },
    {
      id: "abs-q-where",
      kind: "recall",
      topic: "generics",
      difficulty: 1,
      prompt: "Type the keyword that introduces trait bounds after a function signature.",
      accept: ["where"],
      explain:
        "`fn f<T, U>(t: T, u: U) where T: Display, U: Clone + Debug` keeps long bounds readable.",
    },
    {
      id: "abs-q-generic-struct",
      kind: "output",
      topic: "generics",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: "#[derive(Debug)]\nstruct Pair<T> {\n    a: T,\n    b: T,\n}\n\nimpl<T: PartialOrd + Copy> Pair<T> {\n    fn max(&self) -> T {\n        if self.a >= self.b { self.a } else { self.b }\n    }\n}\n\nfn main() {\n    let p = Pair { a: 3, b: 8 };\n    let q = Pair { a: 'z', b: 'c' };\n    println!(\"{} {}\", p.max(), q.max());\n}",
      answer: "8 z",
      explain:
        "`impl<T: …> Pair<T>` adds methods only for `T`s meeting the bounds; `i32` and `char` both qualify.",
    },
    {
      id: "abs-q-no-display-bound",
      kind: "compiles",
      topic: "generics",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn show<T>(x: T) {\n    println!("{x}");\n}\n\nfn main() {\n    show(1);\n}',
      compiles: false,
      codeError: "E0277",
      explain:
        "The body formats `x` with `{}`, which needs `T: Display`. The bound is part of the contract.",
    },
    {
      id: "abs-q-impl-trait-arg",
      kind: "output",
      topic: "traits",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'trait Area {\n    fn area(&self) -> u32;\n}\n\nstruct Sq(u32);\nstruct Rect(u32, u32);\n\nimpl Area for Sq {\n    fn area(&self) -> u32 {\n        self.0 * self.0\n    }\n}\n\nimpl Area for Rect {\n    fn area(&self) -> u32 {\n        self.0 * self.1\n    }\n}\n\nfn double(shape: &impl Area) -> u32 {\n    shape.area() * 2\n}\n\nfn main() {\n    println!("{} {}", double(&Sq(3)), double(&Rect(2, 5)));\n}',
      answer: "18 20",
      explain: "`&impl Area` is shorthand for a generic parameter bounded by `Area`.",
    },
    {
      id: "abs-q-static",
      kind: "choice",
      topic: "lifetimes",
      difficulty: 2,
      prompt: "What does `&'static str` promise?",
      options: [
        "The string is stored on the stack",
        "The referenced data is valid for the entire rest of the program",
        "The string cannot contain non-ASCII characters",
      ],
      answer: 1,
      explain:
        "String literals are baked into the binary, so references to them never dangle. Do not add `'static` just to silence the compiler — fix the ownership instead.",
    },
    {
      id: "abs-q-lifetime-struct",
      kind: "output",
      topic: "lifetimes",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: "struct Excerpt<'a> {\n    part: &'a str,\n}\n\nimpl<'a> Excerpt<'a> {\n    fn first_word(&self) -> &'a str {\n        self.part.split(' ').next().unwrap_or(\"\")\n    }\n}\n\nfn main() {\n    let text = String::from(\"Call me Ishmael. Some years ago\");\n    let first_sentence = text.split('.').next().unwrap();\n    let e = Excerpt { part: first_sentence };\n    println!(\"{} | {}\", e.first_word(), e.part);\n}",
      answer: "Call | Call me Ishmael",
      explain:
        "A struct holding a reference needs a lifetime parameter: the `Excerpt` cannot outlive the text it borrows from.",
    },
    {
      id: "abs-q-trait-bound-facts",
      kind: "multi",
      topic: "traits",
      difficulty: 2,
      prompt: "Select every valid way to require that `T` implements both `Display` and `Clone`.",
      options: [
        "`fn f<T: Display + Clone>(t: T)`",
        "`fn f<T>(t: T) where T: Display + Clone`",
        "`fn f(t: impl Display + Clone)`",
        "`fn f<T: Display, Clone>(t: T)`",
      ],
      answers: [0, 1, 2],
      explain:
        "Bounds combine with `+`. In the last option, `Clone` is parsed as a second type parameter named `Clone`, not a bound.",
    },
  ],
  generators: [
    {
      id: "abs-g-largest",
      topic: "generics",
      difficulty: 1,
      make: (rng) => {
        const useChars = rng() < 0.5;
        const values = useChars
          ? shuffle(rng, "bdfhkmqtwy".split("")).slice(0, 5)
          : distinctInts(rng, 5, 1, 99).map(String);
        const best = useChars ? [...values].sort().at(-1) : String(Math.max(...values.map(Number)));
        const literal = useChars ? values.map((c) => `'${c}'`).join(", ") : values.join(", ");
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `println!("{}", largest(&[${literal}]));`,
            "fn largest<T: PartialOrd + Copy>(items: &[T]) -> T {\n    let mut best = items[0];\n    for &item in items {\n        if item > best {\n            best = item;\n        }\n    }\n    best\n}",
          ),
          answer: String(best),
          explain: `The same generic function serves ${useChars ? "chars (compared by code point)" : "integers"}; the largest is ${best}.`,
        };
      },
    },
    {
      id: "abs-g-trait-sum",
      topic: "traits",
      difficulty: 2,
      make: (rng) => {
        const squares = distinctInts(rng, int(rng, 1, 2), 2, 9);
        const rects = Array.from({ length: int(rng, 1, 2) }, () => [
          int(rng, 2, 9),
          int(rng, 2, 9),
        ]);
        const total =
          squares.reduce((sum, s) => sum + s * s, 0) +
          rects.reduce((sum, [w, h]) => sum + (w ?? 0) * (h ?? 0), 0);
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let total = ${[...squares.map((s) => `area(&Sq(${s}))`), ...rects.map(([w, h]) => `area(&Rect(${w}, ${h}))`)].join(" + ")};\nprintln!("{total}");`,
            "trait Shape {\n    fn area(&self) -> u32;\n}\n\nstruct Sq(u32);\nstruct Rect(u32, u32);\n\nimpl Shape for Sq {\n    fn area(&self) -> u32 {\n        self.0 * self.0\n    }\n}\n\nimpl Shape for Rect {\n    fn area(&self) -> u32 {\n        self.0 * self.1\n    }\n}\n\nfn area<T: Shape>(shape: &T) -> u32 {\n    shape.area()\n}",
          ),
          answer: String(total),
          explain: `Each call is monomorphized for its concrete type; squares contribute ${squares.map((s) => s * s).join(" + ")} and rectangles ${rects.map(([w, h]) => (w ?? 0) * (h ?? 0)).join(" + ")}.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "abs-c-bound",
      front: "Why does `if a > b` fail inside `fn f<T>(a: T, b: T)`?",
      back: "`T` has no bounds; add `T: PartialOrd`.",
    },
    {
      id: "abs-c-mono",
      front: "What is monomorphization?",
      back: "Generating a specialised copy of generic code for each concrete type used — zero runtime cost.",
    },
    {
      id: "abs-c-default",
      front: "Can a trait provide method bodies?",
      back: "Yes — default methods, which implementors may override.",
    },
    {
      id: "abs-c-orphan",
      front: "The orphan rule?",
      back: "You can implement a trait for a type only if the trait or the type is defined in your crate.",
      why: "It keeps trait implementations coherent across crates; the newtype pattern is the workaround.",
    },
    {
      id: "abs-c-elision",
      front: "The three lifetime elision rules?",
      back: "Each input ref gets its own lifetime; one input ⇒ output gets it; `&self` ⇒ output gets self's.",
    },
    {
      id: "abs-c-longest",
      front: "Why does `fn longest(a: &str, b: &str) -> &str` need `'a`?",
      back: "Two input references: the compiler cannot infer which one the result borrows from.",
    },
    {
      id: "abs-c-lifetime-meaning",
      front: "Do lifetime annotations change how long values live?",
      back: "No — they describe relationships between borrows so the compiler can check them.",
    },
    {
      id: "abs-c-impl-arg",
      front: "`fn f(x: &impl Trait)` is shorthand for…?",
      back: "`fn f<T: Trait>(x: &T)`",
    },
  ],
};

const closuresIterators: SegmentBank = {
  chapterId: "closures-iterators",
  questions: [
    {
      id: "clo-q-chain",
      kind: "output",
      topic: "adapters",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let total: i32 = (1..=6).filter(|n| n % 2 == 0).map(|n| n * n).sum();\n    println!("{total}");\n}',
      answer: "56",
      explain: "Even numbers 2, 4, 6 squared are 4 + 16 + 36 = 56.",
    },
    {
      id: "clo-q-lazy",
      kind: "output",
      topic: "laziness",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let v = [1, 2, 3];\n    let doubled = v.iter().map(|x| {\n        println!("saw {x}");\n        x * 2\n    });\n    println!("built");\n    let n = doubled.count();\n    println!("{n}");\n}',
      answer: "built\nsaw 1\nsaw 2\nsaw 3\n3",
      explain:
        "Adapters like `map` do nothing until a consumer (`count`, `sum`, `collect`, `for`) pulls items, so `built` prints first.",
    },
    {
      id: "clo-q-fnmut-binding",
      kind: "compiles",
      topic: "captures",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let mut count = 0;\n    let inc = || count += 1;\n    inc();\n    inc();\n    println!("{count}");\n}',
      compiles: false,
      codeError: "E0596",
      explain:
        "`inc` mutates a capture, so it is `FnMut` and calling it needs `&mut inc`: declare `let mut inc`.",
    },
    {
      id: "clo-q-capture-ref",
      kind: "output",
      topic: "captures",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let mut log = Vec::new();\n    let mut record = |s: &str| log.push(s.to_uppercase());\n    record("a");\n    record("b");\n    println!("{log:?}");\n}',
      answer: '["A", "B"]',
      explain:
        "The closure mutably borrows `log` while it is in use; after its last call the borrow ends and `log` can be read again.",
    },
    {
      id: "clo-q-move-string",
      kind: "compiles",
      topic: "captures",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let name = String::from("ferris");\n    let greet = move || println!("hi {name}");\n    greet();\n    println!("{name}");\n}',
      compiles: false,
      codeError: "E0382",
      explain:
        "`move` transfers ownership of captured values into the closure. Clone before the closure if both need it.",
    },
    {
      id: "clo-q-enumerate-zip",
      kind: "output",
      topic: "adapters",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let names = ["ann", "bo", "cy"];\n    let ages = [31, 25];\n    for (i, (n, a)) in names.iter().zip(ages.iter()).enumerate() {\n        println!("{i}:{n}:{a}");\n    }\n}',
      answer: "0:ann:31\n1:bo:25",
      explain: "`zip` stops at the shorter iterator; `enumerate` pairs each item with its index.",
    },
    {
      id: "clo-q-iter-kinds",
      kind: "choice",
      topic: "adapters",
      difficulty: 2,
      prompt:
        "For `v: Vec<String>`, what item types do `iter()`, `iter_mut()`, `into_iter()` yield?",
      options: [
        "`&String`, `&mut String`, `String`",
        "`String`, `&mut String`, `&String`",
        "`&str`, `&mut str`, `String`",
      ],
      answer: 0,
      explain: "Shared borrows, exclusive borrows, and owned values (consuming the vector).",
    },
    {
      id: "clo-q-fn-traits",
      kind: "choice",
      topic: "captures",
      difficulty: 3,
      prompt:
        "A closure moves a captured `String` out (e.g. returns it). Which traits does it implement?",
      options: ["`Fn`, `FnMut`, and `FnOnce`", "`FnMut` and `FnOnce`", "Only `FnOnce`"],
      answer: 2,
      explain:
        "Moving a capture out can only happen once. `Fn` closures only read, `FnMut` closures mutate, and every closure is at least `FnOnce`.",
    },
    {
      id: "clo-q-collect-string",
      kind: "output",
      topic: "consumers",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let initials: String = ["rust", "is", "fun"].iter().map(|w| w.chars().next().unwrap()).collect();\n    println!("{initials}");\n}',
      answer: "rif",
      explain: "`collect` can build a `String` from an iterator of `char`s.",
    },
    {
      id: "clo-q-windows",
      kind: "output",
      topic: "adapters",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let temps = [12, 15, 11, 18];\n    let rises: Vec<i32> = temps.windows(2).map(|w| w[1] - w[0]).collect();\n    let pairs: Vec<Vec<i32>> = temps.chunks(3).map(|c| c.to_vec()).collect();\n    println!("{rises:?} {pairs:?}");\n}',
      answer: "[3, -4, 7] [[12, 15, 11], [18]]",
      explain:
        "`windows(n)` yields overlapping views; `chunks(n)` yields non-overlapping ones (the last may be shorter).",
    },
    {
      id: "clo-q-enumerate-recall",
      kind: "recall",
      topic: "adapters",
      difficulty: 1,
      prompt: "Type the iterator adapter that pairs each item with its index.",
      accept: ["enumerate", ".enumerate()", "enumerate()"],
      explain: "`iter().enumerate()` yields `(index, item)` tuples.",
    },
    {
      id: "clo-q-find-position",
      kind: "output",
      topic: "consumers",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let v = [4, 9, 16, 25];\n    println!("{:?} {:?} {} {}", v.iter().find(|n| **n > 10), v.iter().position(|n| *n == 25), v.iter().any(|n| n % 2 == 1), v.iter().all(|n| *n > 3));\n}',
      answer: "Some(16) Some(3) true true",
      explain:
        "`find` returns the first match, `position` its index, `any`/`all` short-circuit to a bool.",
    },
    {
      id: "clo-q-collect-infer",
      kind: "compiles",
      topic: "consumers",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let v = (1..4).collect();\n    println!("{:?}", v);\n}',
      compiles: false,
      codeError: "E0283",
      explain:
        "`collect` can build many collection types. Say which: `let v: Vec<i32> = …` or `collect::<Vec<_>>()`.",
    },
    {
      id: "clo-q-fold",
      kind: "output",
      topic: "consumers",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let digits = [4, 0, 2];\n    let number = digits.iter().fold(0, |acc, d| acc * 10 + d);\n    println!("{number}");\n}',
      answer: "402",
      explain: "`fold` threads an accumulator through every item: 0 → 4 → 40 → 402.",
    },
    {
      id: "clo-q-flat-map",
      kind: "output",
      topic: "adapters",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let lines = ["a b", "c", "d e f"];\n    let words: Vec<&str> = lines.iter().flat_map(|l| l.split(\' \')).skip(1).take(3).collect();\n    println!("{words:?}");\n}',
      answer: '["b", "c", "d"]',
      explain:
        "`flat_map` flattens each line's words into one stream; `skip(1).take(3)` then selects items 2–4.",
    },
  ],
  generators: [
    {
      id: "clo-g-chain",
      topic: "adapters",
      difficulty: 2,
      make: (rng) => {
        const values = Array.from({ length: 6 }, () => int(rng, 1, 15));
        const mod = pick(rng, [2, 3]);
        const add = int(rng, 1, 5);
        const kept = values.filter((n) => n % mod === 0).map((n) => n + add);
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let v = vec![${values.join(", ")}];\nlet out: Vec<i32> = v.iter().filter(|n| *n % ${mod} == 0).map(|n| n + ${add}).collect();\nprintln!("{:?} {}", out, out.iter().sum::<i32>());`,
          ),
          answer: `[${kept.join(", ")}] ${kept.reduce((a, b) => a + b, 0)}`,
          explain: `Keep multiples of ${mod}, then add ${add} to each.`,
        };
      },
    },
    {
      id: "clo-g-skip-take",
      topic: "adapters",
      difficulty: 2,
      make: (rng) => {
        const start = int(rng, 1, 10);
        const skip = int(rng, 0, 3);
        const take = int(rng, 2, 4);
        const step = int(rng, 1, 3);
        const values: number[] = [];
        for (let n = start; values.length < skip + take; n += step) values.push(n);
        const out = values.slice(skip, skip + take);
        return {
          kind: "output",
          prompt:
            "Iterators are lazy, so an unbounded range is fine. What exactly does this print?",
          code: program(
            `let v: Vec<u32> = (${start}..).step_by(${step}).skip(${skip}).take(${take}).collect();\nprintln!("{v:?}");`,
          ),
          answer: `[${out.join(", ")}]`,
          explain: `Counting from ${start} in steps of ${step}, skipping ${skip} and taking ${take}.`,
        };
      },
    },
    {
      id: "clo-g-fold",
      topic: "consumers",
      difficulty: 3,
      make: (rng) => {
        const values = Array.from({ length: 4 }, () => int(rng, 1, 9));
        const mul = int(rng, 2, 3);
        const trace = [0];
        for (const n of values) trace.push((trace.at(-1) ?? 0) * mul + n);
        const result = trace.at(-1) ?? 0;
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let v = [${values.join(", ")}];\nlet r = v.iter().fold(0, |acc, n| acc * ${mul} + n);\nprintln!("{r}");`,
          ),
          answer: String(result),
          explain: `Each step multiplies the accumulator by ${mul} and adds the next item: ${trace.join(" → ")}.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "clo-c-lazy",
      front: "When does `v.iter().map(f)` call `f`?",
      back: "Only when a consumer pulls items — iterators are lazy.",
    },
    {
      id: "clo-c-traits",
      front: "Fn vs FnMut vs FnOnce?",
      back: "Reads captures / mutates captures / may consume captures (callable once).",
    },
    {
      id: "clo-c-move",
      front: "What does `move ||` change?",
      back: "The closure takes ownership of what it captures instead of borrowing.",
    },
    {
      id: "clo-c-iter-kinds",
      front: "`iter()`, `iter_mut()`, `into_iter()` yield…?",
      back: "`&T`, `&mut T`, `T`.",
    },
    {
      id: "clo-c-collect",
      front: "How do you tell `collect` what to build?",
      back: "Annotate the binding (`let v: Vec<_> = …`) or use turbofish (`collect::<Vec<_>>()`).",
    },
    {
      id: "clo-c-fold",
      front: "What does `fold(init, |acc, x| …)` do?",
      back: "Threads an accumulator through every item and returns its final value.",
    },
    {
      id: "clo-c-windows",
      front: "`windows(2)` vs `chunks(2)` on `[1,2,3]`?",
      back: "`[1,2],[2,3]` (overlapping) vs `[1,2],[3]` (disjoint).",
    },
    {
      id: "clo-c-zip",
      front: "When does `a.zip(b)` stop?",
      back: "When the shorter iterator runs out.",
    },
  ],
};

const traitObjects: SegmentBank = {
  chapterId: "trait-objects",
  questions: [
    {
      id: "dyn-q-vec-box",
      kind: "output",
      topic: "dispatch",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'trait Shape {\n    fn area(&self) -> f64;\n}\n\nstruct Sq(f64);\nstruct Circle(f64);\n\nimpl Shape for Sq {\n    fn area(&self) -> f64 {\n        self.0 * self.0\n    }\n}\n\nimpl Shape for Circle {\n    fn area(&self) -> f64 {\n        3.0 * self.0 * self.0\n    }\n}\n\nfn main() {\n    let shapes: Vec<Box<dyn Shape>> = vec![Box::new(Sq(2.0)), Box::new(Circle(1.0))];\n    let total: f64 = shapes.iter().map(|s| s.area()).sum();\n    println!("{total}");\n}',
      answer: "7",
      explain:
        "`Box<dyn Shape>` lets one vector hold different concrete types; each `area` call is dispatched through the vtable.",
    },
    {
      id: "dyn-q-unsized",
      kind: "compiles",
      topic: "dispatch",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'trait Shape {\n    fn area(&self) -> f64;\n}\n\nfn main() {\n    let shapes: Vec<dyn Shape> = Vec::new();\n    println!("{}", shapes.len());\n}',
      compiles: false,
      codeError: "E0277",
      explain:
        "`dyn Shape` has no size known at compile time, so it cannot be stored by value. Put it behind a pointer: `Box<dyn Shape>` or `&dyn Shape`.",
    },
    {
      id: "dyn-q-generic-method",
      kind: "compiles",
      topic: "compatibility",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: "trait Store {\n    fn put<T: std::fmt::Debug>(&mut self, item: T);\n}\n\nfn main() {\n    let _s: Option<Box<dyn Store>> = None;\n}",
      compiles: false,
      codeError: "E0038",
      explain:
        "A generic method would need a vtable entry per possible `T`, which cannot exist. Traits with generic methods are not dyn compatible (E0038) unless those methods have `where Self: Sized`.",
    },
    {
      id: "dyn-q-static-vs-dynamic",
      kind: "choice",
      topic: "dispatch",
      difficulty: 2,
      prompt: "`fn draw(x: &impl Draw)` vs `fn draw(x: &dyn Draw)` — which statement is correct?",
      options: [
        "The first is dynamic dispatch; the second is static",
        "The first is monomorphized per type (static); the second uses one function and a vtable (dynamic)",
        "They compile to identical code",
      ],
      answer: 1,
      explain:
        "Generics duplicate code per type and allow inlining. Trait objects share one copy and look up methods at runtime, enabling heterogeneous collections.",
    },
    {
      id: "dyn-q-default-through-dyn",
      kind: "output",
      topic: "dispatch",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'trait Animal {\n    fn name(&self) -> &str;\n    fn intro(&self) -> String {\n        format!("I am {}", self.name())\n    }\n}\n\nstruct Dog;\nstruct Cat;\n\nimpl Animal for Dog {\n    fn name(&self) -> &str {\n        "dog"\n    }\n}\n\nimpl Animal for Cat {\n    fn name(&self) -> &str {\n        "cat"\n    }\n    fn intro(&self) -> String {\n        String::from("...")\n    }\n}\n\nfn main() {\n    let zoo: [&dyn Animal; 2] = [&Dog, &Cat];\n    for a in zoo {\n        println!("{}", a.intro());\n    }\n}',
      answer: "I am dog\n...",
      explain:
        "Default methods and overrides both appear in the vtable; each object calls its own version.",
    },
    {
      id: "dyn-q-prefer-generics",
      kind: "choice",
      topic: "design",
      difficulty: 2,
      prompt: "When is a trait object the better choice over generics?",
      options: [
        "Always — it is faster",
        "When you need a collection of mixed concrete types, or the set of types is only known at runtime",
        "When the trait has generic methods",
      ],
      answer: 1,
      explain: "Reach for generics first; use `dyn` for heterogeneity or to reduce code size.",
    },
    {
      id: "dyn-q-impl-return",
      kind: "compiles",
      topic: "design",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'use std::fmt::Display;\n\nfn pick(flag: bool) -> impl Display {\n    if flag { 1 } else { "one" }\n}\n\nfn main() {\n    println!("{}", pick(true));\n}',
      compiles: false,
      codeError: "E0308",
      explain:
        "`impl Trait` in return position is one hidden concrete type. Returning different types needs `Box<dyn Display>`.",
    },
    {
      id: "dyn-q-box-return",
      kind: "output",
      topic: "design",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::fmt::Display;\n\nfn pick(flag: bool) -> Box<dyn Display> {\n    if flag { Box::new(1) } else { Box::new("one") }\n}\n\nfn main() {\n    println!("{} {}", pick(true), pick(false));\n}',
      answer: "1 one",
      explain: "Boxing erases the concrete types behind one pointer type, so both branches agree.",
    },
    {
      id: "dyn-q-dyn-keyword",
      kind: "recall",
      topic: "dispatch",
      difficulty: 1,
      prompt: "Type the keyword written before a trait name to form a trait-object type.",
      accept: ["dyn"],
      explain: "`Box<dyn Trait>`, `&dyn Trait`, `Arc<dyn Trait + Send>`.",
    },
    {
      id: "dyn-q-vtable",
      kind: "choice",
      topic: "dispatch",
      difficulty: 3,
      prompt: "What does a `&dyn Trait` consist of at runtime?",
      options: [
        "A pointer to the data only",
        "A pointer to the data plus a pointer to a vtable of method addresses (and size/drop info)",
        "A copy of the value plus its type name",
      ],
      answer: 1,
      explain:
        "Trait-object pointers are 'fat': two words. The vtable is shared by all values of the same concrete type.",
    },
    {
      id: "dyn-q-self-return",
      kind: "compiles",
      topic: "compatibility",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: "trait Cloneish {\n    fn duplicate(&self) -> Self;\n}\n\nfn main() {\n    let _items: Vec<Box<dyn Cloneish>> = Vec::new();\n}",
      compiles: false,
      codeError: "E0038",
      explain:
        "Returning `Self` by value requires knowing the concrete size, which a trait object hides. Such methods need `where Self: Sized`.",
    },
    {
      id: "dyn-q-fat-size",
      kind: "output",
      topic: "dispatch",
      difficulty: 3,
      prompt: "On a 64-bit target, what exactly does this print?",
      code: 'use std::fmt::Debug;\nuse std::mem::size_of;\n\nfn main() {\n    println!("{} {} {}", size_of::<&u8>(), size_of::<&dyn Debug>(), size_of::<Box<dyn Debug>>());\n}',
      answer: "8 16 16",
      explain: "A thin pointer is one word; a trait-object pointer adds the vtable pointer.",
    },
    {
      id: "dyn-q-mut-dyn",
      kind: "output",
      topic: "design",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'trait Sink {\n    fn write(&mut self, s: &str);\n}\n\nstruct Count(usize);\nstruct Keep(String);\n\nimpl Sink for Count {\n    fn write(&mut self, s: &str) {\n        self.0 += s.len();\n    }\n}\n\nimpl Sink for Keep {\n    fn write(&mut self, s: &str) {\n        self.0.push_str(s);\n    }\n}\n\nfn log_all(sink: &mut dyn Sink) {\n    sink.write("ab");\n    sink.write("cde");\n}\n\nfn main() {\n    let mut c = Count(0);\n    let mut k = Keep(String::new());\n    log_all(&mut c);\n    log_all(&mut k);\n    println!("{} {}", c.0, k.0);\n}',
      answer: "5 abcde",
      explain:
        "`&mut dyn Trait` lends a mutable trait object; each implementation updates its own state.",
    },
    {
      id: "dyn-q-strategy",
      kind: "multi",
      topic: "design",
      difficulty: 2,
      prompt:
        "Select every type that can hold 'some value implementing `Fn(i32) -> i32`' chosen at runtime.",
      options: [
        "`Box<dyn Fn(i32) -> i32>`",
        "`&dyn Fn(i32) -> i32`",
        "`fn(i32) -> i32` (for non-capturing closures)",
        "`dyn Fn(i32) -> i32` by value",
      ],
      answers: [0, 1, 2],
      explain:
        "Closures are trait objects when boxed or borrowed; non-capturing closures also coerce to plain function pointers. A bare `dyn Fn` is unsized.",
    },
  ],
  generators: [
    {
      id: "dyn-g-shapes",
      topic: "dispatch",
      difficulty: 2,
      make: (rng) => {
        const shapes = Array.from({ length: int(rng, 2, 4) }, () =>
          rng() < 0.5
            ? { kind: "Sq", a: int(rng, 1, 9), b: 0 }
            : { kind: "Rect", a: int(rng, 1, 9), b: int(rng, 1, 9) },
        );
        const total = shapes.reduce((sum, s) => sum + (s.kind === "Sq" ? s.a * s.a : s.a * s.b), 0);
        const items = shapes.map((s) =>
          s.kind === "Sq" ? `Box::new(Sq(${s.a}))` : `Box::new(Rect(${s.a}, ${s.b}))`,
        );
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let shapes: Vec<Box<dyn Shape>> = vec![${items.join(", ")}];\nlet total: u32 = shapes.iter().map(|s| s.area()).sum();\nprintln!("{} {}", shapes.len(), total);`,
            "trait Shape {\n    fn area(&self) -> u32;\n}\n\nstruct Sq(u32);\nstruct Rect(u32, u32);\n\nimpl Shape for Sq {\n    fn area(&self) -> u32 {\n        self.0 * self.0\n    }\n}\n\nimpl Shape for Rect {\n    fn area(&self) -> u32 {\n        self.0 * self.1\n    }\n}",
          ),
          answer: `${shapes.length} ${total}`,
          explain:
            "Each boxed shape dispatches to its own `area` implementation through the vtable.",
        };
      },
    },
    {
      id: "dyn-g-ops",
      topic: "design",
      difficulty: 3,
      make: (rng) => {
        const ops = shuffle(rng, [
          ["add", (n: number, k: number) => n + k, "n + k"],
          ["mul", (n: number, k: number) => n * k, "n * k"],
          ["sub", (n: number, k: number) => n - k, "n - k"],
        ] as const).slice(0, 2);
        const constants = ops.map(() => int(rng, 2, 6));
        const start = int(rng, 1, 9);
        let value = start;
        ops.forEach(([, f], index) => {
          value = f(value, constants[index] ?? 0);
        });
        return {
          kind: "output",
          prompt: "Boxed closures applied in order. What exactly does this print?",
          code: program(
            `let steps: Vec<Box<dyn Fn(i32) -> i32>> = vec![\n${ops
              .map(
                ([, , expr], index) =>
                  `    { let k = ${constants[index]}; Box::new(move |n: i32| ${expr}) as Box<dyn Fn(i32) -> i32> },`,
              )
              .join(
                "\n",
              )}\n];\nlet result = steps.iter().fold(${start}, |acc, f| f(acc));\nprintln!("{result}");`,
          ),
          answer: String(value),
          explain: `Starting from ${start}, apply ${ops.map(([name], index) => `${name} ${constants[index]}`).join(" then ")}.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "dyn-c-what",
      front: "What is a trait object?",
      back: "A value of unknown concrete type used through a pointer (`&dyn T`, `Box<dyn T>`), with methods found via a vtable.",
    },
    {
      id: "dyn-c-why-box",
      front: "Why can't you write `Vec<dyn Shape>`?",
      back: "`dyn Shape` is unsized; store `Box<dyn Shape>` instead.",
    },
    {
      id: "dyn-c-static-dynamic",
      front: "Static vs dynamic dispatch?",
      back: "Generics: resolved at compile time per type. `dyn`: one function, method looked up in a vtable at runtime.",
    },
    {
      id: "dyn-c-compat",
      front: "Two things that make a trait not dyn compatible?",
      back: "Generic methods, or methods returning `Self` by value (without `where Self: Sized`).",
    },
    {
      id: "dyn-c-fat",
      front: "How big is `&dyn Trait` on 64-bit?",
      back: "16 bytes: data pointer + vtable pointer.",
    },
    {
      id: "dyn-c-impl-return",
      front: "Can `-> impl Trait` return different types from different branches?",
      back: "No — it is one concrete type. Use `Box<dyn Trait>`.",
    },
    {
      id: "dyn-c-first",
      front: "Default choice: generics or trait objects?",
      back: "Generics, unless you need heterogeneous collections or runtime choice.",
    },
    {
      id: "dyn-c-closure",
      front: "How do you store different closures in one Vec?",
      back: "`Vec<Box<dyn Fn(A) -> B>>`",
    },
  ],
};

const modules: SegmentBank = {
  chapterId: "modules",
  questions: [
    {
      id: "mod-q-private-fn",
      kind: "compiles",
      topic: "privacy",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'mod kitchen {\n    fn secret_recipe() -> u32 {\n        42\n    }\n}\n\nfn main() {\n    println!("{}", kitchen::secret_recipe());\n}',
      compiles: false,
      codeError: "E0603",
      explain:
        "Items are private to their module by default. Mark it `pub fn` to expose it to the parent.",
    },
    {
      id: "mod-q-private-field",
      kind: "compiles",
      topic: "privacy",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'mod bank {\n    pub struct Account {\n        pub owner: String,\n        balance: u64,\n    }\n}\n\nfn main() {\n    let a = bank::Account { owner: String::from("ada"), balance: 10 };\n    println!("{}", a.owner);\n}',
      compiles: false,
      codeError: "E0451",
      explain:
        "A `pub struct` can still have private fields, and outside code cannot name them — not even to construct one. Provide a `pub fn new` so the module keeps control of its invariants.",
    },
    {
      id: "mod-q-super",
      kind: "output",
      topic: "paths",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'const BASE: u32 = 100;\n\nmod shop {\n    pub mod till {\n        pub fn total(n: u32) -> u32 {\n            super::super::BASE + super::fee() + n\n        }\n    }\n    fn fee() -> u32 {\n        5\n    }\n}\n\nfn main() {\n    println!("{}", shop::till::total(1));\n}',
      answer: "106",
      explain:
        "`super` walks one module up. A child module may use its ancestors' private items, so `till` can call the private `shop::fee`.",
    },
    {
      id: "mod-q-child-sees-parent",
      kind: "compiles",
      topic: "privacy",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'mod outer {\n    fn helper() -> u8 {\n        7\n    }\n    pub mod inner {\n        pub fn call() -> u8 {\n            super::helper()\n        }\n    }\n}\n\nfn main() {\n    println!("{}", outer::inner::call());\n}',
      compiles: true,
      explain:
        "Privacy restricts access from outside a module, not from its descendants. Children see everything their ancestors define.",
    },
    {
      id: "mod-q-pub-keyword",
      kind: "recall",
      topic: "privacy",
      difficulty: 1,
      prompt: "Type the keyword that makes an item visible outside its module.",
      accept: ["pub"],
      explain:
        "`pub` exposes an item to the parent module (and further, if every step on the path is public).",
    },
    {
      id: "mod-q-file-layout",
      kind: "choice",
      topic: "files",
      difficulty: 2,
      prompt: "`src/main.rs` contains `mod network;`. Where does Cargo look for the module's code?",
      options: [
        "`src/network.rs` or `src/network/mod.rs`",
        "Anywhere under `src/` with `network` in the name",
        "`Cargo.toml` `[modules]` table",
      ],
      answer: 0,
      explain:
        "A `mod name;` declaration loads `name.rs` next to the declaring file (or `name/mod.rs`). Files are never modules unless declared.",
    },
    {
      id: "mod-q-enum-variants",
      kind: "compiles",
      topic: "privacy",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'mod menu {\n    #[derive(Debug)]\n    pub enum Size {\n        Small,\n        Large,\n    }\n}\n\nfn main() {\n    let s = menu::Size::Large;\n    println!("{:?} {:?}", s, menu::Size::Small);\n}',
      compiles: true,
      explain: "Unlike struct fields, all variants of a `pub enum` are public.",
    },
    {
      id: "mod-q-pub-crate",
      kind: "choice",
      topic: "privacy",
      difficulty: 2,
      prompt: "What does `pub(crate) fn audit()` mean?",
      options: [
        "Public to the entire world",
        "Visible anywhere inside this crate, but not to crates that depend on it",
        "Visible only to the parent module",
      ],
      answer: 1,
      explain: "`pub(crate)` is the usual choice for internal helpers shared across modules.",
    },
    {
      id: "mod-q-lib-bin",
      kind: "choice",
      topic: "files",
      difficulty: 2,
      prompt: "A package has both `src/lib.rs` and `src/main.rs`. How many crates does it contain?",
      options: [
        "One — main.rs includes lib.rs",
        "Two — a library crate and a binary crate with the package's name",
        "It is a compile error",
      ],
      answer: 1,
      explain:
        "The binary uses the library through its public API like any other dependency (`use my_package::…`), which keeps logic testable.",
    },
    {
      id: "mod-q-unresolved",
      kind: "compiles",
      topic: "paths",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'mod tools {\n    pub fn hammer() -> &\'static str {\n        "bang"\n    }\n}\n\nfn main() {\n    println!("{}", tool::hammer());\n}',
      compiles: false,
      codeError: "E0433",
      explain:
        "`tool` is not a module in scope (E0433). The compiler suggests the similarly named `tools`.",
    },
    {
      id: "mod-q-use",
      kind: "output",
      topic: "paths",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'mod geometry {\n    pub mod shapes {\n        pub fn square(n: u32) -> u32 {\n            n * n\n        }\n    }\n}\n\nuse geometry::shapes;\nuse geometry::shapes::square as sq;\n\nfn main() {\n    println!("{} {}", shapes::square(3), sq(4));\n}',
      answer: "9 16",
      explain: "`use` creates a local shortcut to a path; `as` renames it.",
    },
    {
      id: "mod-q-reexport",
      kind: "choice",
      topic: "paths",
      difficulty: 3,
      prompt: "Why write `pub use crate::parser::Token;` in `lib.rs`?",
      options: [
        "To copy the code of `Token` into lib.rs",
        "To re-export it, so users write `my_crate::Token` regardless of internal module layout",
        "To make `Token` private",
      ],
      answer: 1,
      explain: "Re-exports decouple your public API from your file organisation.",
    },
    {
      id: "mod-q-package-crate",
      kind: "multi",
      topic: "files",
      difficulty: 2,
      prompt: "Select every true statement.",
      options: [
        "A package is described by one `Cargo.toml`",
        "A package can contain at most one library crate",
        "A package can contain many binary crates (e.g. in `src/bin/`)",
        "Every `.rs` file under `src/` is automatically compiled as a module",
      ],
      answers: [0, 1, 2],
      explain: "Files only join the module tree when a `mod` declaration names them.",
    },
    {
      id: "mod-q-const-path",
      kind: "output",
      topic: "paths",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'mod limits {\n    pub const MAX: u32 = 10;\n    pub mod strict {\n        pub const MAX: u32 = super::MAX / 2;\n    }\n}\n\nfn main() {\n    use limits::strict;\n    println!("{} {}", limits::MAX, strict::MAX);\n}',
      answer: "10 5",
      explain:
        "Each module is its own namespace, so both `MAX` constants coexist; `super::MAX` refers to the parent's.",
    },
  ],
  generators: [
    {
      id: "mod-g-privacy",
      topic: "privacy",
      difficulty: 2,
      make: (rng) => {
        const outer = pick(rng, ["net", "store", "audio", "maths"]);
        const inner = pick(rng, ["codec", "cache", "util", "core"]);
        const func = pick(rng, ["value", "load", "run", "level"]);
        const innerPub = rng() < 0.5;
        const fnPub = rng() < 0.6;
        const compiles = innerPub && fnPub;
        return {
          kind: "compiles",
          prompt: "Does this program compile?",
          code: program(
            `println!("{}", ${outer}::${inner}::${func}());`,
            `mod ${outer} {\n    ${innerPub ? "pub " : ""}mod ${inner} {\n        ${fnPub ? "pub " : ""}fn ${func}() -> u8 {\n            1\n        }\n    }\n}`,
          ),
          compiles,
          codeError: compiles ? undefined : "E0603",
          explain: compiles
            ? "Every item on the path from `main` is public, so the call resolves."
            : `Every step on the path must be visible from \`main\`: the ${!innerPub ? `module \`${inner}\`` : `function \`${func}\``} is private (E0603).`,
        };
      },
    },
    {
      id: "mod-g-paths",
      topic: "paths",
      difficulty: 2,
      make: (rng) => {
        const [a, b, c] = distinctInts(rng, 3, 2, 20);
        const pickCall = pick(rng, ["top", "mid", "deep"] as const);
        const value =
          pickCall === "top"
            ? a
            : pickCall === "mid"
              ? (a ?? 0) + (b ?? 0)
              : (a ?? 0) + (b ?? 0) + (c ?? 0);
        const path =
          pickCall === "top"
            ? "a::value()"
            : pickCall === "mid"
              ? "a::b::value()"
              : "a::b::c::value()";
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `println!("{}", ${path});`,
            `mod a {\n    pub fn value() -> u32 {\n        ${a}\n    }\n    pub mod b {\n        pub fn value() -> u32 {\n            super::value() + ${b}\n        }\n        pub mod c {\n            pub fn value() -> u32 {\n                super::value() + ${c}\n            }\n        }\n    }\n}`,
          ),
          answer: String(value),
          explain:
            "Each `value` adds its constant to its parent's `super::value()`, so deeper modules accumulate.",
        };
      },
    },
  ],
  cards: [
    {
      id: "mod-c-default",
      front: "Default visibility of items in a module?",
      back: "Private to that module (and its descendants).",
    },
    {
      id: "mod-c-fields",
      front: "Are the fields of a `pub struct` public?",
      back: "No — each field needs its own `pub`. (All variants of a `pub enum` are public.)",
    },
    {
      id: "mod-c-super",
      front: "What does `super::` refer to?",
      back: "The parent module.",
    },
    {
      id: "mod-c-file",
      front: "Where does `mod parser;` load code from?",
      back: "`parser.rs` beside the declaring file, or `parser/mod.rs`.",
    },
    {
      id: "mod-c-pub-crate",
      front: "What does `pub(crate)` mean?",
      back: "Visible anywhere in the current crate, but not to other crates.",
    },
    {
      id: "mod-c-lib-bin",
      front: "Why split logic into `lib.rs` with a thin `main.rs`?",
      back: "The library is testable and reusable; the binary just wires input/output.",
    },
    {
      id: "mod-c-e0603",
      front: "Error E0603?",
      back: "The item exists but is private at that point in the path.",
    },
    {
      id: "mod-c-reexport",
      front: "What does `pub use` do?",
      back: "Re-exports an item so it is reachable from this module's path.",
    },
  ],
};

const testing: SegmentBank = {
  chapterId: "testing",
  questions: [
    {
      id: "test-q-cfg",
      kind: "choice",
      topic: "structure",
      difficulty: 1,
      prompt: "What does `#[cfg(test)]` on `mod tests` do?",
      options: [
        "Runs the module's code before `main`",
        "Compiles the module only when building tests, so it adds nothing to the normal binary",
        "Marks every function in it as a test",
      ],
      answer: 1,
      explain:
        "Tests and test-only helpers are compiled only for `cargo test`. Each test function still needs `#[test]`.",
    },
    {
      id: "test-q-private-access",
      kind: "compiles",
      topic: "structure",
      difficulty: 2,
      prompt: "Does this program compile (as a normal binary)?",
      code: 'fn internal_adder(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn adds() {\n        assert_eq!(internal_adder(2, 2), 4);\n    }\n}\n\nfn main() {\n    println!("{}", internal_adder(1, 1));\n}',
      compiles: true,
      explain:
        "A child `tests` module may call private functions of its parent via `use super::*`, so Rust lets you unit-test internals.",
    },
    {
      id: "test-q-should-panic",
      kind: "choice",
      topic: "assertions",
      difficulty: 2,
      prompt: 'What does `#[should_panic(expected = "divide by zero")]` check?',
      options: [
        "That the test panics with a message containing the text",
        "That the test does not panic",
        "That the text is printed to stdout",
      ],
      answer: 0,
      explain:
        "`expected` makes the test fail if it panics for a different reason, which keeps it precise.",
    },
    {
      id: "test-q-filter",
      kind: "recall",
      topic: "running",
      difficulty: 1,
      prompt: "Type the command that runs only tests whose names contain `parse`.",
      accept: ["cargo test parse"],
      explain: "The first argument to `cargo test` is a substring filter on test names.",
    },
    {
      id: "test-q-parallel",
      kind: "choice",
      topic: "running",
      difficulty: 2,
      prompt:
        "Two tests write to the same temporary file and fail intermittently. Why, and what is the quick fix?",
      options: [
        "Tests run in parallel threads by default; isolate the files or run with `cargo test -- --test-threads=1`",
        "Tests run in random order; add `#[order(1)]`",
        "The file system caches writes; call `sync()`",
      ],
      answer: 0,
      explain:
        "The test harness runs tests concurrently. Prefer making tests independent (unique temp dirs); single-threading is a diagnostic crutch.",
    },
    {
      id: "test-q-integration-dir",
      kind: "choice",
      topic: "structure",
      difficulty: 1,
      prompt: "Where do integration tests live, and what can they call?",
      options: [
        "`tests/*.rs`; only the library's public API",
        "`src/tests.rs`; any function",
        "`benches/`; private functions",
      ],
      answer: 0,
      explain:
        "Each file in `tests/` is a separate crate that uses your library like an external user would.",
    },
    {
      id: "test-q-result-tests",
      kind: "choice",
      topic: "assertions",
      difficulty: 3,
      prompt: "What does declaring `#[test] fn parses() -> Result<(), String>` allow?",
      options: [
        "Using `?` in the test body; returning `Err` fails the test",
        "Running the test asynchronously",
        "Skipping the test when it returns `Err`",
      ],
      answer: 0,
      explain:
        "Result-returning tests make fallible setup concise. (`should_panic` cannot be combined with them.)",
    },
    {
      id: "test-q-ignore",
      kind: "choice",
      topic: "running",
      difficulty: 2,
      prompt: "A slow test is marked `#[ignore]`. How do you run it?",
      options: ["`cargo test -- --ignored`", "`cargo test --slow`", "It can never run"],
      answer: 0,
      explain: "`--ignored` runs only ignored tests; `--include-ignored` runs everything.",
    },
    {
      id: "test-q-fail-macros",
      kind: "multi",
      topic: "assertions",
      difficulty: 1,
      prompt: "Select every macro that can make a test fail.",
      options: ["`assert!`", "`assert_eq!`", "`panic!`", "`println!`"],
      answers: [0, 1, 2],
      explain: "A test fails when it panics; assertions panic when their condition is false.",
    },
    {
      id: "test-q-nocapture",
      kind: "choice",
      topic: "running",
      difficulty: 2,
      prompt: "Your passing test calls `println!`, but nothing appears. Why?",
      options: [
        "Output of passing tests is captured; use `cargo test -- --nocapture` (or `--show-output`)",
        "`println!` is disabled under `#[cfg(test)]`",
        "Tests run without a terminal",
      ],
      answer: 0,
      explain: "Captured output is shown only for failing tests unless you ask otherwise.",
    },
    {
      id: "test-q-doc",
      kind: "choice",
      topic: "structure",
      difficulty: 2,
      prompt: "What happens to a code block inside a `///` doc comment on a library function?",
      options: [
        "`cargo test` compiles and runs it as a doctest",
        "It is ignored except by rustdoc's HTML output",
        "It is copied into the binary",
      ],
      answer: 0,
      explain:
        "Doctests keep examples honest: documentation that no longer compiles fails the build.",
    },
    {
      id: "test-q-assert-eq-output",
      kind: "choice",
      topic: "assertions",
      difficulty: 1,
      prompt: "Why is `assert_eq!(got, 4)` usually better than `assert!(got == 4)`?",
      options: [
        "It is faster",
        "On failure it prints both the left and right values",
        "It works for types without `PartialEq`",
      ],
      answer: 1,
      explain:
        "Seeing both values usually tells you what went wrong without re-running under a debugger.",
    },
    {
      id: "test-q-red-green",
      kind: "choice",
      topic: "assertions",
      difficulty: 2,
      prompt: "You found a bug. What is the evidence-first order of work?",
      options: [
        "Fix it, then write a test that passes",
        "Write a test that fails because of the bug, see it fail, then fix until it passes",
        "Fix it and rely on manual testing",
      ],
      answer: 1,
      explain:
        "A test that never failed proves nothing. Red first shows the test actually detects the bug.",
    },
    {
      id: "test-q-debug-assert",
      kind: "output",
      topic: "assertions",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn average(values: &[u32]) -> u32 {\n    assert!(!values.is_empty(), "average of nothing");\n    values.iter().sum::<u32>() / values.len() as u32\n}\n\nfn main() {\n    let ok = std::panic::catch_unwind(|| average(&[]));\n    println!("{} {}", average(&[2, 4, 9]), ok.is_err());\n}',
      answer: "5 true",
      explain:
        "Assertions work in ordinary code too: (2 + 4 + 9) / 3 = 5, and the empty call panics (captured here by `catch_unwind`) instead of dividing by zero.",
    },
  ],
  generators: [
    {
      id: "test-g-filter",
      topic: "running",
      difficulty: 2,
      make: (rng) => {
        const names = shuffle(rng, [
          "parse_empty",
          "parse_number",
          "render_table",
          "render_parse_error",
          "tokenize_words",
          "config_parse_path",
          "config_defaults",
        ]).slice(0, 5);
        const usable = ["parse", "render", "config", "error", "number", "words", "path"].filter(
          (candidate) => {
            const count = names.filter((name) => name.includes(candidate)).length;
            return count > 0 && count < names.length;
          },
        );
        const filter = pick(rng, usable);
        const selected = names
          .map((name, index) => (name.includes(filter) ? index : -1))
          .filter((index) => index >= 0);
        return {
          kind: "multi",
          prompt: `Which of these tests run with \`cargo test ${filter}\`?`,
          options: names.map((name) => `\`${name}\``),
          answers: selected,
          explain: `The filter is a substring match: every test name containing "${filter}" runs, wherever it appears in the name.`,
        };
      },
    },
    {
      id: "test-g-assert",
      topic: "assertions",
      difficulty: 1,
      make: (rng) => {
        const a = int(rng, 2, 12);
        const b = int(rng, 2, 12);
        const claimed = a * b + pick(rng, [0, 0, 1, -1]);
        const passes = claimed === a * b;
        return {
          kind: "output",
          prompt:
            "`catch_unwind` reports whether the closure panicked. What exactly does this print?",
          code: program(
            `let passed = std::panic::catch_unwind(|| {\n    assert_eq!(${a} * ${b}, ${claimed});\n})\n.is_ok();\nprintln!("{passed}");`,
          ),
          answer: String(passes),
          explain: passes
            ? `${a} × ${b} = ${a * b}, so the assertion holds.`
            : `${a} × ${b} = ${a * b}, not ${claimed}, so \`assert_eq!\` panics and the result is false.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "test-c-cfg",
      front: "What does `#[cfg(test)]` do?",
      back: "Compiles the item only for `cargo test`.",
    },
    {
      id: "test-c-private",
      front: "Can unit tests call private functions?",
      back: "Yes — the `tests` child module uses `use super::*;`.",
    },
    {
      id: "test-c-integration",
      front: "Where do integration tests go, and what can they use?",
      back: "`tests/` — only the crate's public API.",
    },
    {
      id: "test-c-filter",
      front: "Run only tests matching `auth`?",
      back: "`cargo test auth`",
    },
    {
      id: "test-c-threads",
      front: "Do tests run sequentially?",
      back: "No, in parallel by default (`-- --test-threads=1` to serialise).",
    },
    {
      id: "test-c-should-panic",
      front: "Make a test pass only if it panics with a given message?",
      back: '`#[should_panic(expected = "…")]`',
    },
    {
      id: "test-c-nocapture",
      front: "Show `println!` output from passing tests?",
      back: "`cargo test -- --nocapture` (or `--show-output`).",
    },
    {
      id: "test-c-red",
      front: "Why watch a new test fail first?",
      back: "It proves the test can detect the bug it is meant to catch.",
    },
  ],
};

export const abstractionBanks: SegmentBank[] = [
  abstraction,
  modules,
  testing,
  closuresIterators,
  traitObjects,
];
