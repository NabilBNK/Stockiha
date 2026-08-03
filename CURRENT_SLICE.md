# Current Execution Status

> This is an execution tracker, not an architecture authority. See [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) for the target architecture, release scope, and remaining roadmap. Running/tested behavior, applied migrations, and automated tests determine actual implementation state.

## Released baseline

- **Branch:** `main`
- **Commit:** `0bde507d8e3bc1d503314f9a1afd3ff9d19f4726`
- **Verified boundary:** UI foundation, S0 through S4-003, and R2 supplier-accounting repair
- **Integrated work:** PR #11 (S4-003 + R2) and PR #12 (tracker synchronization) merged

## Completed recent work

- **S4-003:** central drawer policy, customer-payment refunds, cash/bank invariants, and customer-payment controls. Focused Windows/Tauri smoke evidence and exact-head CI passed before integration.
- **R2:** forward-only supplier accounting repair. Goods receipt accrues GRNI; supplier invoice clears GRNI and creates AP; returns use the correct GRNI/AP state; landed cost creates a traceable payable; payments select Cash or Bank correctly.
- **MVP financial boundary:** TVA and discounts remain deferred. Non-zero values are rejected rather than posted under guessed rules.
- **CI:** current migration and SQL regression coverage passed on the exact merge candidate.

## Current implementation slice

- **Roadmap step:** R6 — productionize database configuration and recovery
- **Slice:** R6-001 — operator backup creation and bundle validation
- **Branch:** `task/r6-001-operator-backup-validation`
- **PR:** #13
- **Implemented:** database-authoritative recovery permissions, immutable request audit, schema-version state, typed read-only bundle validation, configured-root containment, redacted errors, Tauri IPC, EN/FR/AR settings UI, and targeted SQL/frontend/Rust tests.
- **Verified increment:** backend validation head passed Rust, frontend, full migration chain, new R6 authorization/audit assertions, and existing S1–S4 regressions.
- **Current gate:** exact-head CI for the settings UI and error-code additions.
- **Still pending in R6-001:** production backup creation with real schema metadata, Windows Credential Manager/`pg_dump` integration, automatic post-create validation, and Windows/Tauri acceptance.
- **Safety boundary:** validation is read-only. No live restore command or destructive database replacement is registered or authorized.
- **Specification:** [`docs/slices/R6-001-operator-backup-validation.md`](./docs/slices/R6-001-operator-backup-validation.md)

R6-001 proceeds while representative physical paperwork is unavailable. It does not replace the R0/R4/R5 data-onboarding critical path.

## Data-onboarding critical path

**R0/R4/R5 remain launch-critical:** establish the data-onboarding contract, prove parsing against representative anonymized/transcribed source files, then implement a reconciled opening-state import.

Required before a live import:

1. Representative source material and independently checked expected totals.
2. A decision to import opening operational state into live ledgers and retain historical documents separately, or to require a full historical replay.
3. Approved mapping/reconciliation rules for the selected source columns.

The existing 1.5 years of physical paperwork is retained as source history. It is not silently replayed into live stock, cash, AR, AP, or journals.

## Explicitly deferred

- Live database restore or replacement until temporary-restore reconciliation and destructive-operation safety are implemented and proven
- TVA, HT/TTC, and discount calculation/posting
- Historical transaction replay unless separately approved
- Payroll, broad returns/transfers, advanced analytics, automatic updating, and unselected hardware/package work

Do not start legacy S4-004 or merge stale S5–S7 branches. New work must branch from current `main`.
