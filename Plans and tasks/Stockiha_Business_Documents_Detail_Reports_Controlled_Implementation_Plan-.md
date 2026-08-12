# Stockiha Business Documents — Detail Inspection & Reports
## Controlled Implementation Plan for a Weak/Low-Cost Coding Agent

> **Purpose**
>
> This document is an execution contract, not a brainstorming note.
>
> The implementing agent must follow the exact scope, sequence, invariants, data contracts, UI behavior, security rules, tests, and completion gates defined here.
>
> The agent is not authorized to simplify this task into a cosmetic “View” button that merely repeats the row data. The goal is to make every business document that appears in the Stockiha Documents area genuinely inspectable and auditable, while adding a useful reporting layer without inventing accounting totals or double-counting economic events.

---

# 1. Reframed Problem

The current **Business Documents** page succeeds at listing durable documents, but it is still incomplete as an operational audit surface.

The current screen exposes columns similar to:

```text
Document #
Type
Date
Status
Generation
Print
Linked Journal
Action
```

but many rows have:

```text
Action: —
```

This means a user can see that a document exists but cannot inspect:

- its header metadata;
- supplier/customer/warehouse context;
- transaction lines;
- quantities;
- unit values;
- totals;
- notes;
- related purchase order/receipt/invoice/return/payment;
- inventory movement references where applicable;
- liability relationships where applicable;
- linked journal evidence;
- reversal relationships;
- document-generation/print history where supported;
- audit metadata.

That is not sufficient for a stock-management/accounting system.

A second gap is that the page has no dedicated **Reports** area for searching and summarizing document activity over a period.

The correct solution is therefore two related but separate capabilities:

1. **Document Detail Inspection**
   - one authoritative detail experience for every document type shown in the Business Documents list;
   - type-specific information, not a generic row echo;
   - linked records and journal navigation;
   - read-only and permission-safe.

2. **Business Documents Reports**
   - filterable document-activity reporting;
   - counts/status/type breakdowns;
   - carefully separated monetary totals by compatible document type;
   - no invalid “grand total of all documents” that would double-count the same economic flow.

This task must not rewrite transaction posting logic.

---

# 2. Critical Baseline Warning

## 2.1 Current running application is ahead of the published procurement branch

The UI screenshot supplied for this task shows a newer **Business Documents** implementation containing:

- procurement documents;
- journal-entry rows;
- linked journal numbers;
- `N/A` generation/print states;
- type filtering.

However, the currently published remote branch:

```text
task/r8-e-procurement
```

still contains the older printable-documents-only React screen.

Therefore:

> **Do not blindly branch from `task/r8-e-procurement` for this task.**

The currently running code must be identified first.

## 2.2 Mandatory baseline discovery

