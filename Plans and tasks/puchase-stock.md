# Stockiha Direct Purchase & Inventory Workflow Specialist

## Purpose

This skill governs implementation work that changes Stockiha's purchasing workflow, inventory correction workflow, and administrative emergency stock receipt workflow.

Use this skill when the task touches any of the following:

- Direct Purchase
- Purchase Receipt
- Purchase Orders
- Receive Goods
- procurement workflow policy
- Supplier Invoices
- Supplier Payables
- Supplier Returns
- landed cost
- Stock Adjustment
- Inventory Corrections
- Stock Receipt
- Emergency Receipt
- procurement/inventory navigation
- procurement/inventory accounting integration
- procurement/inventory Business Documents
- procurement/inventory journals
- procurement migrations
- procurement/inventory posting tests

This skill is intentionally strict. It is written for a low-cost AI coding agent that must not invent architecture, take shortcuts, or weaken Stockiha's accounting and inventory controls.

---

# 1. Role

Act as a Stockiha software engineer and inventory/accounting workflow specialist.

Your job is not merely to make the UI simpler.

Your job is to make the operator workflow simpler **while preserving truthful business records, accounting integrity, inventory valuation, auditability, permissions, idempotency, and upgrade safety**.

You must reason from the actual repository and database contracts before editing anything.

Do not rely on assumptions.

Do not treat frontend behavior as the source of truth when backend/database behavior differs.

---

# 2. Fixed Product Decisions

These decisions are already approved.

Do not reopen them unless the user explicitly changes them.

## 2.1 MVP purchasing workflow

The active MVP purchasing workflow is:

```text
DIRECT_PURCHASE
```

Direct Purchase is the main/default Stockiha purchasing workflow.

The operator records the purchase only after the physical goods have arrived.

The normal operator workflow is:

```text
Open Purchases
-> Enter supplier
-> Enter destination warehouse
-> Enter purchase date
-> Add received products/variants
-> Enter quantity received
-> Enter unit purchase cost
-> Review
-> Confirm Purchase
-> Finished
```

There must be one final operator-facing confirmation:

```text
Confirm Purchase
```

Do not require the MVP operator to perform:

```text
Create Purchase Order
-> Confirm Purchase Order
-> Receive Goods
-> Confirm Goods Receipt
```

for a normal purchase that is already physically present.

---

## 2.2 Advanced purchasing workflow

The professional multi-stage workflow remains valid:

```text
Purchase Order
-> Confirm Order
-> Wait for delivery
-> Partial/full goods receipt
-> Supplier invoice
-> Supplier payable/payment
```

However:

**The advanced Purchase Order workflow is future work and is outside the MVP.**

Do not implement a working Direct/Advanced toggle during this MVP task.

Do not expose an unfinished or unvalidated advanced workflow as a selectable production policy.

Do not delete the advanced Purchase Order code or historical data merely because it is not the active MVP workflow.

Future policy may eventually support:

```text
DIRECT_PURCHASE
PURCHASE_ORDER
```

with `DIRECT_PURCHASE` remaining the default.

---

## 2.3 Purchase Receipt

Do not delete Purchase Receipt.

Purchase Receipt remains a real domain/business document concept.

Direct Purchase is the operator workflow.

Purchase Receipt is authoritative evidence that purchased goods physically entered inventory.

In Direct Purchase mode, the Purchase Receipt should be created automatically as part of the single backend transaction.

The operator should not manually execute a second Receive Goods step.

---

## 2.4 Inventory Corrections

The user-facing Stock Adjustment workflow becomes:

```text
Inventory Corrections
```

Inventory Corrections are used only when recorded stock must be corrected to reflect physical reality.

Examples:

- damaged stock
- shrinkage / missing stock
- expired stock
- found stock
- recording error
- other controlled correction

Inventory Corrections must not become a purchase shortcut.

They must not accept supplier purchase semantics.

They must not accept an arbitrary new acquisition cost.

They must continue using Stockiha's authoritative WAC-based correction logic.

---

## 2.5 Emergency Receipt

Do not delete Stock Receipt.

Do not merge Stock Receipt into Inventory Corrections.

Reframe the stock-receipt capability as:

```text
Emergency Receipt
```

or:

```text
Administrative Emergency Receipt
```

It is a sensitive administrative capability because it allows inventory quantity and acquisition value to be introduced outside the normal procurement path.

Emergency Receipt must be:

- Admin/Manager restricted
- removed from ordinary daily operator navigation
- clearly marked as exceptional
- clearly warned against normal supplier purchase use
- clearly warned against ordinary inventory correction use
- fully auditable
- idempotent
- backend-permission controlled

---

# 3. The Three Inventory Concepts Must Stay Distinct

