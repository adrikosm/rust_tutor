import { distinctInts, int, pick, shuffle } from "../rng";
import type { SegmentBank } from "../types";
import { program, valueChoice } from "./helpers";

const NOISY = `struct Noisy(&'static str);

impl Drop for Noisy {
    fn drop(&mut self) {
        println!("drop {}", self.0);
    }
}`;

const ownership: SegmentBank = {
  chapterId: "ownership",
  questions: [
    {
      id: "own-q-use-after-move",
      kind: "compiles",
      topic: "moves",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let a = String::from("hi");\n    let b = a;\n    println!("{a} {b}");\n}',
      compiles: false,
      codeError: "E0382",
      explain:
        "`let b = a;` moves the String: ownership of the heap buffer transfers to `b` and `a` becomes unusable (E0382). Borrow (`&a`) or `clone()` if you need both.",
    },
    {
      id: "own-q-copy-int",
      kind: "compiles",
      topic: "copy-clone",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let a = 5;\n    let b = a;\n    println!("{a} {b}");\n}',
      compiles: true,
      explain:
        "`i32` is `Copy`: assignment duplicates the bits and both bindings stay valid. Only types without `Copy` move.",
    },
    {
      id: "own-q-clone",
      kind: "output",
      topic: "copy-clone",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let a = String::from("hi");\n    let mut b = a.clone();\n    b.push(\'!\');\n    println!("{a} {b}");\n}',
      answer: "hi hi!",
      explain:
        "`clone()` makes an independent deep copy with its own heap buffer, so changing `b` leaves `a` untouched.",
    },
    {
      id: "own-q-move-into-fn",
      kind: "compiles",
      topic: "functions",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'fn consume(s: String) -> usize {\n    s.len()\n}\n\nfn main() {\n    let s = String::from("data");\n    let n = consume(s);\n    println!("{n} {s}");\n}',
      compiles: false,
      codeError: "E0382",
      explain:
        "Passing a `String` by value moves it into the parameter; it is dropped when `consume` returns. Take `&str` or `&String` if the caller still needs it.",
    },
    {
      id: "own-q-give-back",
      kind: "output",
      topic: "functions",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn shout(mut s: String) -> String {\n    s.push(\'!\');\n    s\n}\n\nfn main() {\n    let s = String::from("hey");\n    let s = shout(s);\n    println!("{s}");\n}',
      answer: "hey!",
      explain:
        "Ownership moves in, the function mutates its own `mut` parameter, and returning `s` moves ownership back out to a new binding.",
    },
    {
      id: "own-q-what-moves",
      kind: "choice",
      topic: "moves",
      difficulty: 2,
      prompt: "When a `String` is moved from `a` to `b`, what is actually copied?",
      options: [
        "The heap bytes of the text",
        "The pointer, length, and capacity stored on the stack",
        "Nothing; `b` is an alias for `a`",
      ],
      answer: 1,
      feedback: [
        "Copying the heap data is what `clone()` does, explicitly.",
        null,
        "Aliases would mean two owners; Rust invalidates `a` instead.",
      ],
      explain:
        "A move is a shallow bitwise copy of the three-word header. Because `a` is then invalid, exactly one owner will free the buffer: no double free, no deep copy.",
    },
    {
      id: "own-q-drop-order",
      kind: "output",
      topic: "drop",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: `${NOISY}\n\nfn main() {\n    let _a = Noisy("a");\n    {\n        let _b = Noisy("b");\n        println!("inner");\n    }\n    let _c = Noisy("c");\n    println!("end");\n}`,
      answer: "inner\ndrop b\nend\ndrop c\ndrop a",
      explain:
        "A value is dropped when its owner goes out of scope. `_b` dies at its block's brace. At the end of `main`, locals drop in reverse declaration order: `_c`, then `_a`.",
    },
    {
      id: "own-q-copy-types",
      kind: "multi",
      topic: "copy-clone",
      difficulty: 2,
      prompt: "Select every type that is `Copy`.",
      options: ["`u64`", "`(i32, bool)`", "`String`", "`Vec<u8>`", "`&str`"],
      answers: [0, 1, 4],
      explain:
        "Scalars, tuples of `Copy` types, and shared references are `Copy`. Types that own heap memory (`String`, `Vec`) are not, because copying their header would create two owners.",
    },
    {
      id: "own-q-move-out-index",
      kind: "compiles",
      topic: "moves",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let v = vec![String::from("a"), String::from("b")];\n    let first = v[0];\n    println!("{first}");\n}',
      compiles: false,
      codeError: "E0507",
      explain:
        "Indexing gives a place inside the vector; moving out of it would leave a hole the Vec would later drop. Borrow `&v[0]`, `clone()`, or take ownership with `into_iter`/`remove`.",
    },
    {
      id: "own-q-loop-move",
      kind: "compiles",
      topic: "functions",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn consume(_s: String) {}\n\nfn main() {\n    let s = String::from("x");\n    for _ in 0..2 {\n        consume(s);\n    }\n}',
      compiles: false,
      codeError: "E0382",
      explain:
        "The first iteration moves `s`; the second would use a moved value. rustc reports 'value moved here, in previous iteration of loop'.",
    },
    {
      id: "own-q-rebind",
      kind: "output",
      topic: "moves",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let s1 = String::from("a");\n    let s2 = s1;\n    let s1 = String::from("b");\n    println!("{s1}{s2}");\n}',
      answer: "ba",
      explain:
        "After the move, a brand-new `s1` is declared with `let`. It is a different binding with its own value, so using it is fine.",
    },
    {
      id: "own-q-e0382",
      kind: "recall",
      topic: "moves",
      difficulty: 1,
      prompt:
        "Type the error code rustc reports for 'borrow of moved value' / 'use of moved value'.",
      accept: ["E0382", "e0382"],
      explain:
        "E0382 is the error of this chapter; `rustc --explain E0382` prints a full walkthrough.",
    },
    {
      id: "own-q-scope-free",
      kind: "choice",
      topic: "drop",
      difficulty: 1,
      prompt: "When is a `String`'s heap memory freed?",
      options: [
        "When a garbage collector runs",
        "When its owner goes out of scope, automatically, exactly once",
        "When you call `free(s)`",
      ],
      answer: 1,
      explain:
        "Rust inserts a call to `drop` where the owner's scope ends. Single ownership guarantees exactly one free with no runtime collector.",
    },
    {
      id: "own-q-struct-field-move",
      kind: "compiles",
      topic: "moves",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'struct User {\n    name: String,\n    age: u32,\n}\n\nfn main() {\n    let u = User { name: String::from("Ada"), age: 36 };\n    let name = u.name;\n    println!("{} {}", name, u.age);\n}',
      compiles: true,
      explain:
        "Moving one field out is a partial move. The other fields stay usable (`u.age` is `Copy`), but `u` as a whole can no longer be used.",
    },
    {
      id: "own-q-clone-cost",
      kind: "choice",
      topic: "copy-clone",
      difficulty: 2,
      prompt: "A reviewer flags `.clone()` inside a hot loop. What is the usual better fix?",
      options: [
        "Replace it with `.copy()`",
        "Borrow instead: pass `&value` or change the callee to take `&str`/`&[T]`",
        "Wrap the value in `unsafe`",
      ],
      answer: 1,
      explain:
        "Clone is explicit because it can be expensive (allocation plus copy). Often the callee only needs to read, so a borrow is both cheaper and clearer.",
    },
  ],
  generators: [
    {
      id: "own-g-drop-order",
      topic: "drop",
      difficulty: 3,
      make: (rng) => {
        const names = shuffle(rng, ["a", "b", "c", "d", "e"]).slice(0, 4);
        const innerStart = int(rng, 1, 2);
        const outer = names.filter((_, index) => index < innerStart || index >= innerStart + 2);
        const inner = names.slice(innerStart, innerStart + 2);
        const lines: string[] = [];
        names.forEach((name, index) => {
          if (index === innerStart) lines.push("{");
          const indent = index >= innerStart && index < innerStart + 2 ? "    " : "";
          lines.push(`${indent}let _${name} = Noisy("${name}");`);
          if (index === innerStart + 1) {
            lines.push('    println!("block ends");');
            lines.push("}");
          }
        });
        lines.push('println!("main ends");');
        const output = [
          "block ends",
          ...[...inner].reverse().map((name) => `drop ${name}`),
          "main ends",
          ...[...outer].reverse().map((name) => `drop ${name}`),
        ];
        return {
          kind: "output",
          prompt:
            "Values drop at the end of their owner's scope, in reverse order of declaration. What exactly does this print?",
          code: program(lines.join("\n"), NOISY),
          answer: output.join("\n"),
          explain: `The block's values (${inner.join(", ")}) drop in reverse when it closes; the rest (${outer.join(", ")}) drop in reverse at the end of main.`,
        };
      },
    },
    {
      id: "own-g-copy-or-move",
      topic: "copy-clone",
      difficulty: 2,
      make: (rng) => {
        const [type, literal, isCopy] = pick(rng, [
          ["i32", "7", true],
          ["f64", "2.5", true],
          ["char", "'z'", true],
          ["bool", "true", true],
          ["(i32, i32)", "(1, 2)", true],
          ["[u8; 3]", "[1, 2, 3]", true],
          ["&str", '"text"', true],
          ["String", 'String::from("text")', false],
          ["Vec<i32>", "vec![1, 2]", false],
          ["Box<i32>", "Box::new(1)", false],
        ] as const);
        return {
          kind: "compiles",
          prompt: `Does this program compile when \`a\` has type \`${type}\`?`,
          code: program(`let a: ${type} = ${literal};\nlet b = a;\nprintln!("{:?} {:?}", a, b);`),
          compiles: isCopy,
          codeError: isCopy ? undefined : "E0382",
          explain: isCopy
            ? `\`${type}\` is \`Copy\`, so \`let b = a;\` duplicates it and both stay usable.`
            : `\`${type}\` owns heap memory and is not \`Copy\`, so \`let b = a;\` moves it and using \`a\` afterwards is E0382.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "own-c-rules",
      front: "State Rust's three ownership rules.",
      back: "Each value has one owner; there is one owner at a time; the value is dropped when the owner goes out of scope.",
    },
    {
      id: "own-c-move",
      front: "What happens to `a` after `let b = a;` when `a: String`?",
      back: "It is moved: `a` becomes unusable and `b` owns the buffer.",
      why: "Only the stack header is copied; invalidating `a` prevents a double free.",
    },
    {
      id: "own-c-copy",
      front: "Which kinds of types are `Copy`?",
      back: "Scalars, `char`, `bool`, shared references, and tuples/arrays of `Copy` types.",
      why: "A type can be `Copy` only if a bitwise copy is a complete, safe duplicate — nothing it owns on the heap.",
    },
    {
      id: "own-c-clone",
      front: "How do you deliberately duplicate a `String` including its heap data?",
      back: "`.clone()`",
    },
    {
      id: "own-c-fn-param",
      front: "What does calling `f(s)` with `s: String` and `fn f(x: String)` do to `s`?",
      back: "Moves it into `f`; the caller can no longer use `s`.",
    },
    {
      id: "own-c-drop-order",
      front: "In what order are local variables dropped at the end of a scope?",
      back: "Reverse order of declaration.",
    },
    {
      id: "own-c-e0507",
      front: "Error E0507 'cannot move out of index' — three fixes?",
      back: "Borrow (`&v[i]`), clone, or take ownership explicitly (`remove`, `swap_remove`, `into_iter`).",
    },
    {
      id: "own-c-partial",
      front: "After `let n = user.name;` can you still read `user.age`?",
      back: "Yes — a partial move leaves the other fields usable, but not `user` as a whole.",
    },
  ],
};

const borrowing: SegmentBank = {
  chapterId: "borrowing",
  questions: [
    {
      id: "borrow-q-two-mut",
      kind: "compiles",
      topic: "rules",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: "fn main() {\n    let mut s = String::from(\"x\");\n    let r1 = &mut s;\n    let r2 = &mut s;\n    r1.push('a');\n    r2.push('b');\n}",
      compiles: false,
      codeError: "E0499",
      explain:
        "Two live mutable borrows of the same value are forbidden (E0499). A `&mut` must be exclusive for as long as it is used.",
    },
    {
      id: "borrow-q-shared-then-mut",
      kind: "compiles",
      topic: "rules",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let mut s = String::from("hi");\n    let r = &s;\n    s.push(\'!\');\n    println!("{r}");\n}',
      compiles: false,
      codeError: "E0502",
      explain:
        "`r` is still used after `s.push`, so the shared borrow overlaps a mutable one (E0502). Move the `println!` above the push and it compiles.",
    },
    {
      id: "borrow-q-nll",
      kind: "compiles",
      topic: "rules",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let mut s = String::from("hi");\n    let r = &s;\n    println!("{r}");\n    s.push(\'!\');\n    println!("{s}");\n}',
      compiles: true,
      explain:
        "A borrow lasts until its last use, not until the end of the scope (non-lexical lifetimes). `r` is finished before `s.push`, so there is no overlap.",
    },
    {
      id: "borrow-q-dangle",
      kind: "compiles",
      topic: "validity",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn dangle() -> &String {\n    let s = String::from("gone");\n    &s\n}\n\nfn main() {\n    println!("{}", dangle());\n}',
      compiles: false,
      codeError: "E0106",
      explain:
        "A returned reference must borrow from something that outlives the call. There is no input to borrow from, so rustc asks for a lifetime (E0106); the real fix is to return the owned `String`.",
    },
    {
      id: "borrow-q-mut-of-immutable",
      kind: "compiles",
      topic: "rules",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: "fn main() {\n    let s = String::new();\n    let r = &mut s;\n    r.push('a');\n}",
      compiles: false,
      codeError: "E0596",
      explain: "You can only mutably borrow a binding declared `mut` (E0596).",
    },
    {
      id: "borrow-q-mut-param",
      kind: "output",
      topic: "functions",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn add_world(s: &mut String) {\n    s.push_str(" world");\n}\n\nfn main() {\n    let mut s = String::from("hello");\n    add_world(&mut s);\n    println!("{s}");\n}',
      answer: "hello world",
      explain:
        "A `&mut String` parameter lends write access for the duration of the call; the caller keeps ownership and sees the change.",
    },
    {
      id: "borrow-q-push-while-held",
      kind: "compiles",
      topic: "rules",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let mut v = vec![1, 2, 3];\n    let first = &v[0];\n    v.push(4);\n    println!("{first}");\n}',
      compiles: false,
      codeError: "E0502",
      explain:
        "`push` may reallocate and move every element, which would leave `first` dangling. The borrow checker prevents exactly this use-after-free.",
    },
    {
      id: "borrow-q-rule",
      kind: "choice",
      topic: "rules",
      difficulty: 1,
      prompt: "Which statement is the borrowing rule?",
      options: [
        "At any time, either one mutable reference or any number of shared references",
        "At most one reference of any kind at a time",
        "Any number of mutable references, as long as they are in different functions",
      ],
      answer: 0,
      explain:
        "Aliasing XOR mutation: many readers or one writer. This single rule rules out data races and iterator invalidation at compile time.",
    },
    {
      id: "borrow-q-deref",
      kind: "output",
      topic: "functions",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn bump(n: &mut i32) {\n    *n += 10;\n}\n\nfn main() {\n    let mut x = 1;\n    bump(&mut x);\n    bump(&mut x);\n    println!("{x}");\n}',
      answer: "21",
      explain: "`*n` dereferences to the caller's `i32`; each call adds 10 to `x`.",
    },
    {
      id: "borrow-q-outlive",
      kind: "compiles",
      topic: "validity",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let r;\n    {\n        let x = 5;\n        r = &x;\n    }\n    println!("{r}");\n}',
      compiles: false,
      codeError: "E0597",
      explain:
        "`x` is dropped at the inner brace while `r` is used afterwards: a reference may not outlive its referent (E0597).",
    },
    {
      id: "borrow-q-reference-facts",
      kind: "multi",
      topic: "validity",
      difficulty: 2,
      prompt: "Select every statement that is true of safe Rust references.",
      options: [
        "A reference is never null",
        "A reference can never outlive the value it points to",
        "A shared `&T` lets you modify the `T` in place",
        "A `&mut T` is exclusive while it is in use",
      ],
      answers: [0, 1, 3],
      explain:
        "References are always valid and non-null. `&T` is read-only (interior-mutability types aside), and `&mut T` guarantees no other access while it is live.",
    },
    {
      id: "borrow-q-e0597",
      kind: "recall",
      topic: "validity",
      difficulty: 2,
      prompt: "Type the error code for 'borrowed value does not live long enough'.",
      accept: ["E0597", "e0597"],
      explain: "E0597 means the referent is dropped while a borrow of it is still needed.",
    },
    {
      id: "borrow-q-swap",
      kind: "output",
      topic: "functions",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let mut a = String::from("left");\n    let mut b = String::from("right");\n    std::mem::swap(&mut a, &mut b);\n    println!("{a} {b}");\n}',
      answer: "right left",
      explain:
        "`std::mem::swap` takes two exclusive borrows of different values and exchanges them without cloning.",
    },
    {
      id: "borrow-q-move-out-of-ref",
      kind: "compiles",
      topic: "functions",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'fn first(v: &Vec<String>) -> String {\n    v[0]\n}\n\nfn main() {\n    let v = vec![String::from("a")];\n    println!("{}", first(&v));\n}',
      compiles: false,
      codeError: "E0507",
      explain:
        "Through a borrow you may read but not take ownership. Return `v[0].clone()`, or return `&String`/`&str` borrowed from `v`.",
    },
    {
      id: "borrow-q-narrowest",
      kind: "choice",
      topic: "functions",
      difficulty: 2,
      prompt: "A function only counts the words in some text. Which parameter type is best?",
      options: ["`text: String`", "`text: &mut String`", "`text: &str`"],
      answer: 2,
      explain:
        "Choose the narrowest access: it only reads, so a shared borrow suffices, and `&str` accepts both `&String` (via deref coercion) and literals.",
    },
  ],
  generators: [
    {
      id: "borrow-g-bump",
      topic: "functions",
      difficulty: 2,
      make: (rng) => {
        let value = int(rng, 0, 5);
        const start = value;
        const calls = Array.from({ length: int(rng, 2, 4) }, () => int(rng, 1, 9));
        const trace = [value];
        for (const by of calls) {
          value = value * 2 + by;
          trace.push(value);
        }
        return {
          kind: "output",
          prompt: "Each call receives an exclusive borrow. What exactly does this print?",
          code: program(
            `let mut n = ${start};\n${calls.map((by) => `step(&mut n, ${by});`).join("\n")}\nprintln!("{n}");`,
            "fn step(n: &mut i32, by: i32) {\n    *n = *n * 2 + by;\n}",
          ),
          answer: String(value),
          explain: `Each call doubles the caller's value then adds its argument, in order: ${trace.join(" → ")}.`,
        };
      },
    },
    {
      id: "borrow-g-patterns",
      topic: "rules",
      difficulty: 3,
      make: (rng) => {
        const name = pick(rng, ["log", "buf", "name", "text"]);
        const word = pick(rng, ["ok", "hi", "rust", "go"]);
        const template = pick(rng, [
          {
            body: `let mut ${name} = String::from("${word}");\nlet r = &${name};\nprintln!("{r}");\n${name}.push('!');\nprintln!("{${name}}");`,
            compiles: true,
            error: undefined,
            why: "The shared borrow's last use comes before the mutation, so the borrows never overlap.",
          },
          {
            body: `let mut ${name} = String::from("${word}");\nlet r = &${name};\n${name}.push('!');\nprintln!("{r}");`,
            compiles: false,
            error: "E0502",
            why: "`r` is used after the push, so a shared borrow is alive during a mutable one.",
          },
          {
            body: `let mut ${name} = String::from("${word}");\nlet a = &mut ${name};\nlet b = &mut ${name};\na.push('!');\nb.push('?');`,
            compiles: false,
            error: "E0499",
            why: "Two mutable borrows are alive at the same time.",
          },
          {
            body: `let mut ${name} = String::from("${word}");\n{\n    let a = &mut ${name};\n    a.push('!');\n}\nlet b = &mut ${name};\nb.push('?');\nprintln!("{${name}}");`,
            compiles: true,
            error: undefined,
            why: "The first mutable borrow ends inside its block before the second begins.",
          },
          {
            body: `let mut ${name} = String::from("${word}");\nlet a = &${name};\nlet b = &${name};\nprintln!("{a}{b}");\n${name}.clear();`,
            compiles: true,
            error: undefined,
            why: "Any number of shared borrows may coexist; both end before `clear`.",
          },
        ]);
        return {
          kind: "compiles",
          prompt: "Does this program compile?",
          code: program(template.body),
          compiles: template.compiles,
          codeError: template.error,
          explain: template.why,
        };
      },
    },
  ],
  cards: [
    {
      id: "borrow-c-rule",
      front: "The borrowing rule, in one line?",
      back: "Either one `&mut` or any number of `&` at a time — aliasing XOR mutation.",
    },
    {
      id: "borrow-c-nll",
      front: "How long does a borrow last?",
      back: "Until its last use (non-lexical lifetimes), not necessarily to the end of the scope.",
    },
    {
      id: "borrow-c-e0499",
      front: "E0499 vs E0502?",
      back: "E0499: two mutable borrows at once. E0502: a mutable borrow while a shared one is alive (or vice versa).",
    },
    {
      id: "borrow-c-dangling",
      front: "Why can't a function return `&String` to a local `String`?",
      back: "The local is dropped when the function returns; the reference would dangle. Return the owned `String`.",
    },
    {
      id: "borrow-c-push",
      front: "Why can't you `v.push(x)` while holding `&v[0]`?",
      back: "Push may reallocate and move elements, invalidating the reference.",
    },
    {
      id: "borrow-c-narrow",
      front: "Parameter type for a function that only reads text?",
      back: "`&str` — the narrowest access that works for both `String` and literals.",
    },
    {
      id: "borrow-c-deref",
      front: "How do you modify the `i32` behind `n: &mut i32`?",
      back: "Dereference it: `*n += 1;`",
    },
    {
      id: "borrow-c-e0596",
      front: "What does E0596 'cannot borrow as mutable' usually need?",
      back: "`mut` on the original binding (`let mut x`).",
    },
  ],
};