Before modifying code, the implementing agent must record:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git log -5 --oneline --decorate
git remote -v
git fetch origin --prune
git branch -vv
```

Then determine:

```text
CURRENT_RUNNING_BRANCH
CURRENT_RUNNING_HEAD_SHA
REMOTE_TRACKING_BRANCH, if any
whether current Business Documents changes are committed
whether they are pushed
whether the working tree contains uncommitted implementation work
```

## 2.3 The screenshot/current running candidate is the functional baseline

The agent must preserve the newer Business Documents behavior visible in the current application.

Do not “fix” this task by checking out an older branch that removes:

- procurement documents;
- linked journals;
- type filter;
- Business Documents semantics.

## 2.4 Dirty working tree protection

Never run destructive commands against unrelated changes.

Forbidden on a dirty workspace:

```bash
git reset --hard
git clean -fd
git checkout -- .
```

Preferred approach:

1. identify the exact current candidate;
2. commit/preserve existing authorized work if repository workflow permits;
3. otherwise use a clean worktree based on the exact current commit;
4. never discard unknown user changes.

## 2.5 New branch

Create a dedicated implementation branch from the exact current Business Documents candidate.

Preferred name:

```text
task/business-documents-detail-reports
```

Do not implement directly on `main`.

Do not implement from an old branch merely because this document contains an older branch name.

---

# 3. Authority Hierarchy

When implementation choices conflict, use:

1. existing database/accounting invariants;
2. current accepted architecture/ADRs;
3. current running Business Documents implementation;
4. this implementation plan;
5. existing typed domain/application/IPC patterns;
6. existing tests representing accepted behavior;
7. current visual convenience.

The cheap agent may not override accounting semantics to make reporting easier.

---

# 4. Agent Operating Contract

## 4.1 Required behavior

The agent must:

- inspect the current implementation before editing;
- inventory every business document type that can appear;
- inventory every existing detail API/component before creating new ones;
- reuse existing detail views when they already satisfy the requirement;
- create type-specific detail contracts for missing document types;
- keep exact numeric strings throughout IPC;
- keep PostgreSQL authoritative;
- keep all detail/report APIs read-only;
- preserve permission boundaries;
- preserve immutable posted records;
- preserve journal integrity;
- add tests for every supported document type;
- verify English, French, Arabic and RTL;
- verify light/dark themes;
- verify restart persistence;
- inspect the final diff for unrelated changes.

## 4.2 Forbidden agent behavior

The agent must not:

- add a fake `View Details` modal containing only number/type/date/status;
- serialize entire database rows with `SELECT *`;
- expose internal IDs without useful labels when human-readable references exist;
- expose SQL diagnostics;
- add runtime write access for detail/report screens;
- recalculate posted transaction totals in JavaScript;
- use `parseFloat` for money;
- infer historical accounting snapshots from current mutable values without labeling them;
- sum purchase orders + receipts + invoices + payments into one “Total Business Value”;
- treat journal debit/credit totals as sales/purchase revenue;
- create transaction PDFs as a shortcut for “view details”;
- redesign posting workflows;
- mutate historical documents;
- rebuild the Documents feature from scratch if the current implementation can be extended safely;
- create one giant backend function with unsafe dynamic SQL for all document types;
- bypass permissions to make rows visible;
- hide unsupported rows instead of implementing their detail path;
- mark the task complete while any visible business document still has a meaningless `—` action.

---

# 5. Scope

## 5.1 Mandatory in-scope capabilities

### A. Document Detail Inspection

Every document row visible in Business Documents must provide an appropriate action:

```text
View details
```

or, for a journal entry:

```text
View journal
```

The detail experience must show all persisted business information relevant to that document type.

### B. Relationship navigation

Where applicable, detail must provide safe navigation to:

- purchase order;
- purchase receipt;
- supplier invoice;
- supplier liability;
- supplier return;
- supplier payment;
- customer;
- customer invoice/payment;
- warehouse;
- linked journal;
- reversing/reversed document;
- generation/print history.

### C. Reports tab/section

Add a dedicated:

```text
Reports
```

view inside Business Documents.

It must provide:

- date range;
- document type;
- status;
- search;
- party filters where applicable;
- journal-link filter;
- counts;
- breakdown by type;
- breakdown by status;
- type-compatible monetary summaries;
- filtered detail table.

### D. Existing detail viewer integration

Reuse existing correct detail components/read models for:

- cash sale receipt;
- credit-sale invoice;
- customer payment;

and any other current types already having safe typed detail support.

### E. Missing detail APIs

Add secure typed read APIs for visible types that currently have no complete detail path.

### F. Tests and acceptance

Add database, Rust, TypeScript/React, permission, localization, visual/manual acceptance coverage.

---

# 6. Explicitly Out of Scope

## 6.1 No posting changes

Do not change:

- purchase-order confirmation semantics;
- receipt posting;
- landed-cost allocation;
- supplier-invoice posting;
- supplier-return posting;
- supplier-payment posting;
- sales posting;
- customer payment posting;
- stock receipt posting;
- stock adjustment posting.

This task reads already-persisted data.

## 6.2 No accounting-policy redesign

Do not change:

- WAC;
- GRNI;
- accounts payable;
- procurement variance;
- sales accounting;
- cash accounting;
- tax/TVA;
- discounts;
- FX policy;
- chart of accounts.

## 6.3 No generic cross-document monetary grand total

Explicitly forbidden:

```text
Purchase Orders
+ Purchase Receipts
+ Supplier Invoices
+ Supplier Payments
+ Returns
+ Journal totals
= "Total Business Value"
```

This is invalid because the same economic flow appears in multiple document stages.

## 6.4 No procurement PDF generation

This task does not require:

- purchase-order PDFs;
- purchase-receipt PDFs;
- supplier-invoice PDFs;
- supplier-return PDFs;
- supplier-payment PDFs.

Document details are an application read view.

## 6.5 No journal editing

Journal-entry documents route to the existing/new Journals viewer.

No:

- manual journal edit;
- reversal from document detail;
- journal-line mutation.

## 6.6 No broad analytics suite

Do not turn Business Documents Reports into:

- profit and loss;
- balance sheet;
- cash flow;
- inventory valuation report;
- supplier aging report;
- sales analytics dashboard.

Those are separate accounting/reporting features.

This task reports **document activity**, not full financial statements.

## 6.7 No unrelated UI redesign

Do not redesign:

- sidebar;
- dashboard;
- procurement screens;
- POS;
- global design system.

Use existing Stockiha components/tokens.

---

# 7. Non-Negotiable Data Principles

## 7.1 Read-only

Document detail and reports must not mutate posted transaction data.

## 7.2 Exact numeric values

Money and quantity values must remain exact decimal strings through:

```text
PostgreSQL numeric
→ Rust Decimal/string
→ serialized DTO
→ TypeScript string
→ formatted UI
```

Do not use binary floating-point for authoritative totals.

## 7.3 Snapshot versus current state

A detail view must distinguish:

```text
At-posting snapshot
```

from:

```text
Current state
```

Example:

A supplier invoice was posted for 1,050 DZD.

Its liability may currently be:

```text
840 DZD outstanding
```

after payment/return activity.

Do not label `840` as the original invoice total.

Use labels such as:

```text
Invoice total: 1,050.00 DZD
Current outstanding payable: 840.00 DZD
```

## 7.4 Human-readable references

Display:

```text
PO-2026-000001
PR-2026-000001
PI-2026-000001
SP-2026-000001
JE-2026-000003
```

rather than only numeric IDs.

Internal ID may be shown in a technical/audit section if useful.

## 7.5 Permission-safe joins

A user must not gain access to supplier/customer/accounting data merely because a generic document header exists.

Detail authorization must respect the same domain permissions as the underlying record.

## 7.6 No hidden inconsistency

If the common business-document header says POSTED but the expected subtype row is missing:

- do not crash;
- do not fabricate data;
- show a safe “Document data incomplete” state;
- record the anomaly in developer diagnostics/tests;
- do not expose SQL/table names in UI.

---

# 8. Mandatory Phase Order

Execute in this order:

```text
Phase 0  — Baseline capture
Phase 1  — Document type inventory
Phase 2  — Existing read-model inventory
Phase 3  — Common detail contract
Phase 4  — Procurement detail contracts
Phase 5  — Inventory detail contracts
Phase 6  — Sales/customer integration
Phase 7  — Journal integration
Phase 8  — Detail UI
Phase 9  — Relationships/audit trail
Phase 10 — Reports query
Phase 11 — Reports UI
Phase 12 — Permission hardening
Phase 13 — Localization/RTL/accessibility
Phase 14 — Automated verification
Phase 15 — Windows/Tauri acceptance
Phase 16 — Diff review and delivery
```

Do not begin Reports before the document detail/read-model inventory is complete.

---

# 9. Phase 0 — Baseline Capture

## 9.1 Record current state

Produce:

```text
Current branch:
Current HEAD:
Remote tracking branch:
Working tree status:
Current Business Documents feature commit:
Current database schema migration version:
```

## 9.2 Capture current Business Documents behavior

Before editing, record:

- columns;
- current type filter values;
- which document types appear;
- which document types have `Action —`;
- which rows already have view actions;
- whether journal numbers are clickable;
- whether row selection exists;
- pagination behavior;
- current query limit;
- feature toggle state;
- permissions used by the list API.

## 9.3 Screenshot evidence

Capture/retain a before-state screenshot showing the current missing action behavior.

The supplied screenshot is evidence of this defect.

---

# 10. Phase 1 — Build the Authoritative Document-Type Inventory

## 10.1 Do not hard-code from this plan

The agent must inspect the **current running HEAD**.

Determine every `core.business_documents.document_type` currently allowed and every type actually produced by posting code.

Build:

```text
Document type
Created by operation
Subtype table
Existing detail API?
Existing detail UI?
Linked journal expected?
Generation/print supported?
Required permission
Visible in Business Documents?
Required action
```

## 10.2 Minimum known types to investigate

At minimum inspect:

```text
CASH_SALE
CREDIT_SALE
CUSTOMER_PAYMENT
CUSTOMER_REFUND, if current HEAD supports it
STOCK_RECEIPT
STOCK_ADJUSTMENT
PURCHASE_ORDER
PURCHASE_RECEIPT
PURCHASE_INVOICE
PURCHASE_RETURN
SUPPLIER_PAYMENT
JOURNAL_ENTRY
```

Also include any additional document type present in the current constraint/current list query.

## 10.3 No visible type may remain unmapped

If Business Documents returns a type that the agent has not mapped:

```text
STOP
```

Do not silently render raw type + no action.

---

# 11. Phase 2 — Inventory Existing Detail APIs and Components

## 11.1 Reuse before creation

Search current HEAD for:

```text
get*Detail
get*Document
list*Lines
*DocumentView
ReceiptView
CustomerDocumentView
PurchaseOrderDetail
JournalDetail
```

## 11.2 Known reusable baseline patterns

The repository already has, at minimum:

- typed purchase-order detail DTO with line-level information;
- cash-sale receipt detail viewer;
- customer credit-sale/payment detail viewer.

The current candidate may contain more.

## 11.3 Required inventory output

For each document type:

```text
Reuse existing API
Extend existing API
Create new API
Reuse existing component
Extend existing component
Create new component
```

The agent must justify new code where reusable code already exists.

---

# 12. Phase 3 — Common Business Document Detail Contract

## 12.1 Common header

Every detail view must expose a common metadata block.

Minimum fields, where they exist:

```text
document_id
document_type
document_number
status
document_date
fiscal_year
fiscal_period_id
posted_at
created_at
updated_at
reverses_document_id
reverses_document_number
reversed_by_document_id (derived reverse lookup, if present)
reversed_by_document_number
linked_journal_document_id
linked_journal_document_number
```

## 12.2 Common labels

UI must have localized labels for:

```text
Document number
Document type
Status
Document date
Fiscal year
Fiscal period
Posted at
Created at
Updated at
Linked journal
Reverses
Reversed by
Internal ID
```

## 12.3 Do not duplicate subtype authority

The common query owns only common metadata.

Type-specific values must come from the authoritative subtype/domain tables.

## 12.4 Safe missing relationships

If no linked journal is expected:

```text
Not applicable
```

If a journal is expected but missing:

```text
Missing linked journal
```

These are different states.

Do not show both as `—`.

---

# 13. Phase 4 — Procurement Document Details

The following requirements are mandatory for procurement document types visible in the list.

---

## 13.1 Purchase Order Detail

### Header

Show:

```text
PO number
status
supplier code/name
warehouse code/name
document date
created date/time
confirmed date/time
subtotal
total
note
```

### Lines

For each PO line:

```text
line #
SKU
product/variant name
unit
quantity ordered
quantity received
remaining quantity
unit cost
line total
```

### Related documents

Show:

```text
Purchase receipts from this PO
Supplier invoices linked to this PO
Supplier returns linked to this PO
```

Each relationship should include:

```text
document number
date
status
amount where meaningful
View details
```

### Journal

A purchase order normally does not create an accounting journal in the accepted workflow.

Display:

```text
Linked journal: Not applicable
```

Do not fabricate one.

---

## 13.2 Purchase Receipt Detail

### Header

Show:

```text
receipt number
purchase order number
supplier
warehouse
document date
posted at
subtotal
total amount
posted-by actor if persisted
workstation if persisted
```

### Lines

For each receipt line:

```text
line #
SKU
variant
unit
PO line reference
quantity received
unit cost
line total
inventory movement reference
```

### Landed cost

If a landed-cost posting exists, show a clearly separate section:

```text
Landed cost amount
allocation method, if persisted/available
landed-cost journal number
posted date
```

Do not merge landed cost into the original receipt subtotal and pretend the receipt itself was posted at that amount.

### Related records

Show:

```text
PO
supplier invoices consuming receipt lines
supplier returns related to PO/variant
```

### Journal

Show:

```text
View receipt journal
```

If landed cost exists:

```text
View landed-cost journal
```

---

## 13.3 Supplier Invoice Detail

### Header

Show:

```text
supplier invoice number
supplier
purchase order
status
document date
created at
posted at
currency
exchange rate to DZD
foreign subtotal
foreign total
base subtotal
base total
note
```

### Lines

For each invoice line:

```text
line #
SKU
variant
PO line
receipt line
quantity
unit cost
line total
```

### Payable

Show separate immutable vs current facts:

```text
Original invoice total
Liability ID/reference
Original payable amount
Current outstanding payable
Current liability status
Due date
```

Do not label current outstanding as invoice total.

### Related payments/returns

Show:

```text
Supplier payments allocated to this liability
Supplier returns that affected the payable, where relationship can be proved
```

Do not infer linkage merely because supplier and date match.

### Journal

Show:

```text
View supplier-invoice journal
```

---

## 13.4 Supplier Return / Debit Note Detail

### Header

Show:

```text
debit note / return number
supplier
warehouse
purchase order
reason code localized
note
document date
created at
posted at
status
```

### Lines

Show:

```text
line #
SKU
variant
quantity
persisted authoritative supplier unit cost
line total
```

### Accounting impact

Where reliably derivable from the linked journal/result data, show:

```text
clearing account role/line
supplier clearing amount
inventory credit/value removed
procurement variance
```

Important:

Do not recalculate posting-time WAC from the current inventory position.

If posting-time values are only represented in the journal, use the journal as the authoritative evidence.

### Related documents

Show:

```text
purchase order
source receipts relevant to the returned variant
supplier invoice if unambiguous
current related liability where provable
```

### Journal

Show:

```text
View return journal
```

---

## 13.5 Supplier Payment Detail

### Header

Show:

```text
payment number
supplier
document date
posted at
amount
payment method
reference number
note
```

### Allocation/source

Show:

```text
liability reference
liability source type
source invoice / landed-cost liability document
original liability amount
current remaining amount
current liability status
```

Clearly mark the latter as current state.

### Journal

Show:

```text
View payment journal
```

### Funding

If safely exposed from persisted posting/journal evidence, show:

```text
Cash
Bank
```

Do not infer from account-code string in React.

---

# 14. Phase 5 — Inventory Document Details

If these types are visible in the current Business Documents list, they must be inspectable.

---

## 14.1 Stock Receipt

Show:

```text
document number
warehouse
date
posted at
reference/note if present
lines
SKU
variant
quantity
unit cost
line value
inventory movement references
linked journal if workflow creates one
```

Do not reuse purchase-receipt terminology for a generic stock receipt.

---

## 14.2 Stock Adjustment

Show:

```text
document number
warehouse
date
reason
note
status
lines
SKU
variant
quantity delta
value delta
resulting quantity/value where persisted
movement references
journal if present
```

Use existing adjustment domain semantics.

Do not invent “purchase cost” for adjustment rows.

---

# 15. Phase 6 — Sales and Customer Document Integration

## 15.1 Cash Sale

The repository already has a cash-sale receipt detail viewer.

Reuse or adapt it inside the new unified detail flow.

Do not create a second cash-sale implementation with different fields.

Minimum retained information:

```text
document number
date
sale lines
quantity
unit price
line total
total
generation/print/drawer jobs
```

## 15.2 Credit Sale

Reuse the existing customer document view.

Retain:

```text
customer
customer code
tax ID/address where available
due date
lines
quantity
unit price
line total
total
generation/print jobs
```

Add common Business Document metadata and linked journal action if the current posting workflow has a journal.

## 15.3 Customer Payment

Reuse the existing customer-payment viewer.

Retain:

```text
customer
payment method
note
invoice allocations
amount
generation/print jobs
```

Add common metadata and journal action where applicable.

## 15.4 Customer Refund

If current HEAD supports and lists it:

- inspect current refund domain;
- add a dedicated detail section;
- show source sale/customer;
- returned lines/amount;
- refund method;
- journal;
- inventory effects where persisted.

Do not omit it because the screenshot currently has no refund row.

---

# 16. Phase 7 — Journal Entry Rows

## 16.1 Journal entry is not a generic transaction-detail document

For:

```text
JOURNAL_ENTRY
```

the Business Documents action should be:

```text
View journal
```

not a duplicate “View details” modal that reproduces the journal screen.

## 16.2 Expected journal view

Show:

```text
journal number
date
status
description
source type
source document
total debit
total credit
balance status
account lines
```

## 16.3 Back-navigation

From journal detail:

```text
Back to Business Documents
```

or preserve current navigation state.

If journal source is a business document:

```text
View source document
```

when permission allows.

Avoid navigation loops that lose filter state.

---

# 17. Phase 8 — Document Detail UI Architecture

## 17.1 Recommended interaction

Use one consistent detail experience.

Preferred desktop behavior:

```text
Business Documents list
→ click View details
→ detail panel/page
→ back to same filtered list
```

The exact implementation may be:

- dedicated sub-route;
- full-width in-screen detail mode;
- large side drawer;

but it must support the information density required.

## 17.2 Do not use a tiny modal

A small confirmation-style modal is not acceptable for:

- 10+ line purchase orders;
- invoice lines;
- related documents;
- audit data;
- journal links.

Use a full-size detail surface.

## 17.3 Preserve list state

Opening and closing detail must preserve:

```text
type filter
date filter
status filter
search
report/list tab
scroll position where feasible
pagination/page
```

Do not reload the screen to defaults every time.

## 17.4 Detail layout

Recommended structure:

```text
[Back]  Document title / number        Status badge