Never collapse these meanings.

## 3.1 Direct Purchase / Purchase Receipt

Meaning:

> Goods were acquired from a supplier and physically arrived.

Business context:

```text
supplier
warehouse
variant/product
received quantity
purchase cost
purchase date
```

Inventory effect:

```text
quantity increases
inventory value increases from acquisition value
WAC recalculates
```

Accounting effect under current procurement semantics:

```text
Dr Inventory
    Cr GRNI
```

The supplier invoice later clears GRNI into Accounts Payable according to Stockiha's current accounting design.

---

## 3.2 Inventory Correction

Meaning:

> The system's recorded inventory is wrong and must be corrected.

Examples:

```text
Damage
Shrinkage
Expired
Found stock
Recording error
Other
```

Valuation:

```text
existing authoritative WAC
```

This is not a new acquisition.

Do not ask the operator for a new purchase cost.

---

## 3.3 Emergency Receipt

Meaning:

> Authorized management introduces valued stock outside normal procurement for an exceptional administrative reason.

Inventory effect:

```text
quantity increases
inventory value increases using entered acquisition value
WAC recalculates
```

This is why the operation is risky.

Do not make it a normal user shortcut.

---

# 4. Required MVP Navigation Model

## 4.1 Catalog & Stock

Normal daily navigation should conceptually be:

```text
Products
Inventory
Inventory Corrections
```

Do not show ordinary users a normal `Stock receipt` menu item beside Inventory Corrections.

---

## 4.2 Purchasing

Normal MVP purchasing navigation should conceptually be:

```text
Suppliers
Purchases
Supplier Invoices
Supplier Payables
Supplier Returns
```

The main purchase page should be called:

```text
Purchases
```

not:

```text
Purchase Orders
```

because Purchase Orders are not the active MVP workflow.

---

## 4.3 Administrative inventory access

Emergency Receipt should live in a restricted administration/settings area.

Preferred conceptual placement:

```text
Settings
-> Inventory Administration
-> Emergency Receipt
```

Do not secure it by frontend hiding alone.

Backend authorization remains mandatory.

---

# 5. Mandatory Repository Ground-Truth Procedure

Before modifying code:

1. Print current Git branch.
2. Print current commit SHA.
3. Print `git status --short`.
4. If unrelated local changes exist, do not overwrite them.
5. Fetch origin.
6. Confirm the intended implementation branch.
7. Search for recent purchase-repair branches and unmerged direct-purchase work.
8. Search for an existing `PurchaseTransactionScreen.tsx` or equivalent before creating a new screen.
9. Inspect the latest effective procurement migrations.
10. Inspect the current Rust command/application/domain contracts.
11. Inspect the current frontend DTO and gateway contracts.
12. Inspect current procurement/inventory tests.
13. Identify which migration currently defines the runtime function being changed.

Do not assume `main` is the newest relevant source if active repair branches exist.

Do not edit an old migration merely because it is easier.

Use forward-only migrations.

---

# 6. Important Existing Repository Areas

Inspect these before editing.

## 6.1 Navigation and routing

```text
src/app/AppShell.tsx
src/app/AppRouter.tsx
```

---

## 6.2 Procurement frontend

```text
src/features/procurement/PurchaseOrdersScreen.tsx
src/features/procurement/PurchaseReceiptModal.tsx
src/features/procurement/PurchaseTransactionScreen.tsx
src/features/procurement/SupplierInvoicesScreen.tsx
src/features/procurement/SupplierLiabilitiesScreen.tsx
src/features/procurement/SupplierReturnsScreen.tsx
src/features/procurement/procurementCopy.ts
```

Some paths may not exist on every branch.

Search before creating replacements.

---

## 6.3 Inventory frontend

```text
src/features/inventory/StockReceiptScreen.tsx
src/features/inventory/StockAdjustmentScreen.tsx
```

---

## 6.4 IPC and DTO contracts

```text
src/shared/ipc/gateway.ts
src/shared/ipc/dto.ts
src/shared/ipc/documentGateway.ts
src/shared/ipc/documentDto.ts
```

---

## 6.5 Rust procurement layer

Inspect:

```text
src-tauri/src/commands/procurement.rs
src-tauri/src/application/procurement_service.rs
src-tauri/src/domain/procurement.rs
src-tauri/src/lib.rs
```

Also discover and inspect the inventory command/service modules actually used by Stock Receipt and Stock Adjustment.

---

## 6.6 Important database areas

Search the effective migrations around:

```text
procurement.purchase_orders
procurement.purchase_order_lines
procurement.purchase_receipts
procurement.purchase_receipt_lines
procurement.supplier_invoices
procurement.supplier_invoice_lines
procurement.supplier_liabilities
procurement.supplier_returns
procurement.supplier_return_lines
inventory.positions
inventory.movements
finance.journal_entries
finance.journal_lines
core.business_documents
```

