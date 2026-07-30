# Dependency license and vulnerability audit

Audited 2026-07-18 against `Cargo.lock` and `pnpm-lock.yaml`.

- `pnpm audit --prod --json`: 146 production/optional dependencies, zero low/moderate/high/critical advisories after pinning DOMPurify 3.4.11. The prior DOMPurify 3.2.7 advisory path through Monaco is closed in the lockfile.
- `cargo-audit 0.22.2`: 145 locked dependencies, zero vulnerabilities or informational warnings against RustSec commit `b5fc89b8be99e96f79194d8a6f11e9b4143b99f0` (database updated 2026-07-17).
- `pnpm licenses list --prod --json`: no unlicensed package. Declared expressions are MIT (98 entries), ISC (6), Python-2.0 (1), Apache-2.0 (2), CC-BY-4.0 (1), BSD-3-Clause (3), MPL-2.0/Apache-2.0 (1), Unlicense (1), and MPL-2.0 (2).
- `cargo-deny 0.20.2 list/check licenses`: no unlicensed crate and every selected license passes `deny.toml`. The graph uses MIT, Apache-2.0, Apache-2.0 with LLVM exception, BSD-3-Clause, BSL-1.0, Unicode-3.0, Unlicense, and Zlib choices. The `r-efi` OR expression includes an approved permissive choice; no LGPL-only selection is required.

The CI dependency-audit job installs the locked audit tools and runs `pnpm audit:dependencies`. No exception is open. A future exception must name an owner, affected package/path, rationale, containment, and expiry. Separately imported source/content retains its source license, commit pin, file scope, notice, and modification status in the source ledger.

The checked-in SPDX document enumerates direct application packages and release/toolchain/content identifiers. The two lockfiles are the full transitive reconstruction inputs. Monaco workers/fonts/icons are bundled locally; no runtime CDN dependency exists.
