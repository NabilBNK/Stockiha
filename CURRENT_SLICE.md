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
- **PR:** #13, draft
- **Current head:** `9ea1dba3277f88309bd31665e5cfd1b7212fd073`
- **Implemented:** administrator-only recovery permissions; immutable request audit; database-owned schema-version metadata; replay-safe backup creation; fixed `stockiha_backup` role and Windows Credential Manager secret consumption; PostgreSQL 18 `pg_dump`; hidden staging and atomic publication; automatic pre/post-publication checksum validation; read-only validation of existing bundles; configured-root and reparse-point containment; stable redacted errors; EN/FR/AR Settings UI; independent Windows checksum/tamper tooling; and targeted SQL/frontend/Rust tests.
- **SQLx metadata repair:** Windows acceptance exposed that `sqlx migrate` creates `public._sqlx_migrations` outside direct `stockiha_owner` ownership. Forward migration `20260804120500_r6_001_sqlx_metadata_backup_acl.sql` grants the fixed backup role read-only access to that table when present, without making `stockiha_owner` login-capable or changing schema ownership.
- **CI hardening:** the database job now creates a representative SQLx metadata table before repository migrations, then requires PostgreSQL 18 `pg_dump` and dedicated ACL assertions to pass. This prevents CI from bypassing the real Windows failure mode.
- **Previous automated verification:** head `54eb036c8327e7fe13ea3a30f1f104efa6095923` passed frontend, Rust, migrations, PostgreSQL 18 `pg_dump`, current SQL/concurrency suites, and all historical upgrade workflows.
- **Current automated gate:** exact-head CI for `9ea1dba3277f88309bd31665e5cfd1b7212fd073` must pass.
- **Windows evidence status:** not accepted. The latest transcript exposed plaintext credentials, bypassed the official provisioning helper with custom code, temporarily changed PostgreSQL authentication configuration, changed `stockiha_owner` to `LOGIN`, altered `public` schema ownership, and reran migrations under a different role. Those actions invalidated the claimed clean-install acceptance even though a later bundle creation and tamper test succeeded.
- **Remaining R6-001 gate:** after exact-head CI passes, rerun Windows acceptance on a fresh database while preserving `stockiha_owner NOLOGIN`, using the normal SQLx migration path, the official credential helper, a new empty backup root, and sanitized evidence only.
- **Safety boundary:** backup creation and validation only. No live restore command or destructive database replacement is registered or authorized.
- **Specification and acceptance procedure:** [`docs/slices/R6-001-operator-backup-validation.md`](./docs/slices/R6-001-operator-backup-validation.md)

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
- Production startup migration from development database configuration to fully credential-backed runtime/migrator connections
- TVA, HT/TTC, and discount calculation/posting
- Historical transaction replay unless separately approved
- Payroll, broad returns/transfers, advanced analytics, automatic updating, and unselected hardware/package work

Do not start legacy S4-004 or merge stale S5–S7 branches. New work must branch from current `main`.
