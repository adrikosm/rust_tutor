# Supported development runtime

Verified on 2026-07-18 on Apple Silicon macOS (Europe/Athens):

| Tool | Tested version | Pin |
|---|---:|---|
| Node.js | 26.5.0 | `package.json` requires Node 24+ |
| pnpm | 11.9.0 | `packageManager` |
| rustc | 1.97.1 | `rust-toolchain.toml` |
| Cargo | 1.97.1 | Rust toolchain |
| rust-analyzer | 1.97.1 | Rust toolchain component |

These are application support evidence, not permission to modify global toolchains. `rustup` may install the repository pin locally when it is absent.
