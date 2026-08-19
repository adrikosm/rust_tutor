# Content authoring and review

For imported public CodeCrafters stage metadata, follow the separately pinned [license audit](codecrafters-license-audit.md). Only slug, name, difficulty, and order enter the local graph. The typed runtime tutor overlay adds the learning material and explicitly records that upstream instructions, paid help, community solutions, and private testers are absent.

Author against the JSON schemas and the canonical graph/feed IDs. A released lesson needs two-to-four observable objectives, recall before reveal, explanation/key terms, a worked example, realistic misconception, independent practice, three-to-five checks (or a documented exception), sources, version, and technical/editorial/accessibility review. Exercises declare primary and supporting outcomes whose disjoint union equals the outcome list. Answer keys and solutions stay service-owned until an explicit result/reveal state.

Curriculum v2 extends that contract across the complete Book, imported exercise, interview-practice,
and flagship-project paths. The tracked release lives under `content/curriculum-v2/`; its validator
requires 23 Book containers (Introduction, chapters 1–21, and Appendices), 109 byte-verified Book
pages with unique recall checks, 98 pinned Mainmatter units with reviewed protected suites, 48
distinct authored interview contracts, and 27 executable PULSE/QUAY/TESSERA stages. Counts may
never be increased by relabeling the same prompt, tests, or solution. Generated runtime data must
be reproducible from these tracked inputs.

Ordinary lesson/practice APIs are safe projections: remove recall answers, hidden and regression
tests, reference solutions, and locked explanations. The authenticated reveal action records
`full_reveal` support before returning an explanation or reference solution, so assisted work cannot
be mistaken for independent evidence.

Mainmatter source, tests, and solutions stay in the separately attributed CC BY-NC 4.0 pack and
must not enter commercial builds without separate permission. Interview items may store an optional
external URL/title, but all local expression and tests must pass the originality review in
`docs/contributing/leetcode-non-copying-policy.md`.

Run `pnpm content:validate`, `pnpm content:manifest`, and `pnpm all-checks`. The validator reports
stable-ID collisions, graph cycles/dangling edges, missing provenance/licenses/review, unsafe
markup, assessment gaps, duplicate question/explanation or exercise contracts, incomplete source
excerpts, and evaluator drift. Every scored exercise must pass its exact server-owned suite with the
pinned reference and fail it with the starter. Volatile tool/API claims require a pinned primary
source and review date. Untrusted research enters the raw/wiki layers and cannot become a released
recommendation without promotion review.

For a sample, copy the structure—not the identifiers or answers—from `content/ownership-pack`. Project stages add one evolving workspace, a predecessor, visible/unseen/prior-regression groups, grader type, artifact rubric, hints, reset/checkpoint lineage, unlock evidence, and source/license scope.