const slicesStrings: SegmentBank = {
  chapterId: "slices-strings",
  questions: [
    {
      id: "slice-q-range",
      kind: "output",
      topic: "slices",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let s = String::from("hello world");\n    let hello = &s[0..5];\n    let world = &s[6..];\n    println!("[{hello}] [{world}]");\n}',
      answer: "[hello] [world]",
      explain:
        "`start..end` excludes `end`; omitting an end means 'to the end'. A slice borrows a range of the original.",
    },
    {
      id: "slice-q-bytes-chars",
      kind: "output",
      topic: "utf8",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let word = "héllo";\n    println!("{} {}", word.len(), word.chars().count());\n}',
      answer: "6 5",
      explain:
        "`len` counts UTF-8 bytes (é is two bytes); `chars().count()` counts Unicode scalar values.",
    },
    {
      id: "slice-q-index-string",
      kind: "compiles",
      topic: "utf8",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let s = String::from("hello");\n    let c = s[0];\n    println!("{c}");\n}',
      compiles: false,
      codeError: "E0277",
      explain:
        "Strings cannot be indexed by an integer because a byte offset is not a character in UTF-8. Use `s.chars().next()` or `s.as_bytes()[0]`.",
    },
    {
      id: "slice-q-boundary-panic",
      kind: "choice",
      topic: "utf8",
      difficulty: 3,
      prompt: "What happens when this runs?",
      code: 'fn main() {\n    let s = "héllo";\n    let part = &s[0..2];\n    println!("{part}");\n}',
      panics: true,
      options: [
        "It prints `hé`",
        "It prints `h` and one garbage byte",
        "It compiles, then panics: byte 2 is not a char boundary",
      ],
      answer: 2,
      explain:
        "`é` occupies bytes 1–2, so a slice ending at byte 2 would split it. String slicing checks boundaries at runtime and panics rather than produce invalid UTF-8.",
    },
    {
      id: "slice-q-reverse",
      kind: "output",
      topic: "methods",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let reversed: String = "rust".chars().rev().collect();\n    println!("{reversed}");\n}',
      answer: "tsur",
      explain:
        "`chars()` yields characters, `rev()` walks backwards, and `collect()` builds a `String`.",
    },
    {
      id: "slice-q-str-vs-string",
      kind: "choice",
      topic: "types",
      difficulty: 1,
      prompt: "Which description is right?",
      options: [
        "`&str` is a borrowed view (pointer + length); `String` is an owned, growable buffer (pointer + length + capacity)",
        "`&str` lives on the stack and `String` on the heap, so `&str` cannot point to heap data",
        "They are the same type with different names",
      ],
      answer: 0,
      explain:
        "`&str` can point into a `String`, a literal in the binary, or anywhere else valid UTF-8 lives. `String` owns and can grow its buffer.",
    },
    {
      id: "slice-q-clear-while-borrowed",
      kind: "compiles",
      topic: "slices",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn first_word(s: &str) -> &str {\n    s.split(\' \').next().unwrap_or("")\n}\n\nfn main() {\n    let mut s = String::from("hello world");\n    let word = first_word(&s);\n    s.clear();\n    println!("{word}");\n}',
      compiles: false,
      codeError: "E0502",
      explain:
        "`word` borrows from `s`, and clearing `s` needs a mutable borrow while `word` is still used. The slice type turns a stale-index bug into a compile error.",
    },
    {
      id: "slice-q-array-slice",
      kind: "output",
      topic: "slices",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let a = [10, 20, 30, 40, 50];\n    let s = &a[1..3];\n    println!("{:?} {}", s, s.len());\n}',
      answer: "[20, 30] 2",
      explain:
        "Array slices work like string slices: indexes 1 and 2, length 2, borrowed from `a`.",
    },
    {
      id: "slice-q-plus",
      kind: "compiles",
      topic: "methods",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let s1 = String::from("tic");\n    let s2 = String::from("tac");\n    let s3 = s1 + "-" + &s2;\n    println!("{s1} {s3}");\n}',
      compiles: false,
      codeError: "E0382",
      explain:
        '`+` takes ownership of its left operand (`fn add(self, s: &str)`), reusing its buffer. `s1` is moved; use `format!("{s1}-{s2}")` to keep both.',
    },
    {
      id: "slice-q-format",
      kind: "output",
      topic: "methods",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let a = String::from("tic");\n    let b = String::from("tac");\n    let s = format!("{a}-{b}-{a}");\n    println!("{s} {}", a.len());\n}',
      answer: "tic-tac-tic 3",
      explain: "`format!` only borrows its arguments, so `a` is still usable afterwards.",
    },
    {
      id: "slice-q-trim",
      kind: "output",
      topic: "methods",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let raw = "  padded  ";\n    println!("[{}]", raw.trim());\n}',
      answer: "[padded]",
      explain:
        "`trim` returns a `&str` sub-slice without leading and trailing whitespace; nothing is copied.",
    },
    {
      id: "slice-q-split",
      kind: "output",
      topic: "methods",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let parts: Vec<&str> = "a,b,,c".split(\',\').collect();\n    println!("{parts:?}");\n}',
      answer: '["a", "b", "", "c"]',
      explain:
        "`split` yields the empty string between adjacent separators; `split_terminator` or filtering removes it.",
    },
    {
      id: "slice-q-literal-type",
      kind: "recall",
      topic: "types",
      difficulty: 2,
      prompt: 'Type the full type of the string literal `"hi"`.',
      accept: ["&'static str", "&' static str", "& 'static str"],
      explain: "Literals are stored in the binary for the whole run, so they are `&'static str`.",
    },
    {
      id: "slice-q-coercion",
      kind: "compiles",
      topic: "types",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn shout(s: &str) -> String {\n    s.to_uppercase()\n}\n\nfn main() {\n    let owned = String::from("hey");\n    println!("{} {}", shout(&owned), shout("you"));\n}',
      compiles: true,
      explain:
        "`&String` coerces to `&str` automatically (deref coercion), so one `&str` parameter serves owned strings and literals alike.",
    },
    {
      id: "slice-q-words",
      kind: "output",
      topic: "methods",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let text = "  the quick   brown fox ";\n    let n = text.split_whitespace().count();\n    let longest = text.split_whitespace().map(str::len).max().unwrap();\n    println!("{n} {longest}");\n}',
      answer: "4 5",
      explain:
        "`split_whitespace` skips runs of whitespace entirely; the longest words have five letters.",
    },
  ],
  generators: [
    {
      id: "slice-g-range",
      topic: "slices",
      difficulty: 2,
      make: (rng) => {
        const values = distinctInts(rng, 7, 1, 60);
        const start = int(rng, 0, 3);
        const end = int(rng, start + 1, 7);
        const form = pick(rng, ["both", "from", "to"] as const);
        const range =
          form === "both" ? `${start}..${end}` : form === "from" ? `${start}..` : `..${end}`;
        const slice =
          form === "both"
            ? values.slice(start, end)
            : form === "from"
              ? values.slice(start)
              : values.slice(0, end);
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let a = [${values.join(", ")}];\nlet s = &a[${range}];\nprintln!("{:?} {}", s, s.len());`,
          ),
          answer: `[${slice.join(", ")}] ${slice.length}`,
          explain: `\`${range}\` selects ${form === "to" ? "from the start" : `from index ${start}`} ${form === "from" ? "to the end" : `up to but not including index ${end}`}.`,
        };
      },
    },
    {
      id: "slice-g-len-count",
      topic: "utf8",
      difficulty: 3,
      make: (rng) => {
        const word = pick(rng, [
          "café",
          "naïve",
          "résumé",
          "jalapeño",
          "über",
          "piñata",
          "straße",
          "señor",
          "déjà",
        ]);
        const bytes = new TextEncoder().encode(word).length;
        const chars = [...word].length;
        return valueChoice(rng, {
          prompt: `For \`let w = "${word}";\`, what does this print?`,
          code: program(`let w = "${word}";\nprintln!("{} {}", w.len(), w.chars().count());`),
          correct: `${bytes} ${chars}`,
          distractors: [
            `${chars} ${chars}`,
            `${chars} ${bytes}`,
            `${bytes} ${bytes}`,
            `${bytes + 1} ${chars}`,
          ],
          expectStdout: `${bytes} ${chars}`,
          explain: `\`len\` counts UTF-8 bytes (${bytes}); accented letters take two bytes each. \`chars().count()\` counts characters (${chars}).`,
        });
      },
    },
    {
      id: "slice-g-split",
      topic: "methods",
      difficulty: 2,
      make: (rng) => {
        const separator = pick(rng, [",", ";", "|", ":"]);
        const words = shuffle(rng, ["red", "green", "blue", "gold", "teal", "plum"]).slice(
          0,
          int(rng, 3, 5),
        );
        const index = int(rng, 0, words.length - 1);
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let line = "${words.join(separator)}";\nlet parts: Vec<&str> = line.split('${separator}').collect();\nprintln!("{} {}", parts.len(), parts[${index}]);`,
          ),
          answer: `${words.length} ${words[index]}`,
          explain: `Splitting on '${separator}' yields ${words.length} pieces, and index ${index} is "${words[index]}".`,
        };
      },
    },
  ],
  cards: [
    {
      id: "slice-c-what",
      front: "What is a slice (`&[T]` or `&str`)?",
      back: "A borrowed view of a contiguous range: a pointer plus a length.",
    },
    {
      id: "slice-c-len",
      front: 'Does `"héllo".len()` return 5 or 6?',
      back: "6 — `len` counts UTF-8 bytes.",
    },
    {
      id: "slice-c-index",
      front: "Why doesn't `s[0]` compile for a `String`?",
      back: "A byte index is not a character in UTF-8; use `chars()`, `bytes()`, or a range slice.",
    },
    {
      id: "slice-c-boundary",
      front: "What happens when a string slice range splits a multibyte character?",
      back: "A runtime panic (byte index is not a char boundary).",
    },
    {
      id: "slice-c-param",
      front: "Best parameter type for read-only text?",
      back: "`&str` — accepts `&String` by deref coercion and literals directly.",
    },
    {
      id: "slice-c-plus",
      front: "What does `s1 + &s2` do to `s1`?",
      back: "Moves it (the left operand is taken by value and its buffer reused).",
      why: "Use `format!` when you need to keep all inputs.",
    },
    {
      id: "slice-c-literal",
      front: "Type of a string literal?",
      back: "`&'static str`",
    },
    {
      id: "slice-c-string-parts",
      front: "What three values make up a `String` on the stack?",
      back: "Pointer, length, capacity.",
    },
  ],
};

