# Accessibility review — beta

Reviewed 2026-07-18 at keyboard-only operation and 200% browser zoom. Core forms use labels, fieldsets/legends, button controls, status/alert live regions, visible focus, native expand/collapse, text alternatives for graph/diagrams, and non-drag ordering controls. Monaco has a textarea-capable fallback; exam and diagnostic accessibility bypasses are explicit and do not change scores.

Keyboard flows covered: diagnostic resume, lesson recall/reveal, editor/check/run/submit/cancel, review queue, graph zoom and list alternative, 15-item exam navigation/confirmation, and export/backup/import dry run. Narrow layouts collapse to one column. Motion is nonessential and no interaction depends on hover or pointer position.

Release checks: automated component semantics, browser DOM inspection for labels/roles, 200% zoom, high-contrast tokens, reduced-motion preference, and a macOS accessibility-tree/screen-reader pass of compiler diagnostics, mastery evidence, graph relations, and forms.

The live pass used the running beta in Zen on macOS and inspected the same accessibility surface consumed by VoiceOver:

| Surface | Observed screen-reader contract |
|---|---|
| Diagnostic | Goal fields have names/types/values; the active item is a level-2 heading; choices are named radios inside “Commit one response”; bypass and “I don’t know” are explicit. |
| Compiler | Result is a heading; duration/toolchain are separate text; the diagnostic list is ordered and announces severity, code, message, file, line, column, primary note, and help; rendered output is separately available. |
| Mastery/review | Retained numerator/denominator, evidence/attempt counts, not-started distribution, due state, due day, support policy, and “Why this review?” controls are announced without collapsing completion into mastery. |
| Graph | Pan/zoom buttons, percentage, edge definition list, eight-node ordered list/tree alternative, directed relation text, and related actions are all reachable without the canvas. |
| Forms/check engine | Native labels, fieldsets, confirmation/cancel controls, confidence slider, support disclosure, ten question types, non-drag ordering buttons, and post-commit live result are exposed. |

One issue found during the pass—duplicate React keys for repeated project prerequisites—was fixed by using occurrence-stable keys. No screen-reader or keyboard blocker remains. Any future unresolved finding is release-blocking rather than silently waived.
