# S4-003 — Drawer Eligibility & Customer Payment Refunds

## Status

Implementation is **in progress** on `task/s4-003-drawer-eligibility-refunds`.
Do not merge until automated verification and the Windows/Tauri manual pass are complete.

## Scope

S4-003 centralizes cash-drawer eligibility and adds a bounded customer payment-refund workflow:

- database-authoritative drawer operation policy;
- administrator-controlled operation toggles, enabled by default;
- one traceable/idempotent drawer job per eligible posted cash operation;
- current-cashier, same-workstation, OPEN-session enforcement;
- full reversal of a posted customer receivable payment;
- manager authorization bound to the exact payment, method, workstation, cash session, and cashier;
- negative cash movement for a CASH refund;
- no cash movement or drawer job for BANK_TRANSFER refunds;
- append-only refund allocations that reopen the original invoice allocation;
- EN/FR/AR customer refund and drawer-policy UI.

Full product returns, stock restoration, quarantine, return costing, and customer credit notes remain Slice 5 work.

## Production invariants

1. Drawer eligibility is determined from the posted cash movement and central policy, not a UI flag.
2. Every toggle defaults ON and can be changed only by an administrator with `MANAGE_DRAWER_POLICY`.
3. Disabling a drawer operation suppresses only the physical pulse job; it does not undo or suppress the financial cash movement.
4. One cash movement can have at most one drawer job.
5. CASH sale/payment/refund operations require the authenticated cashier's OPEN session on the same workstation.
6. Session suspension, closing, pending approval, closure, or handover invalidates stale cashier authority immediately.
7. A refund authorization is single-use, expiring, manager-authorized, and bound to the source payment and cash context.
8. A customer payment may be refunded only once.
9. Refund posting is request-idempotent; retries return the original document without duplicate ledger, cash, journal, or drawer effects.
10. CASH refund movement is negative. BANK_TRANSFER refund has no cash/drawer side effect.
11. Refund allocation rows are append-only and reduce the net allocated amount of the original invoice.
12. Printing and reprinting are never drawer-eligibility signals.

## Verification target

- frontend typecheck, lint, unit/workflow tests, and build;
- Rust domain/application tests;
- full PostgreSQL migration chain;
- S4-003 integration assertions for toggles, cash/bank refunds, authorization, idempotency, and handover;
- all S4-001 and S4-002 regression/concurrency suites;
- Windows/Tauri EN/FR/AR RTL and narrow/touch manual testing.
