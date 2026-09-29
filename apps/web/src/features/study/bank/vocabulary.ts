import { distinctInts, int, pick, shuffle } from "../rng";
import type { SegmentBank } from "../types";
import { program } from "./helpers";

const structs: SegmentBank = {
  chapterId: "structs",
  questions: [
    {
      id: "struct-q-update",
      kind: "output",
      topic: "construction",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: '#[derive(Debug)]\nstruct Config {\n    retries: u32,\n    verbose: bool,\n    name: &\'static str,\n}\n\nfn main() {\n    let base = Config { retries: 3, verbose: false, name: "base" };\n    let loud = Config { verbose: true, ..base };\n    println!("{} {} {}", loud.retries, loud.verbose, loud.name);\n}',
      answer: "3 true base",
      explain: "Struct update syntax `..base` fills every field not listed explicitly from `base`.",
    },
    {
      id: "struct-q-update-move",
      kind: "compiles",
      topic: "construction",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'struct User {\n    name: String,\n    email: String,\n    active: bool,\n}\n\nfn main() {\n    let u1 = User { name: String::from("ada"), email: String::from("a@x"), active: true };\n    let u2 = User { email: String::from("b@x"), ..u1 };\n    println!("{} {}", u1.name, u2.active);\n}',
      compiles: false,
      codeError: "E0382",
      explain:
        "`..u1` moves the fields it copies. `name` is a `String`, so `u1.name` was moved into `u2`. Copy fields like `active` would still be usable on `u1`.",
    },
    {
      id: "struct-q-area",
      kind: "output",
      topic: "methods",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'struct Rect {\n    w: u32,\n    h: u32,\n}\n\nimpl Rect {\n    fn area(&self) -> u32 {\n        self.w * self.h\n    }\n    fn square(side: u32) -> Self {\n        Self { w: side, h: side }\n    }\n}\n\nfn main() {\n    let r = Rect { w: 3, h: 4 };\n    println!("{} {}", r.area(), Rect::square(5).area());\n}',
      answer: "12 25",
      explain:
        "`area` takes `&self` and is called with dot syntax. `square` has no `self`, so it is an associated function called with `Rect::square`.",
    },
    {
      id: "struct-q-mut-self",
      kind: "compiles",
      topic: "methods",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: "struct Meter {\n    total: u32,\n}\n\nimpl Meter {\n    fn add(&mut self, n: u32) {\n        self.total += n;\n    }\n}\n\nfn main() {\n    let m = Meter { total: 0 };\n    m.add(5);\n}",
      compiles: false,
      codeError: "E0596",
      explain:
        "A `&mut self` method needs a mutable borrow of the receiver, so the binding must be `let mut m`.",
    },
    {
      id: "struct-q-receivers",
      kind: "choice",
      topic: "methods",
      difficulty: 2,
      prompt:
        "A method turns a `Draft` into a `Published` post; the draft should not be usable afterwards. Which receiver?",
      options: ["`&self`", "`&mut self`", "`self`"],
      answer: 2,
      feedback: [
        "`&self` only reads; the draft would remain usable.",
        "`&mut self` edits in place but cannot change the type or end the draft's life.",
        null,
      ],
      explain:
        "Taking `self` by value consumes the receiver: the caller's binding is moved, which encodes 'this draft no longer exists' in the type system.",
    },
    {
      id: "struct-q-display-missing",
      kind: "compiles",
      topic: "traits",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'struct Point {\n    x: i32,\n    y: i32,\n}\n\nfn main() {\n    let p = Point { x: 1, y: 2 };\n    println!("{}", p);\n}',
      compiles: false,
      codeError: "E0277",
      explain:
        "`{}` requires `Display`, which user types must implement by hand. Deriving `Debug` and printing with `{:?}` is the quick alternative.",
    },
    {
      id: "struct-q-debug-named",
      kind: "output",
      topic: "traits",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: '#[derive(Debug)]\nstruct Point {\n    x: i32,\n    y: i32,\n}\n\nfn main() {\n    println!("{:?}", Point { x: 1, y: -2 });\n}',
      answer: "Point { x: 1, y: -2 }",
      explain: "Derived `Debug` prints the type name and each field as `name: value`.",
    },
    {
      id: "struct-q-debug-tuple",
      kind: "output",
      topic: "traits",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: '#[derive(Debug)]\nstruct Meters(f64);\n\nfn main() {\n    let m = Meters(2.5);\n    println!("{:?} {}", m, m.0);\n}',
      answer: "Meters(2.5) 2.5",
      explain: "Tuple structs print like a call, and their fields are accessed by position (`.0`).",
    },
    {
      id: "struct-q-eq-missing",
      kind: "compiles",
      topic: "traits",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'struct Id(u32);\n\nfn main() {\n    let same = Id(1) == Id(1);\n    println!("{same}");\n}',
      compiles: false,
      codeError: "E0369",
      explain: "`==` needs `PartialEq`. Add `#[derive(PartialEq)]` to compare field by field.",
    },
    {
      id: "struct-q-impl-keyword",
      kind: "recall",
      topic: "methods",
      difficulty: 1,
      prompt: "Type the keyword that opens the block where a struct's methods are defined.",
      accept: ["impl"],
      explain: "`impl Rect { … }` holds methods and associated functions for `Rect`.",
    },
    {
      id: "struct-q-builder",
      kind: "output",
      topic: "methods",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'struct Query {\n    parts: Vec<String>,\n}\n\nimpl Query {\n    fn new() -> Self {\n        Query { parts: Vec::new() }\n    }\n    fn and(&mut self, clause: &str) -> &mut Self {\n        self.parts.push(clause.to_string());\n        self\n    }\n}\n\nfn main() {\n    let mut q = Query::new();\n    q.and("a").and("b").and("c");\n    println!("{}", q.parts.join(" AND "));\n}',
      answer: "a AND b AND c",
      explain:
        "Returning `&mut Self` lets calls chain on the same value; each call pushes one clause.",
    },
    {
      id: "struct-q-shorthand",
      kind: "choice",
      topic: "construction",
      difficulty: 1,
      prompt:
        "Inside `fn new(name: String, age: u32) -> User`, which body uses field init shorthand?",
      options: ["`User { name, age }`", "`User(name, age)`", "`User { name = name, age = age }`"],
      answer: 0,
      explain: "When a variable has the same name as the field, `name` alone means `name: name`.",
    },
    {
      id: "struct-q-self-type",
      kind: "choice",
      topic: "methods",
      difficulty: 2,
      prompt: "Inside `impl Rect`, what does `Self` refer to?",
      options: ["The current instance", "The type `Rect`", "The trait being implemented"],
      answer: 1,
      explain:
        "`Self` (capital S) is an alias for the implementing type; `self` (lowercase) is the receiver value.",
    },
    {
      id: "struct-q-method-on-borrow",
      kind: "output",
      topic: "methods",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'struct Counter {\n    n: u32,\n}\n\nimpl Counter {\n    fn tick(&mut self) -> u32 {\n        self.n += 1;\n        self.n\n    }\n}\n\nfn main() {\n    let mut c = Counter { n: 10 };\n    let a = c.tick();\n    let b = c.tick();\n    println!("{a} {b} {}", c.n);\n}',
      answer: "11 12 12",
      explain:
        "Each call mutably borrows `c` for the duration of the call and returns the new count.",
    },
    {
      id: "struct-q-unit-struct",
      kind: "choice",
      topic: "construction",
      difficulty: 2,
      prompt: "What is `struct Marker;` useful for?",
      options: [
        "Nothing; it is a syntax error without fields",
        "A zero-sized type that can implement traits or act as a type-level tag",
        "A struct whose fields are filled in later",
      ],
      answer: 1,
      explain:
        "Unit-like structs occupy no memory. They are handy for implementing a trait on a type that needs no data.",
    },
  ],
  generators: [
    {
      id: "struct-g-rect",
      topic: "methods",
      difficulty: 1,
      make: (rng) => {
        const w = int(rng, 2, 15);
        const h = int(rng, 2, 15);
        const grow = int(rng, 1, 5);
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let mut r = Rect { w: ${w}, h: ${h} };\nlet before = r.area();\nr.grow(${grow});\nprintln!("{} {} {}", before, r.area(), r.perimeter());`,
            "struct Rect {\n    w: u32,\n    h: u32,\n}\n\nimpl Rect {\n    fn area(&self) -> u32 {\n        self.w * self.h\n    }\n    fn perimeter(&self) -> u32 {\n        2 * (self.w + self.h)\n    }\n    fn grow(&mut self, by: u32) {\n        self.w += by;\n        self.h += by;\n    }\n}",
          ),
          answer: `${w * h} ${(w + grow) * (h + grow)} ${2 * (w + grow + h + grow)}`,
          explain: `Area starts at ${w}×${h} = ${w * h}. After growing each side by ${grow} it is ${w + grow}×${h + grow} = ${(w + grow) * (h + grow)} with perimeter ${2 * (w + grow + h + grow)}.`,
        };
      },
    },
    {
      id: "struct-g-update",
      topic: "construction",
      difficulty: 2,
      make: (rng) => {
        const [a, b, c] = distinctInts(rng, 3, 1, 90);
        const field = pick(rng, ["x", "y", "z"] as const);
        const replacement = int(rng, 100, 200);
        const result = { x: a, y: b, z: c, [field]: replacement };
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let base = V3 { x: ${a}, y: ${b}, z: ${c} };\nlet next = V3 { ${field}: ${replacement}, ..base };\nprintln!("{:?}", next);`,
            "#[derive(Debug, Clone, Copy)]\nstruct V3 {\n    x: i32,\n    y: i32,\n    z: i32,\n}",
          ),
          answer: `V3 { x: ${result.x}, y: ${result.y}, z: ${result.z} }`,
          explain: `Only \`${field}\` is given explicitly; \`..base\` supplies the remaining fields.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "struct-c-receivers",
      front: "`&self`, `&mut self`, `self` — what does each let a method do?",
      back: "Read; modify in place; consume (take ownership of) the value.",
    },
    {
      id: "struct-c-assoc",
      front: "What is an associated function and how is it called?",
      back: "A function in `impl` with no `self` parameter, called as `Type::name()` (e.g. constructors).",
    },
    {
      id: "struct-c-update",
      front: "What does `..base` do in a struct literal?",
      back: "Fills all unspecified fields from `base` (moving non-Copy ones).",
    },
    {
      id: "struct-c-debug",
      front: "Quickest way to print a struct for debugging?",
      back: "`#[derive(Debug)]` and `{:?}` (or `{:#?}`).",
    },
    {
      id: "struct-c-display",
      front: 'Why does `println!("{}", my_struct)` fail by default?',
      back: "`{}` needs `Display`, which is never derived; implement it yourself.",
    },
    {
      id: "struct-c-tuple",
      front: "How do you read the first field of a tuple struct `Meters(5.0)`?",
      back: "`.0`",
    },
    {
      id: "struct-c-self",
      front: "`Self` vs `self`?",
      back: "`Self` is the type; `self` is the receiver value.",
    },
    {
      id: "struct-c-shorthand",
      front: "Field init shorthand for a variable `age` and field `age`?",
      back: "`User { age, .. }` — writing `age` alone means `age: age`.",
    },
  ],
};

