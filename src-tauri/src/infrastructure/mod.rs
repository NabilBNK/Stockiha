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
// S0-008: ESC/POS Windows RAW spooler proof. Crate-private and consumer-free
// (no Tauri command, no IPC); dead code in non-test builds until a later
// slice sends real receipts. The exemption is removed then. The module is
// NOT cfg(windows)-gated: `SpoolerJob`, validation, the redacted error, and
// the harmless payload builder are platform-neutral and unit-tested on every
// platform. Only the Win32 FFI writer and the live proof are cfg(windows).
#[cfg_attr(not(test), allow(dead_code))]
mod escpos_proof;
// S0-007: Typst French/Arabic PDF generation proof. Crate-private and
// consumer-free (no Tauri command, no IPC); dead code in non-test builds until
// a later slice renders real documents. The exemption is removed then.
#[cfg_attr(not(test), allow(dead_code))]
mod pdf_proof;
// S0-006: SECURITY DEFINER / session-token proof. Crate-private and
// consumer-free (no command, no IPC); dead code in non-test builds until a
// later slice consumes session validation. The exemption is removed then.
#[cfg_attr(not(test), allow(dead_code))]
mod session_proof;
