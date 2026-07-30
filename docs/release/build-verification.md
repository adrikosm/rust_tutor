# Native build verification

Verified 2026-07-19 on macOS Apple Silicon:

- `pnpm all-checks` passes in the working repository.
- A fresh source-only copy excluding `.git`, `.ua`, `node_modules`, `target`, and `dist` installs from the frozen lockfile and passes `pnpm all-checks`.
- `pnpm package:local` produces `dist/rust-tutor-darwin-arm64`.
- `pnpm package:verify-offline` starts the packaged service with outbound proxies closed and verifies the SPA, API, ownership lesson, and graph.
- CI defines the equivalent clean macOS Apple Silicon and Linux x86-64 package/build checks.

The release path is native. It builds and publishes no Docker or OCI image.
