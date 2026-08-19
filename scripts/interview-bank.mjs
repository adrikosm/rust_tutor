// Original algorithm-practice bank for the interview track.
//
// Every problem here is authored locally: scenario, wording, worked examples,
// graded cases, hint ladder, reference solution, and complexity claim. Nothing
// is copied from LeetCode or any other prompt bank — see
// docs/contributing/leetcode-non-copying-policy.md. Similarity at the level of
// the underlying algorithm pattern is expected and allowed; expression is not.
//
// Shape:
//   patternGuides[kind]  — pattern-level teaching material shared by variants
//   patternVariants[kind] — the distinct problems for that pattern
//
// A variant owns its own cases, so a prompt can never drift from what is
// graded: the worked examples in the rendered prompt ARE the visible and
// hidden assertions.

/** Pattern-level depth: recognition, invariant, cost model, idiomatic Rust. */
export const patternGuides = {
  "arrays-hash-maps": {
    invariant:
      "One pass, and a map or set that answers 'have I seen this, and how often?' in expected O(1).",
    cues: [
      "The prompt says distinct, duplicate, frequency, pair, or anagram.",
      "A brute-force answer is an O(n²) double loop over the same slice.",
      "You need to remember something about earlier elements while scanning later ones.",
    ],
    derivation:
      "Each element is inserted and looked up a constant number of times, so the scan is O(n) expected; the map holds at most one entry per distinct element, so space is O(n). Hashing is amortized, not worst case — an adversarial key distribution degrades lookups.",
    idiomatic: [
      "`HashSet::insert` returns `false` when the value was already present, so membership and insertion are one call.",
      "`*counts.entry(key).or_insert(0) += 1` is the frequency idiom; `or_default()` works for any `Default` value.",
      "Iterate with `.iter().enumerate()` when you need the index — indexing in a loop fights the borrow checker for no gain.",
    ],
    pitfalls: [
      "Borrowing the map immutably while trying to insert into it in the same expression.",
      "Assuming HashMap iteration order is stable — it is deliberately randomized.",
      "Reaching for a HashMap when the key space is a small dense integer range and a `Vec` would be faster.",
    ],
    followUps: [
      "What changes if the values do not fit in memory and you may only make one streaming pass?",
      "When is a `BTreeMap` the better choice despite its O(log n) lookups?",
    ],
  },
  "two-pointers-sliding-window": {
    invariant:
      "Two indices move monotonically and never revisit ground, so the total work is linear even though the window resizes.",
    cues: [
      "The data is sorted, or sorting it does not destroy the answer.",
      "You want a contiguous run, a pair, or a longest/shortest span.",
      "The brute force re-examines the same subarray repeatedly.",
    ],
    derivation:
      "Each pointer advances at most n times across the whole run, so the traversal is O(n) even with an inner `while`. Sorting first, when required, dominates at O(n log n).",
    idiomatic: [
      "`slice::sort_unstable` is faster than `sort` and fine when equal elements are interchangeable.",
      "`windows(k)` gives fixed-size windows without manual index arithmetic.",
      "Prefer `usize` arithmetic that cannot underflow — `r - l` panics in debug builds when `r < l`.",
    ],
    pitfalls: [
      "Advancing both pointers on the same iteration and skipping a valid pair.",
      "Recomputing the window sum from scratch instead of adding the entering and subtracting the leaving element.",
      "Off-by-one on the half-open window `[l, r)`; pick one convention and hold it.",
    ],
    followUps: [
      "How does the shrink condition change from 'at most k distinct' to 'exactly k distinct'?",
      "Which of these problems break when negative numbers are allowed?",
    ],
  },
  "stacks-queues": {
    invariant:
      "A stack remembers the most recent unresolved obligation; a queue remembers the oldest one. Choose by which end the answer resolves.",
    cues: [
      "Nesting, matching, undo, or 'most recent' language in the prompt.",
      "You are parsing postfix/prefix input, or collapsing adjacent items.",
      "The answer for element i depends on the nearest element to one side.",
    ],
    derivation:
      "Every element is pushed at most once and popped at most once, so even a nested `while let Some(..) = stack.pop()` keeps the whole scan amortized O(n). Space is the worst-case stack depth, O(n).",
    idiomatic: [
      "`Vec<T>` is the stack — `push`/`pop`/`last`; `VecDeque<T>` is the queue — `push_back`/`pop_front`.",
      "`matches!(stack.pop(), Some('('))` reads better than a nested match for a single shape.",
      "Iterating `chars()` gives Unicode scalars, not bytes; use `bytes()` only when the input is known ASCII.",
    ],
    pitfalls: [
      "Forgetting the final emptiness check — a balanced prefix is not a balanced string.",
      "Popping an empty stack and unwrapping the `None`.",
      "Holding `stack.last_mut()` across another mutation of the same stack.",
    ],
    followUps: [
      "How would you report the index of the first mismatch instead of a boolean?",
      "What does a monotonic stack buy you over rescanning to the right?",
    ],
  },
  "binary-search": {
    invariant:
      "A candidate range that always contains the answer, halved each step. The hard part is the predicate, not the arithmetic.",
    cues: [
      "The input is sorted, or the answer is monotone in some parameter.",
      "The prompt asks for a boundary: first, last, insertion point, minimum feasible value.",
      "A linear scan is correct but the bound must be logarithmic.",
    ],
    derivation:
      "The range length halves each iteration, so it reaches one after ⌈log₂ n⌉ steps: O(log n) comparisons and O(1) extra space. Parsing the input into a `Vec` still costs O(n) — quote the search bound honestly.",
    idiomatic: [
      "`slice::binary_search` returns `Result<usize, usize>`: `Ok(index)` when found, `Err(insertion_point)` when not. Both halves are useful.",
      "`partition_point(|x| pred(x))` is the clean way to express 'first index where the predicate flips'.",
      "`lo + (hi - lo) / 2` avoids the overflow that `(lo + hi) / 2` invites on large indices.",
    ],
    pitfalls: [
      "Searching data the caller never sorted.",
      "An inclusive `hi` with a `while lo < hi` loop — the two conventions do not mix.",
      "Treating `Err(i)` as failure when it is exactly the insertion point you were asked for.",
    ],
    followUps: [
      "How do you binary-search an answer that is not stored anywhere, like a minimum capacity?",
      "What is the first index where a rotated sorted array wraps, and how do you find it?",
    ],
  },
  "linked-lists": {
    invariant:
      "Only one owner per node. Rewiring a list in Rust is a sequence of `Option::take` moves, not pointer edits.",
    cues: [
      "The prompt talks about nodes, next pointers, reversal, or the k-th from the end.",
      "You are asked to do it in place with O(1) extra space.",
      "The exercise exists to teach ownership as much as the algorithm.",
    ],
    derivation:
      "Each node is visited a constant number of times, so traversal is O(n). `Box<Node>` allocates per node, so space is O(n) — a `Vec` would be one allocation and better cache behavior, which is the real lesson.",
    idiomatic: [
      "`Option<Box<Node>>` is the safe singly linked list; `node.next.take()` moves the tail out and leaves `None` behind.",
      "`while let Some(mut node) = current { ... current = node.next.take(); }` is the standard walk.",
      "Two pointers separated by k steps find the k-th from the end in one pass.",
    ],
    pitfalls: [
      "Trying to hold two mutable references into the same chain — the borrow checker is right to refuse.",
      "Writing a recursive drop for a long list and overflowing the stack.",
      "Cloning nodes to dodge ownership, quietly turning O(1) rewiring into O(n) copying.",
    ],
    followUps: [
      "Why does a doubly linked list need `Rc<RefCell<..>>` or raw pointers, and what does that cost?",
      "When is `Vec<T>` simply the correct answer to a 'linked list' problem?",
    ],
  },
  "trees-bst": {
    invariant:
      "A tree problem is a recurrence on children. In a level-order array the children of index i live at 2i+1 and 2i+2.",
    cues: [
      "Depth, leaves, traversal order, ancestor, or subtree language.",
      "The input is given level order with explicit null holes.",
      "The answer at a node is a fold over the answers at its children.",
    ],
    derivation:
      "Each node is visited once: O(n) time. Recursive traversal costs O(h) stack, which is O(log n) when balanced and O(n) in the degenerate chain — that difference is the whole point of balancing.",
    idiomatic: [
      "Index arithmetic on a level-order `Vec` avoids `Rc<RefCell<..>>` entirely for read-only problems.",
      "`Option<Box<Node>>` children keep a real tree ownable by one parent.",
      "An explicit `Vec` stack turns a recursive traversal into an iterative one when depth is untrusted.",
    ],
    pitfalls: [
      "Counting null placeholders as nodes.",
      "Assuming the array is complete — trailing children may simply be absent, not null.",
      "Checking only `left < node < right` locally instead of carrying down a valid range when validating a BST.",
    ],
    followUps: [
      "Which traversal produces sorted output for a BST, and why?",
      "How does an inorder traversal change if duplicates are allowed?",
    ],
  },
  heaps: {
    invariant:
      "Keep only the k candidates that can still matter. A heap of size k gives O(log k) access to the one most likely to be evicted.",
    cues: [
      "'Top k', 'k smallest', 'kth largest', or a merge across many sorted sources.",
      "A full sort would be correct but does more work than the question needs.",
      "The stream is longer than the answer.",
    ],
    derivation:
      "n pushes and pops on a heap bounded at k is O(n log k) time and O(k) space, strictly better than O(n log n) sorting when k ≪ n. For k close to n, just sort.",
    idiomatic: [
      "`BinaryHeap` is a max-heap; wrap items in `std::cmp::Reverse` to get min-heap behavior.",
      "For k smallest, keep a max-heap of size k and pop whenever it overflows — the largest survivor leaves first.",
      "`into_sorted_vec()` drains the heap in ascending order in one call.",
    ],
    pitfalls: [
      "Reversing the comparator and silently keeping the wrong end of the data.",
      "Letting the heap grow to n when the bound k was the entire point.",
      "Assuming `BinaryHeap` iteration is ordered — only draining is.",
    ],
    followUps: [
      "How does quickselect compare, and when is its O(n) average worth the worst case?",
      "What changes if items arrive as a stream you cannot re-read?",
    ],
  },
  "intervals-greedy": {
    invariant:
      "Sort by the field the greedy choice consumes — start for merging, end for packing the most intervals — then make one irrevocable local decision per item.",
    cues: [
      "Pairs of (start, end): meetings, reservations, ranges, bookings.",
      "You are asked to merge, count overlaps, or fit the maximum number.",
      "A local rule provably cannot rule out the global optimum.",
    ],
    derivation:
      "The sort dominates at O(n log n); the sweep afterwards is O(n) with O(n) output. The greedy is correct only because an exchange argument shows the earliest-finishing choice never loses.",
    idiomatic: [
      "`sort_unstable_by_key(|(start, _)| *start)` states the ordering key directly.",
      "`last_mut()` on the output vector lets you extend the running interval in place.",
      "A +1/−1 delta sweep over sorted boundaries counts concurrency without materializing intervals.",
    ],
    pitfalls: [
      "Sorting by start when the problem needed end (or the reverse) — both compile, one is wrong.",
      "Not deciding whether touching intervals `[1,2]` and `[2,3]` overlap; pick and document it.",
      "Mutating the vector you are iterating over.",
    ],
    followUps: [
      "Prove the earliest-end rule with an exchange argument.",
      "Which of these problems become dynamic programming when intervals carry weights?",
    ],
  },
  backtracking: {
    invariant: "Choose, recurse, undo. The state after the undo must be byte-identical to before.",
    cues: [
      "Enumerate all permutations, subsets, arrangements, or valid boards.",
      "The answer count grows factorially or exponentially and no formula collapses it.",
      "Partial candidates can be rejected early.",
    ],
    derivation:
      "The search tree has O(n!) leaves for permutations and O(2ⁿ) for subsets; pruning changes the constant and often the practical shape, never the worst case. Recursion depth — and therefore stack — is O(n).",
    idiomatic: [
      "Pass `&mut Vec<T>` for the working path and push/pop around the recursive call.",
      "A `Vec<bool>` used-set is faster than a `HashSet` for small dense domains.",
      "Return counts through `&mut u64` rather than allocating a result vector you immediately fold.",
    ],
    pitfalls: [
      "Forgetting the undo, so later branches inherit dirty state.",
      "Cloning the whole path at every node instead of only at accepted leaves.",
      "Recursing without an input bound and blowing the stack on hostile input.",
    ],
    followUps: [
      "Which prune cuts the most branches earliest here?",
      "When does memoizing turn this search into dynamic programming?",
    ],
  },
  "graphs-union-find-topological": {
    invariant:
      "Build an adjacency structure first, then pick the traversal the question implies: BFS for fewest hops, DFS for reachability and cycles, Kahn for ordering, union-find for connectivity only.",
    cues: [
      "Nodes and edges, dependencies, reachability, components, or ordering constraints.",
      "The prompt asks 'can I get there', 'how many groups', or 'in what order'.",
      "Cycles would make a naive recursion loop forever.",
    ],
    derivation:
      "Every vertex is dequeued once and every edge is examined once from each endpoint: O(V + E) time and O(V + E) space for the adjacency list plus the visited set. Union-find with path compression is effectively O(α(n)) per operation.",
    idiomatic: [
      "`HashMap<usize, Vec<usize>>` for sparse ids; `Vec<Vec<usize>>` when ids are dense 0..n.",
      "`VecDeque` is the BFS frontier; mark visited on enqueue, not on dequeue, or you will enqueue duplicates.",
      "`HashSet::insert` doubles as the visited check.",
    ],
    pitfalls: [
      "Adding only one direction of an undirected edge.",
      "Marking visited at dequeue time and revisiting nodes.",
      "Assuming the graph is connected when the input never promised it.",
    ],
    followUps: [
      "How does Kahn's algorithm detect a cycle without a separate DFS?",
      "When is union-find strictly better than BFS for connectivity?",
    ],
  },
  "dynamic-programming": {
    invariant:
      "Define the state so the answer at i depends only on strictly smaller states, then decide whether you need the whole table or just a rolling window.",
    cues: [
      "Count the ways, find the minimum cost, or find the best subsequence.",
      "The naive recursion recomputes the same arguments.",
      "Greedy gives a counterexample.",
    ],
    derivation:
      "Cost is (number of states) × (work per transition). A one-dimensional recurrence with O(1) transitions is O(n) time; keeping only the last few states drops space from O(n) to O(1). Two-sequence tables are O(n·m).",
    idiomatic: [
      "`(a, b) = (b, a + b)` rolls a two-state recurrence with no temporary.",
      "`vec![usize::MAX; n + 1]` plus a saturating check models 'unreachable' without `Option` noise.",
      "Prefer bottom-up iteration to memoized recursion when the state order is obvious — no stack depth risk.",
    ],
    pitfalls: [
      "Getting the base case wrong: the empty input usually has exactly one way, not zero.",
      "Integer overflow on counting problems — reach for `u128` or a modulus deliberately.",
      "Iterating the table in an order that reads a state before it is written.",
    ],
    followUps: [
      "Which of these need the full table because the path must be reconstructed?",
      "Where does the O(1)-space rewrite stop being possible?",
    ],
  },
  "bit-math": {
    invariant:
      "Treat the integer as a fixed-width array of bits. Masking, shifting, and XOR replace loops and extra storage.",
    cues: [
      "Powers of two, parity, flags, or 'find the unpaired value'.",
      "The constraints hint at constant space with no auxiliary structure.",
      "The straightforward answer counts something a single instruction already computes.",
    ],
    derivation:
      "Operations on a machine word are O(1) regardless of magnitude, so these run in constant time and space; a whole-input XOR fold is O(n) time and O(1) space.",
    idiomatic: [
      "`count_ones`, `leading_zeros`, `trailing_zeros`, and `is_power_of_two` are on the integer types already.",
      "`x & (x - 1)` clears the lowest set bit; `x & x.wrapping_neg()` isolates it.",
      "`checked_`, `wrapping_`, and `saturating_` say exactly which overflow behavior you meant — debug builds panic on plain arithmetic overflow.",
    ],
    pitfalls: [
      "Shifting by at least the bit width, which is a panic in debug builds.",
      "Sign extension surprises when mixing `i64` and `u64`.",
      "Treating zero as a power of two.",
    ],
    followUps: [
      "How would you find the two unpaired values instead of one?",
      "What does the compiler emit for `count_ones` on a target without a popcount instruction?",
    ],
  },
};

