---
id: WORKED-MOVE-001
version: 1
source_ids: [SRC-APP-OWNERSHIP-001]
outcome_ids: [OUT-TRACE-MOVE-001]
license: project-original
---

# Trace before compiling

`let label = String::from("pulse");` makes `label` the owner. `let next = label;` transfers that responsibility to `next`; a later use of `label` should fail. The correction follows the intended postcondition: borrow when the caller must retain ownership, or accept the move when it must not.
