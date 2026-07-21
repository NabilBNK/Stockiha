//! Infrastructure layer — technical adapters that connect the application to
//! external systems (S0-003: PostgreSQL via SQLx). No business logic lives here.

pub(crate) mod bootstrap;
// S0-005: Windows Credential Manager proof. Crate-private and consumer-free for
// now (no Tauri command, no IPC), so it is dead code in non-test builds until
// the first consumer wires credential-backed connections (S0-006+). The
// exemption is removed when that consumer lands.
#[cfg_attr(not(test), allow(dead_code))]
mod credentials;
pub mod db;