Overview
------------------------------------------------
Type | Date | Posted At | Fiscal Period
Party | Warehouse | Total | Journal

Lines
------------------------------------------------
...

Relationships
------------------------------------------------
PO / receipt / invoice / return / payment

Accounting / Inventory evidence
------------------------------------------------
Journal(s), movement references, liability where applicable

Document output
------------------------------------------------
Generation / print jobs where applicable

Audit
------------------------------------------------
Internal ID, created/updated, reversal relationships
```

Not every section applies to every type.

Do not render empty meaningless cards.

## 17.5 Loading/error state

Detail fetch must have:

```text
loading
not found
permission denied
incomplete data anomaly
generic safe error
```

Do not keep displaying stale prior-document detail after a new selection fails.

---

# 18. Phase 9 — Relationships and Audit Trail

## 18.1 Relationship graph

The detail backend should expose explicit links rather than making React guess relationships.

Examples:

```text
PO -> receipt(s)
PO -> invoice(s)
PO -> return(s)
Receipt -> PO
Receipt -> landed cost
Invoice -> PO
Invoice -> liability
Liability -> payment(s)
Return -> PO
Payment -> liability/source
Journal -> source document
Document -> reversal
```

## 18.2 No heuristic linking

Forbidden relationship logic:

```text
same supplier + close date = related
same amount = related
nearest document number = related
```

Use foreign keys/source IDs only.

## 18.3 Reversal evidence

If reversal is supported:

Show:

```text
This document reverses: X
This document was reversed by: Y
```

based on the authoritative reversal relationship.

Do not mutate the original document to create a reverse pointer.

---

# 19. Phase 10 — Secure Detail Backend API

## 19.1 Preferred design

Do not build:

```text
get_any_document_detail(document_id) -> arbitrary JSON blob
```

with dynamic table selection.

Use a common header read plus typed domain detail reads.

Possible design:

```text
documents.get_business_document_header(...)
procurement.get_purchase_receipt_detail(...)
procurement.get_supplier_invoice_detail(...)
procurement.get_supplier_return_detail(...)
procurement.get_supplier_payment_detail(...)
inventory.get_stock_receipt_detail(...)
inventory.get_stock_adjustment_detail(...)
```

Reuse existing:

```text
get_purchase_order_detail
get sale/customer document payload
journal detail
```

where already correct.

## 19.2 Security-definer requirements

For new PostgreSQL read functions:

- session token required;
- resolve correct permission;
- stable/read-only;
- `SECURITY DEFINER` where repository pattern requires it;
- safe `search_path`;
- `REVOKE ALL ... FROM PUBLIC`;
- grant execute only to runtime role;
- explicit ID validation;
- deterministic ordering.

## 19.3 Permission must follow domain

Examples:

```text
Procurement detail -> procurement permission
Cash sale -> appropriate sales/cash permission
Customer credit/payment -> customer permission
Journal -> finance/journal read permission
Inventory -> inventory permission
```

Do not create one `VIEW_ALL_DOCUMENTS` permission that bypasses every domain boundary unless current accepted architecture already defines such a permission.

## 19.4 Missing subtype

If header exists but subtype row does not:

Return a typed safe state such as:

```text
INCOMPLETE_DOCUMENT_DATA
```

or a safe not-found result according to current error contract.

Private diagnostic may record:

```text
expected PURCHASE_INVOICE subtype missing
```

but UI must remain sanitized.

---

# 20. Phase 11 — TypeScript/Rust Contracts

## 20.1 Typed DTOs

Do not use `any`.

Prefer discriminated types such as:

```ts
type BusinessDocumentDetail =
  | PurchaseOrderDocumentDetail
  | PurchaseReceiptDocumentDetail
  | SupplierInvoiceDocumentDetail
  | SupplierReturnDocumentDetail
  | SupplierPaymentDocumentDetail
  | StockReceiptDocumentDetail
  | StockAdjustmentDocumentDetail
  | CashSaleDocumentDetail
  | CreditSaleDocumentDetail
  | CustomerPaymentDocumentDetail;
