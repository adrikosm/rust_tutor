# Review scheduler policy v1

The scheduler is deterministic and event-derived. Reading or opening a lesson does not create a review. A scored primary-outcome observation creates or updates one review projection.

## Ratings

- **Again:** reopen relearning and schedule a fresh variant in 1 day.
- **Hard:** move to the previous fixed interval band.
- **Good:** advance one band.
- **Easy:** advance at most two bands.

The only interval bands are 1, 3, 7, and 21 days. Ratings describe the learner's review response; they are not themselves mastery evidence. The projection records its model version, reason, source evidence IDs, due day, and interval index. Daily due work is capped and overflow is shown.

Recommendations expose additive reason components (overdue, goal, weak/uncertain outcome, prerequisite centrality, novelty, recency, load, and active-project prerequisite). Recently seen exact items are excluded. Confusable siblings may be interleaved only when their prerequisites are ready. The learner always receives due-review, goal-aligned, and browse/continue choices and may override a recommendation.

## Future FSRS evaluation gate

No FSRS-style model is enabled in v1. Evaluation is earned only after the local event store contains at least 1,000 atomic-item review responses across at least 100 distinct items, with support provenance and stable item versions. A candidate policy must be compared offline against v1 on held-out chronological events, improve calibration or due-load efficiency without reducing retained transfer evidence, remain explainable per recommendation, and leave historical events untouched. Failing any condition keeps v1 active.
