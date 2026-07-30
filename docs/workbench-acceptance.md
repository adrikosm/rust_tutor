# Workbench end-to-end acceptance slice

The executable acceptance slice covers one original algorithm problem (`EXE-ALG-CATALOG-PROBE-001`) and one cumulative flagship stage (`PRJ-PULSE-00`). Both expose a reviewed starter, plan-before-run gate, local rust-analyzer completion, real Check/Run/Submit actions, structured compiler diagnostics, service-owned current and regression tests, and an evidence-derived unlock.

The algorithm contract returns Rust's exact-index or insertion-position result for a sorted unique catalog. Its submit oracle covers exact/between cases plus empty and boundary regressions, then unlocks `EXE-ALG-FIRST-BREACH-001`. The PULSE stage implements a typed availability/cost SLO policy; its submit oracle covers a valid policy, an invalid basis-point bound, and the zero-budget regression, then unlocks `PRJ-PULSE-01`.

An unlock cannot be posted from a client-declared pass. The service accepts it only when the stable evaluator run belongs to the same item, used the `test` action, reached persisted `completed` state, and contains an `ACCEPTED` final result. The workspace checksum and evaluator run ID are retained in `workbench_completion`; startup/reopen tests prove the unlock survives restart. Hidden test names and bodies remain service-owned and are redacted from learner output.

Automated acceptance exercises the real Cargo path for both items, HTTP SSE completion and cancellation, accepted-run binding, current/prior regression oracles, and database restart recovery. Existing analyzer boundary tests cover the same completion endpoint used by both workbenches, while compiler fixtures cover real error codes and source spans.

The local browser acceptance pass completed both UI paths on 2026-07-19. It observed real rust-analyzer suggestions, a real unclosed-delimiter compiler diagnostic, visible Run output, accepted hidden regressions, stage/problem unlock labels, zero console errors, and both unlocks still present after browser reload.
