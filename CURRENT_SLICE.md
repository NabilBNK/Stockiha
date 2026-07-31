# Current Slice Status

## Active Context

- **Current Phase:** Slice 4 — Customers, Receivables & Cash Controls
- **Current Task:** S4-003 — Extended drawer eligibility and customer cash-payment/refund integration
- **Implementation Status:** IN PROGRESS

## Objective

Centralize Stockiha's cash-drawer eligibility policy so every cash operation obeys one database-authoritative rule set and one idempotent drawer-job contract. Harden customer CASH payment integration against the S4-002 cashier-session lifecycle and add the cash/refund leg required for approved customer refunds without prematurely implementing the full customer-return inventory/credit-note workflow reserved for Slice 5.

## Included Task ID

- `S4-003`

## Architecture Contract

The cash drawer opens only for eligible, successfully posted cash operations. Current architecture names these eligible classes: cash sales, customer cash debt payments, approved cash refunds, supplier cash payments, cash expenses, and authorized deposits/withdrawals. Receipt reprints, A4 printing, credit sales without cash, failed transactions, searches, login, and invoice previews must never open the drawer.

S4-003 is specifically responsible for the drawer-policy foundation plus customer payment/refund integration. Full customer return costing, quarantine, stock restoration, and credit-note business documents remain Slice 5 work.

## Database Scope

- Introduce one explicit, database-authoritative drawer eligibility policy/operation vocabulary instead of ad-hoc drawer enqueue behavior in individual posting functions.
- Preserve one idempotent drawer job per eligible financial operation.
- Require an `OPEN` cash session owned by the authenticated cashier on the authenticated workstation for customer CASH collections and CASH refunds.
- Reject cash drawer effects while a session is `CLOSING`, `PENDING_APPROVAL`, `SUSPENDED`, or `CLOSED`.
- Ensure non-cash customer payments/refunds create no cash movement and no drawer pulse.
- Ensure failed/retried/idempotent financial requests cannot duplicate drawer jobs.
- Provide the approved customer-refund cash leg and audit linkage without implementing the Slice-5 inventory return/credit-note domain prematurely.
- Keep drawer pulses isolated from document print/reprint queues.

## Rust/Tauri Scope

- Typed drawer-eligibility/refund DTOs and stable IPC errors.
- Thin application services around protected database APIs.
- Preserve database authority for session eligibility, cash movement amount/direction, refund authorization state, and drawer enqueue decisions.

## React Scope

- Customer payment UI must respect real cashier-session lifecycle eligibility rather than merely knowing a session ID.
- Add the bounded customer refund cash interaction required by S4-003, with clear state/error handling.
- No drawer action for bank-transfer/non-cash paths.
- EN/FR/AR and RTL-ready controls consistent with existing customer/cash-session screens.

## Production Invariants

- Drawer eligibility is explicit and centrally enforced.
- One eligible cash operation produces at most one drawer pulse job.
- Idempotent retries return the original financial result and never duplicate a drawer pulse.
- A CASH operation requires the authenticated cashier's currently `OPEN` session on the same workstation.
- Handover takes effect immediately: the old cashier cannot create cash movement or drawer work against the handed-over session.
- Suspended/closing/pending-approval/closed sessions are never cash-eligible.
- Non-cash operations never create cash movements or drawer pulses.
- Printing/reprinting is never a drawer-eligibility signal.
- Refund cash movement direction is negative from the drawer and must be atomically tied to an approved financial refund intent.
- Full customer-return stock costing and credit-note posting remain deferred to Slice 5.

## Verification Target

- PostgreSQL integration tests for eligible/ineligible drawer operations, idempotent retry, session-state rejection, cashier ownership, and payment/refund cash movement direction.
- Real concurrency/idempotency checks ensuring one financial result and one drawer job.
- Regression coverage for cash sales, customer CASH payments, bank transfers, credit sales, reprints, suspension, and handover.
- Rust unit/integration coverage for typed DTO/error behavior.
- Frontend workflow tests for customer payment/refund eligibility and localized error handling.
- Windows/Tauri EN/FR/AR RTL and narrow/touch smoke testing before merge.

## Completed Predecessor

S4-002 is complete and merged into `main` at merge commit `b991f02555fa88bad405bd9f477acbd40a3860c9` after a clean Windows/Tauri pass and green CI covering blind close, variance approval, suspension/resume, handover, stale-cashier blocking, existing-database upgrade compatibility, and cash/credit/customer-payment regressions.