Also inspect the latest versions of functions equivalent to:

```text
inventory.confirm_purchase_receipt
procurement.confirm_supplier_invoice
inventory.confirm_supplier_return
procurement.post_supplier_payment
inventory.confirm_stock_receipt
inventory.confirm_stock_adjustment
```

---

# 7. Direct Purchase Must Be a Real First-Class Backend Operation

## 7.1 Forbidden shortcut

Never implement Direct Purchase like this:

```text
Frontend:
create hidden PO
-> confirm hidden PO
-> call Receive Goods
```

or:

```text
React:
create PO
-> confirm PO
-> receive
```

This is rejected.

Reasons:

- partial failure can leave false intermediate states
- it creates fake Purchase Orders
- it pollutes reports
- it weakens business truth
- it creates retry/idempotency risk
- it prevents clean future separation between Direct Purchase and advanced Purchase Order workflow

A Direct Purchase is not a Purchase Order.

---

## 7.2 Required posting boundary

Use one backend-authoritative operation with semantics equivalent to:

```text
confirm_direct_purchase(...)
```

Exact naming may follow project conventions.

The Direct Purchase request should conceptually contain:

```text
request_id
supplier_id
warehouse_id
fiscal_period_id
document_date
optional approved note/reference metadata
lines[]
```

Each line should contain:

```text
variant_id
unit_id
quantity_received
unit_cost
```

React may show provisional totals.

React must not be the posting authority.

---

## 7.3 Atomicity

One Direct Purchase must succeed or fail as one database transaction.

The backend transaction should:

1. Resolve session.
2. Verify permission.
3. Reserve/check idempotency key.
4. Verify open fiscal period.
5. Verify document date belongs to period.
6. Verify active supplier.
7. Verify active warehouse.
8. Validate all lines.
9. Validate variants and units.
10. Lock affected inventory positions in deterministic order.
11. Create Purchase Receipt business document.
12. Create receipt header.
13. Create receipt lines.
14. Update inventory quantity/value.
15. Create inventory movements.
16. Recalculate WAC.
17. Create balanced receipt journal.
18. Allocate official document number.
19. Record idempotent result.
20. Return typed result.

If any step fails:

```text
ROLLBACK
```

Never leave:

```text
receipt without movement
movement without journal
partial line set
half-posted purchase
```

---

# 8. Required Schema Generalization

The existing procurement architecture historically assumes a Purchase Receipt belongs to a Purchase Order.

Direct Purchase requires truthful schema support.

Use a new forward-only migration.

## 8.1 Purchase receipt origin

Do not use nullability alone to determine workflow origin.

Add an explicit origin concept equivalent to:

```text
DIRECT_PURCHASE
PURCHASE_ORDER
```

Existing historical rows must be backfilled as:

```text
PURCHASE_ORDER
```

New Direct Purchase rows:

```text
receipt_origin = DIRECT_PURCHASE
purchase_order_id = NULL
```

Future advanced rows:

```text
receipt_origin = PURCHASE_ORDER
purchase_order_id = required
```

Add database constraints enforcing valid combinations.

---

## 8.2 Purchase receipt lines

If current schema requires:

```text
po_line_id NOT NULL
```

generalize it.

For Direct Purchase:

```text
po_line_id = NULL
```

For Purchase Order receipt:

```text
po_line_id = required
```

Do not remove receipt-line authority.

Direct receipt lines still require:

```text
variant_id
unit_id
quantity_received
unit_cost
line_total
movement_id
```

---

# 9. Supplier Invoice Compatibility Is Mandatory

Direct Purchase is incomplete if Supplier Invoices still require Purchase Orders.

For Direct Purchase, the authoritative source is the Purchase Receipt and its receipt lines.

## 9.1 Matching model

Advanced flow may later use:

```text
Purchase Order
+ Receipt
+ Invoice
```

Direct Purchase uses:

```text
Receipt
+ Invoice
```

Do not skip matching simply because there is no Purchase Order.

The backend must still enforce:

- same supplier
- valid receipt
- valid receipt line
- matching variant
- invoiced quantity cannot exceed received quantity
- already invoiced quantity cannot be invoiced again
- returned quantity reduces invoiceable quantity where applicable
- monetary variance remains explicit

---

## 9.2 Supplier Invoice UI

Do not filter eligible sources only from received Purchase Orders.

The UI must be able to list Direct Purchase receipt lines that remain invoiceable.

Example display:

```text
PR-2026-000123
Supplier A
Variant X
Available to invoice: 10
```

---

