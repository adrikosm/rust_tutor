# Threat model and residual risk

| Actor | Boundary/control | Residual risk |
|---|---|---|
| Hostile website | loopback bind, exact Host/origin, memory token, custom mutation header, JSON/body limits | browser/extension compromise remains outside the app |
| Learner code | fixed manifest/files, offline Cargo, scrubbed env, time/output/queue limits, exact cleanup | native code is not a sandbox; filesystem/kernel access cannot be guaranteed |
| Hostile import | 1 MiB cap, no extraction, schema/checksum/path/secret validation, dry-run, backup, transaction, FK/rebuild | deliberately valid semantic misinformation needs human review |
| Corrupt database | quick/integrity checks, fail closed, no blank replacement, verified backups | simultaneous loss of database and backups is unrecoverable |
| Compromised dependency | locks/pins, CI, SBOM/license inventory, local runtime assets, audit gate | upstream zero-days remain possible |

Public/multi-user use, untrusted execution, Windows, OCI/Wasmtime, runtime generation, and heavyweight clusters remain gated experiments. No learner telemetry, clipboard/process inspection, AI detection, or automatic upload is implemented.
