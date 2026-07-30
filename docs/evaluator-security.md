# Trusted local evaluator boundary

Rust compilation and execution are native code execution. The version-1 evaluator is an accident-containment boundary for one learner using reviewed, dependency-free exercises; it is not a secure sandbox and must never be exposed to untrusted or multi-user submissions.

Build and program output is streamed through bounded, prefixed SSE events while the same chunks and final result are persisted under a stable run ID. The browser keeps only the latest 200 live chunks, the evaluator retains its independent total output limit, and cancellation terminates the process tree without discarding the structured terminal status.

The service creates an exact temporary workspace for each run, writes a service-owned `Cargo.toml`, accepts only declared relative Rust files, clears inherited environment variables, supplies deterministic locale/time-zone values, invokes Cargo with an argument array, bounds elapsed time and captured output, sanitizes terminal controls and local paths, and removes the exact workspace after the structured result is retained.

It rejects absolute paths, parent traversal, undeclared files, learner manifests, build scripts, proc macros, custom runners, and dependencies. Check compiles; Run executes only manifest-declared stdin/arguments; Submit runs reviewed tests. Native mode does not claim filesystem, network, kernel, or side-channel isolation. Public or untrusted execution requires a separately reviewed OS/container isolation design.