```

Journal entry can navigate to its own detail contract.

## 20.2 Common metadata type

Create/reuse:

```ts
interface BusinessDocumentHeader {
  document_id: number;
  document_type: ...;
  document_number: string | null;
  status: ...;
  document_date: string;
  fiscal_year: number;
  fiscal_period_id: number;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
  ...
}
```

Do not duplicate common fields in incompatible formats.

## 20.3 Monetary values

Use:

```ts
string
```

for money/decimal values.

Never:

```ts
number
```

for authoritative DZD values.

---

# 21. Phase 12 — Business Documents Reports

## 21.1 Purpose

Reports answer:

```text
What documents were created/posted/reversed during this period?
What types?
Which parties?
What statuses?
Which records have journals?
What type-specific transaction amounts were recorded?
```

Reports do **not** answer full accounting profitability.

## 21.2 Reports tab

Add tabs or an equivalent clear switch:

```text
Documents
Reports
```

Default may remain Documents.

## 21.3 Mandatory report filters

At minimum:

```text
Date from
Date to
Document type
Status
Search document number
Has linked journal: All / Yes / No
```

Where feasible based on current secure read model:

```text
Supplier
Customer
Warehouse
```

Party filters may be context-sensitive rather than one giant ambiguous party select.

## 21.4 Date semantics

Report date filter must clearly use:

```text
Document date
```

or:

```text
Posted date
```

Do not mix them silently.

Recommended:

```text
Date basis:
- Document date
- Posted date
```

If that is too much for MVP, use `document_date` and label it explicitly.

## 21.5 Report summary cards

Mandatory non-monetary cards:

```text
Documents
Posted
Draft
Reversed
With linked journal
Without linked journal
```

Only show statuses that exist in current query.

## 21.6 Type breakdown

Show:

```text
Document type | Count | Posted | Draft/Reversed
```

Use localized type labels.

Do not show raw enum strings as the primary UI label.

## 21.7 Monetary summaries — strict rules

Monetary totals must be grouped by semantically compatible document type.

Examples:

```text
Purchase orders: ordered value
Purchase receipts: received goods value
Supplier invoices: invoiced value
Supplier returns: supplier credit/return value
Supplier payments: paid amount

