import { distinctInts, int, shuffle } from "../rng";
import type { SegmentBank } from "../types";
import { program } from "./helpers";

const concurrency: SegmentBank = {
  chapterId: "concurrency",
  questions: [
    {
      id: "conc-q-no-move",
      kind: "compiles",
      topic: "threads",
      difficulty: 1,
      prompt: "Does this program compile?",
      code: 'use std::thread;\n\nfn main() {\n    let v = vec![1, 2, 3];\n    let handle = thread::spawn(|| println!("{v:?}"));\n    handle.join().unwrap();\n}',
      compiles: false,
      codeError: "E0373",
      explain:
        "The spawned thread might outlive `v`'s owner, so borrowing it is refused (E0373). `move ||` transfers ownership into the thread.",
    },
    {
      id: "conc-q-join-value",
      kind: "output",
      topic: "threads",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'use std::thread;\n\nfn main() {\n    let handle = thread::spawn(|| (1..=4).product::<u32>());\n    let result = handle.join().unwrap();\n    println!("{result}");\n}',
      answer: "24",
      explain:
        "`join` waits for the thread and returns `Result<T, _>` carrying the closure's return value.",
    },
    {
      id: "conc-q-channel-sum",
      kind: "output",
      topic: "channels",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::sync::mpsc;\nuse std::thread;\n\nfn main() {\n    let (tx, rx) = mpsc::channel();\n    thread::spawn(move || {\n        for n in [5, 10, 20] {\n            tx.send(n).unwrap();\n        }\n    });\n    let total: i32 = rx.iter().sum();\n    println!("{total}");\n}',
      answer: "35",
      explain:
        "`rx.iter()` yields messages until every sender is dropped. The sender moves into the thread and is dropped when it finishes, ending the loop.",
    },
    {
      id: "conc-q-use-after-move",
      kind: "compiles",
      topic: "threads",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'use std::thread;\n\nfn main() {\n    let name = String::from("worker");\n    let h = thread::spawn(move || println!("{name}"));\n    println!("{name}");\n    h.join().unwrap();\n}',
      compiles: false,
      codeError: "E0382",
      explain:
        "`move` gave the thread ownership of `name`. Clone it first if both threads need the text.",
    },
    {
      id: "conc-q-main-exit",
      kind: "choice",
      topic: "threads",
      difficulty: 2,
      prompt:
        "`main` spawns a thread but never joins it, then returns. What happens to the thread?",
      options: [
        "`main` waits for it automatically",
        "It is stopped when the process exits, possibly mid-work",
        "It keeps running in the background after the program ends",
      ],
      answer: 1,
      explain:
        "Returning from `main` ends the process. Keep the `JoinHandle` and `join` it when the work must finish.",
    },
    {
      id: "conc-q-channel-end",
      kind: "choice",
      topic: "channels",
      difficulty: 2,
      prompt: "`for msg in rx { … }` never finishes. What is the most likely cause?",
      options: [
        "A `Sender` (often the original `tx` in `main`) is still alive",
        "The channel is full",
        "Receivers must call `close()`",
      ],
      answer: 0,
      explain:
        "Iteration ends only when all senders are dropped. Clones given to workers are not enough; drop the original too.",
    },
    {
      id: "conc-q-rc-send",
      kind: "compiles",
      topic: "send-sync",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'use std::rc::Rc;\nuse std::sync::mpsc;\nuse std::thread;\n\nfn main() {\n    let (tx, rx) = mpsc::channel();\n    thread::spawn(move || {\n        tx.send(Rc::new(5)).unwrap();\n    });\n    println!("{}", rx.recv().unwrap());\n}',
      compiles: false,
      codeError: "E0277",
      explain:
        "Sending a value moves it to another thread, which requires `Send`. `Rc` is not `Send`; `Arc` is. The compiler proves this, so the data race cannot exist.",
    },
    {
      id: "conc-q-producers",
      kind: "output",
      topic: "channels",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::sync::mpsc;\nuse std::thread;\n\nfn main() {\n    let (tx, rx) = mpsc::channel();\n    for id in 1..=3 {\n        let tx = tx.clone();\n        thread::spawn(move || tx.send(id * 10).unwrap());\n    }\n    drop(tx);\n    let mut got: Vec<i32> = rx.iter().collect();\n    got.sort();\n    println!("{got:?}");\n}',
      answer: "[10, 20, 30]",
      explain:
        "Each producer gets a cloned `Sender`. Arrival order is unpredictable, so the program sorts before printing — that is how you test concurrent code deterministically.",
    },
    {
      id: "conc-q-mpsc",
      kind: "recall",
      topic: "channels",
      difficulty: 1,
      prompt: "Type the standard-library module path that provides `channel()`.",
      accept: ["std::sync::mpsc", "sync::mpsc", "mpsc"],
      explain: "`std::sync::mpsc` — multi-producer, single-consumer channels.",
    },
    {
      id: "conc-q-mpsc-meaning",
      kind: "choice",
      topic: "channels",
      difficulty: 1,
      prompt: "What does `mpsc` stand for?",
      options: [
        "Multi-producer, single-consumer",
        "Message-passing shared channel",
        "Mutex-protected synchronous channel",
      ],
      answer: 0,
      explain: "Clone the `Sender` for more producers; there is exactly one `Receiver`.",
    },
    {
      id: "conc-q-scoped",
      kind: "output",
      topic: "threads",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'use std::thread;\n\nfn main() {\n    let data = vec![1, 2, 3, 4, 5, 6];\n    let (left, right) = data.split_at(3);\n    let (a, b) = thread::scope(|s| {\n        let ha = s.spawn(|| left.iter().sum::<i32>());\n        let hb = s.spawn(|| right.iter().sum::<i32>());\n        (ha.join().unwrap(), hb.join().unwrap())\n    });\n    println!("{a} {b} {}", data.len());\n}',
      answer: "6 15 6",
      explain:
        "`thread::scope` guarantees every spawned thread finishes before the scope returns, so threads may borrow local data without `move`.",
    },
    {
      id: "conc-q-send-sync",
      kind: "choice",
      topic: "send-sync",
      difficulty: 3,
      prompt: "Which statement is correct?",
      options: [
        "`Send`: safe to move to another thread. `Sync`: safe to share `&T` between threads.",
        "`Send` and `Sync` are runtime checks performed by `thread::spawn`",
        "Every type is `Send` unless it contains `unsafe` code",
      ],
      answer: 0,
      explain:
        "Both are marker traits the compiler derives automatically from a type's fields; violations are compile errors.",
    },
    {
      id: "conc-q-ordered-join",
      kind: "output",
      topic: "threads",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::thread;\n\nfn main() {\n    let handles: Vec<_> = (1..=4).map(|i| thread::spawn(move || i * i)).collect();\n    let squares: Vec<i32> = handles.into_iter().map(|h| h.join().unwrap()).collect();\n    println!("{squares:?}");\n}',
      answer: "[1, 4, 9, 16]",
      explain:
        "Threads may finish in any order, but joining the handles in spawn order collects results in that order.",
    },
    {
      id: "conc-q-recv",
      kind: "choice",
      topic: "channels",
      difficulty: 2,
      prompt: "`recv()` vs `try_recv()`?",
      options: [
        "`recv` blocks until a message or disconnection; `try_recv` returns immediately",
        "They are identical",
        "`try_recv` retries automatically",
      ],
      answer: 0,
      explain: "`try_recv` suits loops that must keep doing other work between messages.",
    },
    {
      id: "conc-q-send-moves",
      kind: "compiles",
      topic: "channels",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'use std::sync::mpsc;\n\nfn main() {\n    let (tx, rx) = mpsc::channel();\n    let msg = String::from("hi");\n    tx.send(msg).unwrap();\n    println!("{msg}");\n    println!("{}", rx.recv().unwrap());\n}',
      compiles: false,
      codeError: "E0382",
      explain:
        "`send` takes ownership of the value — communication is ownership transfer, so the sender cannot touch it afterwards.",
    },
  ],
  generators: [
    {
      id: "conc-g-join-sum",
      topic: "threads",
      difficulty: 2,
      make: (rng) => {
        const workers = int(rng, 2, 5);
        const factor = int(rng, 2, 9);
        const total = Array.from({ length: workers }, (_, i) => (i + 1) * factor).reduce(
          (a, b) => a + b,
          0,
        );
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let handles: Vec<_> = (1..=${workers}).map(|i| thread::spawn(move || i * ${factor})).collect();\nlet total: i32 = handles.into_iter().map(|h| h.join().unwrap()).sum();\nprintln!("{total}");`,
            "use std::thread;",
          ),
          answer: String(total),
          explain: `${workers} threads return ${Array.from({ length: workers }, (_, i) => (i + 1) * factor).join(", ")}; joining collects every result regardless of finishing order.`,
        };
      },
    },
    {
      id: "conc-g-channel",
      topic: "channels",
      difficulty: 2,
      make: (rng) => {
        const producers = int(rng, 2, 4);
        const perProducer = int(rng, 2, 3);
        const base = int(rng, 1, 5);
        let total = 0;
        for (let id = 0; id < producers; id += 1)
          for (let k = 0; k < perProducer; k += 1) total += id * base + k;
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let (tx, rx) = mpsc::channel();\nfor id in 0..${producers} {\n    let tx = tx.clone();\n    thread::spawn(move || {\n        for k in 0..${perProducer} {\n            tx.send(id * ${base} + k).unwrap();\n        }\n    });\n}\ndrop(tx);\nlet messages: Vec<i32> = rx.iter().collect();\nprintln!("{} {}", messages.len(), messages.iter().sum::<i32>());`,
            "use std::sync::mpsc;\nuse std::thread;",
          ),
          answer: `${producers * perProducer} ${total}`,
          explain:
            "Order varies between runs, but the count and the sum do not. Dropping the original `tx` lets `rx.iter()` finish.",
        };
      },
    },
  ],
  cards: [
    {
      id: "conc-c-move",
      front: "Why do thread closures usually need `move`?",
      back: "The thread may outlive the current scope, so it must own what it uses (E0373 otherwise).",
    },
    {
      id: "conc-c-join",
      front: "What does `JoinHandle::join` return?",
      back: "`Result<T, _>` with the thread's return value (`Err` if it panicked).",
    },
    {
      id: "conc-c-exit",
      front: "What happens to unjoined threads when `main` returns?",
      back: "They are killed with the process.",
    },
    {
      id: "conc-c-rx-end",
      front: "When does `for m in rx` stop?",
      back: "When every `Sender` has been dropped.",
    },
    {
      id: "conc-c-send-own",
      front: "What does `tx.send(v)` do to `v`?",
      back: "Moves it — ownership travels with the message.",
    },
    {
      id: "conc-c-send-sync",
      front: "`Send` vs `Sync`?",
      back: "`Send`: may be moved to another thread. `Sync`: `&T` may be shared between threads.",
    },
    {
      id: "conc-c-scope",
      front: "How can threads borrow local data without `move`?",
      back: "`std::thread::scope` — all scoped threads are joined before it returns.",
    },
    {
      id: "conc-c-mpsc",
      front: "How do you add a second producer to an mpsc channel?",
      back: "`let tx2 = tx.clone();`",
    },
  ],
};