# 10. Supplier Payables Compatibility

Supplier Payable authority should remain the posted supplier invoice.

If current schema requires:

```text
purchase_order_id NOT NULL
```

for liabilities, generalize it.

Direct Purchase liability:

```text
invoice_document_id = required
purchase_order_id = NULL
```

Do not create a fake PO to satisfy payables.

---

# 11. Supplier Return Compatibility

Direct Purchase goods must remain returnable.

Do not keep Supplier Returns dependent only on Purchase Orders.

The authoritative return lineage should be based on actual received goods.

Preferred model:

```text
supplier return
-> receipt / receipt line
```

The backend must verify:

- supplier matches
- warehouse matches
- variant matches
- received quantity exists
- cumulative returned quantity cannot exceed received quantity
- inventory currently contains enough quantity
- authoritative cost comes from receipt/invoice rules
- no arbitrary return cost is accepted from the UI

Do not implement:

```text
if purchase_order_id is null:
    skip validation
```

Instead implement:

```text
if direct purchase:
    validate against receipt lineage
```

---

# 12. Landed Cost Compatibility

Check landed-cost behavior.

Direct Purchase receipt should remain eligible for landed-cost allocation if the current feature supports it.

Do not require a fake PO if the Purchase Receipt contains sufficient authority.

Test:

```text
Direct Purchase
-> Purchase Receipt
-> Landed Cost
-> inventory valuation/WAC remains correct
```

---

# 13. Accounting Rules

Do not invent new accounting semantics.

For the purchase receipt, preserve current procurement accounting behavior:

```text
Dr Inventory
    Cr GRNI
```

Supplier Invoice later handles the GRNI -> Accounts Payable transition under the current effective accounting functions.

## 13.1 Journal invariants

For every non-zero Direct Purchase:

- journal exists
- total debit = total credit
- source type identifies Purchase Receipt
- source id identifies the actual receipt document
- document date is correct
- fiscal period is correct

---

# 14. WAC Rules

WAC remains backend-authoritative.

Do not calculate posted WAC with JavaScript floating point.

Conceptually:

```text
new_quantity =
    old_quantity
    + received_base_quantity

new_value =
    old_value
    + received_value

new_wac =
    new_value / new_quantity
```

Use Stockiha's exact decimal conventions.

If duplicate lines for one variant are allowed, ensure the final inventory valuation is deterministic and not dependent on frontend order or floating-point rounding.

If duplicate lines are intentionally rejected, return a clear validation error and test it.

---

# 15. Idempotency Rules

Every Direct Purchase is one intended posting operation.

Use one request ID.

If the result is unknown due to transport/backend uncertainty:

- retry with the same request ID
- do not generate a second request ID
- backend must return the already-posted result if the first request succeeded

After confirmed success:

- clear the request ID
- the next purchase uses a new request ID

Never allow a timeout to create duplicate stock, journals, or receipts.

---

# 16. Inventory Corrections Implementation Rules

## 16.1 UI rename

User-facing:

```text
Stock Adjustment
```

becomes:

```text
Inventory Corrections
```

The backend document type may remain:

```text
STOCK_ADJUSTMENT
```

Do not rename stable database identifiers merely for cosmetic reasons.

---

## 16.2 Preserve existing semantics

Keep:

- signed quantity change
- exact unit conversion
- reason code
- WAC snapshot
- inventory movement
- adjustment gain/loss journal
- immutability
- idempotency

---

## 16.3 Valid reasons

Keep or improve controlled choices:

```text
Damaged stock
Shrinkage / missing stock
Expired stock
Found stock
Recording error
Other
```

`Other` requires a note.

Do not add:

```text
Purchase
Supplier delivery
New acquisition
```

as correction reasons.

---

## 16.4 Positive correction at zero stock

Preserve the safeguard that prevents a positive correction when stock is zero and no valid WAC exists.

Do not solve it with zero-cost stock.

Show an understandable error directing management to the proper authorized stock-establishment/emergency workflow.

---

## 16.5 Required helper text

The Inventory Corrections screen should clearly communicate:

> Use Inventory Corrections when physical inventory differs from Stockiha. Do not use this page for supplier purchases.

---

# 17. Emergency Receipt Implementation Rules

## 17.1 UI identity

Preferred title:

```text
Emergency Receipt
```

Preferred helper copy:

> Exceptional manager-only stock introduction. Use Purchases for supplier goods and Inventory Corrections for stock discrepancies.

---

## 17.2 Access control

Only authorized Admin/Manager-level roles may post.

The backend permission check is authoritative.

Do not grant the permission broadly just to make the page work.

Cashier/ordinary operator access must not be introduced by the UI refactor.

---

## 17.3 Location

