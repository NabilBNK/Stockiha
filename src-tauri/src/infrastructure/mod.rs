//! Infrastructure layer — technical adapters that connect the application to
//! external systems (S0-003: PostgreSQL via SQLx). No business logic lives here.

// S0-009/R6-001: backup bundle creation proof and authoritative read-only
// validator. R6-001 consumes validation through the recovery application
// service; creation remains unexposed until its schema/version metadata and
// production configuration boundary are completed.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) mod backup_proof;
pub(crate) mod bootstrap;
// S0-005: Windows Credential Manager proof. Crate-private. S0-009 is a real
// consumer of `CredentialTarget::Backup` / `read_secret` on Windows, but most
// of this module's surface (`write_secret`, `delete_secret`, the `Runtime`/
// `Migrator` targets, etc.) still has no consumer on any platform, so the
// dead-code exemption stays in place until a later slice needs those paths
// too.
#[cfg_attr(not(test), allow(dead_code))]
mod credentials;
pub(crate) mod customer_pdf;
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
// S0-010: temporary-database restore and reconciliation proof. Crate-private
// and consumer-free (no Tauri command, no IPC); dead code in non-test builds
// until a later slice runs real restores. The exemption is removed then.
#[cfg_attr(not(test), allow(dead_code))]
mod restore_proof;
// S0-006: SECURITY DEFINER / session-token proof. Crate-private and
// consumer-free (no command, no IPC); dead code in non-test builds until a
// later slice consumes session validation. The exemption is removed then.
#[cfg_attr(not(test), allow(dead_code))]
mod session_proof;