Cash sales: sales value
Credit sales: invoiced sales value
Customer payments: collected amount
Customer refunds: refunded amount
```

These totals must remain separate.

Display a note:

```text
Amounts are shown by document type and are not additive across workflow stages.
```

Required EN/FR/AR localization.

## 21.8 Journal-entry amount

Do not include journal debit/credit totals in transaction-value totals.

If Journal Entry rows are included in report:

show:

```text
Journal entries: count
Balanced: count
Unbalanced: count
```

Do not call total debit “business value.”

## 21.9 Inventory documents

For stock receipt/adjustment:

Only show monetary report totals if the current persisted document/detail model contains an authoritative value with clear semantics.

Otherwise report:

```text
count
quantity activity where semantically safe
```

Do not invent a money total by multiplying current WAC in React.

---

# 22. Phase 13 — Reports Backend

## 22.1 Server-side filtering

Do not fetch the entire document history and perform all reporting in React.

Use secure bounded database queries.

## 22.2 Report query inputs

At minimum:

```text
session token
date_from
date_to
document_type optional
status optional
search optional
linked_journal filter optional
supplier/customer/warehouse optional if supported
limit/page or cursor
```

## 22.3 Report output

Prefer two contracts:

```text
documents.get_business_document_report_summary(...)
documents.list_business_document_report_rows(...)
```

Summary:

```text
total_count
posted_count
draft_count
reversed_count
linked_journal_count
unlinked_journal_count
type_counts[]
type_amounts[]
```

Rows:

reuse/extend Business Document list row.

## 22.4 Exact aggregation

Use PostgreSQL `numeric`.

Serialize aggregated amounts as exact strings.

## 22.5 Monetary source mapping

For every reported monetary amount, document the authoritative source:

```text
PURCHASE_ORDER -> procurement.purchase_orders.total_amount
PURCHASE_RECEIPT -> procurement.purchase_receipts.total_amount
PURCHASE_INVOICE -> procurement.supplier_invoices.base_total_amount
PURCHASE_RETURN -> sum(persisted supplier_return_lines.line_total)
SUPPLIER_PAYMENT -> procurement.supplier_payments.amount
...
```

Do not aggregate generic values from journal lines as substitutes.

## 22.6 Missing value

If a type has no meaningful report amount:

```text
amount = null
amount_semantic = NONE
```

Do not return zero, because zero means a real zero-valued transaction.

---

# 23. Phase 14 — Report Table UX

## 23.1 Columns

Recommended:

```text
Document #
Type
Date
Status
Party
Amount
Linked journal
Action
```

The Amount column uses the semantic amount for that document type.

Journal entry:

```text
Amount: N/A
```

## 23.2 Sorting

Support deterministic sorting for visible report rows where current table architecture supports it.

At minimum:

```text
Date
Document #
Type
Status
Amount
```

Amount sorting must compare exact numeric values correctly.

Do not use lexical string sort for money.

## 23.3 Pagination

Do not render thousands of records without pagination/bounded loading.

Reuse current list pagination if implemented.

If current Business Documents list is still a fixed limit:

this task should introduce proper bounded pagination for both list and report views if required for operational usability.

## 23.4 Empty report

Show:

```text
No business documents match the selected filters.
```

not a blank table.

---

# 24. Phase 15 — Search and Filtering on Main Documents List

The main Documents tab should also be operationally usable.

At minimum support:

```text
Type
Status
Date range
Document number search
```

Current type filter must be preserved.

If current implementation already supports more, do not regress it.

## 24.1 Search semantics

Search should be case-insensitive where appropriate and bounded.

Do not construct SQL with concatenated user input.

Use parameters.

---

# 25. Phase 16 — Export Scope

## 25.1 Reports export is optional only under this exact rule

Inspect current repository for an existing reusable secure report export abstraction.

If a stable Excel/CSV export utility already exists and can be reused without building a new subsystem:

```text
IN SCOPE: export the currently filtered Business Documents report
```

Preferred:

```text
Excel/XLSX
```

with proper typed dates and numeric cells.

If no reusable export infrastructure exists:

```text
OUT OF SCOPE for this defect repair
```

Do not spend the task building a new export engine.

## 25.2 Transaction PDFs remain out of scope

A Reports export is not permission to create purchase-order or invoice PDFs.

---

# 26. Phase 17 — Action Column Rules

This is a hard acceptance rule.

## 26.1 Transaction documents

For every visible supported transaction document:

```text
Action = View details
```

## 26.2 Journal entry

```text
Action = View journal
```

## 26.3 Generated customer/sale documents

`View details` opens the existing detail view and generation/print controls as authorized.

## 26.4 No generic dash

After completion, `Action —` is allowed only if:

- the row is a deliberately non-interactive type explicitly excluded from Business Documents;
- or current permissions prohibit detail access and UI displays a meaningful `Not authorized` state.

For supported visible documents, a dash is a failure.

---

# 27. Phase 18 — Linked Journal Column

## 27.1 Make it actionable

If a linked journal exists:

```text
JE-2026-000001
```

should be clickable or have:

```text
View journal
```

Do not require opening the document first just to inspect the journal.

## 27.2 No linked journal

Differentiate:

```text
Not applicable
```

from:

```text
Missing
```

Example:

Purchase Order:

```text
Not applicable
```

Posted Purchase Receipt with no journal when journal is required:

```text
Missing
```

The second is an anomaly.

---

# 28. Phase 19 — Generation and Print Detail

## 28.1 Supported types

For document types with generation/print jobs:

show:

```text
generation status
generated file reference
print status
attempt count
last error safe code/status
reprint action where already authorized
```

Reuse existing components.

## 28.2 Unsupported types

For procurement documents without generation:

```text
Generation: Not applicable
Print: Not applicable
```

No fake job rows.

---

# 29. Phase 20 — Permissions Matrix

Mandatory roles to test:

```text
Administrator
Manager
Cashier / sales-only user
Other restricted user if present
Invalid/expired session
```

## 29.1 Administrator/Manager

Expected:

- procurement document details;
- journal viewer if permitted;
- Business Documents Reports;
- inventory documents according to role.

## 29.2 Cashier

Expected:

- sales/cash documents the role is entitled to;
- customer documents according to permissions;
- no supplier procurement details unless existing policy explicitly grants them;
- no unrestricted journals.

## 29.3 Invalid session

Expected:

```text
safe SESSION_INVALID handling
```

No cached sensitive detail should remain visible after session invalidation/logout.

---

# 30. Phase 21 — Localization

Every new UI string must exist in:

```text
English
French
Arabic
```

At minimum localize:

```text
View details
View journal
Overview
Lines
Relationships
Accounting
Inventory
Audit
Reports
Date from
Date to
Status
Document type
Party
Amount
With journal
Without journal
Not applicable
Missing linked journal
Current outstanding
Original amount
Reverses
Reversed by
No documents match filters
Amounts are shown by document type and are not additive across workflow stages
```

Do not show raw enum values as user copy when a localized label exists.

---

# 31. Phase 22 — RTL Requirements

Arabic must be tested explicitly.

Rules:

- document numbers remain readable;
- monetary numbers remain readable;
- debit/credit semantics do not swap;
- numeric table alignment remains consistent;
- back button placement follows current design;
- relationship cards do not overflow;
- detail line tables scroll horizontally when necessary;
- action buttons remain visible.

---

# 32. Phase 23 — Accessibility

At minimum:

- real buttons/links for actions;
- keyboard focus;
- visible focus state;
- `aria-label` where icon-only action exists;
- table headers associated correctly;
- modal/drawer focus trapping if modal/drawer architecture is chosen;
- Escape closes drawer/modal if appropriate;
- status not represented by color alone.

Do not use clickable `<div>` rows without keyboard behavior.

---

# 33. Phase 24 — Database Test Matrix

## 33.1 Header/detail authorization

For each supported domain:

- authorized session succeeds;
- unauthorized session denied;
- invalid session denied.

## 33.2 Detail identity

Given document ID X:

- returned header ID = X;
- document number matches;
- subtype matches document type;
- no cross-document line leakage.

## 33.3 Line ordering

Lines ordered by:

```text
line_number
```

## 33.4 Exact totals

For each type:

- sum of persisted line totals equals authoritative document total where domain invariant requires it;
- detail returns exact decimal strings.

Do not create a new constraint just to satisfy display unless accepted schema already defines the invariant.

## 33.5 Relationships

Verify foreign-key/source relationships return only actual linked documents.

## 33.6 Reports

Test:

- date filters;
- type filter;
- status;
- journal filter;
- search;
- party filter;
- pagination;
- counts;
- type amounts;
- null amount semantics;
- no cross-type grand total.

---

# 34. Phase 25 — React Test Matrix

## 34.1 Main list

Test:

- action present for every visible type;
- journal link clickable;
- filter state preserved;
- error state;
- empty state.

## 34.2 Purchase Order detail

Test:

- header;
- supplier;
- warehouse;
- lines;
- ordered/received/remaining;
- total;
- relationships.

## 34.3 Purchase Receipt detail

Test:

- PO link;
- lines;
- landed cost section;
- journal links.

## 34.4 Supplier Invoice detail

Test:

- invoice lines;
- currency/base amounts;
- original/current payable labels;
- payment relationships;
- journal.

## 34.5 Supplier Return detail

Test:

- reason;
- lines;
- accounting impact;
- journal.

## 34.6 Supplier Payment detail

Test:

- amount;
- method;
- liability source;
- current remaining state;
- journal.

## 34.7 Existing sale/customer viewers

Regression tests prove they still work when opened through unified Business Documents.

## 34.8 Journal entry

Action routes to journal detail.

## 34.9 Reports

Test:

- filters;
- summary counts;
- type totals;
- warning note;
- report rows;
- open detail from report;
- return to report with filters preserved.

---

# 35. Phase 26 — Known Business Fixture for Acceptance

Use the current procurement acceptance fixture if available.

Example documents:

```text
PO-2026-000001
PR-2026-000001
PI-2026-000001
SP-2026-000001
JE-2026-000001
JE-2026-000002
JE-2026-000003
```

If supplier return/debit note exists, include it.

## 35.1 PO detail expected evidence

User can see:

- supplier;
- warehouse;
- ordered lines;
- quantities;
- unit costs;
- total;
- related receipt/invoice.

## 35.2 Receipt detail

User can see:

- exact receipt lines;
- PO;
- journal;
- landed cost if posted.

## 35.3 Invoice detail

User can see:

- line quantities/cost;
- total;
- liability;
- current outstanding;
- journal.

## 35.4 Supplier payment

User can see:

- payment amount;
- method;
- liability/source;
- journal.

## 35.5 Journal entry

User can click from Business Documents directly into balanced journal detail.

---

# 36. Phase 27 — Reports Acceptance Fixture

Use a known date range that includes the above documents.

Expected report must show separate counts such as:

```text
Purchase orders: 1
Purchase receipts: 1
Supplier invoices: 1
Supplier payments: 1
Journal entries: 3
```

Do not require those exact counts if current fixture includes more records; calculate expected counts from the controlled fixture.

## 36.1 Separate monetary buckets

For example, if fixture contains:

```text
PO = 1,000 DZD
Receipt = 1,000 DZD
Invoice = 1,050 DZD
Supplier payment = 210 DZD
```

Report must show four separate type-specific amounts.

It must **not** show:

```text
Total = 3,260 DZD
```

as a meaningful business total.

That would double-count the workflow.

---

# 37. Phase 28 — Performance Requirements

## 37.1 No N+1 list detail loading

The Business Documents list must not fetch full detail for every row.

List API returns summary only.

Detail API is called when user opens one document.

## 37.2 Report aggregation server-side

Do not fetch 10,000 rows and calculate summary cards in React.

## 37.3 Index review

Inspect query plans/keys for:

```text
document_date
posted_at
document_type
status
document_number
source relationships
```

Only add indexes if the actual query and existing indexes justify them.

Do not add speculative indexes to every column.

---

# 38. Phase 29 — Security Review

Before finalizing, verify:

- no SQL diagnostics in UI;
- no supplier/customer data exposed across permission boundary;
- no raw access-token logging;
- no filesystem path exposure from generated-file references beyond existing safe UI policy;
- no new direct write grants;
- report filters are parameterized;
- search is parameterized;
- detail endpoints validate document type/ownership relationship;
- security-definer functions have safe search path.

---

# 39. Phase 30 — Current Business Documents Feature Toggle

If the current Business Documents feature is controlled by:

```text
business_documents_enabled
```

preserve it.

When OFF:

- Documents and Reports are hidden/disabled;
- posting remains unaffected;
- existing durable documents remain in database.

When ON:

- both list/detail/reports become available according to permissions.

Do not create a second toggle only for “View Details.”

---

# 40. Phase 31 — Automated Verification Commands

Inspect actual repository scripts first.

Run repository equivalents of:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Rust:

```bash
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Database:

