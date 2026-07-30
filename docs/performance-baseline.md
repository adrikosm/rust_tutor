# Foundation performance baseline

Measured 2026-07-18 on Apple Silicon macOS with Node 26.5.0, pnpm 11.9.0, rustc/Cargo 1.97.1, Vite 8.1.5, and an already-fetched debug dependency set.

| Measurement | Baseline |
|---|---:|
| Loopback Rust service cold start to successful `/api/v1/health` | 386 ms |
| Production client directory bytes | 3,761,041 bytes |
| Application route JavaScript (`Pages`) | 73.17 kB raw / 19.64 kB gzip |
| Main client JavaScript | 241.12 kB raw / 75.91 kB gzip |
| Application CSS | 23.89 kB raw / 5.68 kB gzip |
| Monaco editor API (lazy workbench asset) | 2,524.71 kB raw / 647.23 kB gzip |
| Debug Rust service binary | 35,973,216 bytes |
| Warm `/api/v1/health` mean, 10 loopback requests | 1.054 ms |
| Warm focused graph mean, 10 loopback requests | 1.830 ms |
| Warm FTS search mean, 10 loopback requests | 2.383 ms |
| Warm dashboard mean, 10 loopback requests | 1.762 ms |
| Real `cargo check` evaluator request | 165.135 ms HTTP / 92 ms reported tool duration |

The Monaco asset is intentionally lazy and does not block dashboard/curriculum routes. These observations establish a comparison point, not a budget or release gate. Re-measure with machine/toolchain/build-mode context when architecture or heavy route dependencies change.