const sharedState: SegmentBank = {
  chapterId: "shared-state",
  questions: [
    {
      id: "shared-q-counter",
      kind: "output",
      topic: "mutex",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'use std::sync::{Arc, Mutex};\nuse std::thread;\n\nfn main() {\n    let counter = Arc::new(Mutex::new(0));\n    let mut handles = vec![];\n    for _ in 0..10 {\n        let counter = Arc::clone(&counter);\n        handles.push(thread::spawn(move || {\n            *counter.lock().unwrap() += 1;\n        }));\n    }\n    for h in handles {\n        h.join().unwrap();\n    }\n    println!("{}", *counter.lock().unwrap());\n}',
      answer: "10",
      explain:
        "`Arc` shares ownership across threads; `Mutex` makes each increment exclusive. Joining every handle before reading guarantees all ten ran.",
    },
    {
      id: "shared-q-mutex-no-arc",
      kind: "compiles",
      topic: "arc",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: "use std::sync::Mutex;\nuse std::thread;\n\nfn main() {\n    let m = Mutex::new(0);\n    let mut handles = vec![];\n    for _ in 0..2 {\n        handles.push(thread::spawn(move || {\n            *m.lock().unwrap() += 1;\n        }));\n    }\n}",
      compiles: false,
      codeError: "E0382",
      explain:
        "The first iteration moves the `Mutex` into a thread, so the second has nothing to move. Wrap it in `Arc` and clone the `Arc` per thread.",
    },
    {
      id: "shared-q-rc-mutex",
      kind: "compiles",
      topic: "arc",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: "use std::rc::Rc;\nuse std::sync::Mutex;\nuse std::thread;\n\nfn main() {\n    let shared = Rc::new(Mutex::new(0));\n    let copy = Rc::clone(&shared);\n    thread::spawn(move || {\n        *copy.lock().unwrap() += 1;\n    })\n    .join()\n    .unwrap();\n}",
      compiles: false,
      codeError: "E0277",
      explain: "`Rc` is not `Send`. Threads need the atomically counted `Arc`.",
    },
    {
      id: "shared-q-guard",
      kind: "choice",
      topic: "mutex",
      difficulty: 2,
      prompt: "When is a `Mutex` unlocked?",
      options: [
        "When you call `unlock()`",
        "When the `MutexGuard` returned by `lock()` is dropped",
        "At the end of `main`",
      ],
      answer: 1,
      explain:
        "RAII: the guard releases the lock in its destructor, so you cannot forget to unlock — but you can hold it too long.",
    },
    {
      id: "shared-q-deadlock",
      kind: "choice",
      topic: "mutex",
      difficulty: 3,
      prompt:
        "Thread 1 locks A then B; thread 2 locks B then A. What can happen, and what prevents it?",
      options: [
        "A deadlock; always acquire locks in one global order",
        "A data race; use `unsafe`",
        "Nothing — Rust's type system prevents deadlocks",
      ],
      answer: 0,
      explain:
        "Rust prevents data races, not deadlocks. Consistent lock ordering (or a single lock) is the standard remedy.",
    },
    {
      id: "shared-q-strong-count",
      kind: "output",
      topic: "arc",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::sync::Arc;\nuse std::thread;\n\nfn main() {\n    let data = Arc::new(vec![1, 2, 3]);\n    let clones: Vec<_> = (0..3).map(|_| Arc::clone(&data)).collect();\n    println!("{}", Arc::strong_count(&data));\n    let handle = thread::spawn(move || clones.len());\n    let n = handle.join().unwrap();\n    println!("{} {}", n, Arc::strong_count(&data));\n}',
      answer: "4\n3 1",
      explain:
        "Three clones plus the original make 4. The vector of clones moves into the thread and is dropped when the thread ends, leaving only the original.",
    },
    {
      id: "shared-q-rwlock",
      kind: "choice",
      topic: "mutex",
      difficulty: 2,
      prompt: "Configuration is read constantly and updated rarely. Which primitive fits best?",
      options: ["`Mutex<Config>`", "`RwLock<Config>`", "`RefCell<Config>`"],
      answer: 1,
      explain:
        "`RwLock` allows many simultaneous readers or one writer. `RefCell` is not thread-safe.",
    },
    {
      id: "shared-q-atomic",
      kind: "output",
      topic: "atomics",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'use std::sync::atomic::{AtomicUsize, Ordering};\nuse std::sync::Arc;\nuse std::thread;\n\nfn main() {\n    let hits = Arc::new(AtomicUsize::new(0));\n    let handles: Vec<_> = (0..4)\n        .map(|_| {\n            let hits = Arc::clone(&hits);\n            thread::spawn(move || {\n                for _ in 0..250 {\n                    hits.fetch_add(1, Ordering::Relaxed);\n                }\n            })\n        })\n        .collect();\n    for h in handles {\n        h.join().unwrap();\n    }\n    println!("{}", hits.load(Ordering::Relaxed));\n}',
      answer: "1000",
      explain:
        "Atomic read-modify-write operations never lose updates, and a plain counter needs no lock.",
    },
    {
      id: "shared-q-arc-recall",
      kind: "recall",
      topic: "arc",
      difficulty: 1,
      prompt: "Type the smart pointer for shared ownership across threads.",
      accept: ["Arc", "Arc<T>", "std::sync::Arc"],
      explain: "`Arc<T>`: atomically reference counted. The thread-safe sibling of `Rc<T>`.",
    },
    {
      id: "shared-q-poison",
      kind: "choice",
      topic: "mutex",
      difficulty: 3,
      prompt: "Why does `lock()` return a `Result`?",
      options: [
        "The lock may be poisoned: a thread panicked while holding it, so the data may be inconsistent",
        "Locking can time out",
        "The mutex may have been dropped",
      ],
      answer: 0,
      explain:
        "Poisoning surfaces a possibly broken invariant. `unwrap()` propagates the panic; `into_inner` on the error recovers the data deliberately.",
    },
    {
      id: "shared-q-relock",
      kind: "output",
      topic: "mutex",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'use std::sync::Mutex;\n\nfn main() {\n    let m = Mutex::new(vec![1]);\n    {\n        let mut guard = m.lock().unwrap();\n        guard.push(2);\n    }\n    let mut again = m.lock().unwrap();\n    again.push(3);\n    println!("{:?}", *again);\n}',
      answer: "[1, 2, 3]",
      explain:
        "The first guard is dropped at the end of its block, so locking again in the same thread succeeds.",
    },
    {
      id: "shared-q-interior",
      kind: "choice",
      topic: "mutex",
      difficulty: 2,
      prompt:
        "Why can threads mutate the data in an `Arc<Mutex<T>>` even though `Arc` only gives shared access?",
      options: [
        "`Arc` secretly gives `&mut`",
        "`Mutex` provides interior mutability: `lock(&self)` hands out exclusive access at runtime",
        "Threads ignore borrowing rules",
      ],
      answer: 1,
      explain:
        "`Mutex<T>` is to threads what `RefCell<T>` is to one thread: `&self` in, exclusive access out, checked at runtime.",
    },
    {
      id: "shared-q-into-inner",
      kind: "output",
      topic: "arc",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'use std::sync::{Arc, Mutex};\nuse std::thread;\n\nfn main() {\n    let log = Arc::new(Mutex::new(Vec::new()));\n    thread::scope(|s| {\n        for id in 0..3 {\n            let log = Arc::clone(&log);\n            s.spawn(move || log.lock().unwrap().push(id));\n        }\n    });\n    let mut entries = Arc::try_unwrap(log).unwrap().into_inner().unwrap();\n    entries.sort();\n    println!("{entries:?}");\n}',
      answer: "[0, 1, 2]",
      explain:
        "After every clone is gone, `Arc::try_unwrap` returns the sole owner's `Mutex`, and `into_inner` takes the data out without locking.",
    },
    {
      id: "shared-q-prefer",
      kind: "choice",
      topic: "atomics",
      difficulty: 2,
      prompt: "Which design is usually easiest to get right for a pipeline of workers?",
      options: [
        "One big `Arc<Mutex<State>>` locked by everyone",
        "Passing owned work items through channels, so each item has one owner at a time",
        "Global `static mut` variables",
      ],
      answer: 1,
      explain:
        "Share memory by communicating: message passing keeps ownership simple. Reach for locks knowingly, for truly shared state.",
    },
  ],
  generators: [
    {
      id: "shared-g-counter",
      topic: "mutex",
      difficulty: 2,
      make: (rng) => {
        const threads = int(rng, 2, 6);
        const each = int(rng, 1, 5) * 10;
        const start = int(rng, 0, 9);
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let total = Arc::new(Mutex::new(${start}));\nlet handles: Vec<_> = (0..${threads})\n    .map(|_| {\n        let total = Arc::clone(&total);\n        thread::spawn(move || {\n            for _ in 0..${each} {\n                *total.lock().unwrap() += 1;\n            }\n        })\n    })\n    .collect();\nfor h in handles {\n    h.join().unwrap();\n}\nprintln!("{}", *total.lock().unwrap());`,
            "use std::sync::{Arc, Mutex};\nuse std::thread;",
          ),
          answer: String(start + threads * each),
          explain: `${threads} threads each add ${each} to a start of ${start}; the mutex makes every increment count.`,
        };
      },
    },
    {
      id: "shared-g-atomic",
      topic: "atomics",
      difficulty: 3,
      make: (rng) => {
        const values = distinctInts(rng, int(rng, 3, 5), 1, 20);
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let sum = AtomicU64::new(0);\nlet max = AtomicU64::new(0);\nthread::scope(|s| {\n    for v in [${values.join(", ")}] {\n        let (sum, max) = (&sum, &max);\n        s.spawn(move || {\n            sum.fetch_add(v, Ordering::Relaxed);\n            max.fetch_max(v, Ordering::Relaxed);\n        });\n    }\n});\nprintln!("{} {}", sum.load(Ordering::Relaxed), max.load(Ordering::Relaxed));`,
            "use std::sync::atomic::{AtomicU64, Ordering};\nuse std::thread;",
          ),
          answer: `${values.reduce((a, b) => a + b, 0)} ${Math.max(...values)}`,
          explain:
            "`fetch_add` and `fetch_max` are atomic read-modify-write operations, so the result is independent of scheduling.",
        };
      },
    },
  ],
  cards: [
    {
      id: "shared-c-arc",
      front: "`Rc<T>` vs `Arc<T>`?",
      back: "Same idea; `Arc` uses atomic counts so it is `Send + Sync` (for `T: Send + Sync`).",
    },
    {
      id: "shared-c-idiom",
      front: "Idiom for shared mutable state across threads?",
      back: "`Arc<Mutex<T>>` (or `Arc<RwLock<T>>`).",
    },
    {
      id: "shared-c-unlock",
      front: "How is a `Mutex` unlocked?",
      back: "By dropping the `MutexGuard`.",
    },
    {
      id: "shared-c-deadlock",
      front: "Does Rust prevent deadlocks?",
      back: "No — only data races. Use a consistent lock order.",
    },
    {
      id: "shared-c-poison",
      front: "What is a poisoned mutex?",
      back: "One whose holder panicked; `lock()` returns `Err` to signal possibly broken invariants.",
    },
    {
      id: "shared-c-atomic",
      front: "Lock-free way to count events across threads?",
      back: "`AtomicUsize::fetch_add(1, Ordering::Relaxed)`",
    },
    {
      id: "shared-c-rwlock",
      front: "When is `RwLock` better than `Mutex`?",
      back: "Many readers, rare writers.",
    },
    {
      id: "shared-c-refcell",
      front: "Thread-safe counterpart of `RefCell<T>`?",
      back: "`Mutex<T>` (or `RwLock<T>`).",
    },
  ],
};

