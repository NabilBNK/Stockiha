# Current Slice Status

## Active Context
- **Current Phase:** Slice 0 — Technical Feasibility and Proofs
- **Current Task:** S0-002 — Development Configuration and Typed Error Foundation

See `docs/slices/S0-002-development-and-error-foundation.md` for the full S0-002 contract.

## Out of Scope for S0-002
- PostgreSQL bootstrap implementation
- Database schemas and migrations
- Authentication and session validation
- Inventory and WAC
- Sales and cash sessions
- Accounting and SCF
- Typst generation
- ESC/POS printing
- Backup and restore
- Business UI screens
- Business error variants and any new or fallible Tauri command
- Full French/Arabic/English i18n integration (only message-key ownership is defined)

> Note: PostgreSQL connectivity, credential storage, printing, and backup/restore are covered by later Slice 0 tasks (S0-003 through S0-010).

## Deferred Security Items (documented, not forgotten)
- **CSP hardening:** Addressed in S0-002. A restrictive production CSP and the minimal development-only CSP are configured in `src-tauri/tauri.conf.json` (`app.security.csp` / `app.security.devCsp`). WebView2 CSP behavior still requires a Windows runtime check.
