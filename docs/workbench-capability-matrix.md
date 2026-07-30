# MVP exercise-workbench capability matrix

The workbench is a curated learning surface, not a general IDE. Native processes use accident-containment controls on a trusted single-user machine; they are not a security sandbox.

| Capability | MVP | Boundary |
| --- | --- | --- |
| Curated multi-file Rust edit | Included | Only manifest-declared learner files beneath `src/` |
| Read-only generated `Cargo.toml` | Included | Owned by the service; never accepted from a learner |
| File tabs/tree and ownership labels | Included | Learner-owned, stage-owned read-only, service-only hidden |
| Draft autosave/restart restore | Included | Disposable local draft; not canonical evidence |
| Starter reset preview | Included | Explicit confirmation; canonical attempts unchanged |
| Prior-submission restore/copy | Included | Creates a new draft, never rewrites history |
| Workspace download | Included | Only disclosed manifest files and replay metadata |
| Check | Included | Compile current declared files; no tests |
| Run | Included | Manifest-declared args/stdin/fixtures only |
| Submit | Included | Current unseen group plus completed-stage regressions |
| Cancel | Included | Kills the process group and returns a final structured result |
| Visible/custom cases | Included where the grader supports them | Input, expected, actual, stdout, stderr, status, duration, and replay remain distinct |
| Compiler markers and accessible diagnostics | Included | Primary/secondary spans plus ordered text list |
| Bounded build/test/program output | Included | Controls and host/workspace paths sanitized |
| Local rust-analyzer completion | Included and optional | Completion only; stale versions and out-of-root URIs rejected |
| Plain textarea fallback | Required | Complete Check/Run/Submit/reset/recovery path without Monaco |
| Terminal or arbitrary commands | Absent | No shell surface |
| Debugger | Absent | No debugger protocol/process |
| Extensions or plugins | Absent | Fixed first-party surface |
| Git operations | Absent | Attempts/artifacts are canonical instead |
| Refactors/rename/code actions | Absent | Analyzer workspace edits are rejected |
| Hover/definitions/references/inlay hints | Absent | Analyzer method allowlist is completion-only |
| Inline AI suggestions/runtime LLM | Absent | Offline reviewed curriculum and deterministic feedback |
