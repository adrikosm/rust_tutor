# CodeCrafters public course-definition audit

Audit date: 2026-07-18. This inventory covers each public repository used to reserve local parity stage IDs. Every repository contains a separately verified MIT `LICENSE` with SHA-256 `65eaee3a26d8ecfebc874d0675ecfd802ff961cff1a1f2d3f2a9b0533a3a6b7e`. Exact stage metadata and per-file hashes remain in `knowledge/evidence/codecrafters-source-audit-v0.json`.

| Course | Pinned commit | Stages | Imported file scope | Local modification/starter decision |
|---|---|---:|---|---|
| GREP | `1150053d59e08344366f365a3840421523a426c9` | 33 | `LICENSE`, `course-definition.yml` slug/name/difficulty only | No upstream starter or instruction is shipped; local overlay/evaluator authored separately. |
| Git | `8e8b9e2c9f65580fe55cc0f596adb0493a32a9e3` | 7 | same | same |
| HTTP | `08ca062ca3327fc97da9dd06a473a48c72ad7936` | 14 | same | same |
| DNS | `759aff47a39c390637d6bcbdb49a4a4b2ceef3de` | 8 | same | same |
| Shell | `d2c898fc747696ec88083898573f3da3f1f2f5b1` | 76 | same | same |
| Interpreter | `a64ba2e3ac195dd13418f64c03aea360a9878fdf` | 84 | same | same |
| SQLite | `19f45f30f031c2950a4c90bd03d6000cc798f960` | 9 | same | same |
| Redis | `809d70563f577f96a725e1c8e185e52f60dc3b14` | 115 | same | same |
| BitTorrent | `81bc7958b79434e982acb477c58eaf097aff5c31` | 19 | same | same |
| Kafka | `ec5c587dce80bef3f6018fb27eba92bea1dfd9d3` | 25 | same | same |
| Agent | `68c81e5d351bee101d9bfed50208e3804fc227e9` | 6 | same | same |

The release retains the notice and pinned MIT decision. Excluded scope is uniform: CodeCrafters application/service content, paid hints/editorials, community solutions, tester repositories without a separate accepted license, and private-runner behavior. There are no local modifications to an upstream starter because no upstream starter is distributed. The runtime `TutorOverlay` contract preserves imported stage order while requiring locally authored Rust explanations, retrieval prompts, hints, reflections, graph links, transfer work, and specification-based evaluators.