Remove Emergency Receipt from ordinary daily inventory navigation.

Place it under restricted settings/administration.

---

## 17.4 Audit evidence

Because Emergency Receipt accepts quantity and acquisition cost, capture strong evidence.

Minimum desirable fields:

```text
reason code
note/explanation
actor
workstation
date
warehouse
variant
quantity
unit cost
resulting quantity
resulting total value
resulting WAC
document number
```

If the existing model has no persistent reason/note, add this through a forward-only migration.

Suggested narrow reason vocabulary:

```text
DATA_RECOVERY
AUTHORIZED_INITIALIZATION
ADMINISTRATIVE_CORRECTION
OTHER
```

Do not include:

```text
NORMAL_PURCHASE
```

`OTHER` requires a note.

---

## 17.5 Accounting warning

The historical Emergency/Stock Receipt implementation may not create a journal because its original architecture did not define an offset account.

Do not invent an accounting offset in this task.

Do not silently use:

```text
Cash
Accounts Payable
Inventory Adjustment Gain
Opening Equity
```

unless current Stockiha accounting authority explicitly defines it.

If accounting treatment remains unresolved, keep the operation tightly restricted and flag the accounting policy as future hardening.

Do not broaden Emergency Receipt usage to compensate.

---

# 18. Settings Rules for MVP

The approved state is:

```text
Direct Purchase = active/default MVP
Advanced Purchase Order workflow = future work
```

Therefore:

Do not ship a working policy toggle during MVP.

Do not expose a setting that allows switching to an unvalidated future path.

A read-only display is acceptable:

```text
Purchasing workflow: Direct Purchase
```

Future work may introduce a persisted enum policy.

Future policy changes must affect only new transactions.

They must never reinterpret historical transactions.

---

# 19. Existing Purchase Order Code

Do not aggressively delete it.

The repository already contains useful professional procurement code for:

- Purchase Orders
- confirmation
- partial receipts
- goods receipt
- landed cost
- supplier invoice matching
- supplier returns
- supplier payments

For MVP:

- remove it from the normal operator path
- do not make it the main `Purchases` screen
- preserve historical data
- preserve useful future code where it does not conflict
- keep relevant regression tests

If existing open Purchase Orders exist, do not trap or corrupt them.

If a legacy completion route is necessary, keep it explicit and restricted.

Do not invent a new legacy route unless required by actual existing open-state behavior.

---

# 20. Business Documents Integration

## 20.1 Direct Purchase

Business Documents should show the posted Purchase Receipt.

Expected semantics:

```text
Type: PURCHASE_RECEIPT
Status: POSTED
Supplier
Warehouse
Total
Linked Journal
```

Do not create/display a fake Purchase Order.

---

## 20.2 Inventory Corrections

Preserve:

```text
STOCK_ADJUSTMENT
```

as the underlying document type if already established.

Display user-facing terminology as Inventory Correction where appropriate.

---

## 20.3 Emergency Receipt

Preserve:

```text
STOCK_RECEIPT
```

or the established backend type unless a stronger schema reason exists.

Administrative audit detail must remain inspectable.

---

# 21. Journals Integration

Do not merge Business Documents and Accounting Journals.

Business Document answers:

> What business event occurred?

Journal answers:

> How did that event affect accounting accounts?

Every linked-journal action must resolve the correct journal.

Direct Purchase receipt journals must remain balanced.

Inventory Correction journals must remain balanced.

Do not create a journal for Emergency Receipt unless the approved accounting authority defines the correct offset.

---

# 22. UI Requirements

## 22.1 Purchases list

Main MVP Purchases list should emphasize posted purchases.

Useful columns:

```text
Purchase #
Date
Supplier
Warehouse
Total
Status
Linked Journal
Actions
```

Do not make the main screen revolve around:

```text
Ordered
Remaining
Receive Goods
Cancel Order
```

Those belong to future advanced procurement.

---

## 22.2 Direct Purchase form

Minimum fields:

```text
Supplier
Warehouse
Purchase date
At least one line
```

Each line:

```text
Product / variant
Unit
Quantity received
Unit purchase cost
Line total preview
Remove
```

The frontend total is provisional.

The backend result is authoritative.

---

## 22.3 Submission UX

While posting:

- disable duplicate submits
- show processing state
- do not close the form before result is known
- preserve the same idempotency key on uncertain retry
- show official document number after success

---

## 22.4 Error quality

Do not convert known domain failures into:

```text
An internal error occurred.
```

Provide understandable errors for:

- closed fiscal period
- inactive supplier
- inactive warehouse
- inactive product/variant
- invalid unit
- invalid quantity
- invalid cost
- permission denied
- unknown/uncertain result requiring same-request retry

