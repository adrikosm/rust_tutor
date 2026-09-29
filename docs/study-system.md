# Study system: randomised tests, flashcards, and the open-literature library

`/study` turns each chapter of the from-zero course into a self-testing loop. Everything runs
locally and offline; no LLM generates questions at runtime.

## What the learner gets

| Surface | What it does |
| --- | --- |
| Chapter test | 10 items drawn from that chapter's bank; feedback at the end. |
| Practice mode | Same forms, with elaborative feedback after every answer. |
| Pretest | 4 easier items to attempt *before* reading a chapter. Not scored against the learner. |
| Strand test | 15 items interleaved across every chapter in a strand. |
| Mixed review | 20 items across the whole course, weighted towards chapters with low best scores. |
| Flashcards | Authored atomic cards per chapter, plus a card for every test item the learner missed. |
| Chapter panel | Test, practice, pretest, flashcards, and 4 "go deeper" links at the end of every chapter. |

## Research basis

| Design choice | Evidence |
| --- | --- |
| Questions and cards ask for production (typed output, names, compile/no-compile decisions) | Testing effect: Roediger & Karpicke 2006; Rowland 2014 (meta-analysis). Short-answer beats multiple choice for later retention: Kang, McDermott & Roediger 2007. |
| Expanding intervals 1 · 3 · 7 · 21 · 45 · 90 days | Spacing effect; optimal gap grows with retention interval: Cepeda et al. 2006, 2008. |
| New cards recalled twice before graduating; missed cards return in-session | Successive relearning / retrieval to criterion: Rawson & Dunlosky 2011. |
| Strand, mixed, and daily card sessions interleave chapters | Interleaving: Rohrer & Taylor 2007; Brunmair & Richter 2019 (meta-analysis). |
| Confidence rating before feedback; confident misses listed first; calibration table | Hypercorrection effect: Butterfield & Metcalfe 2001; metacognitive feedback: Butler, Karpicke & Roediger 2008. |
| Every item explains *why*; distractors carry misconception-specific feedback | Elaborative feedback: Butler, Godbole & Marsh 2013. |
| Pretests before reading | Pretesting effect: Richland, Kornell & Kao 2009. |
| Plausible, misconception-based distractors; 3–4 options; no "all/none of the above" | Little, Bjork, Bjork & Angello 2012; Rodriguez 2005. |
| Fresh generated variants and stratified forms | Desirable difficulties / variability of practice: Bjork 1994. |
| Ownership and borrowing items target known sticking points | Brown University Rust Book experiment: Crichton, Gray & Krishnamurthi 2023; Crichton & Krishnamurthi 2024. |

Practice testing and distributed practice are the two techniques rated "high utility" by Dunlosky
et al. (2013).

## How a form is built

`assembleTest` in `apps/web/src/features/study/engine.ts` is deterministic in its seed:

1. About 30% of slots are generated variants from distinct generators (round-robin by chapter).
2. Remaining slots are filled round-robin across strata — topics for a chapter test, chapters for
   strand and mixed tests — first from items not on the previous form, then from anything left.
3. Within a stratum, items are ranked by a random draw plus bonuses for unseen and previously
   missed items and a penalty for items answered correctly twice in a row.
4. Items are ordered by difficulty with jitter and choice options are shuffled.

The form's seed is shown on screen; `?seed=` reproduces any form.

## Authoring questions

Banks live in `apps/web/src/features/study/bank/*.ts`, one `SegmentBank` per course chapter:

- `choice`, `multi`, `output`, `compiles`, and `recall` question kinds (see `types.ts`).
- Any `code` containing `fn main` must compile, unless `codeError` names the rustc error code
  it must produce. `output` items are run and must print exactly `answer`; `panics: true` items
  must panic; `choice` items may declare `expectStdout`.
- Generators (`make(rng)`) must compute their key in TypeScript and produce at least four
  distinct variants in twelve seeds.
- Minimums per chapter: 14 questions over 3+ topics, 2 generators, 8 flashcards.

Run `pnpm content:verify-study-bank` (add `--samples 25` for a deeper generator sweep). It is part
of `pnpm content:validate`.

## Data

Study state is stored in the browser under `rust-tutor:study:v1`, validated on read, and can be
exported, imported, or reset from `/study`. See ADR-019 for why, and for the planned move into
SQLite.

## Reference library

`/library` lists 81 free works — official books, free third-party books and courses, exercise
sets, tools, code worth reading, public datasets (rustc UI tests, error-code sources, the Clippy
lint list, RustSec advisories, crates.io dumps, Rust Quiz sources), ecosystem maps, talks, and
research — with licenses, topic tags, and ten ordered learning paths. Every entry is link-only.
The catalog is maintained in `scripts/reference-library.mjs`; per-chapter companions and learning
paths are in `apps/web/src/data/course-companions.ts`.