- migration chain;
- procurement tests;
- documents tests;
- finance/journal tests;
- permissions;
- existing-database upgrade tests;
- clean database;
- historical upgrade gates where current CI requires them.

Also:

```bash
git diff --check
```

Never claim a command passed if it was not executed.

---

# 41. Phase 32 — Windows/Tauri Manual Acceptance

Automated tests are not enough.

Run the exact final candidate in Windows/Tauri.

## 41.1 Main Business Documents list

Verify:

- current documents still appear;
- type filter works;
- status/date/search filters work;
- Action no longer contains meaningless dashes for supported rows;
- journal numbers open journals.

## 41.2 Open each visible type

At minimum in the fixture:

```text
Purchase order
Purchase receipt
Supplier invoice
Supplier payment
Journal entry
```

Also:

```text
Supplier return
Cash sale
Credit sale
Customer payment
Stock receipt
Stock adjustment
```

whenever available in current test database.

## 41.3 Detail correctness

Compare UI with persisted database values for representative documents.

Do not validate only that “a screen opens.”

Verify:

- correct document;
- correct lines;
- correct supplier/customer;
- correct quantities;
- correct exact money;
- correct related documents;
- correct journal.

---

# 42. Phase 33 — Theme/Language Acceptance

Inspect:

```text
English light
English dark
French
Arabic RTL light
Arabic RTL dark
```

