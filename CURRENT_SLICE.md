# Current Slice Status

## Active Context

- **Current Phase:** Slice 4 — Customers, Receivables & Cash Controls
- **Current Task:** S4-002 — Full cashier-session lifecycle
- **Implementation Status:** IN PROGRESS

## Objective

Upgrade the minimal cash-session model into a production cashier-control lifecycle with blind denomination counts, database-authoritative expected cash, variance calculation and approval, suspension, and controlled cashier handover. Cash-session state transitions must remain session-authenticated, permission-protected, auditable, concurrency-safe, and isolated from receipt printing/reprint behavior.

## Included Task ID

- `S4-002`

## Architecture Contract

Cash sessions use the states:

- `OPEN`
- `CLOSING`
- `PENDING_APPROVAL`
- `CLOSED`
- `SUSPENDED`

Cashiers close using blind denomination counts. Expected cash is calculated by the system and must not be exposed before the cashier submits the blind count. Material variance requires manager authorization before final close.

## Database Scope

- Denomination catalog/configuration for DZD cash counting.
- Immutable/session-bound denomination count submissions.
- Database-authoritative expected cash and counted cash totals.
- Variance amount and configurable materiality threshold.
- State-machine enforcement for OPEN → CLOSING → CLOSED or PENDING_APPROVAL → CLOSED.
- Manager-only variance approval with recorded actor, reason, timestamp, and exact close attempt.
- Session suspension/resume rules with audit trail.
- Controlled handover between cashier users without losing cash accountability.
- Concurrency locks preventing duplicate close/approval/handover transitions.

## Rust/Tauri Scope

- Typed cash-session lifecycle DTOs and stable IPC errors.
- Thin application services around protected database functions.
- Commands for denomination configuration/read, close preparation/submission, manager approval, suspension/resume, and handover.

## React Scope

- Cash-session screen showing state and permitted actions without leaking expected cash before blind-count submission.
- Touch-friendly denomination count entry.
- Variance result and manager approval workflow.
- Suspension/resume controls.
- Handover workflow with explicit outgoing/incoming cashier identity and accountability.
- EN/FR/AR and RTL-ready UI structure.

## Production Invariants

- Expected cash is database-authoritative.
- A cashier cannot see expected cash before submitting the blind count.
- Denomination counts must be non-negative exact integers; monetary totals use exact decimal arithmetic.
- A close attempt is immutable once submitted.
- Material variance cannot reach `CLOSED` without authorized manager approval.
- Approval is bound to the exact close attempt and cannot be reused.
- Only valid lifecycle transitions are accepted; stale/concurrent transitions fail safely.
- Suspension and handover are auditable and cannot silently change cash ownership.
- Printing/reprinting never changes cash-session balances or lifecycle state.

## Verification Target

- PostgreSQL migration/integration tests for state transitions, blind-count privacy, expected/count variance, approval authorization, suspension/resume, handover, stale transition rejection, and concurrency.
- Rust unit/integration coverage for typed DTO/error behavior.
- Frontend workflow tests for cashier and manager paths.
- Windows/Tauri EN/FR/AR RTL and touchscreen smoke testing before merge.

## Completed Predecessor

S4-001 is complete and merged into `main` at merge commit `43ddce5729d5cb6a18952326337a2ca43673c081` after green automated verification and clean Windows/Tauri validation of customer credit/payment documents, PDF generation, reprint safety, cash-sale regression, and EN/FR/AR RTL behavior.
