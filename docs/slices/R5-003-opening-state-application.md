# R5-003 — Approved Opening-State Application

## Product Lifecycle

Opening state is a **one-time optional cutover workflow**, not a permanent daily module and not an annual process.

The first CEO/administrator receives the choice during initial setup:

1. **Enter now** — complete and approve the opening-state package before finishing setup.
2. **Do later** — continue using Stockiha and expose the unfinished workflow later only inside restricted Settings.
3. **Do not use** — explicitly decline opening state and hide the workflow.

The authoritative lifecycle is:

| Status | Meaning | Visibility |
|---|---|---|
| `PENDING` | The initial CEO/administrator has not decided or completed it yet. | Initial setup only; restricted access. |
| `DEFERRED` | It was intentionally postponed. | Restricted Settings card for CEO/admin only. |
| `DECLINED` | The CEO/admin chose to start without existing balances. | Hidden; ordinary users cannot reopen it. |
| `COMPLETED` | One balanced package was approved. | Hidden from normal navigation and disabled for new entry. |

Opening state must never appear in the normal application sidebar. Cashiers and ordinary operators must not discover or access the workflow. Every deferral, decline, and completion decision is audited. Existing databases with an approved package migrate directly to `COMPLETED`.

## Purpose

Apply exactly one approved R5-002 opening-state package to Stockiha's controlled live financial state. This is the cutover bridge between reviewed onboarding evidence and operational use.

This slice must not replay the 1.5-year historical transaction archive. It applies only the approved balances that exist on the Stockiha go-live date.

## Preconditions

An application request is valid only when all of the following are true:

1. The package exists and has status `APPROVED_FOR_APPLICATION`.
2. The package reconciliation difference is exactly zero.
3. Every package line has review status `APPROVED` and no validation errors.
4. The cutover date belongs to an open fiscal period.
5. The application feature is enabled through a CEO/administrator-visible setting, default ON.
6. The actor has a dedicated `APPLY_OPENING_STATE` permission.
7. The package has never been applied successfully.
8. Every customer-receivable line is mapped to an existing operational customer.
9. Every supplier-payable line is mapped to an existing operational supplier.
10. No mapping silently creates, merges, or guesses a customer or supplier.

## Application Model

The application is one atomic database transaction. Either every required financial and subledger record is posted, audited, and linked, or nothing is changed.

### Financial journal

Create one immutable posted journal entry dated on the approved cutover date. The journal must:

- use a stable opening-state source type and source ID;
- contain at least two lines;
- preserve one line or a traceable aggregation for every approved opening-state line;
- balance exactly in DZD;
- use only controlled account mappings already recognized by Stockiha;
- never guess an account code from a free-text description;
- be idempotently linked to the application record and package.

### Posting semantics

| Opening line type | Application behavior |
|---|---|
| `CASH` | Debit the controlled Cash account in the opening journal. This is the financial opening balance; opening a cash session remains a drawer-control action and must not create a second opening journal. |
| `BANK` | Debit the controlled Bank account in the opening journal. |
| `INVENTORY_VALUE` | Debit the controlled Inventory asset account in the opening journal only. Do not create item quantities, warehouse positions, WAC, or inventory movements from a value-only line. Mark physical inventory state as incomplete until the later item-level opening-stock workflow is applied. |
| `CUSTOMER_RECEIVABLE` | Create an immutable opening receivable/subledger item for the mapped existing customer and debit Accounts Receivable in the opening journal. |
| `SUPPLIER_PAYABLE` | Create an immutable opening supplier liability for the mapped existing supplier and credit Accounts Payable in the opening journal. |
| `LOAN_PAYABLE` | Credit the controlled Loan Payable account. |
| `TAX_PAYABLE` | Credit the controlled Tax Payable account. |
| `OWNER_CAPITAL` | Credit the controlled Owner Capital account. |
| `RETAINED_EARNINGS` | Credit the controlled Retained Earnings / accumulated-result account. |
| `OTHER_ASSET` | Require an explicit controlled account mapping before application; debit that account. |
| `OTHER_LIABILITY` | Require an explicit controlled account mapping before application; credit that account. |

Zero-value required lines remain part of the approved evidence but do not create zero-value journal lines.

## Counterparty Mapping

R5-002 deliberately stores reviewed names rather than creating operational master records. R5-003 therefore requires an explicit mapping layer:

- package line ID;
- mapped operational customer ID or supplier ID;
- actor and workstation;
- mapping timestamp;
- optional mapping note;
- immutable mapping snapshot once the package is applied.

The UI must show the evidence name and the selected operational record together. Similar names are suggestions only; application requires an explicit operator selection.

## Idempotency and Immutability

- One successful application per package, enforced by a unique database constraint.
- A stable request ID returns the previous success result when replayed with the same package and payload.
- A conflicting replay is rejected.
- Successful application records, mapping snapshots, journal links, and audit rows are immutable.
- An applied R5-002 package cannot be edited, rejected, or re-approved.
- Corrections after application require a new controlled reversal/correction workflow; no direct mutation is allowed.

## Audit

Record at minimum:

- setup deferred;
- setup declined;
- setup completed;
- application requested;
- mapping changed before application;
- validation failed;
- application posted;
- replay returned;
- application rejected;
- feature setting changed.

Every event records actor, workstation, package, application request, stable reason/error code, and timestamp.

## Safety Boundaries

R5-003 must not:

- display opening state as a daily navigation module;
- allow cashier/operator access;
- force a CEO to enter an opening state;
- reopen an ordinarily completed or declined setup;
- replay historical sales or purchases;
- create historical inventory movements;
- infer product quantities or WAC from inventory value;
- auto-create customers or suppliers;
- post to a closed fiscal period;
- apply an unbalanced or non-approved package;
- apply more than one opening-state package;
- write through the runtime role directly;
- expose raw database errors to the UI.

## Required Verification

Automated tests must prove:

1. `PENDING`, `DEFERRED`, `DECLINED`, and `COMPLETED` lifecycle behavior;
2. initial setup choices and restricted deferred access;
3. cashier/operator denial and absence from normal navigation;
4. completed/declined workflows cannot be ordinarily reopened;
5. permission and feature-toggle enforcement;
6. approved-package and open-period prerequisites;
7. required customer/supplier mappings;
8. exact journal semantics and balance;
9. receivable and payable subledger creation;
10. no inventory movements or positions from `INVENTORY_VALUE`;
11. no live sales or purchases;
12. application idempotency and conflict rejection;
13. all-or-nothing rollback on a forced mid-transaction failure;
14. immutable successful evidence and mappings;
15. backup-role read access and no write access;
16. existing migration, SQL, concurrency, Rust, frontend, and upgrade suites remain green.

## Deferred

- item-level opening stock quantities and WAC;
- automatic party creation or fuzzy auto-matching;
- multi-warehouse allocation of historical inventory value;
- reversal UI for an already applied opening state;
- certified accounting or tax statements;
- replay of the 1.5-year historical archive into live ledgers.
