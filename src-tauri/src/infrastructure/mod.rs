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
// WS-K-3: the `--provision-migrate` CLI entry point, reachable only via
// that literal argument (checked in `lib.rs` before Tauri's normal `run()`
// is ever called). Not `dead_code`-exempted: `lib.rs::maybe_run_provision_migrate`
// is a real, always-present consumer.
pub(crate) mod provision_cli;
// WS-K-1: per-installation `database.json` config-file resolution, the
// second tier of the connection precedence (env var, then this, then the
// developer-only `runtime.key` fallback in `db`).
pub(crate) mod local_config;
// WS-K-1: read-only comparison of the migrations embedded in this binary
// against the migrations actually applied to the connected database.
pub(crate) mod schema_version;
// WS-K-4: first-run embedded-PostgreSQL setup (initdb, roles, database,
// migrations, database.json) — ported from the retired
// scripts/provisioning/Provision-StockihaPostgres.ps1 installer script.
pub(crate) mod embedded_setup;
// WS-K-4: embedded PostgreSQL process lifecycle — spawn, graceful/escalated
// stop, and the stale-postmaster.pid liveness check that is the single most
// safety-critical piece of this workstream (see the module's own doc
// comment).
pub(crate) mod pg_process;
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
// S0-010/R6-002: the temporary-database restore proof is now consumed by the
// administrator recovery workflow. It remains crate-private and exposes only
// generated temporary-database operations, validated bundle preflight, and
// the fixed PostgreSQL 18 pg_restore adapter. No live replacement API exists.
pub(crate) mod restore_proof;
// S0-006: SECURITY DEFINER / session-token proof. Crate-private and
// consumer-free (no command, no IPC); dead code in non-test builds until a
// later slice consumes session validation. The exemption is removed then.
#[cfg_attr(not(test), allow(dead_code))]
mod session_proof;
