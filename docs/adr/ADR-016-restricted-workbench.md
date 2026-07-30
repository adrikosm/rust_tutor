# ADR-016: Restricted Rust workbench

Status: Accepted — 2026-07-18

The editor uses Monaco models, one local rust-analyzer session per curated workspace, and explicit Cargo actions. Terminal, arbitrary filesystem access, extensions, debugger, source-control UI, and AI completion remain out of scope.