const roadAhead: SegmentBank = {
  chapterId: "road-ahead",
  questions: [
    {
      id: "road-q-guard-fall",
      kind: "output",
      topic: "patterns",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'enum Reading {\n    Ok(f64),\n    Err,\n}\n\nfn triage(r: &Reading) -> &\'static str {\n    match r {\n        Reading::Ok(v) if *v < 100.0 => "normal",\n        Reading::Ok(_) => "high",\n        Reading::Err => "sensor fault",\n    }\n}\n\nfn main() {\n    println!("{} {} {}", triage(&Reading::Ok(20.0)), triage(&Reading::Ok(140.0)), triage(&Reading::Err));\n}',
      answer: "normal high sensor fault",
      explain:
        "A false guard means the arm did not match, so matching continues with the next arm.",
    },
    {
      id: "road-q-at-binding",
      kind: "output",
      topic: "patterns",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn bucket(n: u32) -> String {\n    match n {\n        small @ 0..=9 => format!("small {small}"),\n        big @ 10.. => format!("big {big}"),\n    }\n}\n\nfn main() {\n    println!("{} / {}", bucket(7), bucket(42));\n}',
      answer: "small 7 / big 42",
      explain: "`name @ pattern` tests a pattern and binds the matched value in one step.",
    },
    {
      id: "road-q-slice-pattern",
      kind: "output",
      topic: "patterns",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'fn ends(v: &[i32]) -> String {\n    match v {\n        [] => "empty".to_string(),\n        [one] => format!("one {one}"),\n        [first, .., last] => format!("{first}..{last}"),\n    }\n}\n\nfn main() {\n    println!("{} | {} | {}", ends(&[]), ends(&[5]), ends(&[1, 2, 3, 9]));\n}',
      answer: "empty | one 5 | 1..9",
      explain:
        "Slice patterns match on length and shape; `..` skips any number of middle elements.",
    },
    {
      id: "road-q-async-lazy",
      kind: "choice",
      topic: "async",
      difficulty: 2,
      prompt: "You call an `async fn` but never `.await` the result. What runs?",
      options: [
        "The whole body, in the background",
        "Nothing — futures are lazy until polled (awaited or spawned)",
        "The body up to its first `.await`",
      ],
      answer: 1,
      explain:
        "Calling an `async fn` only builds a future. The compiler warns about unused futures for this reason.",
    },
    {
      id: "road-q-threads-async",
      kind: "choice",
      topic: "async",
      difficulty: 2,
      prompt: "Which workload suits async best?",
      options: [
        "Compressing four large files on four cores",
        "Serving ten thousand mostly idle network connections",
        "A tight numeric loop",
      ],
      answer: 1,
      explain:
        "Async shines when tasks spend most of their time waiting. CPU-bound parallel work suits threads (or rayon).",
    },
    {
      id: "road-q-unsafe-means",
      kind: "multi",
      topic: "unsafe",
      difficulty: 2,
      prompt: "Select every operation that requires an `unsafe` block.",
      options: [
        "Dereferencing a raw pointer",
        "Calling an `unsafe fn` (such as an FFI function)",
        "Creating a raw pointer with `&raw const x` or `as *const T`",
        "Indexing a slice",
      ],
      answers: [0, 1],
      explain:
        "Creating raw pointers is safe; dereferencing them is not. `unsafe` unlocks a short list of operations and never turns off the borrow checker.",
    },
    {
      id: "road-q-raw-deref",
      kind: "compiles",
      topic: "unsafe",
      difficulty: 2,
      prompt: "Does this program compile?",
      code: 'fn main() {\n    let x = 5;\n    let p = &x as *const i32;\n    println!("{}", *p);\n}',
      compiles: false,
      codeError: "E0133",
      explain:
        "Dereferencing a raw pointer requires `unsafe`, where you assert it points to a valid, live, aligned value.",
    },
    {
      id: "road-q-raw-ok",
      kind: "output",
      topic: "unsafe",
      difficulty: 2,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let mut x = 5;\n    let p = &raw mut x;\n    // SAFETY: p points to a live local and no other reference to x is in use.\n    unsafe {\n        *p += 1;\n    }\n    println!("{x}");\n}',
      answer: "6",
      explain:
        "Inside `unsafe` you may dereference the pointer; the `SAFETY:` comment records why this is sound.",
    },
    {
      id: "road-q-macro-expr",
      kind: "output",
      topic: "macros",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'macro_rules! square {\n    ($x:expr) => {\n        $x * $x\n    };\n}\n\nfn main() {\n    println!("{}", square!(2 + 1));\n}',
      answer: "9",
      explain:
        "An `expr` fragment is substituted as a single expression node, as if parenthesised, so this is (2 + 1) * (2 + 1). Macros operate on syntax trees, not text.",
    },
    {
      id: "road-q-unsafe-keyword",
      kind: "recall",
      topic: "unsafe",
      difficulty: 1,
      prompt:
        "Type the keyword that marks a block where you take responsibility for invariants the compiler cannot check.",
      accept: ["unsafe"],
      explain:
        "Keep unsafe blocks small and wrap them in safe APIs whose signatures make misuse impossible.",
    },
    {
      id: "road-q-await",
      kind: "choice",
      topic: "async",
      difficulty: 3,
      prompt: "What does `.await` do inside an `async fn`?",
      options: [
        "Blocks the OS thread until the future completes",
        "Yields to the executor if the future is not ready, so other tasks can run on the thread",
        "Spawns a new thread",
      ],
      answer: 1,
      explain:
        "Awaiting suspends only this task. Blocking calls inside async code stall every task sharing the thread.",
    },
    {
      id: "road-q-while-let",
      kind: "output",
      topic: "patterns",
      difficulty: 1,
      prompt: "What exactly does this print?",
      code: 'fn main() {\n    let mut stack = vec![1, 2, 3];\n    let mut order = Vec::new();\n    while let Some(top) = stack.pop() {\n        order.push(top);\n    }\n    println!("{order:?}");\n}',
      answer: "[3, 2, 1]",
      explain:
        "`while let` loops as long as the pattern matches; `pop` returns `None` when empty, ending the loop.",
    },
    {
      id: "road-q-derive",
      kind: "choice",
      topic: "macros",
      difficulty: 2,
      prompt: "What does `#[derive(Debug, Clone)]` do?",
      options: [
        "Runs code at program start",
        "Invokes procedural macros that generate `impl Debug` and `impl Clone` blocks at compile time",
        "Inherits methods from a parent struct",
      ],
      answer: 1,
      explain: "Derives are code generators; `cargo expand` shows exactly what they write.",
    },
    {
      id: "road-q-nested-destructure",
      kind: "output",
      topic: "patterns",
      difficulty: 3,
      prompt: "What exactly does this print?",
      code: 'struct Point {\n    x: i32,\n    y: i32,\n}\n\nenum Event {\n    Click(Point),\n    Key(char),\n}\n\nfn describe(e: &Event) -> String {\n    match e {\n        Event::Click(Point { x: 0, y }) => format!("left edge at {y}"),\n        Event::Click(Point { x, y: 0 }) => format!("top edge at {x}"),\n        Event::Click(Point { x, y }) => format!("({x}, {y})"),\n        Event::Key(c @ \'a\'..=\'z\') => format!("letter {c}"),\n        Event::Key(_) => "other key".into(),\n    }\n}\n\nfn main() {\n    let events = [Event::Click(Point { x: 0, y: 7 }), Event::Click(Point { x: 3, y: 4 }), Event::Key(\'q\'), Event::Key(\'!\')];\n    let out: Vec<String> = events.iter().map(describe).collect();\n    println!("{}", out.join("; "));\n}',
      answer: "left edge at 7; (3, 4); letter q; other key",
      explain:
        "Patterns nest: literals, bindings, `@` ranges, and struct destructuring compose inside one match.",
    },
  ],
  generators: [
    {
      id: "road-g-slice",
      topic: "patterns",
      difficulty: 2,
      make: (rng) => {
        const length = int(rng, 0, 5);
        const values = Array.from({ length }, () => int(rng, 1, 9));
        const expected =
          length === 0
            ? "none"
            : length === 1
              ? `just ${values[0]}`
              : length === 2
                ? `pair ${values[0]} ${values[1]}`
                : `${values[0]} then ${length - 2} more then ${values[length - 1]}`;
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let v: Vec<i32> = vec![${values.join(", ")}];\nlet text = match v.as_slice() {\n    [] => "none".to_string(),\n    [a] => format!("just {a}"),\n    [a, b] => format!("pair {a} {b}"),\n    [first, middle @ .., last] => format!("{first} then {} more then {last}", middle.len()),\n};\nprintln!("{text}");`,
          ),
          answer: expected,
          explain: `A slice of length ${length} matches the ${length >= 3 ? "`[first, middle @ .., last]`" : `length-${length}`} arm.`,
        };
      },
    },
    {
      id: "road-g-at",
      topic: "patterns",
      difficulty: 2,
      make: (rng) => {
        const code = int(rng, 100, 599);
        const label =
          code <= 199
            ? "info"
            : code <= 299
              ? "ok"
              : code <= 399
                ? "redirect"
                : code <= 499
                  ? "client error"
                  : "server error";
        return {
          kind: "output",
          prompt: "What exactly does this print?",
          code: program(
            `let status: u16 = ${code};\nlet text = match status {\n    c @ 100..=199 => format!("{c} info"),\n    c @ 200..=299 => format!("{c} ok"),\n    c @ 300..=399 => format!("{c} redirect"),\n    c @ 400..=499 => format!("{c} client error"),\n    c => format!("{c} server error"),\n};\nprintln!("{text}");`,
          ),
          answer: `${code} ${label}`,
          explain: "`c @ range` checks membership and binds the value for use in the arm.",
        };
      },
    },
    {
      id: "road-g-macro",
      topic: "macros",
      difficulty: 3,
      make: (rng) => {
        const values = shuffle(rng, [2, 3, 4, 5, 6, 7]).slice(0, int(rng, 2, 4));
        const total = values.reduce((a, b) => a + b, 0);
        return {
          kind: "output",
          prompt: "A repetition macro. What exactly does this print?",
          code: program(
            `println!("{} {}", sum!(${values.join(", ")}), count!(${values.join(", ")}));`,
            "macro_rules! sum {\n    ($($x:expr),*) => { 0 $(+ $x)* };\n}\n\nmacro_rules! count {\n    ($($x:expr),*) => { 0 $(+ { let _ = $x; 1 })* };\n}",
          ),
          answer: `${total} ${values.length}`,
          explain:
            "`$(...)*` repeats its body once per matched item, so the macros expand to `0 + a + b …` and `0 + 1 + 1 …`.",
        };
      },
    },
  ],
  cards: [
    {
      id: "road-c-guard",
      front: "A match guard is false. What happens?",
      back: "That arm does not match; matching continues with the next arm.",
    },
    {
      id: "road-c-at",
      front: "What does `n @ 1..=9` do in a pattern?",
      back: "Tests the range and binds the matched value to `n`.",
    },
    {
      id: "road-c-slice",
      front: "Pattern for 'first and last of a slice with at least two items'?",
      back: "`[first, .., last]`",
    },
    {
      id: "road-c-lazy",
      front: "What does calling an `async fn` do without `.await`?",
      back: "Nothing yet — it returns a lazy future.",
    },
    {
      id: "road-c-async-when",
      front: "Threads or async for 10,000 idle connections?",
      back: "Async: tasks are cheap and the work is waiting.",
    },
    {
      id: "road-c-unsafe",
      front: "Does `unsafe` disable the borrow checker?",
      back: "No. It only unlocks extra operations (raw-pointer deref, unsafe fns, …) and moves the proof burden to you.",
    },
    {
      id: "road-c-raw",
      front: "Is creating a raw pointer unsafe?",
      back: "No — only dereferencing it is.",
    },
    {
      id: "road-c-macro",
      front: "Why does `square!(2 + 1)` give 9 with `$x:expr`?",
      back: "Macro fragments are syntax-tree nodes, so the expression stays grouped.",
    },
  ],
};

export const concurrencyBanks: SegmentBank[] = [concurrency, sharedState, roadAhead];
