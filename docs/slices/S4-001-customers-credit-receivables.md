# S4-001 — Customers, Credit Controls & Receivables

## Status

Implementation is **in progress** on `task/s4-001-customer-credit-controls`.
Do not mark the task complete or merge the branch until the automated and Windows/Tauri gates below pass.

## Scope

S4-001 introduces the customer/accounts-receivable side of Stockiha:

- customer master data and credit policy;
- database-authoritative credit exposure;
- append-only customer ledger;
- open credit-invoice tracking;
- concurrency-safe credit-limit and overdue blocking;
- exact-sale, single-use manager overrides;
- customer credit sale posting;
- explicit customer payment allocations;
- customer cash collection integration with the active cash session and drawer queue.

Full cashier lifecycle hardening remains S4-002/S4-003/S4-004 work.

## Security boundaries

- Runtime cannot directly mutate customer financial state, ledgers, credit overrides, credit-sale ledgers, customer payments, or allocations.
- Customer master writes require `MANAGE_CUSTOMERS` through `SECURITY DEFINER` functions.
- Customer reads use `VIEW_CUSTOMERS`.
- Credit sales require `POST_CREDIT_SALE`.
- Customer payments require `POST_CUSTOMER_PAYMENT`.
- Manager overrides require `OVERRIDE_CREDIT_LIMIT`.
- The database resolves actor/workstation from the application-session token.
- Override fingerprints are derived inside PostgreSQL from the actual customer, warehouse, fiscal period, Africa/Algiers business date, and sale lines. Runtime cannot provide a trusted fingerprint.

## Credit-sale invariants

1. Lock the customer credit-state row before evaluating exposure.
2. Reject inactive/non-credit customers.
3. Reject normal credit posting when the resulting exposure exceeds the configured limit.
4. Reject when overdue policy blocks new credit.
5. An override is single-use, expiring, manager-authorized, and bound to the exact sale payload.
6. A cart mutation invalidates the override.
7. Stock issue, WAC/COGS, accounts receivable, revenue, and journal posting are atomic.
8. A credit sale creates no cash movement and no drawer pulse.
9. Credit-sale POS fiscal date is derived in PostgreSQL using `Africa/Algiers`.

## Customer-payment invariants

1. Lock the same customer credit-state row used by credit sales.
2. A payment cannot exceed current customer exposure.
3. Every payment is explicitly allocated to one or more open `CREDIT_INVOICE` ledger entries.
4. Allocation cannot cross customer boundaries.
5. Allocation cannot exceed an invoice's remaining amount.
6. Allocation sum must equal payment amount; unapplied customer cash is not supported in S4-001.
7. Payment and allocations are immutable after posting.
8. Cash collection requires an OPEN cash session on the authenticated workstation.
9. Cash collection creates one positive cash movement and one idempotent drawer pulse.
10. Bank transfer creates no cash-session movement or drawer pulse.
11. Physical checks are intentionally unsupported until a checks-receivable/clearing lifecycle exists; they must not be treated as settled bank cash.
12. Payment updates customer exposure and recomputes the oldest still-open due date atomically.

## Automated verification

Frontend:

```powershell
npm ci
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Rust:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Database harnesses require a disposable migrated database whose name ends in `_test`:

- `src-tauri/tests/receivables/s4_001_credit_sale_integration.sql`
- `src-tauri/tests/receivables/s4_001_customer_payment_integration.sql`
- `src-tauri/tests/receivables/s4_001_credit_concurrency.sh`

The GitHub CI workflow contains a PostgreSQL 18 job that applies all migrations in filename order before running these S4 assertions.

## Required Windows/Tauri manual pass

### Customer directory

- Admin/manager can create and edit customer master data.
- Credit disabled forces zero limit/zero terms/no overdue rule.
- Cashier can view customers but does not receive management controls.
- Customer detail shows database exposure, available credit, oldest open due date, open invoices, and ledger entries.
- French, English, and Arabic RTL remain usable at 1366×768 and a narrow window.

### Credit POS

- Cash sale behavior is unchanged.
- Switch to Credit and select an active credit-enabled customer.
- Confirm a within-limit sale: stock falls once, AR rises once, no cash movement, no drawer pulse.
- Confirm an over-limit or overdue sale: it is blocked with safe localized copy.
- Manager authorizes the exact blocked cart using temporary credentials.
- Manager session is logged out after authorization.
- Unchanged cart can be reconfirmed once with the override.
- Change quantity/product/customer after authorization: old override must no longer work.
- Retry a successful request: same document returns without duplicate stock/ledger/journal effects.

### Customer payment

- Open customer detail and choose an open invoice.
- Allocate a partial payment; total allocation is visible before posting.
- Cash payment is unavailable without an open cash session.
- With a cash session open, cash payment reduces exposure and invoice remaining balance; cash session receives one movement and drawer opens once.
- Bank transfer reduces exposure without cash movement or drawer pulse.
- Attempt allocation above invoice remaining amount: blocked.
- Attempt cross-customer allocation through direct test harness: blocked.
- Retry same request: no duplicate payment, allocation, cash movement, or drawer pulse.

## Known remaining S4-001 work

- Final current-head automated verification evidence must be captured.
- Credit-sale/customer-payment document rendering and print/export surfaces are not yet implemented.
- Final Windows/Tauri multilingual/touchscreen smoke testing is not yet signed off.
