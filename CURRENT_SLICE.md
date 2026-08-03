# Current Execution Status

> This is an execution tracker, not an architecture authority. See [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) for the target architecture, release scope, and remaining roadmap. Running/tested behavior, applied migrations, and automated tests determine actual implementation state.

## Released baseline

- **Branch:** `main`
- **Commit:** `c767e47a111700198d47cc6531d57a2e950216fc`
- **Verified boundary:** UI foundation, S0 through S4-003, and R2 supplier-accounting repair
- **Integrated work:** PR #11 (S4-003 + R2) merged; PR #9 superseded

## Completed recent work

- **S4-003:** central drawer policy, customer-payment refunds, cash/bank invariants, and customer-payment controls. Focused Windows/Tauri smoke evidence and exact-head CI passed before integration.
- **R2:** forward-only supplier accounting repair. Goods receipt accrues GRNI; supplier invoice clears GRNI and creates AP; returns use the correct GRNI/AP state; landed cost creates a traceable payable; payments select Cash or Bank correctly.
- **MVP financial boundary:** TVA and discounts remain deferred. Non-zero values are rejected rather than posted under guessed rules.
- **CI:** current migration and SQL regression coverage passed on the exact merge candidate.

## Current roadmap position

**Next critical path:** R0/R4/R5 — establish the data-onboarding contract, prove spreadsheet parsing against representative anonymized workbooks, then implement a reconciled opening-state import.

Required before a live import:

1. Anonymized representative source files and their expected totals.
2. A decision to import opening operational state into live ledgers and retain historical documents separately, or to require a full historical replay.
3. Approved mapping/reconciliation rules for the selected source columns.

R6 (operator backup/restore) may proceed in parallel once the pilot database shape and operational workflow are selected.

## Explicitly deferred

- TVA, HT/TTC, and discount calculation/posting
- Historical transaction replay unless separately approved
- Payroll, broad returns/transfers, advanced analytics, automatic updating, and unselected hardware/package work

Do not start legacy S4-004 or merge stale S5–S7 branches. New work must branch from current `main`.
