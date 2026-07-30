# Supported beta platforms

| Surface | Supported beta | CI/verification |
|---|---|---|
| macOS | Apple Silicon, current supported macOS | `macos-15`, local browser QA |
| Linux | x86-64 current Ubuntu | `ubuntu-latest` |
| Windows | Not supported; gated experiment | none |
| Browser | Current Chromium-class browser at the exact loopback origin | keyboard/zoom/offline browser checklist |
| Rust | 1.97.1 with rustfmt, Clippy, rust-analyzer | pinned toolchain |
| Node/pnpm | Node 26.5.0 / pnpm 11.9.0 for development only | pinned CI |

The packaged production app needs no Node server. Native Rust execution retains OS-level risk and is only supported for one trusted local learner.

No Docker or OCI image is built, published, or required. Supported releases are native bundles containing the Rust service and static SPA.

The CI `package` matrix builds a native bundle independently on macOS Apple Silicon and Linux x86-64, starts each artifact with external proxies forced to a closed loopback port, and verifies the SPA, API, lesson, and graph before uploading the artifact. A package is not promoted merely because it compiled.
