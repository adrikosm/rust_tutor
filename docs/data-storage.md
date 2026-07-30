# Learner data storage

The SQLite database is private runtime state and is never created under tracked curriculum content by default:

- macOS: `~/Library/Application Support/Rust Tutor/rust-tutor.sqlite3`
- Windows: `%LOCALAPPDATA%\Rust Tutor\rust-tutor.sqlite3`
- Linux: `$XDG_DATA_HOME/rust-tutor/rust-tutor.sqlite3`, or `~/.local/share/rust-tutor/rust-tutor.sqlite3`

`RUST_TUTOR_DATA_DIR` may point to a different absolute private directory. The repository ignores `.runtime/`, `data/*.sqlite*`, database sidecars, and backups, but an external OS application-data directory is the normal choice.

Startup performs a read-only integrity check before applying checksum-pinned forward migrations. If the database is corrupt or a previously applied migration changed, startup refuses mutation. Preserve the database and its `-wal`/`-shm` sidecars together, restore a known-good backup, or move the damaged set aside before starting a fresh store.

Learner attempts are immutable event streams. Mastery, review, and evidence projections can be rebuilt deterministically from those events; artifact records retain their checksum, item version, and toolchain provenance.

Evaluator runs use stable run IDs and persist their queued/running/final state, bounded build/program chunks, and final structured result. The SSE response is a live view of that record: cancellation still produces a final result, completed runs are recoverable after disconnect, and a service restart converts abandoned queued/running rows to `interrupted` instead of pretending they completed.