const enumsMatching: SegmentBank = {
  chapterId: "enums-matching",
  questions: [
    {
      id: "enum-q-nonexhaustive",
      kind: "compiles",
      topic: "exhaustiveness",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'enum Light {\n    Red,\n    Amber,\n    Green,\n}\n\nfn action(l: Light) -> &\'static str {\n    match l {\n        Light::Red => "stop",\n        Light::Green => "go",\n    }\n}\n\nfn main() {\n    println!("{}", action(Light::Amber));\n}',
      compiles: false,
      codeError: "E0004",
      explain:
        "`match` must cover every variant. rustc lists the missing pattern (`Light::Amber`) for you.",
    },
    {
      id: "enum-q-bind-data",
      kind: "output",
      topic: "patterns",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'enum Shape {\n    Circle(f64),\n    Rect { w: f64, h: f64 },\n}\n\nfn area(s: &Shape) -> f64 {\n    match s {\n        Shape::Circle(r) => 3.0 * r * r,\n        Shape::Rect { w, h } => w * h,\n    }\n}\n\nfn main() {\n    println!("{} {}", area(&Shape::Circle(2.0)), area(&Shape::Rect { w: 2.0, h: 5.0 }));\n}',
      answer: "12 10",
      explain:
        "Patterns bind the data inside each variant. (A float with no fractional part prints without `.0`.)",
    },
    {
      id: "enum-q-option-map",
      kind: "output",
      topic: "option",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let some: Option<i32> = Some(4);\n    let none: Option<i32> = None;\n    println!("{:?} {:?} {}", some.map(|n| n * 10), none.map(|n| n * 10), none.unwrap_or(-1));\n}',
      answer: "Some(40) None -1",
      explain:
        "`map` transforms the value inside `Some` and passes `None` through; `unwrap_or` supplies a default.",
    },
    {
      id: "enum-q-if-let",
      kind: "output",
      topic: "patterns",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let config: Option<u8> = Some(3);\n    if let Some(level) = config {\n        println!("level {level}");\n    } else {\n        println!("default");\n    }\n}',
      answer: "level 3",
      explain:
        "`if let` matches one pattern and ignores the rest — a concise `match` with a single interesting arm.",
    },
    {
      id: "enum-q-guard",
      kind: "output",
      topic: "patterns",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn describe(n: i32) -> &\'static str {\n    match n {\n        x if x < 0 => "negative",\n        0 => "zero",\n        x if x % 2 == 0 => "even",\n        _ => "odd",\n    }\n}\n\nfn main() {\n    println!("{} {} {} {}", describe(-3), describe(0), describe(8), describe(7));\n}',
      answer: "negative zero even odd",
      explain:
        "Arms are tried top to bottom; a guard (`if …`) must also hold for its arm to match.",
    },
    {
      id: "enum-q-option-add",
      kind: "compiles",
      topic: "option",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let x: Option<i32> = Some(5);\n    let y = x + 1;\n    println!("{y}");\n}',
      compiles: false,
      codeError: "E0369",
      explain:
        "`Option<i32>` is not an `i32`. You must handle the `None` case first (`match`, `if let`, `map`, `unwrap_or`) — the type makes forgetting impossible.",
    },
    {
      id: "enum-q-ranges",
      kind: "output",
      topic: "patterns",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: "fn grade(score: u32) -> char {\n    match score {\n        90..=100 => 'A',\n        80..=89 => 'B',\n        70..=79 => 'C',\n        _ => 'F',\n    }\n}\n\nfn main() {\n    let grades: String = [95, 80, 79, 12].iter().map(|s| grade(*s)).collect();\n    println!(\"{grades}\");\n}",
      answer: "ABCF",
      explain: "Inclusive range patterns (`a..=b`) test membership; `_` catches everything else.",
    },
    {
      id: "enum-q-arm-order",
      kind: "output",
      topic: "exhaustiveness",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: "fn label(c: char) -> &'static str {\n    match c {\n        'a'..='z' => \"lower\",\n        'x' => \"the letter x\",\n        _ => \"other\",\n    }\n}\n\nfn main() {\n    println!(\"{} {}\", label('x'), label('X'));\n}",
      answer: "lower other",
      explain:
        "The first matching arm wins, so `'x'` never reaches its own arm; rustc warns that the pattern is unreachable. Put specific patterns before general ones.",
    },
    {
      id: "enum-q-let-else",
      kind: "output",
      topic: "option",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn double_first(words: &[&str]) -> i32 {\n    let Some(first) = words.first() else {\n        return -1;\n    };\n    let Ok(n) = first.parse::<i32>() else {\n        return 0;\n    };\n    n * 2\n}\n\nfn main() {\n    println!("{} {} {}", double_first(&["21"]), double_first(&["x"]), double_first(&[]));\n}',
      answer: "42 0 -1",
      explain:
        "`let … else` binds on success and requires the `else` block to diverge (return, break, panic) otherwise, keeping the happy path unindented.",
    },
    {
      id: "enum-q-none-name",
      kind: "recall",
      topic: "option",
      difficulty: 1,
      prompt: "Type the `Option` variant that represents the absence of a value.",
      accept: ["None", "Option::None"],
      explain: "`Option<T>` is `Some(T)` or `None`; Rust has no null.",
    },
    {
      id: "enum-q-why-option",
      kind: "choice",
      topic: "option",
      difficulty: 2,
      prompt: "What does `Option<T>` buy you compared with a null pointer?",
      options: [
        "It is faster than null checks",
        "The possibility of absence is in the type, so the compiler forces you to handle it before use",
        "It can store two values at once",
      ],
      answer: 1,
      explain:
        "A `T` is always present; only `Option<T>` can be absent, and you cannot use it as a `T` without handling `None`.",
    },
    {
      id: "enum-q-matches",
      kind: "output",
      topic: "patterns",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: "fn main() {\n    let chars = ['a', '7', '?', 'Z'];\n    let letters = chars.iter().filter(|c| matches!(c, 'a'..='z' | 'A'..='Z')).count();\n    println!(\"{letters}\");\n}",
      answer: "2",
      explain: "`matches!(value, pattern)` returns a `bool`; `|` combines patterns.",
    },
    {
      id: "enum-q-variant-kinds",
      kind: "multi",
      topic: "exhaustiveness",
      difficulty: 2,
      prompt: "Select every valid way to declare a variant of `enum Message`.",
      options: ["`Quit`", "`Move { x: i32, y: i32 }`", "`Write(String)`", "`Color: (u8, u8, u8)`"],
      answers: [0, 1, 2],
      explain:
        "Variants can be unit-like, struct-like, or tuple-like. There is no `Name: type` variant syntax.",
    },
    {
      id: "enum-q-wildcard-warn",
      kind: "choice",
      topic: "exhaustiveness",
      difficulty: 3,
      prompt:
        "Why might a team prefer listing every variant instead of ending a match with `_ =>`?",
      options: [
        "`_` is slower at runtime",
        "When a new variant is added, an exhaustive match fails to compile at every site that must decide what to do",
        "`_` cannot be used with enums",
      ],
      answer: 1,
      explain:
        "A wildcard silently absorbs new variants. Exhaustive arms turn 'we added a case' into a compiler-generated to-do list.",
    },
    {
      id: "enum-q-methods",
      kind: "output",
      topic: "patterns",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'enum Coin {\n    Penny,\n    Nickel,\n    Dime,\n}\n\nimpl Coin {\n    fn cents(&self) -> u32 {\n        match self {\n            Coin::Penny => 1,\n            Coin::Nickel => 5,\n            Coin::Dime => 10,\n        }\n    }\n}\n\nfn main() {\n    let purse = [Coin::Dime, Coin::Penny, Coin::Dime, Coin::Nickel];\n    let total: u32 = purse.iter().map(Coin::cents).sum();\n    println!("{total}");\n}',
      answer: "26",
      explain: "Enums can have methods like structs. 10 + 1 + 10 + 5 = 26.",
    },
  ],
  generators: [
    {
      id: "enum-g-range-match",
      topic: "patterns",
      difficulty: 2,
      make: (rng) => {
        const value = int(rng, -5, 120);
        const label =
          value < 0 ? "invalid" : value <= 9 ? "digit" : value <= 99 ? "two digits" : "large";
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let n: i32 = ${value};\nlet kind = match n {\n    i32::MIN..=-1 => "invalid",\n    0..=9 => "digit",\n    10..=99 => "two digits",\n    _ => "large",\n};\nprintln!("{kind}");`,
          ),
          answer: label,
          explain: `${value} falls in the arm for "${label}"; range patterns are inclusive at both ends.`,
        };
      },
    },
    {
      id: "enum-g-option-chain",
      topic: "option",
      difficulty: 3,
      make: (rng) => {
        const present = rng() < 0.7;
        const value = int(rng, 1, 30);
        const limit = int(rng, 5, 25);
        const add = int(rng, 1, 9);
        const result = present && value > limit ? `Some(${value + add})` : "None";
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let start: Option<i32> = ${present ? `Some(${value})` : "None"};\nlet out = start.filter(|n| *n > ${limit}).map(|n| n + ${add});\nprintln!("{:?}", out);`,
          ),
          answer: result,
          explain: present
            ? `\`filter\` keeps ${value} only if it is greater than ${limit}${value > limit ? `; then \`map\` adds ${add}` : ", so the result is None"}.`
            : "Starting from `None`, every combinator passes `None` through.",
        };
      },
    },
  ],
  cards: [
    {
      id: "enum-c-exhaustive",
      front: "What does the compiler require of a `match`?",
      back: "Exhaustiveness: every possible value must be covered (E0004 otherwise).",
    },
    {
      id: "enum-c-option",
      front: "The two variants of `Option<T>`?",
      back: "`Some(T)` and `None`.",
    },
    {
      id: "enum-c-if-let",
      front: "When is `if let` better than `match`?",
      back: "When only one pattern matters and the rest can be ignored.",
    },
    {
      id: "enum-c-guard",
      front: "What is a match guard?",
      back: "An extra `if` condition on an arm: `Some(x) if x > 5 => …`.",
    },
    {
      id: "enum-c-order",
      front: "Two arms could match a value. Which runs?",
      back: "The first one, top to bottom.",
    },
    {
      id: "enum-c-let-else",
      front: "What must the `else` block of `let PATTERN = expr else { … };` do?",
      back: "Diverge — `return`, `break`, `continue`, or panic.",
    },
    {
      id: "enum-c-matches",
      front: "Which macro turns a pattern test into a `bool`?",
      back: "`matches!(value, pattern)`",
    },
    {
      id: "enum-c-wildcard",
      front: "Risk of ending a match with `_ =>`?",
      back: "New variants are silently absorbed instead of forcing a compile error at every match.",
    },
  ],
};

const collections: SegmentBank = {
  chapterId: "collections",
  questions: [
    {
      id: "coll-q-push-pop",
      kind: "output",
      topic: "vec",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let mut v = vec![1, 2, 3];\n    v.push(4);\n    let last = v.pop();\n    println!("{:?} {:?} {}", v, last, v.len());\n}',
      answer: "[1, 2, 3] Some(4) 3",
      explain: "`pop` returns `Option<T>` because the vector might be empty.",
    },
    {
      id: "coll-q-get",
      kind: "output",
      topic: "vec",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let v = vec![10, 20, 30];\n    println!("{:?} {:?}", v.get(1), v.get(10));\n}',
      answer: "Some(20) None",
      explain: "`get` returns `Option<&T>`; indexing with `v[10]` would panic instead.",
    },
    {
      id: "coll-q-index-panic",
      kind: "choice",
      topic: "vec",
      difficulty: 1,
      prompt: "What happens when this runs?",
      code: 'fn main() {\n    let v = vec![1, 2, 3];\n    let i = v.len() + 2;\n    println!("{}", v[i]);\n}',
      panics: true,
      options: ["It prints 0", "It panics: index out of bounds", "Compile error"],
      answer: 1,
      explain:
        "Indexing is bounds-checked at runtime. Rust never reads past the end; use `get` when the index might be invalid.",
    },
    {
      id: "coll-q-push-while-iter",
      kind: "compiles",
      topic: "iteration",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: "fn main() {\n    let mut v = vec![1, 2, 3];\n    for x in &v {\n        v.push(*x);\n    }\n}",
      compiles: false,
      codeError: "E0502",
      explain:
        "The loop holds a shared borrow of `v` for its whole duration, so pushing (which might reallocate) is refused. Collect changes first, then extend.",
    },
    {
      id: "coll-q-consume",
      kind: "compiles",
      topic: "iteration",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let v = vec![String::from("a"), String::from("b")];\n    for s in v {\n        println!("{s}");\n    }\n    println!("{}", v.len());\n}',
      compiles: false,
      codeError: "E0382",
      explain:
        "`for s in v` calls `into_iter()` and consumes the vector. Iterate over `&v` to keep it.",
    },
    {
      id: "coll-q-word-count",
      kind: "output",
      topic: "hashmap",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::collections::BTreeMap;\n\nfn main() {\n    let mut counts = BTreeMap::new();\n    for word in "the cat the hat the end".split_whitespace() {\n        *counts.entry(word).or_insert(0) += 1;\n    }\n    println!("{counts:?}");\n}',
      answer: '{"cat": 1, "end": 1, "hat": 1, "the": 3}',
      explain:
        "`entry(k).or_insert(0)` returns `&mut` to the count, inserting 0 first if needed. A `BTreeMap` iterates in sorted key order.",
    },
    {
      id: "coll-q-insert-old",
      kind: "output",
      topic: "hashmap",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::collections::HashMap;\n\nfn main() {\n    let mut m = HashMap::new();\n    let first = m.insert("k", 1);\n    let second = m.insert("k", 2);\n    println!("{:?} {:?} {}", first, second, m["k"]);\n}',
      answer: "None Some(1) 2",
      explain: "`insert` overwrites and returns the previous value, if any.",
    },
    {
      id: "coll-q-order",
      kind: "choice",
      topic: "hashmap",
      difficulty: 2,
      prompt: "You print every entry of a `HashMap` in a `for` loop. In what order do they appear?",
      options: [
        "Insertion order",
        "Sorted by key",
        "An unspecified order that can differ between runs",
      ],
      answer: 2,
      explain:
        "`HashMap` uses a randomly seeded hasher. Use `BTreeMap` for sorted order, or sort the keys when output must be stable.",
    },
    {
      id: "coll-q-get-recall",
      kind: "recall",
      topic: "vec",
      difficulty: 1,
      prompt:
        "Type the `Vec` method that returns `Option<&T>` instead of panicking on a bad index.",
      accept: ["get", ".get", "get()", ".get()"],
      explain: "`v.get(i)` returns `None` for an out-of-range index.",
    },
    {
      id: "coll-q-vec-macro",
      kind: "output",
      topic: "vec",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: "fn main() {\n    let zeros = vec![0; 3];\n    let mut grid = vec![vec!['.'; 2]; 2];\n    grid[1][0] = '#';\n    println!(\"{:?} {:?}\", zeros, grid);\n}",
      answer: "[0, 0, 0] [['.', '.'], ['#', '.']]",
      explain: "`vec![value; n]` clones `value` n times; nested vectors are independent rows.",
    },
    {
      id: "coll-q-sort-dedup",
      kind: "output",
      topic: "vec",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let mut v = vec![3, 1, 3, 2, 1];\n    v.sort();\n    v.dedup();\n    v.retain(|n| *n != 2);\n    println!("{v:?}");\n}',
      answer: "[1, 3]",
      explain:
        "`dedup` removes consecutive duplicates (so sort first); `retain` keeps elements matching the predicate.",
    },
    {
      id: "coll-q-iter-mut",
      kind: "output",
      topic: "iteration",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let mut prices = vec![10, 20, 30];\n    for p in &mut prices {\n        *p += 1;\n    }\n    println!("{prices:?}");\n}',
      answer: "[11, 21, 31]",
      explain: "Iterating `&mut v` yields `&mut T`; dereference to modify each element in place.",
    },
    {
      id: "coll-q-loop-forms",
      kind: "multi",
      topic: "iteration",
      difficulty: 2,
      prompt: "Select every loop after which `v` is still usable.",
      options: [
        "`for x in &v { … }`",
        "`for x in &mut v { … }`",
        "`for x in v { … }`",
        "`for x in v.iter() { … }`",
      ],
      answers: [0, 1, 3],
      explain: "Only `for x in v` consumes the vector; the others borrow it.",
    },
    {
      id: "coll-q-hashmap-get",
      kind: "output",
      topic: "hashmap",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::collections::HashMap;\n\nfn main() {\n    let scores = HashMap::from([("ada", 90), ("bo", 72)]);\n    let ada = scores.get("ada").copied().unwrap_or(0);\n    let cy = scores.get("cy").copied().unwrap_or(0);\n    println!("{ada} {cy} {}", scores.contains_key("bo"));\n}',
      answer: "90 0 true",
      explain:
        "`get` returns `Option<&V>`; `copied()` turns it into `Option<V>` for `Copy` values.",
    },
    {
      id: "coll-q-which-collection",
      kind: "choice",
      topic: "hashmap",
      difficulty: 2,
      prompt:
        "You need a queue that pushes at the back and pops at the front efficiently. Which std collection?",
      options: ["`Vec<T>`", "`VecDeque<T>`", "`HashSet<T>`"],
      answer: 1,
      explain:
        "`VecDeque` is a ring buffer with O(1) push/pop at both ends. `Vec::remove(0)` shifts every element.",
    },
  ],
  generators: [
    {
      id: "coll-g-ops",
      topic: "vec",
      difficulty: 2,
      make: (rng) => {
        const start = distinctInts(rng, int(rng, 2, 4), 1, 30);
        const values = [...start];
        const lines = [`let mut v = vec![${start.join(", ")}];`];
        for (let step = 0; step < 4; step += 1) {
          const op = pick(rng, ["push", "pop", "insert", "remove"] as const);
          if (op === "push") {
            const n = int(rng, 40, 99);
            values.push(n);
            lines.push(`v.push(${n});`);
          } else if (op === "pop" && values.length > 1) {
            values.pop();
            lines.push("v.pop();");
          } else if (op === "insert") {
            const n = int(rng, 40, 99);
            values.unshift(n);
            lines.push(`v.insert(0, ${n});`);
          } else if (values.length > 1) {
            values.splice(0, 1);
            lines.push("v.remove(0);");
          }
        }
        lines.push('println!("{v:?}");');
        return {
          kind: "output",
          prompt: "Trace the vector. What exactly does this print?",
          code: program(lines.join("\n")),
          answer: `[${values.join(", ")}]`,
          explain:
            "`push`/`pop` work at the end; `insert(0, x)` and `remove(0)` work at the front, shifting the rest.",
        };
      },
    },
    {
      id: "coll-g-count",
      topic: "hashmap",
      difficulty: 2,
      make: (rng) => {
        const pool = ["ant", "bee", "cat", "dog"];
        const words = Array.from({ length: int(rng, 5, 8) }, () => pick(rng, pool));
        const counts = new Map<string, number>();
        for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
        const sorted = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let mut counts = BTreeMap::new();\nfor w in "${words.join(" ")}".split(' ') {\n    *counts.entry(w).or_insert(0) += 1;\n}\nprintln!("{counts:?}");`,
            "use std::collections::BTreeMap;",
          ),
          answer: `{${sorted.map(([word, count]) => `"${word}": ${count}`).join(", ")}}`,
          explain:
            "The entry API inserts 0 for a new key and increments it; BTreeMap prints keys in sorted order.",
        };
      },
    },
    {
      id: "coll-g-sum-filter",
      topic: "iteration",
      difficulty: 1,
      make: (rng) => {
        const values = Array.from({ length: 6 }, () => int(rng, 1, 20));
        const threshold = int(rng, 5, 15);
        const kept = values.filter((n) => n >= threshold);
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let v = vec![${values.join(", ")}];\nlet mut total = 0;\nlet mut count = 0;\nfor n in &v {\n    if *n >= ${threshold} {\n        total += n;\n        count += 1;\n    }\n}\nprintln!("{total} {count}");`,
          ),
          answer: `${kept.reduce((a, b) => a + b, 0)} ${kept.length}`,
          explain: `Values at least ${threshold}: ${kept.join(", ") || "none"}.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "coll-c-get",
      front: "`v[i]` vs `v.get(i)` on a bad index?",
      back: "`v[i]` panics; `v.get(i)` returns `None`.",
    },
    {
      id: "coll-c-pop",
      front: "Return type of `Vec::pop`?",
      back: "`Option<T>` — `None` when empty.",
    },
    {
      id: "coll-c-loops",
      front: "`for x in v`, `&v`, `&mut v` — what does each yield?",
      back: "Owned `T` (consumes v), `&T`, `&mut T`.",
    },
    {
      id: "coll-c-entry",
      front: "Idiom to count occurrences in a map?",
      back: "`*map.entry(key).or_insert(0) += 1;`",
    },
    {
      id: "coll-c-order",
      front: "Is `HashMap` iteration order stable?",
      back: "No. Use `BTreeMap` (sorted) or sort keys for deterministic output.",
    },
    {
      id: "coll-c-insert",
      front: "What does `HashMap::insert` return?",
      back: "The previous value for that key, as `Option<V>`.",
    },
    {
      id: "coll-c-push-loop",
      front: "Why can't you push to a Vec while iterating over `&v`?",
      back: "The loop's shared borrow conflicts with push's mutable borrow (reallocation could invalidate it).",
    },
    {
      id: "coll-c-deque",
      front: "Collection for efficient push/pop at both ends?",
      back: "`VecDeque<T>`",
    },
  ],
};