const smartPointers: SegmentBank = {
  chapterId: "smart-pointers",
  questions: [
    {
      id: "sp-q-rc-count",
      kind: "output",
      topic: "rc",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::rc::Rc;\n\nfn main() {\n    let a = Rc::new(String::from("shared"));\n    let b = Rc::clone(&a);\n    {\n        let _c = Rc::clone(&a);\n        println!("{}", Rc::strong_count(&a));\n    }\n    println!("{}", Rc::strong_count(&b));\n}',
      answer: "3\n2",
      explain:
        "Each `Rc::clone` increments the count without copying the String; dropping `_c` at the end of the block decrements it. All owners see the same count.",
    },
    {
      id: "sp-q-rc-mutate",
      kind: "compiles",
      topic: "rc",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'use std::rc::Rc;\n\nfn main() {\n    let n = Rc::new(5);\n    *n += 1;\n    println!("{n}");\n}',
      compiles: false,
      codeError: "E0594",
      explain:
        "`Rc` gives shared ownership, and shared means read-only. To mutate through it, put the data in a `RefCell` (or `Cell`): `Rc<RefCell<i32>>`.",
    },
    {
      id: "sp-q-rc-refcell",
      kind: "output",
      topic: "refcell",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::cell::RefCell;\nuse std::rc::Rc;\n\nfn main() {\n    let log = Rc::new(RefCell::new(Vec::new()));\n    let writer = Rc::clone(&log);\n    writer.borrow_mut().push("a");\n    log.borrow_mut().push("b");\n    println!("{:?}", log.borrow());\n}',
      answer: '["a", "b"]',
      explain:
        "Both handles point to one `RefCell<Vec>`. `borrow_mut` hands out a runtime-checked exclusive borrow, so either owner can push.",
    },
    {
      id: "sp-q-double-borrow",
      kind: "choice",
      topic: "refcell",
      difficulty: 3,
      prompt: "What happens when this runs?",
      code: 'use std::cell::RefCell;\n\nfn main() {\n    let cell = RefCell::new(1);\n    let a = cell.borrow_mut();\n    let b = cell.borrow_mut();\n    println!("{} {}", a, b);\n}',
      panics: true,
      options: [
        "Compile error E0499",
        "It compiles, then panics with 'already borrowed'",
        "It prints `1 1`",
      ],
      answer: 1,
      feedback: [
        "RefCell moves the check to runtime; the compiler sees two ordinary method calls.",
        null,
        "Two live mutable borrows are never allowed — RefCell enforces that at runtime.",
      ],
      explain:
        "RefCell enforces the same borrowing rule, but dynamically. A second `borrow_mut` while the first guard is alive panics (`BorrowMutError`).",
    },
    {
      id: "sp-q-box-uses",
      kind: "multi",
      topic: "box",
      difficulty: 2,
      prompt: "Select every good reason to use `Box<T>`.",
      options: [
        "A recursive type whose size would otherwise be infinite",
        "Owning a trait object such as `Box<dyn Error>`",
        "Moving a large value around by pointer instead of copying its bytes",
        "Letting several owners share the same value",
      ],
      answers: [0, 1, 2],
      explain:
        "Box is single ownership of a heap value with a known pointer size. Shared ownership is `Rc`/`Arc`.",
    },
    {
      id: "sp-q-recursive",
      kind: "compiles",
      topic: "box",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: "enum List {\n    Cons(i32, List),\n    Nil,\n}\n\nfn main() {\n    let _l = List::Nil;\n}",
      compiles: false,
      codeError: "E0072",
      explain:
        "A `List` containing a `List` directly would be infinitely large. `Cons(i32, Box<List>)` gives the variant a fixed, pointer-sized field (E0072 suggests exactly this).",
    },
    {
      id: "sp-q-box-deref",
      kind: "output",
      topic: "box",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let b = Box::new(41);\n    println!("{}", *b + 1);\n}',
      answer: "42",
      explain: "`Box<T>` implements `Deref`, so `*b` reaches the `i32` on the heap.",
    },
    {
      id: "sp-q-rc-thread",
      kind: "compiles",
      topic: "rc",
      difficulty: 3,
      prompt: "Does this program compile?",
      code: 'use std::rc::Rc;\nuse std::thread;\n\nfn main() {\n    let data = Rc::new(5);\n    let copy = Rc::clone(&data);\n    thread::spawn(move || println!("{copy}")).join().unwrap();\n}',
      compiles: false,
      codeError: "E0277",
      explain:
        "`Rc` updates its count non-atomically, so it is not `Send`. The compiler refuses to move it to another thread; `Arc` is the thread-safe version.",
    },
    {
      id: "sp-q-weak",
      kind: "output",
      topic: "rc",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'use std::rc::Rc;\n\nfn main() {\n    let strong = Rc::new(7);\n    let weak = Rc::downgrade(&strong);\n    println!("{:?}", weak.upgrade());\n    drop(strong);\n    println!("{:?}", weak.upgrade());\n}',
      answer: "Some(7)\nNone",
      explain:
        "A `Weak` does not keep the value alive. Once the last strong owner is dropped, `upgrade` returns `None`. This is how parent links avoid reference cycles.",
    },
    {
      id: "sp-q-cycle",
      kind: "choice",
      topic: "rc",
      difficulty: 2,
      prompt:
        "Two `Rc` nodes hold strong references to each other and nothing else refers to them. What happens?",
      options: [
        "Rust detects the cycle and frees both",
        "The memory leaks: each count stays at 1",
        "It fails to compile",
      ],
      answer: 1,
      explain:
        "Reference counting cannot see cycles. Leaks are memory-safe in Rust but still bugs; break cycles with `Weak`.",
    },
    {
      id: "sp-q-downgrade",
      kind: "recall",
      topic: "rc",
      difficulty: 2,
      prompt: "Type the associated function that creates a `Weak<T>` from an `&Rc<T>`.",
      accept: ["Rc::downgrade", "downgrade", "rc::downgrade"],
      explain: "`Rc::downgrade(&rc)` returns a `Weak` that does not increase the strong count.",
    },
    {
      id: "sp-q-cell",
      kind: "output",
      topic: "refcell",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::cell::Cell;\n\nstruct Counter {\n    hits: Cell<u32>,\n}\n\nimpl Counter {\n    fn hit(&self) {\n        self.hits.set(self.hits.get() + 1);\n    }\n}\n\nfn main() {\n    let c = Counter { hits: Cell::new(0) };\n    c.hit();\n    c.hit();\n    println!("{}", c.hits.get());\n}',
      answer: "2",
      explain:
        "`Cell<T>` allows mutation through `&self` by copying values in and out; no borrow is ever handed out, so there is nothing to check at runtime.",
    },
    {
      id: "sp-q-which-runtime",
      kind: "choice",
      topic: "refcell",
      difficulty: 1,
      prompt: "Which type enforces the borrowing rules at runtime instead of compile time?",
      options: ["`Box<T>`", "`Rc<T>`", "`RefCell<T>`"],
      answer: 2,
      explain: "RefCell tracks active borrows in a counter and panics on a violation.",
    },
    {
      id: "sp-q-ptr-eq",
      kind: "output",
      topic: "rc",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::rc::Rc;\n\nfn main() {\n    let a = Rc::new(1);\n    let b = Rc::clone(&a);\n    let c = Rc::new(1);\n    println!("{} {} {}", a == c, Rc::ptr_eq(&a, &b), Rc::ptr_eq(&a, &c));\n}',
      answer: "true true false",
      explain:
        "`==` compares the values; `Rc::ptr_eq` asks whether two handles share the same allocation.",
    },
    {
      id: "sp-q-box-drop",
      kind: "output",
      topic: "box",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: `${NOISY}\n\nfn main() {\n    let boxed = Box::new(Noisy("boxed"));\n    let moved = boxed;\n    println!("moved");\n    drop(moved);\n    println!("after");\n}`,
      answer: "moved\ndrop boxed\nafter",
      explain:
        "Moving a Box moves ownership of the heap value, not the value itself. `drop(moved)` runs the destructor immediately, before `after`.",
    },
  ],
  generators: [
    {
      id: "sp-g-rc-count",
      topic: "rc",
      difficulty: 2,
      make: (rng) => {
        const clones = int(rng, 1, 4);
        const drops = int(rng, 0, clones);
        const lines = ["let root = Rc::new(0);", "let mut owners = Vec::new();"];
        lines.push(`for _ in 0..${clones} {\n    owners.push(Rc::clone(&root));\n}`);
        if (drops > 0) lines.push(`owners.truncate(${clones - drops});`);
        lines.push('println!("{}", Rc::strong_count(&root));');
        const count = 1 + clones - drops;
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(lines.join("\n"), "use std::rc::Rc;"),
          answer: String(count),
          explain: `The original plus ${clones} clones makes ${1 + clones} owners; truncating the vector drops ${drops}, leaving ${count}.`,
        };
      },
    },
    {
      id: "sp-g-refcell-push",
      topic: "refcell",
      difficulty: 2,
      make: (rng) => {
        const items = distinctInts(rng, int(rng, 2, 4), 1, 50);
        const lines = [
          "let shared = Rc::new(RefCell::new(Vec::new()));",
          "let other = Rc::clone(&shared);",
        ];
        for (const [index, item] of items.entries()) {
          lines.push(`${index % 2 === 0 ? "shared" : "other"}.borrow_mut().push(${item});`);
        }
        lines.push("let total: i32 = shared.borrow().iter().sum();");
        lines.push('println!("{} {}", other.borrow().len(), total);');
        const sum = items.reduce((a, b) => a + b, 0);
        return {
          kind: "output",
          prompt: "Both handles share one RefCell. What exactly does this print?",
          code: program(lines.join("\n"), "use std::cell::RefCell;\nuse std::rc::Rc;"),
          answer: `${items.length} ${sum}`,
          explain: `Pushes through either handle land in the same vector: ${items.length} items summing to ${sum}.`,
        };
      },
    },
  ],
  cards: [
    {
      id: "sp-c-box",
      front: "What is `Box<T>`?",
      back: "Single ownership of a value on the heap, through a fixed-size pointer.",
    },
    {
      id: "sp-c-recursive",
      front: "How do you make a recursive enum like `Cons(i32, List)` compile?",
      back: "Indirect the recursion: `Cons(i32, Box<List>)`.",
    },
    {
      id: "sp-c-rc",
      front: "What does `Rc::clone(&a)` copy?",
      back: "Only the pointer — it increments the reference count.",
    },
    {
      id: "sp-c-rc-threads",
      front: "Why is `Rc<T>` not `Send`?",
      back: "Its count is updated non-atomically; use `Arc<T>` across threads.",
    },
    {
      id: "sp-c-refcell",
      front: "What does `RefCell<T>` change about borrowing?",
      back: "The same rules are checked at runtime; violations panic instead of failing to compile.",
    },
    {
      id: "sp-c-combo",
      front: "Idiom for shared, mutable, single-threaded data?",
      back: "`Rc<RefCell<T>>`",
    },
    {
      id: "sp-c-weak",
      front: "What breaks an `Rc` reference cycle?",
      back: "Make one direction a `Weak<T>` (via `Rc::downgrade`).",
    },
    {
      id: "sp-c-cell",
      front: "`Cell<T>` vs `RefCell<T>`?",
      back: "`Cell` moves/copies values in and out (no references handed out); `RefCell` lends `&`/`&mut` with runtime checks.",
    },
  ],
};

export const ownershipBanks: SegmentBank[] = [ownership, borrowing, slicesStrings, smartPointers];
