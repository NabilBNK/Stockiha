# Current Slice Status

## Active Context
- **Current Phase:** Slice 0 — Technical Feasibility and Proofs
- **Current Task:** S0-001 — Repository Foundation and Tauri Scaffold

## Out of Scope for S0-001
- PostgreSQL bootstrap implementation
- Database schemas and migrations
- Authentication
- Inventory and WAC
- Sales and cash sessions
- Accounting and SCF
- Typst generation
- ESC/POS printing
- Backup and restore
- Business UI screens

> Note: Backup/restore, printing, PostgreSQL connectivity, and credential storage are covered by later Slice 0 tasks (S0-003 through S0-010). They are out of scope for S0-001 only.

## Deferred Security Items (documented, not forgotten)
- **CSP hardening:** `csp: null` is temporary. Configuring a restrictive Tauri v2 Content Security Policy is an explicit acceptance criterion for S0-002.