Do not expose raw SQL to the operator.

---

# 23. Permissions

Preserve backend-authoritative permission checks.

Conceptual separation should remain:

```text
Procurement management/posting
Inventory management/corrections
Emergency stock receipt
```

Do not allow ordinary procurement permission to automatically imply Emergency Receipt permission unless the current role policy explicitly does so.

---

# 24. Migration Discipline

All database work must follow these rules:

1. Forward-only migrations.
2. Never edit already-applied migrations as the upgrade strategy.
3. Support fresh database creation.
4. Support upgrade from existing database.
5. Preserve existing IDs.
6. Preserve existing document numbers.
7. Never delete historical rows.
8. Backfill new origin columns deterministically.
9. Add constraints only after backfill is valid.
10. Preserve `SECURITY DEFINER` patterns where required.
11. Preserve safe fixed `search_path`.
12. Revoke from `PUBLIC`.
13. Grant only required runtime roles.
14. Preserve posted-record immutability.
15. Do not weaken permissions to make tests pass.

---

# 25. Rust / IPC Contract Discipline

If new contracts are introduced, keep them explicit and typed.

Potential concepts:

```text
DirectPurchaseLinePayload
ConfirmDirectPurchasePayload
ConfirmDirectPurchaseResult
```

Update all layers consistently:

```text
React DTO
IPC gateway
Tauri command
application service
domain validation
database RPC
result parser
```

Do not let one layer silently diverge from another.

Do not use `f64` for authoritative money.

Use existing exact-decimal patterns.

---

# 26. Required Automated Tests

Do not claim completion without these.

## 26.1 Direct Purchase happy path

Initial:

```text
Variant A
Warehouse W
quantity = 20
inventory value = 1600
WAC = 80
```

Direct Purchase:

```text
quantity = 10
unit cost = 100
value = 1000
```

Expected:

```text
new quantity = 30
new value = 2600
new WAC = 86.666666... according to Stockiha precision
```

Verify:

- one Purchase Receipt
- origin = DIRECT_PURCHASE
- no fake Purchase Order
- correct receipt line
- correct inventory movement
- correct WAC
- balanced journal
- Inventory debit = 1000
- GRNI credit = 1000
- official document number
- POSTED status

---

## 26.2 Multi-line purchase

Use multiple variants.

All lines must commit atomically.

---

## 26.3 Duplicate variant handling

If multiple lines for same variant are supported:

- verify deterministic aggregate valuation

If not supported:

- reject clearly
- test rejection

---

## 26.4 Failure tests

Test no writes for:

```text
closed period
invalid supplier
invalid warehouse
inactive variant
invalid unit
zero quantity
negative quantity
invalid cost
permission failure
```

---

## 26.5 Idempotency

Same request ID:

- same result
- no duplicate receipt
- no duplicate movement
- no duplicate journal

Concurrent duplicate requests must post only once.

---

## 26.6 Supplier Invoice from Direct Purchase

Verify:

```text
Direct Purchase
-> eligible receipt line
-> Supplier Invoice
-> posted invoice
-> correct GRNI clearing
-> Accounts Payable liability
```

No Purchase Order dependency.

Over-invoicing remains rejected.

---

## 26.7 Supplier Return from Direct Purchase

Verify:

```text
Direct Purchase
-> Supplier Return
-> inventory decreases
-> return quantity <= received/net returnable
-> debit note
-> balanced journal
```

No fake PO dependency.

---

## 26.8 Landed Cost

Verify Direct Purchase receipt remains compatible with landed cost if currently supported.

---

## 26.9 Inventory Corrections

Test:

```text
damage decrease
shrinkage decrease
expired decrease
found stock increase
recording-error increase/decrease
OTHER without note rejected
OTHER with note accepted
positive correction at zero stock without WAC rejected
negative correction beyond stock rejected
```

---

## 26.10 Emergency Receipt

Test:

- Admin allowed
- Manager allowed if role policy grants
- unauthorized user denied
- hidden from normal navigation
- quantity validation
- cost validation
- WAC recalculation
- idempotency
- reason/note validation if added

---

## 26.11 Frontend workflow

Verify:

- main nav says `Purchases`
- main inventory nav says `Inventory Corrections`
- normal nav does not expose Stock Receipt
- Direct Purchase has one final confirm action
- no Receive Goods step required
- success shows Purchase Receipt number
- uncertain retry reuses request ID
- Emergency Receipt is restricted
- Supplier Invoice can select Direct Purchase receipt
- Supplier Return can select Direct Purchase receipt

---

## 26.12 Documents/Journals

Verify:

