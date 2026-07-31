# Current Slice Status

## Active Context

- **Current Phase:** Slice 4 — Customers, Receivables & Credit Controls
- **Current Task:** S4-001 — Customer master, credit state, receivables, and customer document pipeline
- **Implementation Status:** IN PROGRESS — automated verification is green; final Windows/Tauri document + multilingual/touchscreen validation remains before completion/merge.

## Objective

Introduce the customer/accounts-receivable side of Stockiha as a complete vertical slice: customer master data, authoritative credit exposure, customer ledger tracking, credit-limit and overdue enforcement, payment allocations, single-use manager overrides, and immutable customer credit/payment documents. Financial decisions remain database-authoritative and concurrency-safe.

## Included Task ID

- `S4-001`

## Database Scope

- Customer master directory with active/inactive and credit-policy fields.
- Database-generated immutable customer codes.
- Per-customer credit state used as the row-lock boundary for concurrent credit decisions.
- Immutable customer ledger entries for receivable movements.
- Database-level credit exposure and overdue checks before credit posting.
- Customer payments with canonical invoice allocations, cash/bank behavior, and idempotency.
- Immutable customer identity snapshots on posted credit sales and customer payments.
- Durable customer-document generation, original-print, and reprint queue rows.

## Rust/Tauri Scope

- Customer DTOs, repositories/services, and typed IPC commands.
- Customer ledger and credit-summary reads.
- Protected credit-sale and customer-payment command paths backed by database posting functions.
- In-process Typst credit-invoice and customer-payment-receipt PDF generation from immutable posted payloads.
- Atomic PDF publication under the Tauri app-data directory.

## React Scope

- Customer directory and customer detail/financial summary screens.
- POS customer selection and credit availability feedback.
- Customer payment/allocation and manager-override workflows.
- Documents workbench for credit invoice/payment receipt preview, PDF generation state, original print state, and reprint queueing.
- Customer code is hidden during creation and shown only after the customer record exists.

## Verified Automated State

GitHub CI on implementation head `218b71e29623f52265ea9a9419a95f32c6673add` passed:

- frontend typecheck, lint, tests, and production build;
- Rust unit tests including customer Typst PDF rendering;
- full PostgreSQL migration chain;
- credit-sale integration assertions including invoice generation/reprint queue behavior;
- customer-payment integration assertions including canonical allocation idempotency, receipt generation/reprint, cash/drawer safety, and customer isolation;
- real two-session credit-limit race.

A later documentation-only commit may move the branch HEAD without changing that verified implementation content.

## Known Boundary

The durable `documents.print_jobs` state machine is wired for customer documents and successful generation releases customer print jobs to `PENDING`. The production queue-to-Windows physical printer worker is not yet implemented, so `PENDING` means print work is durably ready — not that paper was physically printed.

## Slice 4 Follow-on Scope

After S4-001, Slice 4 still includes production cashier controls from the architecture baseline: blind denomination counts, variance approval, suspension/handover, extended drawer eligibility, and multilingual POS/cash-session verification. S4 is not complete when S4-001 alone is complete.

## Production Invariants

- Credit exposure is database-authoritative; React/Rust may display it but may not decide financial eligibility independently.
- Concurrent credit sales must not jointly exceed a customer's authorized credit limit.
- Customer ledger entries and posted customer snapshots are append-only/immutable after posting.
- Payment allocation cannot exceed invoice remaining balance or cross customer boundaries.
- Equivalent allocation intent is canonicalized by invoice identity and numeric amount for idempotency.
- Manager overrides are single-use, auditable, permission-protected, and bound inside PostgreSQL to the exact sale payload.
- All receivable postings are atomic, idempotent, session-authenticated, and journal-balanced.
- Customer document generation/reprint cannot repost stock, exposure, journal, cash, or drawer effects.

## Remaining Verification Target

- Windows/Tauri smoke test for the three new document-related migrations.
- Credit invoice and customer payment receipt preview/PDF generation/reprint queue validation on Windows.
- French, Arabic RTL, English, and touchscreen smoke testing.
- Existing cash-sale receipt regression.
