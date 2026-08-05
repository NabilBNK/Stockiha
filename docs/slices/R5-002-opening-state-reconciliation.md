# R5-002 — Current opening-state reconciliation

## Purpose

Build a controlled package for the business state that exists on the Stockiha go-live date. This is separate from the 1.5-year historical finance archive.

Historical finance answers what happened during the prior period. Opening state answers what the business owns and owes at cutover.

## Included values

- cash on hand;
- bank balance;
- current inventory financial value;
- customer receivables, with customer identity;
- supplier payables, with supplier identity;
- loans payable;
- taxes payable;
- owner capital and retained earnings;
- explicitly described other assets or liabilities.

Historical product-line reconstruction is not required. Physical stock quantities are outside this reconciliation package and require a later inventory-opening workflow when the pilot needs item-level stock control.

## Accounting equation

A package is valid only when:

```text
Assets = Liabilities + Equity
```

Stockiha reports the exact reconciliation difference. A non-zero difference blocks approval.

## Workflow

1. Administrator creates an Excel or manual package for one cutover date.
2. Rows are staged in the isolated `onboarding` schema.
3. Stockiha validates required categories, counterparty identity, review status, and the accounting equation.
4. A reviewer approves only a fully reconciled package.
5. Approval means `APPROVED_FOR_APPLICATION` and creates immutable evidence only.

## Safety boundary

R5-002 does not apply opening balances to operational tables. It creates no:

- live sale or purchase;
- cash movement;
- inventory movement or position;
- customer receivable;
- supplier payable;
- finance journal.

A later forward-only slice must define the idempotent application matrix and reconciliation report before approved opening state can affect live ledgers.

## Authorization and toggles

- feature toggle: `opening_state_reconciliation_enabled`, default ON;
- manage permission: `MANAGE_OPENING_STATE_RECONCILIATION`;
- review permission: `REVIEW_OPENING_STATE_RECONCILIATION`;
- pilot assignment: administrator only;
- direct runtime table access denied;
- setting changes and workflow transitions audited.

## Required validation

- at least one row;
- explicit `CASH`, `BANK`, and `INVENTORY_VALUE` rows, including zero-value rows when applicable;
- at least one `OWNER_CAPITAL` or `RETAINED_EARNINGS` row;
- customer identity for every customer receivable;
- supplier identity for every supplier payable;
- all rows in `READY` review status;
- zero accounting-equation difference.

## Deferred

- direct application to live ledgers;
- item-level opening stock quantities and WAC application;
- automatic customer/supplier master creation;
- historical transaction replay;
- certified accounting or tax statements.
