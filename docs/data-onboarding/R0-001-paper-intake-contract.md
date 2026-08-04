# R0-001 — Historical Finance Onboarding Contract

## Status

This contract reflects the confirmed business workflow on 4 August 2026:

1. The 1.5 years of physical paperwork will be read and entered manually by a paid employee.
2. A controlled Excel workbook is the primary high-volume entry path.
3. Direct entry inside Stockiha is the secondary path for corrections, missing rows, and smaller batches.
4. Scanning or photographing every paper is **not required**.
5. Historical product and supply-line details are not required unless needed to understand a document total.
6. The historical backlog exists primarily to reconstruct finance: sales, purchases, expenses, payments, balances, and an inventory-adjusted profit/loss estimate.

The physical papers remain the external source evidence. Stockiha preserves the employee's `Paper_ID`, review status, and audit trail, but does not require a digital image attachment for MVP import.

## Primary and secondary workflows

### Primary: controlled Excel import

The employee enters one summary row per paper in the official Stockiha workbook. The required columns are ordered first:

- `Paper_ID`
- `Transaction_Date`
- `Transaction_Type`
- `Description_or_Category`
- `Net_Amount_DZD`
- `Payment_Status`
- `Review_Status`

Optional columns:

- `Amount_Paid_DZD_Optional`
- `Expense_Category_Optional`
- `Supplier_Fournisseur_Optional`
- `Customer_Client_Optional`
- `Notes_Optional`

A second `Balances` sheet records opening/closing cash, bank, inventory value, receivables, payables, loans, tax, and owner capital.

### Secondary: direct Stockiha entry

The application uses the same fields and staging tables for:

- one-off historical rows;
- corrections after Excel validation;
- rows that were missing from the workbook;
- small additional batches after the bulk import.

Excel and direct entry must never create separate financial models.

## Historical transaction types

Allowed transaction types:

- `SALE`
- `PURCHASE`
- `EXPENSE`
- `OTHER_INCOME`
- `CUSTOMER_REFUND`
- `SUPPLIER_REFUND`
- `LOAN_RECEIVED`
- `LOAN_REPAYMENT`
- `OWNER_CONTRIBUTION`
- `OWNER_WITHDRAWAL`
- `TAX_PAYMENT`
- `SALARY`
- `OTHER`

Owner contributions and loans must not be reported as sales revenue. Loan repayments and owner withdrawals must not be treated as merchandise purchases.

## Historical balance types

Allowed balance types:

- `OPENING_CASH`
- `CLOSING_CASH`
- `OPENING_BANK`
- `CLOSING_BANK`
- `OPENING_INVENTORY_VALUE`
- `CLOSING_INVENTORY_VALUE`
- `CUSTOMER_RECEIVABLE`
- `SUPPLIER_PAYABLE`
- `LOAN_BALANCE`
- `TAX_PAYABLE`
- `OWNER_CAPITAL`
- `OTHER`

Supplier/fournisseur and customer/client names remain optional for normal paid transactions. They become important when a receivable, payable, partial payment, or unresolved balance must be tracked individually.

## Finance calculation boundary

From approved historical rows, Stockiha may calculate:

- total sales;
- total purchases;
- operating expenses;
- salaries and taxes included in expenses;
- customer and supplier refunds;
- other income;
- preliminary result before inventory adjustment;
- outstanding receivables and payables when payment information is available;
- inventory-adjusted estimated profit or loss when opening and closing inventory values are available.

The inventory-adjusted formula is:

```text
Cost of goods sold
= Opening inventory + Purchases - Supplier refunds - Closing inventory

Estimated profit/loss
= Sales + Other income - Customer refunds - Cost of goods sold - Expenses
```

If opening and closing inventory values are missing, Stockiha must label the result:

```text
INCOMPLETE_WITHOUT_OPENING_AND_CLOSING_INVENTORY
```

It must not present the preliminary result as exact accounting profit.

## Staging and safety rules

1. Excel and manual entry write only to `onboarding` staging tables.
2. Staged historical rows cannot call live sale, purchase, payment, stock, cash, receivable, payable, or journal-posting functions.
3. `Paper_ID` is unique across historical batches to prevent duplicate physical papers.
4. Every batch has a source type: `EXCEL` or `MANUAL`.
5. Excel imports retain the original filename, but not unrestricted filesystem paths.
6. Invalid or uncertain rows remain `NEEDS_REVIEW`.
7. Approved batches become available for historical reporting only.
8. Approval does not replay 1.5 years of historical transactions into live operational ledgers.
9. Current opening state, if later applied, requires a separate idempotent reconciliation and approval operation.
10. Direct table access is denied to the runtime role; guarded database functions enforce permissions and audit.

## Validation rules

The importer must reject or flag:

- missing or duplicate `Paper_ID`;
- invalid dates or future dates;
- unsupported transaction or balance types;
- zero or negative transaction totals;
- inconsistent partial payments;
- unpaid rows that contain a payment amount;
- paid rows whose explicit paid amount differs from the net amount;
- unknown payment status;
- missing category for expenses, salaries, or tax payments;
- customer receivable without a customer name;
- supplier payable without a supplier name;
- rows explicitly marked `NEEDS_REVIEW`.

The employee must use `UNKNOWN` or `NEEDS_REVIEW` instead of guessing.

## Workflow states

Batch states:

- `DRAFT`
- `VALIDATED`
- `NEEDS_REVIEW`
- `APPROVED_FOR_REPORTING`
- `REJECTED`

Row review states:

- `READY`
- `NEEDS_REVIEW`
- `APPROVED`
- `REJECTED`

Approval is replay-safe and audited with actor, workstation, timestamp, and status transition.

## Feature-toggle policy

Historical finance import is controlled by a CEO/administrator-visible setting and defaults **ON**. Disabling the feature blocks creation of new batches without deleting or modifying retained historical evidence.

## MVP completion boundary

R0-001 is complete when:

- the staging schema and permission model pass SQL regressions;
- Excel and manual entry produce the same typed row payload;
- the official minimal `.xlsx` template is parsed and validated;
- a review screen shows row errors and batch totals;
- an authorized user can approve a validated batch for historical reporting;
- finance summaries clearly distinguish preliminary results from inventory-adjusted estimates;
- one targeted Windows/Tauri test imports a representative workbook, fixes one invalid row, approves the batch, and views the resulting historical summary.

## Explicitly deferred

- automated OCR;
- mandatory scanning or image storage;
- historical product-line reconstruction;
- replay of historical stock, sales, purchases, cash, AR, AP, or journals;
- exact tax/accounting certification;
- bankruptcy prediction presented as certainty.
