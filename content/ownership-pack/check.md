---
id: CHECK-BORROW-001
version: 1
source_ids: [SRC-APP-OWNERSHIP-001]
outcome_ids: [OUT-CHOOSE-BORROW-001]
license: project-original
---

# Commit the caller's postcondition

A formatter reads a `String`, and the caller must append to it afterward. Should the function accept `String`, `&String`, or `&mut String`? Commit the choice and owner trace before feedback.
