//! Domain layer — value types, typed identifiers, status enums, and
//! validation constructors for the S1-001 production schemas (catalog
//! products/variants, inventory positions/movements, cash sales, journal
//! entries, fiscal periods, business documents, document sequences).
//!
//! Deliberately contains no persistence code (no raw `sqlx::query!` SQL
//! strings, no Tauri command, no IPC): this module is the authoritative
//! in-memory representation of the S1-001/Slice-1 tables, matching their
//! constraints. Most of it still has no consumer outside its own unit
//! tests (dead code in non-test builds — see the `#[cfg_attr(not(test),
//! allow(dead_code))]` on `mod domain;` in `lib.rs`), but
//! [`canonical_json`] is the one exception: the Slice 1 MVP batch's
//! `application` module is a real, live consumer of it (every posting
//! call needs a canonical idempotency payload hash), so that one submodule
//! is `pub(crate)` instead of private, and its dead-code exemption is
//! already satisfied by that real usage.

// No blanket crate-wide re-exports here: most of these types still have no
// consumer outside this module tree (no IPC command or application service
// constructs them yet), so speculative `pub(crate) use` re-exports would
// themselves be unused surface — exactly what AGENTS.md's "no speculative
// code, placeholders, or unused abstractions" rule forbids. Each submodule's
// own tests reach its siblings directly via `super::`. `canonical_json` is
// `pub(crate)` (not re-exported, just directly reachable as
// `crate::domain::canonical_json::...`) because it already has the real
// consumer the others are still waiting for.
mod business_document;
pub(crate) mod canonical_json;
mod cash_session;
mod document_sequence;
mod error;
mod fiscal_period;
mod identifiers;
mod journal;
mod money;
mod product;
mod queue;
mod sale;
mod stock;
mod warehouse;