const errors: SegmentBank = {
  chapterId: "errors",
  questions: [
    {
      id: "err-q-parse-match",
      kind: "output",
      topic: "result",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    for input in ["42", "4x"] {\n        match input.parse::<i32>() {\n            Ok(n) => println!("ok {n}"),\n            Err(_) => println!("bad {input}"),\n        }\n    }\n}',
      answer: "ok 42\nbad 4x",
      explain: "`parse` returns `Result<T, E>`; `match` handles both outcomes explicitly.",
    },
    {
      id: "err-q-question-in-main",
      kind: "compiles",
      topic: "question-mark",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let n: i32 = "5".parse()?;\n    println!("{n}");\n}',
      compiles: false,
      codeError: "E0277",
      explain:
        "`?` returns early with the error, so the enclosing function must return a `Result` (or `Option`). Declare `fn main() -> Result<(), Box<dyn std::error::Error>>`.",
    },
    {
      id: "err-q-propagate",
      kind: "output",
      topic: "question-mark",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::num::ParseIntError;\n\nfn sum(a: &str, b: &str) -> Result<i32, ParseIntError> {\n    let x: i32 = a.parse()?;\n    let y: i32 = b.parse()?;\n    Ok(x + y)\n}\n\nfn main() {\n    println!("{:?}", sum("2", "40"));\n    println!("{:?}", sum("2", "forty"));\n}',
      answer: "Ok(42)\nErr(ParseIntError { kind: InvalidDigit })",
      explain:
        "`?` unwraps `Ok` or returns the `Err` from the function immediately. The second call stops at `b.parse()`.",
    },
    {
      id: "err-q-no-from",
      kind: "compiles",
      topic: "question-mark",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'fn read_age(s: &str) -> Result<u8, String> {\n    let n: u8 = s.parse()?;\n    Ok(n)\n}\n\nfn main() {\n    println!("{:?}", read_age("7"));\n}',
      compiles: false,
      codeError: "E0277",
      explain:
        "`?` converts the error with `From`. There is no `From<ParseIntError> for String`, so either `map_err(|e| e.to_string())?` or choose an error type that can absorb it.",
    },
    {
      id: "err-q-when-panic",
      kind: "choice",
      topic: "panic",
      difficulty: 2,
      prompt: "A config file the user supplied is missing a field. What is the idiomatic response?",
      options: [
        "`panic!`, because the program cannot continue",
        "Return an `Err` describing the problem so the caller can report it",
        "Use `unwrap()` and let the crash message explain",
      ],
      answer: 1,
      explain:
        "Expected failures from the outside world are values (`Result`). Panics are for bugs — broken invariants the program cannot sensibly recover from.",
    },
    {
      id: "err-q-expect",
      kind: "choice",
      topic: "panic",
      difficulty: 1,
      prompt:
        'Why prefer `.expect("config has a port")` over `.unwrap()` where a panic is acceptable?',
      options: [
        "It avoids the panic",
        "The panic message states the assumption that was violated",
        "It is faster",
      ],
      answer: 1,
      explain:
        "Both panic on `Err`/`None`; `expect` documents why you believed it could not happen.",
    },
    {
      id: "err-q-combinators",
      kind: "output",
      topic: "result",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let good: Result<i32, String> = Ok(3);\n    let bad: Result<i32, String> = Err("nope".to_string());\n    println!("{:?}", good.map(|n| n * 2));\n    println!("{:?}", bad.clone().map_err(|e| e.len()));\n    println!("{}", bad.unwrap_or(0));\n}',
      answer: "Ok(6)\nErr(4)\n0",
      explain:
        "`map` transforms `Ok`, `map_err` transforms `Err`, and `unwrap_or` supplies a fallback.",
    },
    {
      id: "err-q-ok-or",
      kind: "output",
      topic: "result",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'fn first_even(v: &[i32]) -> Result<i32, &\'static str> {\n    let n = v.iter().find(|n| *n % 2 == 0).ok_or("no even number")?;\n    Ok(*n)\n}\n\nfn main() {\n    println!("{:?} {:?}", first_even(&[3, 8, 4]), first_even(&[1, 5]));\n}',
      answer: 'Ok(8) Err("no even number")',
      explain:
        "`ok_or` converts `Option` into `Result`, which lets `?` propagate a meaningful error.",
    },
    {
      id: "err-q-display",
      kind: "output",
      topic: "custom-errors",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'use std::fmt;\n\n#[derive(Debug)]\nenum BankError {\n    Insufficient { needed: u32, available: u32 },\n    Frozen,\n}\n\nimpl fmt::Display for BankError {\n    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {\n        match self {\n            BankError::Insufficient { needed, available } => {\n                write!(f, "need {needed}, have {available}")\n            }\n            BankError::Frozen => write!(f, "account frozen"),\n        }\n    }\n}\n\nfn main() {\n    let e = BankError::Insufficient { needed: 50, available: 20 };\n    println!("{e} | {}", BankError::Frozen);\n}',
      answer: "need 50, have 20 | account frozen",
      explain:
        "A custom error enum names each failure mode; implementing `Display` gives users a readable message while `Debug` stays available for developers.",
    },
    {
      id: "err-q-box-dyn",
      kind: "compiles",
      topic: "custom-errors",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'use std::error::Error;\n\nfn parse_pair(s: &str) -> Result<(i32, f64), Box<dyn Error>> {\n    let (a, b) = s.split_once(\',\').ok_or("missing comma")?;\n    Ok((a.parse()?, b.parse()?))\n}\n\nfn main() {\n    println!("{:?}", parse_pair("3,2.5").unwrap());\n}',
      compiles: true,
      explain:
        "`Box<dyn Error>` has `From` impls for any error type and for string messages, so `?` can propagate `ParseIntError`, `ParseFloatError`, and a `&str` alike.",
    },
    {
      id: "err-q-qmark-recall",
      kind: "recall",
      topic: "question-mark",
      difficulty: 1,
      prompt:
        "Type the operator that unwraps `Ok` or returns the `Err` early from the current function.",
      accept: ["?", "the ? operator", "question mark"],
      explain: "`expr?` is shorthand for a match that returns `Err(From::from(e))`.",
    },
    {
      id: "err-q-qmark-types",
      kind: "multi",
      topic: "question-mark",
      difficulty: 2,
      prompt: "Select every combination where `?` is allowed.",
      options: [
        "On a `Result` inside a function returning `Result`",
        "On an `Option` inside a function returning `Option`",
        "On a `Result` inside a function returning `()`",
        "On an `Option` inside `fn main() -> Result<(), String>` without conversion",
      ],
      answers: [0, 1],
      explain:
        "`?` needs a compatible return type. Mixing `Option` and `Result` requires an explicit conversion such as `ok_or`.",
    },
    {
      id: "err-q-collect-result",
      kind: "output",
      topic: "result",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let good: Result<Vec<i32>, _> = "1 2 3".split(\' \').map(str::parse::<i32>).collect();\n    let bad: Result<Vec<i32>, _> = "1 x 3".split(\' \').map(str::parse::<i32>).collect();\n    println!("{:?} {}", good, bad.is_err());\n}',
      answer: "Ok([1, 2, 3]) true",
      explain:
        "Collecting an iterator of `Result`s into `Result<Vec<_>, _>` stops at the first error — all-or-nothing parsing in one line.",
    },
    {
      id: "err-q-unwrap-panic",
      kind: "choice",
      topic: "panic",
      difficulty: 1,
      prompt: "What happens when this runs?",
      code: 'fn main() {\n    let n: i32 = "ten".parse().unwrap();\n    println!("{n}");\n}',
      panics: true,
      options: ["It prints 10", "It prints 0", "It panics with the parse error"],
      answer: 2,
      explain:
        "`unwrap` on an `Err` panics and includes the error's `Debug` output in the message.",
    },
    {
      id: "err-q-main-result",
      kind: "compiles",
      topic: "question-mark",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'use std::num::ParseIntError;\n\nfn main() -> Result<(), ParseIntError> {\n    let n: i32 = "5".parse()?;\n    println!("{n}");\n    Ok(())\n}',
      compiles: true,
      explain:
        "`main` may return `Result<(), E>` where `E: Debug`. An `Err` makes the process exit with a non-zero code and prints the error.",
    },
  ],
  generators: [
    {
      id: "err-g-parse",
      topic: "result",
      difficulty: 2,
      make: (rng) => {
        const inputs = shuffle(rng, [
          String(int(rng, 1, 99)),
          String(-int(rng, 1, 99)),
          `${int(rng, 1, 9)}x`,
          " 7",
          "",
          String(int(rng, 300, 999)),
        ]).slice(0, 3);
        const parse = (text: string) => {
          if (!/^[+-]?\d+$/.test(text)) return null;
          const n = Number(text);
          return n >= -128 && n <= 127 ? n : null;
        };
        const lines = inputs.map((text) => {
          const value = parse(text);
          return value === null ? "err" : String(value);
        });
        return {
          kind: "output",
          prompt: "Parsing into `i8` (range −128..=127). What exactly does this print?",
          code: program(
            `for input in [${inputs.map((text) => JSON.stringify(text)).join(", ")}] {\n    match input.parse::<i8>() {\n        Ok(n) => println!("{n}"),\n        Err(_) => println!("err"),\n    }\n}`,
          ),
          answer: lines.join("\n"),
          explain:
            "`parse::<i8>` fails on non-digits, leading spaces, empty strings, and values outside −128..=127.",
        };
      },
    },
    {
      id: "err-g-checked",
      topic: "question-mark",
      difficulty: 3,
      make: (rng) => {
        const a = int(rng, 20, 90);
        const b = pick(rng, [0, int(rng, 2, 9)]);
        const c = pick(rng, [0, int(rng, 2, 5)]);
        const first = b === 0 ? null : Math.trunc(a / b);
        const second = first === null || c === 0 ? null : Math.trunc(first / c);
        return {
          kind: "output",
          prompt: "`?` works on `Option` too. What exactly does this print?",
          code: program(
            `println!("{:?}", chain(${a}, ${b}, ${c}));`,
            "fn chain(a: i32, b: i32, c: i32) -> Option<i32> {\n    let first = a.checked_div(b)?;\n    let second = first.checked_div(c)?;\n    Some(second)\n}",
          ),
          answer: second === null ? "None" : `Some(${second})`,
          explain:
            second === null
              ? "A division by zero makes `checked_div` return `None`, and `?` returns it immediately."
              : `${a} / ${b} = ${first}, then ${first} / ${c} = ${second}.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "err-c-kinds",
      front: "Recoverable vs unrecoverable errors in Rust?",
      back: "`Result<T, E>` for expected failures; `panic!` for bugs and broken invariants.",
    },
    {
      id: "err-c-qmark",
      front: "What does `?` do on an `Err(e)`?",
      back: "Returns `Err(From::from(e))` from the enclosing function.",
    },
    {
      id: "err-c-qmark-main",
      front: "How do you use `?` in `main`?",
      back: "Give `main` a `Result` return type, e.g. `-> Result<(), Box<dyn Error>>`.",
    },
    {
      id: "err-c-expect",
      front: "`unwrap` vs `expect`?",
      back: 'Both panic on failure; `expect("msg")` states the assumption that failed.',
    },
    {
      id: "err-c-ok-or",
      front: "How do you turn `Option<T>` into `Result<T, E>`?",
      back: "`.ok_or(err)` (or `.ok_or_else(|| err)`).",
    },
    {
      id: "err-c-map-err",
      front: "Convert an error type before `?` when no `From` impl exists?",
      back: "`.map_err(|e| …)?`",
    },
    {
      id: "err-c-collect",
      front: "Parse a list, failing if any item fails, in one expression?",
      back: "`iter.map(parse).collect::<Result<Vec<_>, _>>()`",
    },
    {
      id: "err-c-box-dyn",
      front: "Quick error type that accepts any error via `?`?",
      back: "`Box<dyn std::error::Error>`",
    },
  ],
};

export const vocabularyBanks: SegmentBank[] = [structs, enumsMatching, collections, errors];