Particularly inspect:

- long document numbers;
- line tables;
- relationship sections;
- report filters;
- summary cards;
- amount labels;
- action column.

---

# 43. Phase 34 — Restart Acceptance

After opening details/reports:

1. close app;
2. restart;
3. log in;
4. open Business Documents;
5. confirm documents remain;
6. confirm detail fetch still works;
7. confirm report filters can be reapplied;
8. confirm no state/data corruption.

No document-detail feature may depend on transient frontend-only records.

---

# 44. Phase 35 — Forbidden Shortcuts

The following automatically fail the implementation:

```text
Adding "View Details" but showing only the table-row columns.
Using one JSON dump for every document type.
Showing raw database column names to users.
Showing only internal IDs.
Recalculating money in JavaScript.
Summing heterogeneous document types into one total.
Loading every detail eagerly.
Using SELECT * in public-facing read contracts.
Creating broad runtime SELECT on sensitive tables without session permission checks.
Removing existing generation/print views.
Breaking cash-sale/customer detail viewers.
Leaving procurement documents with Action —.
Leaving journal entries with Action —.
Creating fake PDFs.
Editing posted data from detail screen.
```

---

# 45. Phase 36 — Adjacent Defect Sweep

The implementing agent must inspect and report:

```text
FIXED
NO DEFECT FOUND
OUT OF SCOPE
```

for each.

## 45.1 Raw enum labels

Are raw values such as:

```text
PURCHASE_INVOICE
JOURNAL_ENTRY
```

still displayed instead of localized labels?

If yes, fix within Documents/Reports.

## 45.2 Date mismatch

The screenshot shows PO date differing from older procurement fixture dates.

Verify the displayed document date is the authoritative header date and not created-at date accidentally.

Do not change data merely to make dates visually consistent.

## 45.3 Journal rows inside Business Documents

Verify whether including `JOURNAL_ENTRY` in the main list is intentional current design.

If current accepted Business Documents contract includes journals:

keep them and make them actionable.

If current architecture says Journals must be separate:

do not silently delete them; document the conflict and follow current architecture authority.

## 45.4 Party labels

Verify supplier/customer secondary label is correct and not accidentally attached to journal rows.

## 45.5 Generation/print N/A

Verify procurement rows show a localized `Not applicable`, not raw `N/A`, in French/Arabic.

## 45.6 Missing detail for landed cost

Landed cost may not be a standalone business-document row.

Ensure receipt detail still exposes its landed-cost posting and journal.

Do not invent a fake business document merely for landed cost.

---

# 46. Phase 37 — Likely File Map

Exact files must be discovered from current HEAD.

Likely areas:

```text
src/features/documents/
src/features/accounting/
src/features/procurement/
src/features/inventory/
src/shared/ipc/
src/shared/hooks/
src/shared/i18n/
src/app/
```

Rust:

```text
src-tauri/src/domain/
src-tauri/src/application/
src-tauri/src/commands/
src-tauri/src/lib.rs
```

Database:

```text
src-tauri/migrations/<new_forward_migration>.sql
src-tauri/tests/documents/
src-tauri/tests/procurement/
src-tauri/tests/finance/
src-tauri/tests/inventory/
```

Do not modify applied migrations.

---

# 47. Phase 38 — Database Migration Rules

If new SQL functions/permissions/indexes are required:

- create forward-only migration;
- do not alter applied migration files;
- preserve current data;
- no posted-record rewrites;
- explicit public revoke;
- explicit runtime grants;
- safe search path;
- update schema-state/version only according to repository conventions.

If no schema change is required because detail queries can be implemented through existing accepted API layers:

