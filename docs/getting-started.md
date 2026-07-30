# Local development

## Clean install

1. Install a supported Node/pnpm and Rustup; do not install global project helpers.
2. Run `pnpm install --frozen-lockfile` from the repository root.
3. Run `cargo metadata --no-deps` to let Rustup verify the pinned toolchain.
4. Optionally copy `.env.example` to `.env` and change only documented loopback values.

## Start and stop

Run `pnpm dev`, then open `http://127.0.0.1:3000`. The command starts the SPA and loopback Rust service. Press Ctrl-C once; the supervisor forwards shutdown to both children.

For isolation, use `pnpm dev:web` or `pnpm dev:service`. The browser calls `/api`; Vite proxies that path to `127.0.0.1:4317` without putting a session token in a URL or persistent browser storage.

For a production static build, set `RUST_TUTOR_ALLOWED_ORIGIN=http://127.0.0.1:4317` and start the built Rust service. It serves `apps/web/dist/client` and grants the in-memory session token only to that exact origin. Development uses the exact Vite origin through the proxy. Tokens are returned with `Cache-Control: no-store`, never accepted from a hostile origin, and never written to URLs, logs, or persistent browser storage.

The service creates and migrates the learner SQLite database in the OS application-data directory. See [data-storage.md](data-storage.md) for exact paths, the optional directory override, backup scope, and fail-closed recovery behavior.

## Check and build

- `pnpm all-checks`: governance/content validation, Rust-to-Zod contract generation, formatting, linting, type checking, static UI verification, and production builds.
- `pnpm content:validate`: validate stable IDs, Markdown, provenance/licenses, assessment coverage, graph integrity, and ID migrations without network access.
- `pnpm content:manifest`: compile the validated ownership pack into deterministic release and generated-edge manifests.
- `pnpm contract:generate`: emit the Rust-owned API fixture decoded by the web Zod boundary test.
- `pnpm build`: emits the production SPA shell under `apps/web/dist/client` and builds the Rust service. The build-time server bundle is used only for prerendering; production requires no Node application backend.

## Troubleshooting

- **Service unavailable:** verify port 4317 is free and `RUST_TUTOR_BIND` is loopback.
- **Origin rejected:** use the exact origin in `RUST_TUTOR_ALLOWED_ORIGIN`; wildcard/non-loopback origins are intentionally invalid.
- **Toolchain degraded:** run `rustc --version` and `cargo --version`; health reports missing tools without logging environment values.
- **Learner database refuses startup:** preserve the database and sidecars; follow [data-storage.md](data-storage.md) rather than deleting or overwriting evidence.
- **Build uses stale dependencies:** run only `pnpm install --frozen-lockfile`; do not delete or rewrite lockfiles silently.
