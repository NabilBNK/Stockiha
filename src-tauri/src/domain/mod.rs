//! Domain layer — value types, typed identifiers, status enums, and
//! validation constructors for the S1-001 production schemas (products,
//! warehouse stock, cash sales, journal entries, fiscal periods, document
//! sequences).
//!
//! Deliberately contains no persistence code (no `sqlx::query!`, no
//! Tauri command, no IPC, no application service): this module is the
//! authoritative in-memory representation of the S1-001 tables, matching
//! their constraints, but does not yet talk to the database or to the
//! frontend. Both of those are future-slice work.
//!
//! Crate-private and, for now, consumer-free — the same posture every
//! Slice 0 proof module uses (see `infrastructure::backup_proof`,
//! `infrastructure::session_proof`, etc.): no IPC command or application
//! service in this slice constructs these types outside of their own unit
//! tests. `lib.rs` carries the matching `#[cfg_attr(not(test),
//! allow(dead_code))]` on the `mod domain;` declaration itself (the same
//! place every other proof module's exemption lives), removed once a later
//! slice's application service is the real consumer.

// No crate-wide re-exports here: nothing outside this module tree consumes
// these types yet (no IPC command or application service in this slice), so
// speculative `pub(crate) use` re-exports would themselves be unused
// surface — exactly what AGENTS.md's "no speculative code, placeholders, or
// unused abstractions" rule forbids. Each submodule's own tests reach its
// siblings directly via `super::`. A later slice's application service can
// add the specific re-export it actually needs when it exists.
mod document_sequence;
mod error;
mod fiscal_period;
mod identifiers;
mod journal;
mod money;
mod product;
mod sale;
mod stock;
mod warehouse;
