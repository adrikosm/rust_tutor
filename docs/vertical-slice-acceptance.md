# Ownership vertical-slice acceptance

Date: 2026-07-18<br>
Owner authorization: the repository owner explicitly authorized completing approval-gated roadmap work.

## Scripted acceptance run

1. Open the dashboard and answer all five diagnostic items before feedback.
2. Commit the diagnostic and verify a five-of-five result plus a lesson link.
3. Open the lesson and select a proof-view row by its keyboard-equivalent button.
4. Deep-link to `EX-OWNERSHIP-INDEPENDENT-001`.
5. Commit a plan and confidence before compiling.
6. Compile a use-after-move program and verify normalized E0382 feedback.
7. Replace the move with a shared borrow and verify an accepted check.
8. Record compiler support and a reflection; verify stable attempt/evidence identifiers and “why next.”
9. Repeat layout checks at 375×812 and 812×375; inspect browser warnings/errors.

Result: passed in the in-app browser against the real local Rust service. The compact layouts had no horizontal overflow and the browser emitted no warning/error logs.

## Defect log

Product/content friction, not learner errors:

- Same-origin session creation originally required an `Origin` header that browsers omit on ordinary same-origin GET requests. Fixed by accepting `Sec-Fetch-Site: same-origin` when `Origin` is absent while retaining exact-origin rejection.
- The `/practice` parent route rendered its own page instead of its nested exercise route. Fixed by rendering the route outlet for child matches.
- Exercise starters were fragments that could not compile as the service-owned binary crate. Replaced them with complete runnable programs.
- Cargo JSON and host toolchain paths appeared below the structured diagnostic. Machine output is now private for Check/Clippy and home/workspace paths are redacted.

Observed learner errors during the script:

- Used a moved `String`, producing E0382. This was the intended diagnostic probe and required no product fix.

## Instructional-hypothesis changes

- Preserve the “plan before feedback” gate: it produced an explicit prediction that could be compared with E0382.
- Keep compiler feedback as support provenance rather than treating a successful compile alone as mastery.
- Require a fresh isomorphic variant after the corrected attempt; the first supported success remains `practicing`.
- Make all starter programs runnable in the exact evaluator shape so environment friction cannot masquerade as an ownership misconception.