do not create a migration just to satisfy a plan checklist.

---

# 48. Phase 39 — Final Diff Gate

Before commit:

```bash
git status --short
git diff --stat
git diff
git diff --check
```

Search touched feature surfaces for:

```text
any
parseFloat
Number(
SELECT *
console.log
TODO
FIXME
Action — logic
raw .message error rendering
```

Interpret results.

Do not perform unrelated cleanup.

---

# 49. Phase 40 — Required Final Evidence Report

The cheap agent may not respond only:

```text
Done.
```

The final implementation report must contain:

## 49.1 Baseline

```text
Starting branch:
Starting SHA:
Final branch:
Final SHA:
```

## 49.2 Root cause

```text
Why Action was blank:
Which document types lacked detail contracts:
Which existing viewers were reused:
Which new APIs/components were added:
```

## 49.3 Coverage matrix

Required table:

```text
Document Type
Visible in list
Action
Detail API
Detail UI
Journal link
Relationships
Permission tested
PASS/FAIL
```

No visible type may be omitted.

## 49.4 Reports evidence

Include:

```text
filters implemented
summary metrics
type breakdown
type-specific amount semantics
pagination
permission behavior
```

## 49.5 Tests

List every command and result.

## 49.6 Manual acceptance

State which document numbers were opened and what was verified.

## 49.7 Remaining limitations

Explicitly list genuine out-of-scope items.

---

# 50. Definition of Done

This task is complete only if every applicable checkbox is true.

## 50.1 Main Business Documents page

- [ ] Existing current Business Documents functionality is preserved.
- [ ] Type filtering remains functional.
- [ ] Search/date/status filtering works.
- [ ] Every visible supported transaction has `View details`.
- [ ] Every visible journal entry has `View journal`.
- [ ] Linked journal numbers/actions are clickable.
- [ ] `Not applicable` and `Missing` are distinct.
- [ ] Filter/list state survives opening/closing details.

## 50.2 Purchase Order

- [ ] Full header visible.
- [ ] Supplier and warehouse visible.
- [ ] Lines visible.
- [ ] Ordered/received/remaining quantities visible.
- [ ] Unit costs and line totals visible.
- [ ] Related receipts/invoices/returns visible where present.

## 50.3 Purchase Receipt

- [ ] Full header.
- [ ] PO/supplier/warehouse.
- [ ] Receipt lines.
- [ ] Exact totals.
- [ ] Inventory movement references where appropriate.
- [ ] Landed-cost section.
- [ ] Receipt journal.
- [ ] Landed-cost journal if present.

## 50.4 Supplier Invoice

- [ ] Header.
- [ ] Lines.
- [ ] Currency/exchange rate.
- [ ] Base/foreign totals.
- [ ] Original liability.
- [ ] Current outstanding clearly labeled.
- [ ] Related payments.
- [ ] Journal.

## 50.5 Supplier Return

- [ ] Header.
- [ ] Localized reason.
- [ ] Lines.
- [ ] Persisted supplier cost.
- [ ] Accounting impact from authoritative evidence.
- [ ] Related PO.
- [ ] Journal.

## 50.6 Supplier Payment

- [ ] Header.
- [ ] Amount.
- [ ] Method.
- [ ] Liability source.
- [ ] Current liability state clearly labeled.
- [ ] Journal.

## 50.7 Other document types

- [ ] Cash sale existing detail preserved.
- [ ] Credit sale existing detail preserved.
- [ ] Customer payment existing detail preserved.
- [ ] Customer refund detailed if visible.
- [ ] Stock receipt detailed if visible.
- [ ] Stock adjustment detailed if visible.
- [ ] Any additional visible type mapped and implemented.

## 50.8 Reports

- [ ] Reports section exists.
- [ ] Date filtering.
- [ ] Type filtering.
- [ ] Status filtering.
- [ ] Document-number search.
- [ ] Journal-link filter.
- [ ] Party filters where applicable.
- [ ] Document count.
- [ ] Status counts.
- [ ] Type counts.
- [ ] Separate type-specific monetary totals.
- [ ] No invalid cross-type grand total.
- [ ] Journal entries excluded from business amount totals.
- [ ] Clear non-additive amount warning.
- [ ] Report rows can open document details.

## 50.9 Security

- [ ] Domain permissions preserved.
- [ ] Cashier does not gain procurement access.
- [ ] Invalid session denied.
- [ ] No raw SQL errors.
- [ ] No new write capability.
- [ ] No unsafe dynamic SQL.

## 50.10 Quality

- [ ] Exact decimals preserved.
- [ ] No business money calculations with floats.
- [ ] No N+1 detail loading.
- [ ] Pagination/bounded queries.
- [ ] EN/FR/AR complete.
- [ ] RTL usable.
- [ ] Light/dark usable.
- [ ] Accessibility basics pass.
- [ ] Clean database tests pass.
- [ ] Existing database upgrade tests pass.
- [ ] Rust checks pass.
- [ ] Frontend checks pass.
- [ ] PostgreSQL checks pass.
- [ ] Windows/Tauri manual acceptance passes.
- [ ] Restart passes.
- [ ] Final diff has no unrelated work.

---

# 51. Hard Stop Conditions

The implementation must not be declared complete if any of these remain:

- a supported visible document still has `Action —`;
- `View details` only repeats summary row fields;
- purchase/invoice/return/payment lines cannot be inspected;
- journal links remain dead text;
- reports add different workflow amounts together into one grand total;
- report calculations use JavaScript floats;
- detail endpoints bypass permissions;
- cash/customer existing viewers regress;
- raw database diagnostics appear;
- unsupported/missing subtype crashes the screen;
- report loads unbounded history into React;
- posted records can be edited from detail;
- current running Business Documents implementation was accidentally replaced by the old remote screen;
- Windows/Tauri acceptance was not performed.

Report the blocker instead of claiming success.

---

# 52. Final Instruction to the Implementing Agent

Start by identifying the exact code currently producing the supplied Business Documents screenshot.

Preserve that candidate.

Then implement this plan sequentially.

The task is not complete because a button exists.

The task is complete when the Business Documents area becomes a real audit surface:

```text
find document
→ open it
→ inspect full persisted transaction
→ inspect lines
→ inspect related records
→ inspect accounting evidence
→ navigate to journal
→ return to list without losing context
```

and when the Reports section provides useful document-activity summaries without inventing invalid accounting totals.

Do not take shortcuts to finish faster.
Do not hide missing implementations behind dashes.
Do not substitute generic JSON for domain-specific detail.
Do not use reporting as an excuse to change accounting.

Correctness, auditability, security, and complete visible document-type coverage are the acceptance criteria.