const v = (variant) => variant;

/** Distinct problems per pattern. Items cycle through this list. */
export const patternVariants = {
  "arrays-hash-maps": [
    v({
      slug: "distinct",
      action: "Count distinct readings",
      tier: "easy",
      problem: "Count how many **distinct** integer readings the record contains.",
      input:
        "A single line of whitespace-separated integers. Tokens that do not parse as integers are ignored. The line may be empty.",
      output: "The count of distinct integer values, as a decimal string.",
      cases: [
        ["1 2 2 3", "3"],
        ["", "0"],
      ],
      notes: [
        "four tokens, but `2` repeats, so three distinct values: {1, 2, 3}.",
        "no tokens means zero distinct values.",
      ],
      edge: [false, true],
      complexity: "O(n) expected time and O(n) space",
      approach: "Scan each value once while a HashSet records membership.",
      hintPattern:
        "You only need membership, never counts — that is a set, not a map. `HashSet::insert` reports whether the value was new.",
      hintImpl:
        "`input.split_whitespace().filter_map(|token| token.parse::<i64>().ok()).collect::<HashSet<_>>().len()` is the whole computation.",
      mistakes: [
        "Sorting first and comparing neighbours, paying O(n log n) for an O(n) question.",
        "Counting tokens rather than parsed values, so junk tokens inflate the answer.",
      ],
      tradeoff:
        "A `HashSet` costs an allocation and hashing per element; for a small fixed value range a bitset or array would be faster but far less general.",
      solution: `use std::collections::HashSet;

pub fn solve(input: &str) -> String {
    let seen: HashSet<i64> = input
        .split_whitespace()
        .filter_map(|token| token.parse().ok())
        .collect();
    seen.len().to_string()
}`,
    }),
    v({
      slug: "first-repeat",
      action: "Report the first repeated reading",
      tier: "easy",
      problem:
        "Report the **first value that repeats** — the earliest token whose value already appeared before it.",
      input: "A single line of whitespace-separated integers. Unparsable tokens are ignored.",
      output: "The repeated value as a decimal string, or `none` when every value is unique.",
      cases: [
        ["4 1 2 1 4", "1"],
        ["3 2 1", "none"],
      ],
      notes: [
        "`1` at position 3 is the first token whose value was already seen; `4` also repeats but later.",
        "no value ever repeats, so the answer is `none`.",
      ],
      edge: [false, true],
      complexity: "O(n) expected time and O(n) space",
      approach: "Scan left to right and stop at the first value the set already contains.",
      hintPattern:
        "'First' means you must stop mid-scan — a frequency table built over the whole input loses the ordering you need.",
      hintImpl:
        "`if !seen.insert(value) { return value.to_string(); }` — `insert` returns `false` when the value was already present.",
      mistakes: [
        "Counting frequencies first and then reporting the smallest repeated value instead of the earliest.",
        "Returning the first value that has a duplicate anywhere, rather than the first *second* occurrence.",
      ],
      tradeoff:
        "Early return means the set never grows past the prefix scanned, but the worst case still holds every distinct value.",
      solution: `use std::collections::HashSet;

pub fn solve(input: &str) -> String {
    let mut seen = HashSet::new();
    for value in input.split_whitespace().filter_map(|t| t.parse::<i64>().ok()) {
        if !seen.insert(value) {
            return value.to_string();
        }
    }
    "none".to_string()
}`,
    }),
    v({
      slug: "mode",
      action: "Find the dominant reading",
      tier: "medium",
      problem:
        "Find the **most frequent** value. When several values tie for the highest count, report the smallest of them.",
      input: "A single line of whitespace-separated integers. Unparsable tokens are ignored.",
      output: "The winning value as a decimal string, or `none` for an empty record.",
      cases: [
        ["5 3 5 3 7", "3"],
        ["", "none"],
      ],
      notes: [
        "`5` and `3` both appear twice; the tie breaks toward the smaller value, `3`.",
        "an empty record has no dominant value.",
      ],
      edge: [false, true],
      complexity: "O(n) expected time and O(n) space",
      approach:
        "Build a frequency map in one pass, then fold it into the best (count, value) pair with an explicit tie rule.",
      hintPattern:
        "Two passes, not one: you cannot know the maximum count until every value is tallied.",
      hintImpl:
        "`*counts.entry(value).or_insert(0) += 1`, then pick with `max_by_key(|(value, count)| (*count, std::cmp::Reverse(*value)))` so ties prefer the smaller value.",
      mistakes: [
        "Leaving the tie unresolved and depending on HashMap iteration order, which is randomized per run.",
        "Tracking only the running maximum while inserting, which is wrong when a later value overtakes an earlier one.",
      ],
      tradeoff:
        "A `BTreeMap` would make the tie rule fall out of iteration order for free, at O(log n) per update instead of O(1) expected.",
      solution: `use std::cmp::Reverse;
use std::collections::HashMap;

pub fn solve(input: &str) -> String {
    let mut counts: HashMap<i64, usize> = HashMap::new();
    for value in input.split_whitespace().filter_map(|t| t.parse::<i64>().ok()) {
        *counts.entry(value).or_insert(0) += 1;
    }
    match counts
        .into_iter()
        .max_by_key(|&(value, count)| (count, Reverse(value)))
    {
        Some((value, _)) => value.to_string(),
        None => "none".to_string(),
    }
}`,
    }),
    v({
      slug: "pair-index",
      action: "Locate a complementary pair",
      tier: "medium",
      problem:
        "The first integer is a **target**. Among the remaining values, find two different positions whose values sum to it, preferring the pair whose second position is earliest.",
      input:
        "Whitespace-separated integers: the first is the target, the rest are the pool. Unparsable tokens are ignored.",
      output:
        "The two zero-based pool indices, smaller first, separated by a space — or `-1` when no pair exists.",
      cases: [
        ["9 2 7 4", "0 1"],
        ["20 2 7 4", "-1"],
      ],
      notes: [
        "target 9; pool [2, 7, 4] — positions 0 and 1 hold 2 + 7 = 9.",
        "no pair in [2, 7, 4] reaches 20.",
      ],
      edge: [false, false],
      complexity: "O(n) expected time and O(n) space",
      approach:
        "Store value → index as you scan, and at each element look up the complement you still need.",
      hintPattern:
        "Sorting would find *a* pair but destroys the original indices the answer is expressed in — so the map, not two pointers.",
      hintImpl:
        "For each `(index, value)`, check `seen.get(&(target - value))` before inserting `value → index`; that ordering also prevents pairing an element with itself.",
      mistakes: [
        "Inserting before looking up, so a value at index i pairs with itself when 2·value == target.",
        "Reporting values instead of indices.",
        "Overflowing on `target - value` for extreme inputs instead of using `checked_sub`.",
      ],
      tradeoff:
        "The map buys O(n) at the cost of O(n) memory; a sort plus two pointers is O(n log n) but O(1) extra and would need an index side-table here.",
      solution: `use std::collections::HashMap;

pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let Some(target) = numbers.next() else {
        return "-1".to_string();
    };
    let mut seen: HashMap<i64, usize> = HashMap::new();
    for (index, value) in numbers.enumerate() {
        if let Some(complement) = target.checked_sub(value) {
            if let Some(&earlier) = seen.get(&complement) {
                return format!("{earlier} {index}");
            }
        }
        seen.entry(value).or_insert(index);
    }
    "-1".to_string()
}`,
    }),
  ],

  "two-pointers-sliding-window": [
    v({
      slug: "target-pair",
      action: "Find a target pair",
      tier: "easy",
      problem:
        "The first integer is a **target**; the rest are values. Report whether some **two distinct** values sum to the target.",
      input:
        "Whitespace-separated integers: the first is the target, the remaining are the pool of values. Non-integer tokens are ignored.",
      output: "`true` if two different positions in the pool sum to the target, otherwise `false`.",
      cases: [
        ["9 2 7 4", "true"],
        ["20 2 7 4", "false"],
      ],
      notes: [
        "target 9; the pool [2, 7, 4] contains 2 + 7 = 9.",
        "target 20; no pair in [2, 7, 4] reaches 20.",
      ],
      edge: [false, false],
      complexity: "O(n log n) time and O(n) parsed storage",
      approach:
        "Sort the values, then move two indices according to how their sum compares with the target.",
      hintPattern:
        "Once sorted, the sum is monotone in each pointer: too small means the left must rise, too large means the right must fall.",
      hintImpl:
        "`match (values[l] + values[r]).cmp(&target)` with `Less => l += 1`, `Greater => r -= 1`, `Equal => return true`.",
      mistakes: [
        "Moving both pointers on a mismatch and stepping over the answer.",
        "Allowing `l == r`, which pairs an element with itself.",
      ],
      tradeoff:
        "A HashSet solves this in O(n) but needs O(n) memory and loses the sorted order that neighbouring questions reuse.",
      solution: `use std::cmp::Ordering;

pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let target = numbers.next().unwrap_or(0);
    let mut values: Vec<i64> = numbers.collect();
    values.sort_unstable();
    if values.len() < 2 {
        return "false".to_string();
    }
    let (mut left, mut right) = (0usize, values.len() - 1);
    while left < right {
        match (values[left] + values[right]).cmp(&target) {
            Ordering::Equal => return "true".to_string(),
            Ordering::Less => left += 1,
            Ordering::Greater => right -= 1,
        }
    }
    "false".to_string()
}`,
    }),
    v({
      slug: "longest-distinct",
      action: "Measure the longest clean run",
      tier: "medium",
      problem:
        "Measure the length of the **longest contiguous run of characters with no repeats**.",
      input: "A single line of characters. The line may be empty.",
      output: "The length of the longest repeat-free run, as a decimal string.",
      cases: [
        ["abcabcbb", "3"],
        ["", "0"],
      ],
      notes: [
        "`abc` is repeat-free at length 3; every window of 4 repeats a character.",
        "an empty line has no run.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(k) space for k distinct characters",
      approach:
        "Grow the window on the right and, on a repeat, jump the left edge past the previous occurrence.",
      hintPattern:
        "The window only ever moves right. Storing the last index of each character lets the left edge jump instead of crawl.",
      hintImpl:
        "Keep `last: HashMap<char, usize>`; on a hit with `previous >= left`, set `left = previous + 1`, then record `last[ch] = index` and track `index + 1 - left`.",
      mistakes: [
        "Moving the left edge backwards when the repeat sits before the current window.",
        "Clearing the whole map on a repeat, which quietly makes the scan quadratic.",
      ],
      tradeoff:
        "A fixed `[usize; 128]` table is faster for ASCII but wrong for arbitrary Unicode input.",
      solution: `use std::collections::HashMap;

pub fn solve(input: &str) -> String {
    let mut last: HashMap<char, usize> = HashMap::new();
    let (mut left, mut best) = (0usize, 0usize);
    for (index, ch) in input.chars().enumerate() {
        if let Some(&previous) = last.get(&ch) {
            if previous >= left {
                left = previous + 1;
            }
        }
        last.insert(ch, index);
        best = best.max(index + 1 - left);
    }
    best.to_string()
}`,
    }),
    v({
      slug: "window-sum",
      action: "Peak a fixed window",
      tier: "easy",
      problem:
        "The first integer is a **window width** k; the rest are readings. Report the largest sum of any k consecutive readings.",
      input:
        "Whitespace-separated integers: the first is k, the remaining are the readings. Unparsable tokens are ignored.",
      output: "The maximum window sum, or `0` when k is not positive or exceeds the reading count.",
      cases: [
        ["2 1 5 2 3", "7"],
        ["5 1 2", "0"],
      ],
      notes: [
        "k = 2 over [1, 5, 2, 3]: the windows sum to 6, 7, 5 — the peak is 7.",
        "k = 5 but only two readings exist, so no window fits.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(n) parsed storage",
      approach:
        "Sum the first window once, then slide: add the entering reading and subtract the leaving one.",
      hintPattern:
        "Recomputing each window is O(n·k). Consecutive windows differ by exactly two elements.",
      hintImpl:
        "`readings.windows(k)` is the readable form; the rolling `sum += readings[i] - readings[i - k]` is the one that stays O(n) for large k.",
      mistakes: [
        "Guarding k with a `usize` subtraction that underflows when the input is shorter than k.",
        "Initialising the running best to zero when readings may be negative.",
      ],
      tradeoff:
        "`windows(k)` re-sums each window — clearer, but O(n·k). The rolling sum is the one to defend in an interview.",
      solution: `pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let width = numbers.next().unwrap_or(0);
    let readings: Vec<i64> = numbers.collect();
    if width <= 0 || (width as usize) > readings.len() {
        return "0".to_string();
    }
    let width = width as usize;
    let mut running: i64 = readings[..width].iter().sum();
    let mut best = running;
    for index in width..readings.len() {
        running += readings[index] - readings[index - width];
        best = best.max(running);
    }
    best.to_string()
}`,
    }),
    v({
      slug: "palindrome",
      action: "Verify a mirrored label",
      tier: "easy",
      problem:
        "Decide whether the label reads the same forwards and backwards, **ignoring case and every non-alphanumeric character**.",
      input: "A single line of arbitrary characters. The line may be empty.",
      output: "`true` when the filtered label is a palindrome, otherwise `false`.",
      cases: [
        ["Harbor, ro brah!", "true"],
        ["harbor", "false"],
      ],
      notes: [
        "filtering to `harborrobrah` and lowercasing leaves a mirrored string.",
        "`harbor` reversed is `robrah`, so it is not mirrored.",
      ],
      edge: [false, false],
      complexity: "O(n) time and O(n) filtered storage",
      approach: "Filter and normalise once, then walk one pointer from each end toward the middle.",
      hintPattern:
        "Do the normalisation before the comparison; interleaving 'skip junk' with 'compare ends' is where these solutions get their bugs.",
      hintImpl:
        "Collect `filter(char::is_alphanumeric).flat_map(char::to_lowercase)` into a `Vec<char>`, then compare `chars[l]` with `chars[r]`.",
      mistakes: [
        "Indexing a `&str` by byte offset and splitting a multi-byte character.",
        "Comparing with `to_ascii_lowercase` on non-ASCII input.",
      ],
      tradeoff:
        "Collecting into a `Vec<char>` costs O(n) memory; a double-ended iterator over the filtered stream avoids it at the cost of readability.",
      solution: `pub fn solve(input: &str) -> String {
    let chars: Vec<char> = input
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect();
    if chars.len() < 2 {
        return "true".to_string();
    }
    let (mut left, mut right) = (0usize, chars.len() - 1);
    while left < right {
        if chars[left] != chars[right] {
            return "false".to_string();
        }
        left += 1;
        right -= 1;
    }
    "true".to_string()
}`,
    }),
  ],

  "stacks-queues": [
    v({
      slug: "brackets",
      action: "Validate nested signals",
      tier: "easy",
      problem:
        "Validate that the bracket characters `()`, `[]`, and `{}` are correctly **nested and balanced**. All other characters are ignored.",
      input:
        "A single line that may contain the six bracket characters interleaved with any other characters.",
      output:
        "`true` if every opening bracket is closed by the matching kind in the correct order, otherwise `false`.",
      cases: [
        ["([]{})", "true"],
        ["([)]", "false"],
      ],
      notes: [
        "every bracket closes the most recent unmatched opener of its own kind.",
        "the `)` tries to close a `[`, so the nesting is crossed.",
      ],
      edge: [false, false],
      complexity: "O(n) time and O(n) space",
      approach:
        "Push opening delimiters and require each closing delimiter to match the most recent opener.",
      hintPattern:
        "Nesting is last-in-first-out by definition, so the structure is a stack and nothing else.",
      hintImpl:
        "On a closer, `stack.pop()` and reject unless the pair matches; after the scan, the answer is `stack.is_empty()`.",
      mistakes: [
        "Returning `true` as soon as the scan ends without checking for unclosed openers.",
        "Counting brackets instead of matching them, so `)(` passes.",
      ],
      tradeoff:
        "Counting per kind is O(1) space but cannot detect crossing; the stack is the only correct structure here.",
      solution: `pub fn solve(input: &str) -> String {
    let mut stack: Vec<char> = Vec::new();
    for ch in input.chars().filter(|c| "()[]{}".contains(*c)) {
        if "([{".contains(ch) {
            stack.push(ch);
        } else {
            let matched = matches!(
                (stack.pop(), ch),
                (Some('('), ')') | (Some('['), ']') | (Some('{'), '}')
            );
            if !matched {
                return "false".to_string();
            }
        }
    }
    stack.is_empty().to_string()
}`,
    }),
    v({
      slug: "postfix",
      action: "Evaluate a postfix record",
      tier: "medium",
      problem:
        "Evaluate a **postfix (reverse Polish)** expression over the operators `+`, `-`, and `*`.",
      input:
        "Whitespace-separated tokens: integers and the operators `+`, `-`, `*`. Operators pop the two most recent values, with the earlier-pushed value on the left.",
      output: "The resulting integer, or `invalid` when the expression is malformed.",
      cases: [
        ["3 4 + 2 *", "14"],
        ["3 +", "invalid"],
      ],
      notes: [
        "`3 4 +` leaves 7 on the stack, then `2 *` yields 14.",
        "`+` needs two operands but only one is available.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(n) space",
      approach:
        "Push operands; on an operator pop exactly two values, apply, and push the result back.",
      hintPattern:
        "Postfix needs no precedence rules — the token order already encodes the tree, which is why a stack alone suffices.",
      hintImpl:
        '`let (Some(right), Some(left)) = (stack.pop(), stack.pop()) else { return "invalid".into() };` — note the pop order reverses the operands.',
      mistakes: [
        "Applying the operands in pop order, which breaks subtraction.",
        "Accepting a final stack with more than one value left.",
        "Overflowing on `*` instead of using `checked_mul`.",
      ],
      tradeoff:
        "Rejecting malformed input with a sentinel string keeps the exercise signature simple; production code should return `Result` and name the failure.",
      solution: `pub fn solve(input: &str) -> String {
    let mut stack: Vec<i64> = Vec::new();
    for token in input.split_whitespace() {
        if let Ok(value) = token.parse::<i64>() {
            stack.push(value);
            continue;
        }
        let (Some(right), Some(left)) = (stack.pop(), stack.pop()) else {
            return "invalid".to_string();
        };
        let result = match token {
            "+" => left.checked_add(right),
            "-" => left.checked_sub(right),
            "*" => left.checked_mul(right),
            _ => None,
        };
        match result {
            Some(value) => stack.push(value),
            None => return "invalid".to_string(),
        }
    }
    match stack.as_slice() {
        [only] => only.to_string(),
        _ => "invalid".to_string(),
    }
}`,
    }),
    v({
      slug: "collapse",
      action: "Collapse adjacent duplicates",
      tier: "medium",
      problem:
        "Repeatedly remove **pairs of equal adjacent characters** until no such pair remains, and report what survives.",
      input: "A single line of characters.",
      output: "The collapsed line. An empty result is reported as an empty line.",
      cases: [
        ["abbaca", "ca"],
        ["aa", ""],
      ],
      notes: [
        "`bb` cancels leaving `aaca`, then `aa` cancels leaving `ca`.",
        "the only pair cancels and nothing survives.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(n) space",
      approach:
        "Push each character unless it equals the top of the stack, in which case pop instead.",
      hintPattern:
        "A cancellation exposes a new adjacency to its left — exactly the element a stack already has at hand.",
      hintImpl: "`if stack.last() == Some(&ch) { stack.pop(); } else { stack.push(ch); }`",
      mistakes: [
        "Rescanning the string after each removal, which is O(n²).",
        "Comparing `stack.last()` (an `Option<&char>`) against a bare `char` and fighting the type error instead of reading it.",
      ],
      tradeoff:
        "The stack doubles as the output buffer, so there is no second allocation — at the cost of only supporting a left-to-right rule.",
      solution: `pub fn solve(input: &str) -> String {
    let mut stack: Vec<char> = Vec::new();
    for ch in input.chars() {
        if stack.last() == Some(&ch) {
            stack.pop();
        } else {
            stack.push(ch);
        }
    }
    stack.into_iter().collect()
}`,
    }),
    v({
      slug: "next-greater",
      action: "Chart the next stronger signal",
      tier: "hard",
      problem:
        "For each reading, report the **first strictly larger reading to its right**, or `-1` when none exists.",
      input: "A single line of whitespace-separated integers. Unparsable tokens are ignored.",
      output: "One answer per reading, in the original order, space-separated.",
      cases: [
        ["2 1 3", "3 3 -1"],
        ["", ""],
      ],
      notes: [
        "2 and 1 are both answered by the 3 at the end, which has nothing larger after it.",
        "no readings means no answers.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(n) space",
      approach:
        "Keep a stack of indices whose answer is still unknown, popping every index the current reading resolves.",
      hintPattern:
        "This is a monotonic stack: the pending indices always hold non-increasing values, so one new reading can settle a whole run of them at once.",
      hintImpl:
        "`while let Some(&top) = pending.last() { if values[top] < value { answers[top] = value; pending.pop(); } else { break } }` then push the current index.",
      mistakes: [
        "Using `<=` and answering equal values, which the prompt calls strictly larger.",
        "Calling it O(n²) because of the inner loop — each index is pushed and popped exactly once.",
        "Leaving the still-pending indices unset instead of `-1`.",
      ],
      tradeoff:
        "The stack costs O(n) memory to turn the obvious O(n²) rescan into a single pass; for tiny inputs the rescan is genuinely faster.",
      solution: `pub fn solve(input: &str) -> String {
    let values: Vec<i64> = input
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    let mut answers = vec![-1i64; values.len()];
    let mut pending: Vec<usize> = Vec::new();
    for (index, &value) in values.iter().enumerate() {
        while let Some(&top) = pending.last() {
            if values[top] < value {
                answers[top] = value;
                pending.pop();
            } else {
                break;
            }
        }
        pending.push(index);
    }
    answers
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(" ")
}`,
    }),
  ],

  "binary-search": [
    v({
      slug: "locate",
      action: "Locate a sorted checkpoint",
      tier: "easy",
      problem:
        "The first integer is a **target**; the remaining integers form an **already-sorted** ascending array. Report the target's index in that array.",
      input:
        "Whitespace-separated integers: the first is the target, the rest are the sorted array (ascending). Non-integer tokens are ignored.",
      output: "The zero-based index of the target within the array, or `-1` if it is absent.",
      cases: [
        ["7 1 4 7 9", "2"],
        ["8 1 4 7 9", "-1"],
      ],
      notes: [
        "target 7; the array [1, 4, 7, 9] holds 7 at index 2.",
        "target 8 is not present in [1, 4, 7, 9].",
      ],
      edge: [false, false],
      complexity: "O(log n) search over O(n) parsed storage",
      approach:
        "Maintain a half-open candidate range and discard the half that cannot contain the target.",
      hintPattern:
        "Sortedness is the whole licence to halve. State the invariant: if the target exists, it is inside the current range.",
      hintImpl:
        "`values.binary_search(&target)` gives `Ok(index)` or `Err(insertion_point)`; map `Err` to `-1` here.",
      mistakes: [
        "Reporting `Err(i)` as a found index.",
        "Assuming the caller sorted the array when they did not.",
      ],
      tradeoff:
        "Parsing is O(n) regardless, so the logarithmic bound only pays off across repeated searches on the same array.",
      solution: `pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let target = numbers.next().unwrap_or(0);
    let values: Vec<i64> = numbers.collect();
    match values.binary_search(&target) {
        Ok(index) => index.to_string(),
        Err(_) => "-1".to_string(),
    }
}`,
    }),
    v({
      slug: "insertion-point",
      action: "Place an incoming checkpoint",
      tier: "easy",
      problem:
        "The first integer is a **target**; the rest form an ascending array. Report the index where the target belongs so the array stays sorted — the first position holding a value **not less than** the target.",
      input: "Whitespace-separated integers: target first, then the ascending array.",
      output: "The zero-based insertion index, as a decimal string.",
      cases: [
        ["8 1 4 7 9", "3"],
        ["0 1 4", "0"],
      ],
      notes: [
        "1, 4 and 7 are below 8, so 8 belongs at index 3, ahead of 9.",
        "the target is below everything, so it belongs at the front.",
      ],
      edge: [false, true],
      complexity: "O(log n) search over O(n) parsed storage",
      approach: "Binary-search the boundary where the predicate `value < target` stops holding.",
      hintPattern:
        "This is the lower bound, not a search for equality. Describe it as 'how many values are strictly below the target'.",
      hintImpl: "`values.partition_point(|&value| value < target)` is exactly that count.",
      mistakes: [
        "Using `<=` and landing after an equal run when the prompt asked for the first not-less position.",
        "Returning `-1` on absence — every target has an insertion point, including past the end.",
      ],
      tradeoff:
        "`partition_point` states the predicate rather than the arithmetic, which is why it is far harder to get off by one than a hand-rolled loop.",
      solution: `pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let target = numbers.next().unwrap_or(0);
    let values: Vec<i64> = numbers.collect();
    values.partition_point(|&value| value < target).to_string()
}`,
    }),
    v({
      slug: "integer-root",
      action: "Bound a quadratic capacity",
      tier: "medium",
      problem:
        "Report the **integer square root** of a non-negative reading: the largest whole number whose square does not exceed it.",
      input: "A single non-negative integer. Unparsable input is treated as zero.",
      output: "The integer square root, as a decimal string.",
      cases: [
        ["17", "4"],
        ["0", "0"],
      ],
      notes: ["4² = 16 ≤ 17 while 5² = 25 exceeds it.", "zero is its own square root."],
      edge: [false, true],
      complexity: "O(log n) time and O(1) space",
      approach:
        "Binary-search the answer itself: the predicate `candidate² ≤ n` is monotone, so its boundary is the root.",
      hintPattern:
        "Nothing is stored to search. The searched space is the range of possible answers — this is 'binary search on the answer'.",
      hintImpl:
        "Search `0..=n` with `while low < high { let mid = low + (high - low).div_ceil(2); ... }` — the upward bias is what stops the loop spinning.",
      mistakes: [
        "Overflowing on `mid * mid` — compare `mid <= n / mid` instead, or widen to `u128`.",
        "A midpoint biased downward with a lower-bound update, which loops forever.",
        "Trusting `(n as f64).sqrt()` at the edges of the integer range.",
      ],
      tradeoff:
        "Newton's method converges faster but needs care about the stopping condition; the binary search is obviously correct and fast enough.",
      solution: `pub fn solve(input: &str) -> String {
    let n: u64 = input.trim().parse().unwrap_or(0);
    if n < 2 {
        return n.to_string();
    }
    let (mut low, mut high) = (1u64, n);
    while low < high {
        let mid = low + (high - low).div_ceil(2);
        if mid <= n / mid {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    low.to_string()
}`,
    }),
    v({
      slug: "occurrences",
      action: "Count a repeated checkpoint",
      tier: "medium",
      problem:
        "The first integer is a **target**; the rest form an ascending array that may repeat values. Report how many times the target occurs.",
      input: "Whitespace-separated integers: target first, then the ascending array.",
      output: "The occurrence count, as a decimal string.",
      cases: [
        ["4 1 4 4 9", "2"],
        ["5 1 4 4 9", "0"],
      ],
      notes: ["4 occupies indices 1 and 2 of [1, 4, 4, 9].", "5 never appears."],
      edge: [false, true],
      complexity: "O(log n) search over O(n) parsed storage",
      approach:
        "Find the first index not below the target and the first index above it; the count is the gap.",
      hintPattern:
        "Two boundaries, one subtraction. Equal elements form a contiguous block in sorted data, so its ends are what you search for.",
      hintImpl:
        "`partition_point(|&x| x < target)` and `partition_point(|&x| x <= target)`; subtract the first from the second.",
      mistakes: [
        "Finding one occurrence and then scanning outward linearly, which is O(n) on a long run.",
        "Swapping the two predicates and getting a negative-then-panicking subtraction.",
      ],
      tradeoff:
        "Two searches double the comparisons but stay logarithmic; a single search plus expansion is faster only when runs are short.",
      solution: `pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let target = numbers.next().unwrap_or(0);
    let values: Vec<i64> = numbers.collect();
    let first = values.partition_point(|&value| value < target);
    let past = values.partition_point(|&value| value <= target);
    (past - first).to_string()
}`,
    }),
  ],

  "linked-lists": [
    v({
      slug: "reverse",
      action: "Reverse a linked route",
      tier: "easy",
      problem: "Read the values as a singly linked list in order, then return them **reversed**.",
      input:
        "Whitespace-separated integers giving the list from head to tail. Non-integer tokens are ignored; the line may be empty.",
      output: "The values in reversed order, space-separated on one line.",
      cases: [
        ["1 2 3", "3 2 1"],
        ["5", "5"],
      ],
      notes: ["head-to-tail 1→2→3 reverses to 3→2→1.", "a single node reverses to itself."],
      edge: [false, false],
      complexity: "O(n) time and O(n) space",
      approach: "Move each value into a singly linked list, then reverse links one node at a time.",
      hintPattern:
        "Pushing onto the front of a new list reverses order as you build — no second pass needed.",
      hintImpl:
        "`head = Some(Box::new(Node { value, next: head }))` moves the old head into the new node's tail in one step.",
      mistakes: [
        "Trying to hold references to both the previous and next node at once.",
        "Recursing over a long list and overflowing the stack.",
      ],
      tradeoff:
        "`Box` per node is one allocation each — a `Vec` reversed in place would be far faster, and knowing that is part of the exercise.",
      solution: `struct Node {
    value: i64,
    next: Option<Box<Node>>,
}

pub fn solve(input: &str) -> String {
    let mut head: Option<Box<Node>> = None;
    for value in input.split_whitespace().filter_map(|t| t.parse().ok()) {
        head = Some(Box::new(Node { value, next: head }));
    }
    let mut out = Vec::new();
    while let Some(node) = head {
        out.push(node.value.to_string());
        head = node.next;
    }
    out.join(" ")
}`,
    }),
    v({
      slug: "middle",
      action: "Find the midpoint node",
      tier: "easy",
      problem:
        "Report the value at the **middle node** of the list. With an even number of nodes, report the second of the two middle nodes.",
      input: "Whitespace-separated integers from head to tail. The line may be empty.",
      output: "The middle value, or `none` for an empty list.",
      cases: [
        ["1 2 3 4", "3"],
        ["", "none"],
      ],
      notes: [
        "four nodes have two middles, 2 and 3; the rule picks the second.",
        "an empty list has no middle.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(1) extra state beyond the parsed list",
      approach:
        "Advance a slow pointer one step and a fast pointer two; when the fast pointer runs out, the slow one is at the middle.",
      hintPattern:
        "The tortoise-and-hare split finds the midpoint without ever learning the length — that is what makes it work on a stream.",
      hintImpl:
        "`while fast + 1 < len { slow += 1; fast += 2; }` leaves `slow` on the second middle for even lengths.",
      mistakes: [
        "Computing `len / 2` after a length pass, which is correct but throws away the one-pass property being taught.",
        "Advancing the fast pointer past the end without bounds-checking.",
      ],
      tradeoff:
        "Two passes are simpler to read; the two-pointer version is the one that generalises to lists you cannot re-read.",
      solution: `pub fn solve(input: &str) -> String {
    let values: Vec<i64> = input
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    if values.is_empty() {
        return "none".to_string();
    }
    let (mut slow, mut fast) = (0usize, 0usize);
    while fast + 1 < values.len() {
        slow += 1;
        fast += 2;
    }
    values[slow].to_string()
}`,
    }),
    v({
      slug: "drop-kth",
      action: "Drop the k-th node from the end",
      tier: "medium",
      problem:
        "The first integer is **k**; the rest are list values. Remove the k-th node counted from the end and report what remains. If k does not address a node, change nothing.",
      input: "Whitespace-separated integers: k first, then the list from head to tail.",
      output: "The surviving values in order, space-separated.",
      cases: [
        ["2 1 2 3 4", "1 2 4"],
        ["9 1 2", "1 2"],
      ],
      notes: [
        "the 2nd node from the end of [1, 2, 3, 4] is 3, so it is removed.",
        "k = 9 addresses nothing in a two-node list, so the list is unchanged.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(n) space",
      approach:
        "Open a gap of k between two pointers, then advance both until the leader falls off the end.",
      hintPattern:
        "Counting from the end without knowing the length is exactly what a fixed-width pointer gap buys you.",
      hintImpl:
        "Guard `k >= 1 && k <= len` first, then the index to remove is `len - k`; the two-pointer form computes the same position without the length.",
      mistakes: [
        "Off-by-one between 'k-th from the end' and 'index len − k'.",
        "Underflowing the `usize` subtraction when k exceeds the length.",
      ],
      tradeoff:
        "Materialising a `Vec` makes the removal trivial; on a real linked list the gap technique avoids the second traversal.",
      solution: `pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let k = numbers.next().unwrap_or(0);
    let mut values: Vec<i64> = numbers.collect();
    if k >= 1 && (k as usize) <= values.len() {
        let index = values.len() - k as usize;
        values.remove(index);
    }
    values
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(" ")
}`,
    }),
    v({
      slug: "merge-sorted",
      action: "Splice two sorted routes",
      tier: "medium",
      problem: "Merge two **already-sorted** lists into one sorted sequence, keeping duplicates.",
      input:
        "Two whitespace-separated ascending integer lists separated by `;`. Either side may be empty.",
      output: "The merged ascending values, space-separated.",
      cases: [
        ["1 3 5;2 4", "1 2 3 4 5"],
        ["7;", "7"],
      ],
      notes: [
        "the two runs interleave into a single ascending sequence.",
        "one side is empty, so the other passes through unchanged.",
      ],
      edge: [false, true],
      complexity: "O(n + m) time and O(n + m) space",
      approach:
        "Compare the two heads and move the smaller one across, until one side is exhausted.",
      hintPattern:
        "Never re-sort. Both inputs are already ordered, so a single comparison per output element is enough.",
      hintImpl:
        "Two indices and a `while left < a.len() && right < b.len()` loop, then drain whichever side remains with `extend_from_slice`.",
      mistakes: [
        "Concatenating and calling `sort`, turning O(n + m) into O(n log n) and hiding the point.",
        "Dropping the tail of the longer list after the main loop.",
        "Using `<` and reordering equal values — use `<=` when stability matters.",
      ],
      tradeoff:
        "Building a fresh vector is clearer; merging in place into the larger buffer from the back avoids the extra allocation.",
      solution: `pub fn solve(input: &str) -> String {
    let mut sides = input.split(';');
    let parse = |part: Option<&str>| -> Vec<i64> {
        part.unwrap_or("")
            .split_whitespace()
            .filter_map(|t| t.parse().ok())
            .collect()
    };
    let (left, right) = (parse(sides.next()), parse(sides.next()));
    let (mut i, mut j) = (0usize, 0usize);
    let mut merged = Vec::with_capacity(left.len() + right.len());
    while i < left.len() && j < right.len() {
        if left[i] <= right[j] {
            merged.push(left[i]);
            i += 1;
        } else {
            merged.push(right[j]);
            j += 1;
        }
    }
    merged.extend_from_slice(&left[i..]);
    merged.extend_from_slice(&right[j..]);
    merged
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(" ")
}`,
    }),
  ],

  "trees-bst": [
    v({
      slug: "depth",
      action: "Measure a sparse tree",
      tier: "medium",
      problem:
        "The values are a binary tree in **level order** (breadth-first), where `null` marks an absent node. Report the depth of the deepest present node, counting the root as depth 1.",
      input:
        "Whitespace-separated tokens in level order: integers for present nodes and `null` for holes. The line may be empty.",
      output: "The depth of the deepest present node, as a decimal string.",
      cases: [
        ["1 2 3 4 null 6", "3"],
        ["", "0"],
      ],
      notes: [
        "the deepest present tokens sit on the third level of the level-order layout.",
        "an empty tree has depth 0.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(n) input storage",
      approach: "Traverse non-empty level-order positions and retain the deepest reachable level.",
      hintPattern:
        "In a level-order array, index i sits on level ⌊log₂(i+1)⌋ + 1 — the level boundaries are the powers of two.",
      hintImpl:
        "For each non-null index i, the level is `usize::BITS - (i + 1).leading_zeros()`; keep the maximum.",
      mistakes: [
        "Counting `null` placeholders as nodes.",
        "Returning a zero-based depth when the prompt counts the root as 1.",
      ],
      tradeoff:
        "Index arithmetic avoids building a real tree; a linked structure would be needed if the problem required mutation.",
      solution: `pub fn solve(input: &str) -> String {
    input
        .split_whitespace()
        .enumerate()
        .filter(|(_, token)| *token != "null")
        .map(|(index, _)| usize::BITS - (index + 1).leading_zeros())
        .max()
        .unwrap_or(0)
        .to_string()
}`,
    }),
    v({
      slug: "bst-inorder",
      action: "Order a search tree",
      tier: "medium",
      problem:
        "Insert the values into a **binary search tree** in the order given, ignoring duplicates, then report an **inorder** traversal.",
      input: "Whitespace-separated integers in insertion order. The line may be empty.",
      output: "The inorder values, space-separated.",
      cases: [
        ["5 3 8 1", "1 3 5 8"],
        ["", ""],
      ],
      notes: [
        "inorder on a BST visits left subtree, node, right subtree — which is ascending order.",
        "an empty tree has an empty traversal.",
      ],
      edge: [false, true],
      complexity: "O(n log n) expected time and O(n) space",
      approach:
        "Walk down from the root comparing against each node to find the insertion slot, then traverse left-node-right.",
      hintPattern:
        "Inorder on a BST is sorted by construction. Writing it as a traversal rather than a `sort` is what proves you understand the invariant.",
      hintImpl:
        "Insert with `let mut slot = &mut root; while let Some(node) = slot { slot = if value < node.value { &mut node.left } else { &mut node.right } }` — reborrowing through the `Option` is the trick.",
      mistakes: [
        "Sorting the input and calling it a BST traversal — correct output, wrong lesson.",
        "Recursing on a degenerate ascending input and overflowing the stack.",
        "Inserting duplicates on both sides and breaking the ordering invariant.",
      ],
      tradeoff:
        "An unbalanced BST degrades to O(n) per insert on sorted input; a `BTreeSet` gives the same output with guaranteed balance.",
      solution: `struct Node {
    value: i64,
    left: Option<Box<Node>>,
    right: Option<Box<Node>>,
}

fn insert(slot: &mut Option<Box<Node>>, value: i64) {
    let mut current = slot;
    loop {
        match current {
            None => {
                *current = Some(Box::new(Node { value, left: None, right: None }));
                return;
            }
            Some(node) => {
                if value == node.value {
                    return;
                }
                current = if value < node.value { &mut node.left } else { &mut node.right };
            }
        }
    }
}

fn inorder(node: &Option<Box<Node>>, out: &mut Vec<i64>) {
    let mut stack: Vec<&Node> = Vec::new();
    let mut current = node.as_deref();
    while current.is_some() || !stack.is_empty() {
        while let Some(node) = current {
            stack.push(node);
            current = node.left.as_deref();
        }
        if let Some(node) = stack.pop() {
            out.push(node.value);
            current = node.right.as_deref();
        }
    }
}

pub fn solve(input: &str) -> String {
    let mut root: Option<Box<Node>> = None;
    for value in input.split_whitespace().filter_map(|t| t.parse().ok()) {
        insert(&mut root, value);
    }
    let mut out = Vec::new();
    inorder(&root, &mut out);
    out.iter().map(ToString::to_string).collect::<Vec<_>>().join(" ")
}`,
    }),
    v({
      slug: "leaves",
      action: "Count the leaf sensors",
      tier: "easy",
      problem:
        "The values are a binary tree in **level order** with `null` holes. Count the **leaves** — present nodes with no present child.",
      input: "Whitespace-separated level-order tokens: integers or `null`.",
      output: "The leaf count, as a decimal string.",
      cases: [
        ["1 2 3 null null 6", "2"],
        ["", "0"],
      ],
      notes: [
        "the node at index 1 has two null children and the node at index 5 has no children in range — two leaves.",
        "an empty tree has no leaves.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(n) input storage",
      approach:
        "For each present index, check positions 2i+1 and 2i+2; a node with neither present is a leaf.",
      hintPattern:
        "Absent and `null` mean the same thing here: a child that is past the end of the array is just as missing as one written `null`.",
      hintImpl:
        '`let present = |i: usize| tokens.get(i).is_some_and(|t| *t != "null");` then count indices where neither child is present.',
      mistakes: [
        "Treating an out-of-range child index as present and undercounting.",
        "Counting `null` slots themselves as leaves.",
      ],
      tradeoff:
        "The array form is compact but wastes space on a sparse deep tree, where an explicit node structure would be smaller.",
      solution: `pub fn solve(input: &str) -> String {
    let tokens: Vec<&str> = input.split_whitespace().collect();
    let present = |index: usize| tokens.get(index).is_some_and(|token| *token != "null");
    (0..tokens.len())
        .filter(|&index| present(index) && !present(2 * index + 1) && !present(2 * index + 2))
        .count()
        .to_string()
}`,
    }),
    v({
      slug: "full-nodes",
      action: "Count fully branched nodes",
      tier: "medium",
      problem:
        "Using the same level-order layout, count the nodes that have **both** children present.",
      input: "Whitespace-separated level-order tokens: integers or `null`.",
      output: "The count of nodes with two present children.",
      cases: [
        ["1 2 3 4 5", "2"],
        ["1", "0"],
      ],
      notes: [
        "the root and the node at index 1 each have two present children.",
        "a lone root has no children at all.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(n) input storage",
      approach:
        "Test both child positions for every present index and count the nodes where both hold.",
      hintPattern:
        "Same index arithmetic as the leaf count, opposite predicate — recognising that saves you writing a second traversal.",
      hintImpl: "Count indices where `present(index) && present(2*index+1) && present(2*index+2)`.",
      mistakes: [
        "Reusing the leaf predicate unchanged and counting the complement, which also includes half-branched nodes.",
        "Overflowing `2 * index + 2` on an enormous array — use `checked_mul` if the input is untrusted.",
      ],
      tradeoff:
        "A single pass computing both statistics at once would avoid the second scan when the caller needs both.",
      solution: `pub fn solve(input: &str) -> String {
    let tokens: Vec<&str> = input.split_whitespace().collect();
    let present = |index: usize| tokens.get(index).is_some_and(|token| *token != "null");
    (0..tokens.len())
        .filter(|&index| present(index) && present(2 * index + 1) && present(2 * index + 2))
        .count()
        .to_string()
}`,
    }),
  ],

  heaps: [
    v({
      slug: "k-smallest",
      action: "Keep the smallest priorities",
      tier: "medium",
      problem:
        "The first integer is **k**; the rest are priorities. Report the k smallest priorities in ascending order.",
      input: "Whitespace-separated integers: k first, then the priorities.",
      output:
        "The k smallest priorities ascending, space-separated. Fewer than k available means all of them.",
      cases: [
        ["3 9 1 7 2 8", "1 2 7"],
        ["0 1 2", ""],
      ],
      notes: ["the three smallest of [9, 1, 7, 2, 8] are 1, 2 and 7.", "k = 0 selects nothing."],
      edge: [false, true],
      complexity: "O(n log k) time and O(k) space",
      approach:
        "Maintain a max-heap of size k so the largest retained candidate is replaced first.",
      hintPattern:
        "To keep the *smallest* k you evict the *largest* survivor — so the heap you want is a max-heap, which is the counterintuitive half.",
      hintImpl: "`heap.push(value); if heap.len() > k { heap.pop(); }` then `into_sorted_vec()`.",
      mistakes: [
        "Reaching for `Reverse` and building a min-heap, which evicts exactly the values you meant to keep.",
        "Sorting all n values when k is tiny.",
      ],
      tradeoff:
        "O(n log k) beats a full sort when k ≪ n; once k approaches n, `sort_unstable` and a slice is simpler and faster.",
      solution: `use std::collections::BinaryHeap;

pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let k = numbers.next().unwrap_or(0).max(0) as usize;
    let mut heap = BinaryHeap::new();
    for value in numbers {
        heap.push(value);
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(" ")
}`,
    }),
    v({
      slug: "kth-largest",
      action: "Name the k-th strongest signal",
      tier: "medium",
      problem:
        "The first integer is **k**; the rest are readings. Report the k-th largest reading, counting duplicates as separate readings.",
      input: "Whitespace-separated integers: k first, then the readings.",
      output: "The k-th largest reading, or `none` when fewer than k readings exist.",
      cases: [
        ["2 9 1 7", "7"],
        ["9 1", "none"],
      ],
      notes: [
        "sorted descending, [9, 7, 1] has 7 in second place.",
        "only one reading exists, so there is no ninth largest.",
      ],
      edge: [false, true],
      complexity: "O(n log k) time and O(k) space",
      approach:
        "Keep a min-heap of the k largest readings seen; its root is the answer once the scan ends.",
      hintPattern:
        "Mirror of the previous problem: to keep the largest k you evict the smallest survivor, so wrap values in `Reverse`.",
      hintImpl:
        "`heap.push(Reverse(value)); if heap.len() > k { heap.pop(); }` then read `heap.peek()`, unwrapping the `Reverse`.",
      mistakes: [
        "Deduplicating readings when the prompt counts duplicates.",
        "Reading the heap root before checking it holds exactly k items.",
      ],
      tradeoff:
        "Quickselect averages O(n) but degrades to O(n²) on adversarial pivots; the heap's bound is unconditional.",
      solution: `use std::cmp::Reverse;
use std::collections::BinaryHeap;

pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let k = numbers.next().unwrap_or(0);
    if k < 1 {
        return "none".to_string();
    }
    let k = k as usize;
    let mut heap = BinaryHeap::new();
    for value in numbers {
        heap.push(Reverse(value));
        if heap.len() > k {
            heap.pop();
        }
    }
    if heap.len() < k {
        return "none".to_string();
    }
    match heap.peek() {
        Some(Reverse(value)) => value.to_string(),
        None => "none".to_string(),
    }
}`,
    }),
    v({
      slug: "merge-streams",
      action: "Merge sorted streams",
      tier: "hard",
      problem: "Merge several **already-sorted** ascending streams into one ascending sequence.",
      input:
        "Streams separated by `;`, each a whitespace-separated ascending integer list. Streams may be empty.",
      output: "All values in ascending order, space-separated.",
      cases: [
        ["1 4;2 6;3", "1 2 3 4 6"],
        ["5", "5"],
      ],
      notes: [
        "the three streams interleave into one ascending run.",
        "one stream passes through unchanged.",
      ],
      edge: [false, true],
      complexity: "O(n log k) time for n values across k streams, and O(k) heap space",
      approach:
        "Hold the current head of every stream in a min-heap and repeatedly pop the smallest, refilling from its stream.",
      hintPattern:
        "The heap holds one entry per *stream*, not per value — that is what keeps the extra space at O(k) no matter how long the streams are.",
      hintImpl:
        "Push `Reverse((value, stream_index, position))`; after popping, push that stream's next value if it has one.",
      mistakes: [
        "Concatenating everything and sorting, which is O(n log n) and ignores the existing order.",
        "Forgetting to refill from the stream you just popped, silently dropping values.",
      ],
      tradeoff:
        "Pairwise merging is simpler and also O(n log k) overall, but the heap version streams — it never materialises intermediate results.",
      solution: `use std::cmp::Reverse;
use std::collections::BinaryHeap;

pub fn solve(input: &str) -> String {
    let streams: Vec<Vec<i64>> = input
        .split(';')
        .map(|part| part.split_whitespace().filter_map(|t| t.parse().ok()).collect())
        .collect();
    let mut heap = BinaryHeap::new();
    for (index, stream) in streams.iter().enumerate() {
        if let Some(&first) = stream.first() {
            heap.push(Reverse((first, index, 0usize)));
        }
    }
    let mut merged = Vec::new();
    while let Some(Reverse((value, index, position))) = heap.pop() {
        merged.push(value.to_string());
        if let Some(&next) = streams[index].get(position + 1) {
            heap.push(Reverse((next, index, position + 1)));
        }
    }
    merged.join(" ")
}`,
    }),
    v({
      slug: "top-frequent",
      action: "Rank the busiest codes",
      tier: "hard",
      problem:
        "The first integer is **k**; the rest are event codes. Report the k most frequent codes, most frequent first, breaking ties toward the smaller code.",
      input: "Whitespace-separated integers: k first, then the event codes.",
      output: "The selected codes in ranked order, space-separated.",
      cases: [
        ["2 1 1 2 2 2 3", "2 1"],
        ["1 4", "4"],
      ],
      notes: [
        "code 2 appears three times and code 1 twice, so they rank ahead of code 3.",
        "a single code is trivially the most frequent.",
      ],
      edge: [false, true],
      complexity: "O(n log k) time and O(d) space for d distinct codes",
      approach:
        "Tally frequencies, then run a bounded heap over the distinct codes rather than all events.",
      hintPattern:
        "Two stages with different sizes: the tally is over n events, the selection is only over the d distinct codes.",
      hintImpl:
        "Push `Reverse((count, Reverse(code)))` so the heap evicts the least frequent and, among equals, the larger code.",
      mistakes: [
        "Running the heap over raw events instead of the tally, inflating the work to n log k for no reason.",
        "Leaving the tie rule to HashMap ordering, which makes the output non-deterministic between runs.",
      ],
      tradeoff:
        "Bucket sort by frequency is O(n) when counts are bounded by n; the heap generalises to streaming tallies.",
      solution: `use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let k = numbers.next().unwrap_or(0).max(0) as usize;
    let mut counts: HashMap<i64, usize> = HashMap::new();
    for code in numbers {
        *counts.entry(code).or_insert(0) += 1;
    }
    let mut heap = BinaryHeap::new();
    for (code, count) in counts {
        heap.push(Reverse((count, Reverse(code))));
        if heap.len() > k {
            heap.pop();
        }
    }
    let mut ranked: Vec<(usize, i64)> = heap
        .into_iter()
        .map(|Reverse((count, Reverse(code)))| (count, code))
        .collect();
    ranked.sort_unstable_by_key(|&(count, code)| (Reverse(count), code));
    ranked
        .iter()
        .map(|(_, code)| code.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}`,
    }),
  ],

  "intervals-greedy": [
    v({
      slug: "merge",
      action: "Merge reservation windows",
      tier: "medium",
      problem: "Merge every group of **overlapping or touching** reservation windows.",
      input:
        "Windows separated by `;`, each written as `start end` with whitespace-separated integers.",
      output: "The merged windows in ascending start order, formatted the same way.",
      cases: [
        ["1 3;2 5;8 9", "1 5;8 9"],
        ["2 4", "2 4"],
      ],
      notes: [
        "`1 3` and `2 5` overlap and merge into `1 5`; `8 9` stands alone.",
        "a single window merges with nothing.",
      ],
      edge: [false, true],
      complexity: "O(n log n) time and O(n) space",
      approach: "Sort by start time and extend the last output interval whenever ranges overlap.",
      hintPattern:
        "After sorting by start, any window that overlaps the running one must overlap it *now* — you never need to look further ahead.",
      hintImpl:
        "`if let Some(last) = out.last_mut() { if start <= last.1 { last.1 = last.1.max(end); continue; } }` then push.",
      mistakes: [
        "Forgetting to take the maximum end, which truncates a window fully contained in the previous one.",
        "Sorting by end and merging the wrong neighbours.",
      ],
      tradeoff:
        "Sorting dominates the cost; if the input arrives sorted the merge alone is O(n) and this becomes a streaming operation.",
      solution: `pub fn solve(input: &str) -> String {
    let mut windows: Vec<(i64, i64)> = input
        .split(';')
        .filter_map(|part| {
            let mut numbers = part.split_whitespace().filter_map(|t| t.parse().ok());
            Some((numbers.next()?, numbers.next()?))
        })
        .collect();
    windows.sort_unstable();
    let mut merged: Vec<(i64, i64)> = Vec::new();
    for (start, end) in windows {
        if let Some(last) = merged.last_mut() {
            if start <= last.1 {
                last.1 = last.1.max(end);
                continue;
            }
        }
        merged.push((start, end));
    }
    merged
        .iter()
        .map(|(start, end)| format!("{start} {end}"))
        .collect::<Vec<_>>()
        .join(";")
}`,
    }),
    v({
      slug: "max-fit",
      action: "Fit the most bookings",
      tier: "medium",
      problem:
        "Select the largest number of windows that do **not** overlap. Windows that merely touch — one ending exactly where the next begins — may both be selected.",
      input: "Windows separated by `;`, each written as `start end`.",
      output: "The size of the largest non-overlapping selection.",
      cases: [
        ["1 3;2 5;8 9", "2"],
        ["", "0"],
      ],
      notes: [
        "taking `1 3` and `8 9` fits two; adding `2 5` would clash with `1 3`.",
        "no windows means nothing to select.",
      ],
      edge: [false, true],
      complexity: "O(n log n) time and O(n) space",
      approach:
        "Sort by end time and take every window that begins no earlier than the last one taken finished.",
      hintPattern:
        "Sort by **end**, not start. Finishing earliest leaves the most room for everything after it — that is the exchange argument.",
      hintImpl: "`if start >= last_end { taken += 1; last_end = end; }` over the end-sorted list.",
      mistakes: [
        "Sorting by start, or by duration, both of which are plausible and both wrong.",
        "Using `>` and rejecting windows that merely touch.",
      ],
      tradeoff:
        "The greedy is optimal only for unweighted intervals; add weights and this becomes a dynamic program over sorted ends.",
      solution: `pub fn solve(input: &str) -> String {
    let mut windows: Vec<(i64, i64)> = input
        .split(';')
        .filter_map(|part| {
            let mut numbers = part.split_whitespace().filter_map(|t| t.parse().ok());
            Some((numbers.next()?, numbers.next()?))
        })
        .collect();
    windows.sort_unstable_by_key(|&(_, end)| end);
    let mut taken = 0usize;
    let mut last_end = i64::MIN;
    for (start, end) in windows {
        if start >= last_end {
            taken += 1;
            last_end = end;
        }
    }
    taken.to_string()
}`,
    }),
    v({
      slug: "rooms",
      action: "Size the room pool",
      tier: "hard",
      problem:
        "Report the smallest number of rooms that can host every booking. A booking ending exactly when another begins may reuse the same room.",
      input: "Windows separated by `;`, each written as `start end`.",
      output: "The minimum number of concurrent rooms required.",
      cases: [
        ["1 5;2 3;4 6", "2"],
        ["1 2;2 3", "1"],
      ],
      notes: [
        "at time 2 the first two bookings overlap, and at time 4 the first and third do — never three at once.",
        "the second booking starts exactly when the first ends, so one room suffices.",
      ],
      edge: [false, true],
      complexity: "O(n log n) time and O(n) space",
      approach:
        "Sweep the sorted boundaries, adding one on each start and releasing one on each end, and record the peak.",
      hintPattern:
        "The answer is the maximum concurrency, and concurrency only changes at a boundary — so sweep the boundaries, not the timeline.",
      hintImpl:
        "Build `(time, delta)` events with `delta = +1` for starts and `-1` for ends, sort with ends before starts at equal times, then track the running maximum.",
      mistakes: [
        "Ordering a start before an end at the same instant, which invents a room that is not needed.",
        "Counting total overlapping pairs instead of the peak concurrency.",
      ],
      tradeoff:
        "A min-heap of end times models the rooms literally and is easier to extend to room attributes; the delta sweep is leaner.",
      solution: `pub fn solve(input: &str) -> String {
    let mut events: Vec<(i64, i32)> = Vec::new();
    for part in input.split(';') {
        let mut numbers = part.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
        if let (Some(start), Some(end)) = (numbers.next(), numbers.next()) {
            events.push((start, 1));
            events.push((end, -1));
        }
    }
    events.sort_unstable_by_key(|&(time, delta)| (time, delta));
    let (mut active, mut peak) = (0i32, 0i32);
    for (_, delta) in events {
        active += delta;
        peak = peak.max(active);
    }
    peak.to_string()
}`,
    }),
    v({
      slug: "coverage",
      action: "Total the covered time",
      tier: "medium",
      problem:
        "Report the total length of time covered by at least one window, counting overlapped time only once.",
      input: "Windows separated by `;`, each written as `start end`.",
      output: "The total covered length, as a decimal string.",
      cases: [
        ["1 3;2 5;8 9", "5"],
        ["", "0"],
      ],
      notes: [
        "`1 3` and `2 5` together cover `1 5`, four units, plus one more from `8 9`.",
        "no windows cover nothing.",
      ],
      edge: [false, true],
      complexity: "O(n log n) time and O(n) space",
      approach:
        "Sort by start, track the furthest point already covered, and add only the new tail of each window.",
      hintPattern:
        "You are merging, but you never need the merged windows themselves — only how much each one adds beyond what is already covered.",
      hintImpl:
        "`let from = start.max(covered_to); if end > from { total += end - from; } covered_to = covered_to.max(end);`",
      mistakes: [
        "Summing every window length and double-counting the overlaps.",
        "Ignoring windows fully contained in an earlier one, which must add zero, not their own length.",
      ],
      tradeoff:
        "Accumulating during the sweep avoids materialising the merged list — the same trick as merge, one allocation lighter.",
      solution: `pub fn solve(input: &str) -> String {
    let mut windows: Vec<(i64, i64)> = input
        .split(';')
        .filter_map(|part| {
            let mut numbers = part.split_whitespace().filter_map(|t| t.parse().ok());
            Some((numbers.next()?, numbers.next()?))
        })
        .collect();
    windows.sort_unstable();
    let (mut total, mut covered_to) = (0i64, i64::MIN);
    for (start, end) in windows {
        let from = start.max(covered_to);
        if end > from {
            total += end - from;
        }
        covered_to = covered_to.max(end);
    }
    total.max(0).to_string()
}`,
    }),
  ],

  backtracking: [
    v({
      slug: "orders",
      action: "Enumerate assignment orders",
      tier: "medium",
      problem:
        "Count the distinct orders in which **n** distinguishable tasks can be assigned. Inputs above 10 are clamped to 10.",
      input: "A single non-negative integer n.",
      output: "The number of distinct orders, as a decimal string.",
      cases: [
        ["3", "6"],
        ["0", "1"],
      ],
      notes: [
        "three tasks admit 3! = 6 orders.",
        "zero tasks admit exactly one order: the empty one.",
      ],
      edge: [false, true],
      complexity: "O(n!) time and O(n) search depth",
      approach:
        "Choose one unused option, recurse, and undo the choice before exploring the next branch.",
      hintPattern:
        "The count has a closed form, but the exercise is the search skeleton — build the tree so the harder variants reuse it.",
      hintImpl:
        "`used[i] = true; visit(..); used[i] = false;` — the undo is what makes the next sibling branch correct.",
      mistakes: [
        "Skipping the undo, so later branches see a partially consumed set.",
        "Recursing without clamping n and hanging on a large input.",
      ],
      tradeoff:
        "An explicit search is exponentially slower than the factorial formula, but it is the only version that survives added constraints.",
      solution: `fn visit(n: usize, used: &mut [bool], count: &mut u64) {
    if used.iter().all(|slot| *slot) {
        *count += 1;
        return;
    }
    for index in 0..n {
        if !used[index] {
            used[index] = true;
            visit(n, used, count);
            used[index] = false;
        }
    }
}

pub fn solve(input: &str) -> String {
    let n: usize = input.trim().parse().unwrap_or(0).min(10);
    let mut count = 0;
    visit(n, &mut vec![false; n], &mut count);
    count.to_string()
}`,
    }),
    v({
      slug: "subset-sum",
      action: "Count qualifying subsets",
      tier: "medium",
      problem:
        "The first integer is a **target**; the rest are item weights. Count the subsets whose weights sum exactly to the target. Positions are distinct even when weights repeat.",
      input: "Whitespace-separated integers: target first, then up to 16 weights.",
      output: "The number of qualifying subsets.",
      cases: [
        ["5 1 2 3 4", "2"],
        ["0", "1"],
      ],
      notes: [
        "{1, 4} and {2, 3} both reach 5.",
        "with no items, the empty subset already sums to the target 0.",
      ],
      edge: [false, true],
      complexity: "O(2ⁿ) time and O(n) search depth",
      approach:
        "At each item, branch on taking it or skipping it, carrying the remaining target down.",
      hintPattern:
        "Two branches per item, not one loop — 'include or exclude' is the subset skeleton, distinct from the permutation one.",
      hintImpl:
        "`count(index + 1, remaining - weights[index]) + count(index + 1, remaining)` with the base case `index == weights.len()` returning `remaining == 0`.",
      mistakes: [
        "Returning zero for the empty subset when the target is zero.",
        "Pruning on `remaining < 0` when weights may be negative, which discards valid branches.",
      ],
      tradeoff:
        "For non-negative weights and a small target this collapses to an O(n·target) dynamic program; the search stays correct for negative weights.",
      solution: `fn count(weights: &[i64], index: usize, remaining: i64) -> u64 {
    if index == weights.len() {
        return u64::from(remaining == 0);
    }
    count(weights, index + 1, remaining - weights[index]) + count(weights, index + 1, remaining)
}

pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let target = numbers.next().unwrap_or(0);
    let weights: Vec<i64> = numbers.take(16).collect();
    count(&weights, 0, target).to_string()
}`,
    }),
    v({
      slug: "arrangements",
      action: "List every arrangement",
      tier: "hard",
      problem:
        "List **every distinct arrangement** of the label's characters in ascending order. Labels longer than six characters are truncated to six.",
      input: "A single line of characters.",
      output: "The arrangements, ascending, joined by commas.",
      cases: [
        ["abc", "abc,acb,bac,bca,cab,cba"],
        ["a", "a"],
      ],
      notes: [
        "the six arrangements of three distinct characters, listed in ascending order.",
        "a one-character label has a single arrangement.",
      ],
      edge: [false, true],
      complexity: "O(n! · n) time and O(n! · n) output space",
      approach:
        "Sort the characters, then recurse over unused positions, skipping a repeated character at the same depth.",
      hintPattern:
        "Sorting first is what makes the output ordered *and* makes duplicate suppression a local check against the previous character.",
      hintImpl:
        "Inside the loop: `if index > 0 && chars[index] == chars[index - 1] && !used[index - 1] { continue; }`",
      mistakes: [
        "Deduplicating with a HashSet afterwards, which wastes the work and loses the ordering.",
        "Cloning the whole path at every node instead of only at complete leaves.",
      ],
      tradeoff:
        "Producing the full list costs factorial memory; a generator yielding one arrangement at a time keeps space at O(n).",
      solution: `fn visit(chars: &[char], used: &mut Vec<bool>, path: &mut Vec<char>, out: &mut Vec<String>) {
    if path.len() == chars.len() {
        out.push(path.iter().collect());
        return;
    }
    for index in 0..chars.len() {
        if used[index] {
            continue;
        }
        if index > 0 && chars[index] == chars[index - 1] && !used[index - 1] {
            continue;
        }
        used[index] = true;
        path.push(chars[index]);
        visit(chars, used, path, out);
        path.pop();
        used[index] = false;
    }
}

pub fn solve(input: &str) -> String {
    let mut chars: Vec<char> = input.trim().chars().take(6).collect();
    chars.sort_unstable();
    if chars.is_empty() {
        return String::new();
    }
    let mut used = vec![false; chars.len()];
    let mut path = Vec::new();
    let mut out = Vec::new();
    visit(&chars, &mut used, &mut path, &mut out);
    out.join(",")
}`,
    }),
    v({
      slug: "queens",
      action: "Place non-attacking guards",
      tier: "hard",
      problem:
        "Count the ways to place **n** guards on an n×n grid so that no two share a row, column, or diagonal. Inputs above 8 are clamped to 8.",
      input: "A single non-negative integer n.",
      output: "The number of valid placements.",
      cases: [
        ["4", "2"],
        ["1", "1"],
      ],
      notes: [
        "a 4×4 grid admits exactly two non-attacking placements.",
        "a single guard on a 1×1 grid attacks nothing.",
      ],
      edge: [false, true],
      complexity: "O(n!) worst case, cut heavily by pruning; O(n) search depth",
      approach:
        "Place one guard per row and reject a column or diagonal that is already claimed before recursing.",
      hintPattern:
        "One guard per row is a constraint you can build in rather than check — that alone removes most of the search tree.",
      hintImpl:
        "Track claimed columns, `row + col` diagonals and `row - col + n` anti-diagonals as three boolean vectors.",
      mistakes: [
        "Validating a full board at the leaf instead of pruning at each placement.",
        "Getting the anti-diagonal index negative — offset it by n before indexing.",
      ],
      tradeoff:
        "Bitmask columns and diagonals run far faster than boolean vectors; the vectors are chosen here because the invariant stays readable.",
      solution: `fn place(n: usize, row: usize, cols: &mut Vec<bool>, diag: &mut Vec<bool>, anti: &mut Vec<bool>) -> u64 {
    if row == n {
        return 1;
    }
    let mut total = 0;
    for col in 0..n {
        let d = row + col;
        let a = row + n - col;
        if cols[col] || diag[d] || anti[a] {
            continue;
        }
        cols[col] = true;
        diag[d] = true;
        anti[a] = true;
        total += place(n, row + 1, cols, diag, anti);
        cols[col] = false;
        diag[d] = false;
        anti[a] = false;
    }
    total
}

pub fn solve(input: &str) -> String {
    let n: usize = input.trim().parse().unwrap_or(0).min(8);
    if n == 0 {
        return "0".to_string();
    }
    let mut cols = vec![false; n];
    let mut diag = vec![false; 2 * n];
    let mut anti = vec![false; 2 * n + 1];
    place(n, 0, &mut cols, &mut diag, &mut anti).to_string()
}`,
    }),
  ],

  "graphs-union-find-topological": [
    v({
      slug: "reachable",
      action: "Trace service reachability",
      tier: "medium",
      problem: "Decide whether one service can reach another across **undirected** links.",
      input:
        "`n source target;edges` where the header is three whitespace-separated integers and the edge list is comma-separated `a-b` pairs.",
      output: "`true` when the target is reachable from the source, otherwise `false`.",
      cases: [
        ["4 0 3;0-1,1-3", "true"],
        ["4 0 3;0-1,2-3", "false"],
      ],
      notes: [
        "0→1→3 connects the endpoints.",
        "the two links form separate components, so 3 is unreachable from 0.",
      ],
      edge: [false, false],
      complexity: "O(V + E) time and O(V + E) space",
      approach: "Build adjacency lists and use breadth-first search with a visited set.",
      hintPattern:
        "Reachability does not care about distance, so any traversal works — but the visited set is not optional, or a cycle loops forever.",
      hintImpl:
        "Insert into `visited` when you enqueue, not when you dequeue, so a node cannot enter the frontier twice.",
      mistakes: [
        "Adding only `a → b` for an undirected edge.",
        "Checking the target only at enqueue time and missing the source itself.",
      ],
      tradeoff:
        "Union-find answers repeated connectivity queries in near-constant time after one build; BFS is better when you also want the path.",
      solution: `use std::collections::{HashMap, HashSet, VecDeque};

pub fn solve(input: &str) -> String {
    let mut parts = input.split(';');
    let header: Vec<usize> = parts
        .next()
        .unwrap_or("")
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    if header.len() < 3 {
        return "false".to_string();
    }
    let (source, target) = (header[1], header[2]);
    let mut graph: HashMap<usize, Vec<usize>> = HashMap::new();
    for edge in parts.next().unwrap_or("").split(',') {
        let mut ends = edge.split('-').filter_map(|t| t.parse().ok());
        if let (Some(a), Some(b)) = (ends.next(), ends.next()) {
            graph.entry(a).or_default().push(b);
            graph.entry(b).or_default().push(a);
        }
    }
    let mut frontier = VecDeque::from([source]);
    let mut visited = HashSet::from([source]);
    while let Some(node) = frontier.pop_front() {
        if node == target {
            return "true".to_string();
        }
        for &next in graph.get(&node).into_iter().flatten() {
            if visited.insert(next) {
                frontier.push_back(next);
            }
        }
    }
    "false".to_string()
}`,
    }),
    v({
      slug: "components",
      action: "Count isolated clusters",
      tier: "medium",
      problem:
        "Count the **connected components** across services numbered `0..n`, including services with no links at all.",
      input: "`n;edges` — the service count, then comma-separated undirected `a-b` pairs.",
      output: "The number of connected components.",
      cases: [
        ["5;0-1,3-4", "3"],
        ["3;", "3"],
      ],
      notes: [
        "{0,1}, {2} and {3,4} are three clusters.",
        "with no links every service is its own cluster.",
      ],
      edge: [false, true],
      complexity: "O(V + E · α(V)) time and O(V) space",
      approach:
        "Union the endpoints of every edge, then count the distinct roots across all services.",
      hintPattern:
        "Union-find is the tool when you only ever ask 'same group?' — no traversal order, no adjacency list, no queue.",
      hintImpl:
        "`fn find(parent: &mut [usize], x: usize) -> usize` with path compression; union by assigning `parent[find(a)] = find(b)`.",
      mistakes: [
        "Counting only the services that appear in edges and losing the isolated ones.",
        "Skipping path compression and degrading to O(n) per query on a long chain.",
      ],
      tradeoff:
        "Union-find cannot enumerate a component's members without a second pass; BFS gives you the members for free.",
      solution: `fn find(parent: &mut [usize], node: usize) -> usize {
    let mut root = node;
    while parent[root] != root {
        root = parent[root];
    }
    let mut current = node;
    while parent[current] != root {
        let next = parent[current];
        parent[current] = root;
        current = next;
    }
    root
}

pub fn solve(input: &str) -> String {
    let mut parts = input.split(';');
    let n: usize = parts.next().unwrap_or("").trim().parse().unwrap_or(0);
    let mut parent: Vec<usize> = (0..n).collect();
    for edge in parts.next().unwrap_or("").split(',') {
        let mut ends = edge.split('-').filter_map(|t| t.parse::<usize>().ok());
        if let (Some(a), Some(b)) = (ends.next(), ends.next()) {
            if a < n && b < n {
                let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
                parent[ra] = rb;
            }
        }
    }
    (0..n)
        .filter(|&node| find(&mut parent, node) == node)
        .count()
        .to_string()
}`,
    }),
    v({
      slug: "hops",
      action: "Count the fewest hops",
      tier: "medium",
      problem: "Report the **fewest links** on any path between two services.",
      input: "`n source target;edges` with comma-separated undirected `a-b` pairs.",
      output: "The hop count, or `-1` when no path exists.",
      cases: [
        ["4 0 3;0-1,1-3", "2"],
        ["4 0 3;0-1", "-1"],
      ],
      notes: ["0→1→3 uses two links.", "no chain of links reaches 3."],
      edge: [false, true],
      complexity: "O(V + E) time and O(V + E) space",
      approach:
        "Breadth-first search from the source, recording the distance as each node is first reached.",
      hintPattern:
        "BFS specifically, not DFS: on an unweighted graph the first time BFS reaches a node is provably along a shortest path.",
      hintImpl:
        "Enqueue `(node, distance)` pairs and mark visited on enqueue — `HashSet::insert` returning `true` is both the check and the mark.",
      mistakes: [
        "Using DFS and reporting the first path found, which is rarely the shortest.",
        "Forgetting that the source is at distance 0, not 1.",
      ],
      tradeoff:
        "BFS is optimal for unit weights only; weighted edges need Dijkstra and a priority queue.",
      solution: `use std::collections::{HashMap, HashSet, VecDeque};

pub fn solve(input: &str) -> String {
    let mut parts = input.split(';');
    let header: Vec<usize> = parts
        .next()
        .unwrap_or("")
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    if header.len() < 3 {
        return "-1".to_string();
    }
    let (source, target) = (header[1], header[2]);
    let mut graph: HashMap<usize, Vec<usize>> = HashMap::new();
    for edge in parts.next().unwrap_or("").split(',') {
        let mut ends = edge.split('-').filter_map(|t| t.parse().ok());
        if let (Some(a), Some(b)) = (ends.next(), ends.next()) {
            graph.entry(a).or_default().push(b);
            graph.entry(b).or_default().push(a);
        }
    }
    let mut visited = HashSet::from([source]);
    let mut frontier = VecDeque::from([(source, 0usize)]);
    while let Some((node, steps)) = frontier.pop_front() {
        if node == target {
            return steps.to_string();
        }
        for &next in graph.get(&node).into_iter().flatten() {
            if visited.insert(next) {
                frontier.push_back((next, steps + 1));
            }
        }
    }
    "-1".to_string()
}`,
    }),
    v({
      slug: "topo-order",
      action: "Order the dependency chain",
      tier: "hard",
      problem:
        "Order services so every dependency comes before the service that needs it. An edge `a-b` means a must precede b. When several services are ready at once, take the smallest id first.",
      input: "`n;edges` — the service count, then comma-separated directed `a-b` pairs.",
      output: "The ordering, space-separated, or `cycle` when no ordering exists.",
      cases: [
        ["4;0-1,0-2,1-3", "0 1 2 3"],
        ["2;0-1,1-0", "cycle"],
      ],
      notes: [
        "0 must lead; 1 and 2 are then both ready, and the smallest-first rule takes 1.",
        "the two services depend on each other, so no ordering exists.",
      ],
      edge: [false, true],
      complexity: "O(V log V + E) time with the smallest-first tiebreak, and O(V + E) space",
      approach:
        "Kahn's algorithm: repeatedly emit a service whose remaining dependency count is zero, decrementing its dependents.",
      hintPattern:
        "Track in-degrees, not visited flags. A node becomes ready exactly when its last incoming edge is removed.",
      hintImpl:
        "Use a `BinaryHeap<Reverse<usize>>` as the ready set to get the smallest-first tiebreak; if the emitted count is below n, a cycle remains.",
      mistakes: [
        "Detecting cycles with a separate DFS when the emitted count already reveals them.",
        "Decrementing the in-degree of a node more than once for a duplicated edge.",
        "Using a plain `Vec` as the ready set and producing a valid but non-deterministic order.",
      ],
      tradeoff:
        "The heap costs the log factor purely for determinism; a `VecDeque` gives a valid order in O(V + E).",
      solution: `use std::cmp::Reverse;
use std::collections::BinaryHeap;

pub fn solve(input: &str) -> String {
    let mut parts = input.split(';');
    let n: usize = parts.next().unwrap_or("").trim().parse().unwrap_or(0);
    let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut indegree = vec![0usize; n];
    for edge in parts.next().unwrap_or("").split(',') {
        let mut ends = edge.split('-').filter_map(|t| t.parse::<usize>().ok());
        if let (Some(a), Some(b)) = (ends.next(), ends.next()) {
            if a < n && b < n {
                adjacency[a].push(b);
                indegree[b] += 1;
            }
        }
    }
    let mut ready: BinaryHeap<Reverse<usize>> = (0..n)
        .filter(|&node| indegree[node] == 0)
        .map(Reverse)
        .collect();
    let mut order = Vec::with_capacity(n);
    while let Some(Reverse(node)) = ready.pop() {
        order.push(node.to_string());
        for next in std::mem::take(&mut adjacency[node]) {
            indegree[next] -= 1;
            if indegree[next] == 0 {
                ready.push(Reverse(next));
            }
        }
    }
    if order.len() < n {
        return "cycle".to_string();
    }
    order.join(" ")
}`,
    }),
  ],

  "dynamic-programming": [
    v({
      slug: "step-plans",
      action: "Count resilient step plans",
      tier: "easy",
      problem: "Count the ways to climb **n** steps taking one or two steps at a time.",
      input: "A single non-negative integer n.",
      output: "The number of distinct plans, as a decimal string.",
      cases: [
        ["4", "5"],
        ["0", "1"],
      ],
      notes: [
        "four steps admit five plans: 1111, 112, 121, 211, 22.",
        "there is exactly one way to climb nothing — the empty plan.",
      ],
      edge: [false, true],
      complexity: "O(n) time and O(1) auxiliary space",
      approach:
        "Store the number of ways to reach the previous two states and roll the recurrence forward.",
      hintPattern:
        "The last move was either one step or two, so ways(n) = ways(n−1) + ways(n−2). Naming the last move is how you find the recurrence.",
      hintImpl: "`(a, b) = (b, a + b)` repeated n times, starting from `(1, 1)`.",
      mistakes: [
        "Setting the base case to zero and shifting the entire sequence.",
        "Overflowing `u64` for large n instead of widening to `u128`.",
      ],
      tradeoff:
        "The full table is unnecessary because nothing reconstructs the path; keeping it would cost O(n) memory for no gain.",
      solution: `pub fn solve(input: &str) -> String {
    let n: u32 = input.trim().parse().unwrap_or(0);
    let (mut a, mut b) = (1u128, 1u128);
    for _ in 0..n {
        (a, b) = (b, a + b);
    }
    a.to_string()
}`,
    }),
    v({
      slug: "coin-change",
      action: "Minimise the parts used",
      tier: "hard",
      problem:
        "The first integer is an **amount**; the rest are part sizes with unlimited supply. Report the fewest parts that sum exactly to the amount.",
      input: "Whitespace-separated integers: the amount, then the available part sizes.",
      output: "The minimum number of parts, or `-1` when the amount cannot be made.",
      cases: [
        ["11 1 2 5", "3"],
        ["3 2", "-1"],
      ],
      notes: [
        "5 + 5 + 1 = 11 uses three parts, and nothing does it in two.",
        "no combination of 2s makes 3.",
      ],
      edge: [false, true],
      complexity: "O(amount × parts) time and O(amount) space",
      approach:
        "Fill a table where best[value] is the fewest parts summing to value, considering every part at each step.",
      hintPattern:
        "Greedy fails here — try amount 6 with parts {1, 3, 4}. That counterexample is the reason this is a table and not a loop.",
      hintImpl:
        "`best[0] = 0`, then for each value and each part with `part <= value`, take `best[value].min(best[value - part] + 1)` when the smaller state is reachable.",
      mistakes: [
        "Taking the largest part first and reporting a suboptimal count.",
        "Adding one to an unreachable sentinel and overflowing it into a fake answer.",
        "Ignoring non-positive part sizes and looping forever.",
      ],
      tradeoff:
        "This bottom-up table is O(amount) memory; for huge amounts with few parts, a BFS over reachable values can prune far more.",
      solution: `pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<i64>().ok());
    let amount = numbers.next().unwrap_or(0);
    if amount < 0 {
        return "-1".to_string();
    }
    let parts: Vec<usize> = numbers.filter(|&p| p > 0).map(|p| p as usize).collect();
    let amount = amount as usize;
    const UNREACHABLE: usize = usize::MAX;
    let mut best = vec![UNREACHABLE; amount + 1];
    best[0] = 0;
    for value in 1..=amount {
        for &part in &parts {
            if part <= value && best[value - part] != UNREACHABLE {
                best[value] = best[value].min(best[value - part] + 1);
            }
        }
    }
    if best[amount] == UNREACHABLE {
        "-1".to_string()
    } else {
        best[amount].to_string()
    }
}`,
    }),
    v({
      slug: "common-subsequence",
      action: "Align two records",
      tier: "hard",
      problem:
        "Report the length of the longest sequence of characters appearing in both records **in the same relative order**, not necessarily adjacently.",
      input: "Two records separated by `;`. Either may be empty.",
      output: "The length of the longest common subsequence.",
      cases: [
        ["abcde;ace", "3"],
        ["abc;", "0"],
      ],
      notes: ["`ace` appears in order inside `abcde`.", "an empty record shares nothing."],
      edge: [false, true],
      complexity: "O(n × m) time and O(min(n, m)) space with a rolling row",
      approach:
        "Fill a table over prefix pairs: equal characters extend the diagonal, otherwise take the better of dropping one character.",
      hintPattern:
        "State is a *pair* of prefix lengths. Once you see that, the transition writes itself from 'do the last characters match?'.",
      hintImpl:
        "`if a[i] == b[j] { previous[j] + 1 } else { current[j].max(previous[j + 1]) }`, keeping only the previous row.",
      mistakes: [
        "Confusing subsequence with substring and requiring adjacency.",
        "Overwriting the diagonal value before reading it when compressing to one row.",
      ],
      tradeoff:
        "The rolling row drops memory to O(m) but makes reconstructing the actual subsequence impossible — keep the full table when you need the alignment.",
      solution: `pub fn solve(input: &str) -> String {
    let mut sides = input.split(';');
    let left: Vec<char> = sides.next().unwrap_or("").trim().chars().collect();
    let right: Vec<char> = sides.next().unwrap_or("").trim().chars().collect();
    let mut previous = vec![0usize; right.len() + 1];
    let mut current = vec![0usize; right.len() + 1];
    for &lhs in &left {
        for (j, &rhs) in right.iter().enumerate() {
            current[j + 1] = if lhs == rhs {
                previous[j] + 1
            } else {
                current[j].max(previous[j + 1])
            };
        }
        std::mem::swap(&mut previous, &mut current);
        current.iter_mut().for_each(|slot| *slot = 0);
    }
    previous[right.len()].to_string()
}`,
    }),
    v({
      slug: "best-run",
      action: "Find the strongest run",
      tier: "medium",
      problem:
        "Report the largest sum of any **contiguous** run of readings. An empty record scores zero.",
      input: "A single line of whitespace-separated integers, possibly negative.",
      output: "The maximum contiguous sum.",
      cases: [
        ["-2 1 -3 4 -1 2 1 -5 4", "6"],
        ["", "0"],
      ],
      notes: ["the run [4, −1, 2, 1] sums to 6, and nothing beats it.", "no readings score zero."],
      edge: [false, true],
      complexity: "O(n) time and O(1) space",
      approach:
        "At each reading decide whether to extend the current run or restart from this reading, tracking the best seen.",
      hintPattern:
        "The state is 'best run ending exactly here'. A prefix with a negative sum can never help what follows — that is the whole insight.",
      hintImpl: "`ending_here = value.max(ending_here + value); best = best.max(ending_here);`",
      mistakes: [
        "Initialising `best` to zero on an all-negative record and reporting 0 instead of the least-negative reading.",
        "Resetting the running sum to zero rather than to the current value.",
      ],
      tradeoff:
        "Tracking indices as well as the sum makes the run reportable at the cost of two more variables; the pure sum is what interviews usually ask for.",
      solution: `pub fn solve(input: &str) -> String {
    let readings: Vec<i64> = input
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    let Some(&first) = readings.first() else {
        return "0".to_string();
    };
    let (mut ending_here, mut best) = (first, first);
    for &value in &readings[1..] {
        ending_here = value.max(ending_here + value);
        best = best.max(ending_here);
    }
    best.to_string()
}`,
    }),
  ],

  "bit-math": [
    v({
      slug: "popcount",
      action: "Audit active feature flags",
      tier: "easy",
      problem: "Count the **set bits** in a non-negative flag word.",
      input: "A single non-negative integer. Unparsable input is treated as zero.",
      output: "The number of one bits.",
      cases: [
        ["11", "3"],
        ["0", "0"],
      ],
      notes: ["11 is `1011` in binary — three set bits.", "zero has no set bits."],
      edge: [false, true],
      complexity: "O(1) time and O(1) space",
      approach: "Use a population count to measure set bits in the input word.",
      hintPattern:
        "This is one machine instruction on most targets. Reach for the intrinsic before writing a shift loop.",
      hintImpl: "`value.count_ones()` on any Rust integer type.",
      mistakes: [
        "Writing a 64-iteration shift loop when a single call exists.",
        "Parsing into a signed type and shifting in sign bits.",
      ],
      tradeoff:
        "`count_ones` compiles to a popcount instruction where available and a portable fallback elsewhere — always the right default.",
      solution: `pub fn solve(input: &str) -> String {
    input
        .trim()
        .parse::<u64>()
        .unwrap_or(0)
        .count_ones()
        .to_string()
}`,
    }),
    v({
      slug: "power-of-two",
      action: "Verify a clean capacity",
      tier: "easy",
      problem: "Decide whether a capacity reading is an exact **power of two**.",
      input: "A single non-negative integer.",
      output: "`true` when the value is a power of two, otherwise `false`.",
      cases: [
        ["16", "true"],
        ["0", "false"],
      ],
      notes: ["16 is 2⁴, a single set bit.", "zero has no set bits, so it is not a power of two."],
      edge: [false, true],
      complexity: "O(1) time and O(1) space",
      approach:
        "A power of two has exactly one set bit, which `x & (x - 1) == 0` detects for non-zero x.",
      hintPattern:
        "Subtracting one flips the lowest set bit and everything below it, so the AND wipes the value out only when there was exactly one bit.",
      hintImpl: "`value != 0 && value & (value - 1) == 0`, or simply `value.is_power_of_two()`.",
      mistakes: [
        "Letting zero through: `0 & (0 - 1)` underflows and panics in debug builds.",
        "Dividing by two in a loop and mishandling odd values.",
      ],
      tradeoff:
        "`is_power_of_two()` says exactly what it means; the bit trick is worth knowing because it generalises to clearing the lowest set bit.",
      solution: `pub fn solve(input: &str) -> String {
    let value: u64 = input.trim().parse().unwrap_or(0);
    (value != 0 && value & (value - 1) == 0).to_string()
}`,
    }),
    v({
      slug: "unpaired",
      action: "Isolate the unpaired code",
      tier: "medium",
      problem: "Every code appears exactly twice except one. Report the unpaired code.",
      input: "Whitespace-separated integers. An empty line reports 0.",
      output: "The value that appears an odd number of times.",
      cases: [
        ["4 1 2 1 2", "4"],
        ["", "0"],
      ],
      notes: ["1 and 2 each cancel out, leaving 4.", "an empty record folds to the identity, 0."],
      edge: [false, true],
      complexity: "O(n) time and O(1) space",
      approach: "XOR every value together; equal values cancel and the unpaired one survives.",
      hintPattern:
        "XOR is its own inverse and is commutative, so pairs annihilate regardless of the order they arrive in.",
      hintImpl: "`input.split_whitespace().filter_map(..).fold(0, |acc, value| acc ^ value)`",
      mistakes: [
        "Building a frequency map, which is correct but O(n) memory when the question wants O(1).",
        "Assuming the input is sorted and comparing neighbours.",
      ],
      tradeoff:
        "The XOR fold cannot say *which* codes were paired; a map answers richer questions at the cost of memory.",
      solution: `pub fn solve(input: &str) -> String {
    input
        .split_whitespace()
        .filter_map(|t| t.parse::<i64>().ok())
        .fold(0i64, |accumulator, value| accumulator ^ value)
        .to_string()
}`,
    }),
    v({
      slug: "gcd",
      action: "Reduce a sampling ratio",
      tier: "medium",
      problem: "Report the **greatest common divisor** of two non-negative readings.",
      input: "Two whitespace-separated non-negative integers.",
      output: "Their greatest common divisor.",
      cases: [
        ["12 18", "6"],
        ["0 5", "5"],
      ],
      notes: [
        "6 divides both 12 and 18, and nothing larger does.",
        "gcd(0, n) is n by definition.",
      ],
      edge: [false, true],
      complexity: "O(log min(a, b)) time and O(1) space",
      approach:
        "Apply the Euclidean algorithm: replace the pair with (b, a mod b) until b reaches zero.",
      hintPattern:
        "Every common divisor of a and b also divides a mod b, so the remainder step preserves the answer while shrinking the numbers fast.",
      hintImpl: "`while b != 0 { (a, b) = (b, a % b); }` then return `a`.",
      mistakes: [
        "Subtracting instead of taking the remainder, which is correct but far slower on lopsided pairs.",
        "Dividing by zero by testing the wrong operand in the loop condition.",
      ],
      tradeoff:
        "The binary GCD avoids division and can be faster on hardware with slow modulo; Euclid's version is shorter and obviously correct.",
      solution: `pub fn solve(input: &str) -> String {
    let mut numbers = input.split_whitespace().filter_map(|t| t.parse::<u64>().ok());
    let (mut a, mut b) = (numbers.next().unwrap_or(0), numbers.next().unwrap_or(0));
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a.to_string()
}`,
    }),
  ],
};