- Direct Purchase appears in Business Documents
- linked journal opens
- no fake Purchase Order appears
- Inventory Correction remains inspectable
- Emergency Receipt remains inspectable
- reports do not double-count synthetic PO data because synthetic PO data must not exist

---

# 27. Manual Acceptance Scenarios

After implementation, provide these to the human tester.

## Scenario A — Direct Purchase

1. Create/select Supplier A.
2. Confirm Product A exists.
3. Record current quantity and WAC.
4. Open Purchases.
5. New Purchase.
6. Select Supplier A.
7. Select Warehouse A.
8. Add Product A.
9. Quantity = 10.
10. Unit cost = 100 DZD.
11. Click `Confirm Purchase` once.
12. Confirm success shows `PR-...`.
13. Open Inventory.
14. Verify quantity increased by 10.
15. Verify WAC changed correctly.
16. Open Business Documents.
17. Verify Purchase Receipt exists.
18. Open linked Journal.
19. Verify balanced Inventory / GRNI posting.
20. Verify no fake Purchase Order was created.

---

## Scenario B — Supplier Invoice after Direct Purchase

1. Open Supplier Invoices.
2. Select Direct Purchase receipt line.
3. Create/post invoice.
4. Verify Accounts Payable liability.
5. Verify linked journal.
6. Verify no PO is required.

---

## Scenario C — Supplier Return after Direct Purchase

1. Return part of the received product.
2. Verify return is linked to received stock.
3. Verify inventory decreases.
4. Verify over-return is rejected.
5. Verify debit note / journal.

---

## Scenario D — Inventory Correction

1. Open Inventory Corrections.
2. Select Product A.
3. Decrease 2.
4. Reason: Damage.
5. Confirm.
6. Verify stock decreases.
7. Verify existing WAC is used.
8. Verify no supplier/purchase is created.

---

## Scenario E — Emergency Receipt

1. Log in as normal operator.
2. Verify Emergency Receipt is unavailable.
3. Log in as Manager/Admin.
4. Open Settings -> Inventory Administration.
5. Open Emergency Receipt.
6. Verify warning is shown.
7. Post an authorized emergency receipt.
8. Verify WAC uses entered acquisition value.
9. Verify administrative evidence is inspectable.

---

# 28. Implementation Order

Do not jump straight to frontend work.

## Phase 0 — Repository ground truth

Understand:

```text
how Purchase Order works
how receipt posting works
which DB constraints force PO relationships
how Supplier Invoice consumes receipt lines
how Supplier Return determines returnable quantity
how Stock Receipt posts
how Stock Adjustment posts
```

Do not continue until these are understood.

---

## Phase 1 — Schema generalization

Goal:

Represent Direct Purchase truthfully.

Implement:

- receipt origin
- nullable PO relationships where needed
- historical backfill
- invoice/payables/returns compatibility changes

---

## Phase 2 — Direct Purchase backend

Implement:

- typed request/result
- atomic posting
- exact decimals
- WAC
- movements
- journal
- idempotency

Pass DB integration tests before relying on UI tests.

---

## Phase 3 — Downstream procurement compatibility

Implement/test:

- Supplier Invoice
- Supplier Payables
- Supplier Returns
- landed cost
- documents/reports queries

---

## Phase 4 — Direct Purchase frontend

Implement:

- Purchases route
- single transaction form
- one Confirm Purchase
- purchase history
- success state
- safe retry behavior

---

## Phase 5 — Inventory Corrections UI

Implement:

- rename
- helper copy
- preserve existing backend semantics
- preserve reason validation
- preserve zero-WAC safeguard

---

## Phase 6 — Emergency Receipt hardening

Implement:

- restricted navigation
- Admin/Manager access
- warning
- audit reason/note where approved
- existing WAC/idempotency behavior

---

## Phase 7 — Documents and Journals

Verify complete audit trace.

---

## Phase 8 — Full regression

Run:

- frontend tests
- Rust checks/tests
- SQL integration tests
- migration tests
- manual Tauri acceptance

Do not claim completion earlier.

---

# 29. In Scope

This skill authorizes work on:

- Direct Purchase as main/default MVP procurement workflow
- one final Confirm Purchase action
- atomic Direct Purchase backend posting
- real Purchase Receipt without fake PO
- receipt-origin schema
- Supplier Invoice compatibility
- Supplier Payables compatibility
- Supplier Return compatibility
- landed-cost verification
- `Purchase Orders` -> `Purchases` user-facing MVP navigation change
- removing Receive Goods as required Direct Purchase operator action
- preserving future advanced PO code
- `Stock Adjustment` -> `Inventory Corrections` user-facing change
- preserving WAC-based correction semantics
- restricting Stock Receipt as Emergency Receipt
- Emergency Receipt audit hardening
- Business Documents integration
- Journal integration
- forward-only migrations
- automated tests
- manual acceptance instructions
- localization preservation on touched screens
- RTL regression avoidance

