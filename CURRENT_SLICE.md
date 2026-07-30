# Current Slice Status

## Active Context

- **Current Phase:** Slice 4 — Customers, Receivables & Credit Controls
- **Current Task:** S4-001 — Customer master, credit state, and customer ledger foundation
- **Implementation Status:** IN PROGRESS

## Objective

Introduce the customer/accounts-receivable side of Stockiha as a complete vertical slice: customer master data, authoritative credit exposure, customer ledger tracking, credit-limit and overdue enforcement, payment allocation foundations, and single-use manager overrides. Financial decisions remain database-authoritative and concurrency-safe.

## Included Task ID

- `S4-001`

## Database Scope

- Customer master directory with active/inactive and credit-policy fields.
- Per-customer credit state used as the row-lock boundary for concurrent credit decisions.
- Immutable customer ledger entries for receivable movements.
- Database-level credit exposure and overdue checks before credit posting.
- Foundations for customer payments, allocations, credit notes, write-offs, and manager overrides.

## Rust/Tauri Scope

- Customer DTOs, repositories/services, and typed IPC commands.
- Customer ledger and credit-summary reads.
- Protected credit-sale and customer-payment command paths backed by database posting functions.

## React Scope

- Customer directory and customer detail/financial summary screens.
- POS customer selection and credit availability feedback.
- Customer payment/allocation and manager-override workflows as the backend posting paths land.

## Slice 4 Follow-on Scope

After S4-001, Slice 4 still includes production cashier controls from the architecture baseline: blind denomination counts, variance approval, suspension/handover, extended drawer eligibility, and multilingual POS/cash-session verification. S4 is not complete when S4-001 alone is complete.

## Production Invariants

- Credit exposure is database-authoritative; React/Rust may display it but may not decide financial eligibility independently.
- Concurrent credit sales must not jointly exceed a customer's authorized credit limit.
- Customer ledger entries are append-only after posting.
- Payment allocation cannot exceed the payment amount or cross customer boundaries.
- Manager overrides are single-use, auditable, permission-protected, and bound to the exact sale payload.
- All receivable postings are atomic, idempotent, session-authenticated, and journal-balanced.

## Verification Target

- Database migration/integration tests for customer master, exposure locking, ledger immutability, credit-limit races, payment allocation, and override invalidation.
- Rust unit/integration coverage for typed errors and application services.
- Frontend workflow tests plus Windows/Tauri French, Arabic RTL, English, and touchscreen smoke testing.
