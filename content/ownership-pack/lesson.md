---
id: UNIT-OWNERSHIP-001
version: 1
source_ids: [SRC-APP-OWNERSHIP-001]
outcome_ids: [OUT-TRACE-MOVE-001, OUT-CHOOSE-BORROW-001]
license: project-original
---

# Ownership is a changing responsibility

Before reading code, name which binding should own the value after each operation. Assignment of a non-`Copy` value transfers ownership. A reference instead grants bounded access while the owner remains responsible for the value.

Use compiler diagnostics as evidence about a specific ownership trace, not as text to silence mechanically.