---

# 30. Out of Scope

Do not expand this work into:

- functional advanced purchasing policy toggle
- purchase approval chains
- requisitions
- RFQ/vendor quote management
- scheduled delivery system
- blanket purchase orders
- new tax/TVA system
- new discount engine
- accounting chart redesign
- historical procurement mass rewrite
- Purchase Order data deletion
- new costing policy replacing WAC
- warehouse transfers
- manual journal editor
- supplier portal
- mobile app
- unrelated POS redesign
- unrelated documents redesign
- unrelated authentication changes
- unrelated backup/restore changes

Do not "clean up" unrelated code.

---

# 31. Anti-Shortcut Rules

## Never fake Direct Purchase with a hidden Purchase Order.

## Never make React the accounting authority.

## Never use floats for authoritative money.

## Never edit old applied migrations as the upgrade strategy.

## Never wipe production data to solve a migration problem.

## Never weaken permissions to make Emergency Receipt accessible.

## Never skip/disable tests to produce a green run.

## Never swallow important posting errors.

## Never create a second idempotency key for an uncertain retry.

## Never expose a broken future advanced-policy toggle.

## Never invent accounting offset accounts.

## Never remove posted-record immutability to simplify implementation.

## Never claim completion based on UI behavior alone.

---

# 32. Completion Checklist

The work is complete only when all are true.

## Purchasing

- [ ] Main MVP route is `Purchases`.
- [ ] Operator records goods only after physical arrival.
- [ ] One `Confirm Purchase` action posts the transaction.
- [ ] No normal `Receive Goods` step is required.
- [ ] No fake Purchase Order is created.
- [ ] Purchase Receipt is created automatically.
- [ ] Inventory quantity is correct.
- [ ] Inventory value is correct.
- [ ] WAC is correct.
- [ ] Receipt journal is balanced.
- [ ] Idempotent retry does not duplicate.
- [ ] Supplier Invoice works from Direct Purchase receipt.
- [ ] Supplier Payable works without fake PO.
- [ ] Supplier Return works without fake PO.
- [ ] Landed cost behavior is verified.

## Inventory Corrections

- [ ] User-facing name is `Inventory Corrections`.
- [ ] Existing correction reasons work.
- [ ] Corrections use existing WAC.
- [ ] Corrections do not accept purchase semantics.
- [ ] Zero-stock/no-WAC safeguard remains.
- [ ] Corrections remain immutable/auditable.

## Emergency Receipt

- [ ] Not in ordinary daily navigation.
- [ ] Admin/Manager access only according to backend policy.
- [ ] Unauthorized roles denied.
- [ ] Warning explains correct use.
- [ ] WAC recalculates from entered acquisition value.
- [ ] Administrative evidence is captured.
- [ ] No unapproved accounting offset is invented.

## Audit

- [ ] Direct Purchase appears as Purchase Receipt in Business Documents.
- [ ] Linked journal opens.
- [ ] No false Purchase Order appears.
- [ ] Inventory Corrections are traceable.
- [ ] Emergency Receipt is traceable.

## Engineering

- [ ] Forward-only migrations.
- [ ] Fresh DB migration passes.
- [ ] Upgrade DB migration passes.
- [ ] Rust checks/tests pass.
- [ ] Frontend tests pass.
- [ ] SQL integration tests pass.
- [ ] Manual Tauri acceptance passes.
- [ ] No unrelated changes.
- [ ] No disabled tests.

---

# 33. Future Work

Do not implement this during the MVP task unless the user explicitly changes scope.

Future purchasing policy may become:

```text
Purchasing Workflow

Direct Purchase
Purchase Order Workflow
```

Rules for the future implementation:

- Direct Purchase remains default.
- Policy is backend-persisted.
- Policy affects only newly created transactions.
- Existing Direct Purchases remain Direct Purchases.
- Existing Purchase Orders remain Purchase Orders.
- Historical records are never reinterpreted.

Emergency Receipt may also require a future accounting-policy task if it remains in regular live use.

---

# 34. Final Operating Principle

When unsure which workflow applies, use this decision model:

```text
Did goods come from a supplier as a purchase?
    -> Purchases / Direct Purchase

Is recorded stock wrong versus physical reality?
    -> Inventory Corrections

Is management intentionally introducing valued stock outside procurement?
    -> Emergency Receipt
       Admin/Manager only

Are goods being returned to a supplier?
    -> Supplier Returns
```

The implementation is acceptable only when the operator experience is simple **and** the underlying records remain truthful, atomic, auditable, idempotent, permission-safe, valuation-safe, and future-compatible.
