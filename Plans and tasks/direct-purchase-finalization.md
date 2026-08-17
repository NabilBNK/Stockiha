# Stockiha Part 01 — Direct Purchase Finalization

## Purpose

This skill governs the **final cleanup and acceptance closure of Part 01 — Direct Purchase**.

The Direct Purchase business workflow already exists. This task is **not a procurement rewrite**.

The goal is to remove remaining legacy/advanced procurement UI and functions from the active MVP operator workflow while preserving:

- working Direct Purchase behavior,
- Purchase Receipt history,
- inventory and WAC integrity,
- journals,
- audit evidence,
- historical records,
- migration safety.

This skill is intentionally strict and suitable for a cheap / weak AI coding agent.

Do not invent architecture.
Do not expand scope.
Do not take shortcuts just to obtain green tests.

---

# 1. Fixed MVP Purchasing Policy

The active Stockiha MVP purchasing workflow is:

```text
Purchases
→ New Purchase
→ Supplier
→ Warehouse
→ Purchase date
→ Product / Variant
→ Unit
→ Quantity received
→ Unit purchase cost
→ Confirm Purchase
→ Purchase Receipt
→ Inventory + WAC
→ Inventory / GRNI Journal
→ Finished
````

The MVP does NOT use the old operational workflow:

```
Purchase Order
→ Confirm Order
→ Receive Goods
→ Supplier Invoice
→ Supplier Payable
→ Supplier Return
→ Landed Cost
```

Purchase Orders and other old procurement records may continue to exist historically in the database.

They must not remain part of the normal MVP operator workflow.

---

# 2. Repository Safety First

Before modifying anything, run:

```
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin --prune
```

If unrelated local changes exist:

```
STOP.
```

Do NOT:

```
git reset --hard
git clean
discard user files
overwrite unrelated changes
automatically stash unrelated work
```

Report the existing changes instead.

Work only from the current accepted Part 01 branch.

Do not restart from an older branch.

---

# 3. Direct Purchase Features That Must Remain Working

Do NOT break or redesign these working features:

- Purchases page
- `+ New purchase`
- one `Confirm Purchase` action
- real Purchase Receipt
- `DIRECT_PURCHASE` receipt origin
- official `PR-...` document number
- supplier
- warehouse
- purchase date
- product / variant
- SKU
- unit
- quantity
- unit purchase cost
- line total
- purchase total
- exact decimal handling
- inventory quantity increase
- inventory value increase
- WAC recalculation
- POSTED status
- receipt history
- receipt details
- journal reference
- Inventory debit
- GRNI credit
- balanced journal
- idempotency
- safe retry
- Business Documents evidence
- restart persistence
- no fake Purchase Order

The final cleanup must preserve these contracts.

---

# 4. Final Purchasing Sidebar

The normal MVP Purchasing navigation must become:

```
PURCHASING

Suppliers
Purchases
```

Remove these from the normal sidebar:

```
Supplier Invoices
Supplier Payables
Supplier Returns
```

There must also be no visible normal:

```
Purchase Orders
```

navigation item.

Do not:

- rename them and keep them,
- move them into another normal submenu,
- leave them disabled,
- hide them only with CSS.

They must no longer be part of ordinary MVP purchasing navigation.

Inspect:

```
src/app/AppShell.tsx
src/app/AppRouter.tsx
```

and the actual current routing implementation.

---

# 5. Remove Purchase Order Section From Purchases

The current Purchases page still contains old Purchase Order functionality.

Remove the entire active operational Purchase Order section from the normal Purchases page.

Remove UI for:

```
Purchase order
Draft #...
View
Edit
Confirm order
Cancel order
Receive Goods
```

Also remove active normal-page logic for:

```
Create Purchase Order Draft
Update Purchase Order Draft
Confirm Purchase Order
Cancel Purchase Order
Receive Goods
PO detail modal
PO remaining quantity
PO ordered quantity
PO received quantity
```

Candidate functions include:

```
createPurchaseOrderDraft
updatePurchaseOrderDraft
confirmPurchaseOrder
cancelPurchaseOrder
getPurchaseOrderDetail
listPurchaseOrders
```

Do not keep calling these from the normal Purchases page.

---

# 6. Do Not Delete Historical Purchase Orders

Removing the active Purchase Order workflow does NOT authorize deletion of old business records.

Preserve:

- Purchase Order database tables,
- existing Purchase Orders,
- historical PO document numbers,
- historical Purchase Receipts,
- old journal entries,
- historical relationships,
- existing posted business data.

A historical receipt may still correctly display:

```
Origin: Purchase Order
```

if it genuinely originated from a historical Purchase Order.

That is read-only history, not an active workflow.

Never convert historical Purchase Orders into Direct Purchases.

---

# 7. Final Purchases Page Structure

The normal Purchases page should approximately be:

```
Purchases

+ New purchase

[ Summary ]

Purchase Receipts & History

Receipt
Date
Supplier
Warehouse
Origin
Total
Receipt Journal
Actions
```

The primary receipt action should be:

```
View details
```

Do not attach old advanced procurement actions to the receipt rows.

---

# 8. Remove Landed Cost Completely From Active MVP

The current Purchases page contains:

```
Allocate landed cost
```

This must be removed from the active MVP.

Remove:

- `Allocate landed cost` buttons
- landed-cost action column if no longer useful
- landed-cost modal
- landed-cost form
- landed-cost frontend state
- landed-cost result card
- landed-cost success state
- landed-cost handlers
- landed-cost UI imports
- active landed-cost gateway calls
- active landed-cost DTO usage
- active landed-cost Tauri command exposure where safely unused
- tests whose only purpose is the removed active landed-cost workflow

Inspect:

```
src/features/procurement/LandedCostModal.tsx
```

If this component becomes completely unused, delete the frontend component.

Do not leave dead imports.

Do not leave unreachable landed-cost UI.

---

# 9. Database Rule for Landed Cost Removal

"Remove landed cost" does NOT mean destroy historical accounting data.

Do NOT:

- delete historical landed-cost rows,
- delete posted journals,
- rewrite applied migrations,
- drop historical tables blindly,
- modify past financial evidence.

If landed-cost SQL functions exist in already-applied migrations:

```
leave those migration files unchanged
```

The objective is:

```
No active MVP landed-cost feature.
```

Not:

```
Destroy historical landed-cost support.
```

If a new forward migration is genuinely required to remove runtime permission/exposure, prove that requirement first.

Do not create a migration simply because frontend code was removed.

---

# 10. Remove Supplier Invoices From Active MVP

Remove:

```
Supplier Invoices
```

from normal sidebar navigation and normal application routing.

Inspect:

```
src/features/procurement/SupplierInvoicesScreen.tsx
```

Required result:

- no Supplier Invoices sidebar item,
- no normal operator route,
- no Direct Purchase action that sends the operator to Supplier Invoice,
- no Supplier Invoice button on Purchase Receipt.

If the frontend screen becomes unused:

- remove dead import,
- remove dead route,
- remove obsolete frontend tests.

Do NOT delete historical supplier invoices from PostgreSQL.

Do NOT rewrite posted invoice journals.

---

# 11. Remove Supplier Payables From Active MVP

Remove:

```
Supplier Payables
```

from normal sidebar navigation and routing.

Inspect:

```
src/features/procurement/SupplierLiabilitiesScreen.tsx
```

Required:

- no Supplier Payables sidebar item,
- no active normal route,
- no automatic Direct Purchase → payable workflow.

Historical liabilities and posted accounting records must remain unchanged.

---

# 12. Remove Supplier Returns From Active MVP

Remove:

```
Supplier Returns
```

from normal sidebar navigation and routing.

Inspect:

```
src/features/procurement/SupplierReturnsScreen.tsx
```

Required:

- no Supplier Returns sidebar item,
- no normal route,
- no Return action on Purchase Receipt history/details.

Do not delete historical return records.

Do not delete posted supplier-return journals.

---

# 13. Current Procurement Files To Inspect

Before modifying, inspect the actual current versions of:

```
src/features/procurement/PurchaseOrdersScreen.tsx
src/features/procurement/PurchaseReceiptModal.tsx
src/features/procurement/PurchaseTransactionScreen.tsx
src/features/procurement/LandedCostModal.tsx
src/features/procurement/SupplierInvoicesScreen.tsx
src/features/procurement/SupplierLiabilitiesScreen.tsx
src/features/procurement/SupplierReturnsScreen.tsx
src/features/procurement/procurementCopy.ts
src/features/procurement/procurementDecimal.ts
src/features/procurement/purchaseReceiptExport.ts
```

Search before deleting anything.

Do not create another parallel Purchases screen if the current screen already works.

Modify the current accepted implementation.

---

# 14. IPC / Backend Cleanup

Inspect:

```
src/shared/ipc/gateway.ts
src/shared/ipc/dto.ts
src/shared/ipc/commands.ts

src-tauri/src/commands/procurement.rs
src-tauri/src/application/procurement_service.rs
src-tauri/src/domain/procurement.rs
src-tauri/src/lib.rs
```

Do NOT mass-delete procurement code.

A backend/runtime function may be removed from the active application surface only if:

1. It is used exclusively by a removed feature.
2. Direct Purchase does not require it.
3. Another active module does not require it.
4. Historical read-only behavior does not require it.
5. Tests prove there is no active dependency.

Purchase Order backend code may remain dormant for future advanced purchasing.

The main rule is:

```
Preserve backend/history where safe.
Remove active MVP exposure.
```

---

# 15. Purchase Receipt History Rules

Keep Purchase Receipts as the main purchase history authority.

Recommended columns:

```
Receipt
Date
Supplier
Warehouse
Origin
Total
Receipt Journal
Actions
```

Keep:

```
View details
```

Remove:

```
Allocate landed cost
Create invoice
Create return
Receive Goods
Confirm Order
Cancel Order
```

For Direct Purchase show:

```
Origin: Direct Purchase
```

For historical PO receipt show:

```
Origin: Purchase Order
```

Do not display raw fields such as:

```
purchase_order_id = null
po_line_id = null
```

---

# 16. Receipt Detail Cleanup

The current Direct Purchase receipt detail is useful and should remain.

Keep:

```
DIRECT PURCHASE
Receipt: PR-...
POSTED
Supplier
Warehouse
Date
Total
Receipt Journal
Origin
Product / Variant
SKU
Unit
Quantity
Unit Cost
Line Total
Accounting Impact
Inventory Merchandise (Debit)
Goods Received Not Invoiced / GRNI (Credit)
```

Change legacy terminology:

```
Order lines
```

to:

```
Receipt lines
```

or preferably:

```
Purchased items
```

A Direct Purchase is not a Purchase Order.

Do not place landed-cost, supplier-invoice, payable, or return actions inside the receipt detail.

---

# 17. Summary Metrics Must Match Filters

The Purchases screen currently has summary cards such as:

```
Total receipts
Direct purchases
Total value
```

If the user filters:

```
Origin: Direct Purchase
```

then summary metrics should preferably reflect the filtered dataset.

Example:

```
3 receipts
3 Direct Purchases
13,000 DZD
```

If summary cards intentionally represent all historical data, clearly label them:

```
All receipts
All Direct Purchases
All-time receipt value
```

Never display filtered rows beside ambiguous totals from an unfiltered dataset.

---

# 18. Localization

Preserve:

```
English
French
Arabic
```

Check removed or changed labels in all three languages.

Relevant old terms include:

```
Purchase Order
Confirm Order
Cancel Order
Receive Goods
Supplier Invoices
Supplier Payables
Supplier Returns
Allocate landed cost
Order lines
```

Do not break Arabic RTL.

Do not rewrite the localization architecture.

Remove unused translation keys only if they are truly unused.

---

# 19. Authorization

Do not weaken backend permissions.

Removing pages does not justify granting broader permissions.

Direct Purchase must continue using the existing authoritative procurement posting permission.

Do not change roles simply to satisfy tests.

---

# 20. Database Safety

This task is primarily an application/UI cleanup.

Do NOT:

```
edit already-applied migrations
delete Purchase Orders
delete Supplier Invoices
delete Supplier Payables
delete Supplier Returns
delete landed-cost accounting history
delete journals
delete Business Documents
truncate tables
reset the acceptance database
rewrite official document numbers
disable immutability
weaken database permissions
use SQLx force/ignore
```

If a database change appears necessary:

```
STOP AND INVESTIGATE.
```

Only use a new forward migration if repository evidence proves that one is required.

---

# 21. Required Frontend Tests

Tests must prove the final Part 01 MVP policy.

Required assertions:

```
1. Sidebar contains Suppliers.
2. Sidebar contains Purchases.

3. Sidebar does NOT contain Purchase Orders.
4. Sidebar does NOT contain Supplier Invoices.
5. Sidebar does NOT contain Supplier Payables.
6. Sidebar does NOT contain Supplier Returns.

7. Purchases page does NOT contain Purchase Order management.
8. Purchases page does NOT contain Confirm Order.
9. Purchases page does NOT contain Cancel Order.
10. Purchases page does NOT contain Receive Goods.
11. Purchases page does NOT contain Allocate landed cost.

12. + New purchase still opens the Direct Purchase form.
13. Confirm Purchase still posts successfully.
14. Successful purchase returns an official PR number.
15. Purchase Receipt history still works.
16. View details still works.
17. Receipt journal remains visible.
18. Inventory / GRNI accounting remains visible/correct.
19. Historical PO-origin receipt can still display read-only.
20. No normal operator action creates or modifies a Purchase Order.
```

Do not simply delete tests that fail because the policy changed.

Update obsolete tests to assert the new approved behavior.

---

# 22. Required Direct Purchase Regression Test

Verify this canonical WAC scenario still passes.

Before:

```
Quantity: 20
Inventory value: 1,600 DZD
WAC: 80 DZD
```

Purchase:

```
Quantity: 10
Unit cost: 100 DZD
Purchase value: 1,000 DZD
```

Expected:

```
Quantity: 30
Inventory value: 2,600 DZD
WAC: approximately 86.666667 DZD
```

Also verify:

```
one Purchase Receipt
no fake Purchase Order
one inventory effect
one receipt journal

Dr Inventory 1,000
Cr GRNI      1,000
```

---

# 23. Engineering Gates

Run the repository's canonical commands.

At minimum:

```
npm run typecheck
npm run lint
npm test
npm run build
```

Rust:

```
cd src-tauri

cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

If the project uses slightly different CI commands, inspect:

```
package.json
GitHub Actions
existing repository scripts
```

and run the canonical versions.

Do not disable tests.

Do not ignore Clippy failures.

Do not use broad suppression annotations to hide errors.

---

# 24. Manual Windows Acceptance

Use the normal Stockiha launcher.

Before launching:

```
Remove-Item Env:STOCKIHA_DEV_DATABASE_URL -ErrorAction SilentlyContinue
.\run.bat
```

Do not bypass launcher or migration failures with:

```
npm run tauri dev
```

Manual acceptance:

```
1. Sign in.

2. Inspect Purchasing navigation.

Expected:
   Suppliers
   Purchases

Not expected:
   Purchase Orders
   Supplier Invoices
   Supplier Payables
   Supplier Returns

3. Open Purchases.

4. Confirm the Purchase Order table is gone.

5. Confirm there is no:
   Confirm Order
   Cancel Order
   Receive Goods
   Allocate landed cost

6. Click + New purchase.

7. Create a Direct Purchase.

8. Confirm success returns PR-....

9. Verify exactly one receipt appears.

10. View receipt details.

11. Verify:
    supplier
    warehouse
    date
    items
    quantity
    unit cost
    total
    journal
    Inventory debit
    GRNI credit

12. Verify no fake Purchase Order was generated.

13. Open Inventory.

14. Verify quantity and WAC.

15. Restart Stockiha.

16. Verify the receipt and inventory state persist.
```

---

# 25. Target Final UI

The final MVP sidebar:

```
PURCHASING

Suppliers
Purchases
```

The final Purchases page:

```
Purchases

+ New purchase

Summary

Purchase Receipts & History
------------------------------------------------
Receipt
Date
Supplier
Warehouse
Origin
Total
Receipt Journal
Actions

PR-2026-000004
...
Direct Purchase
...
View details
```

There must be no operational sections for:

```
Purchase Orders
Supplier Invoices
Supplier Payables
Supplier Returns
Landed Cost
```

---

# 26. Out of Scope

Do not start Part 02 or Part 03.

Do not modify:

```
Inventory Corrections
Emergency Receipt
POS
Customer Returns
warehouse transfers
TVA/tax system
discount system
new costing policy
account chart
historical finance
backup/restore
authentication
unrelated UI
```

Do not add a Direct Purchase / Purchase Order toggle.

Advanced Purchase Order workflow is future work.

---

# 27. Anti-Shortcut Rules

## Never delete historical business data.

## Never fake Direct Purchase using a hidden Purchase Order.

## Never leave legacy buttons visible "for compatibility."

## Never keep dead frontend handlers after removing their UI.

## Never rewrite applied migrations.

## Never weaken permissions.

## Never remove posted-record immutability.

## Never change accounting merely because an old page was removed.

## Never leave Supplier Invoice, Payable, or Return pages in the normal MVP sidebar.

## Never leave Allocate landed cost in the normal Purchases workflow.

## Never declare success only because the application launches.

---

# 28. Completion Checklist

## Direct Purchase

-  Purchases is the main purchasing page.
-  \+ New purchase works.
-  Confirm Purchase works.
-  Purchase Receipt is created.
-  No fake Purchase Order is created.
-  Inventory quantity is correct.
-  Inventory value is correct.
-  WAC is correct.
-  Receipt journal is balanced.
-  Receipt history works.
-  Receipt detail works.
-  Receipt journal link/reference works.
-  Direct Purchase terminology is consistent.
-  `Order lines` removed/replaced.

## Purchase Order Cleanup

-  Purchase Order table removed.
-  Draft PO actions removed.
-  Confirm Order removed.
-  Cancel Order removed.
-  Receive Goods removed.
-  Normal Purchases page no longer calls PO mutations.
-  Historical PO records remain intact.
-  Historical PO-origin receipts remain readable.

## Old Procurement Pages

-  Supplier Invoices removed from sidebar.
-  Supplier Payables removed from sidebar.
-  Supplier Returns removed from sidebar.
-  Their normal routes are removed.
-  Dead imports are removed.
-  Dead frontend state is removed.
-  Obsolete tests are updated.
-  Historical records remain intact.

## Landed Cost

-  Allocate landed cost button removed.
-  Landed-cost modal removed from active UI.
-  Landed-cost result UI removed.
-  Active landed-cost handlers removed.
-  Dead IPC exposure removed where safely unused.
-  Applied migrations remain untouched.
-  Historical landed-cost evidence remains preserved.

## Quality

-  Typecheck passes.
-  Lint passes.
-  Frontend tests pass.
-  Build passes.
-  cargo fmt passes.
-  cargo check passes.
-  Clippy passes.
-  cargo test passes.
-  Windows manual acceptance passes.
-  No unrelated changes.

---

# 29. Commit Rule

After everything passes:

```
git status --short
git diff --stat
git diff
```

Ensure only intended files changed.

Create one focused commit:

```
refactor(procurement): finalize Direct Purchase MVP workflow
```

Push the current branch.

Do NOT merge into `main` unless explicitly instructed.

---

# 30. Required Final Report

Return:

```
PART 01 DIRECT PURCHASE FINALIZATION REPORT

Git
- Branch:
- Commit:
- Working tree clean:

Navigation
- Suppliers visible: PASS/FAIL
- Purchases visible: PASS/FAIL
- Purchase Orders hidden: PASS/FAIL
- Supplier Invoices removed: PASS/FAIL
- Supplier Payables removed: PASS/FAIL
- Supplier Returns removed: PASS/FAIL

Purchases Page
- New Purchase works: PASS/FAIL
- Purchase Order section removed: PASS/FAIL
- Confirm Order removed: PASS/FAIL
- Cancel Order removed: PASS/FAIL
- Receive Goods removed: PASS/FAIL
- Allocate landed cost removed: PASS/FAIL

Direct Purchase
- Confirm Purchase works: PASS/FAIL
- PR document created: PASS/FAIL
- No fake PO created: PASS/FAIL
- Inventory correct: PASS/FAIL
- WAC correct: PASS/FAIL
- Receipt history works: PASS/FAIL
- Receipt details work: PASS/FAIL
- Journal visible: PASS/FAIL
- Inventory / GRNI balanced: PASS/FAIL

Historical Safety
- Historical Purchase Orders preserved: PASS/FAIL
- Historical invoices preserved: PASS/FAIL
- Historical payables preserved: PASS/FAIL
- Historical returns preserved: PASS/FAIL
- Historical landed costs preserved: PASS/FAIL
- Applied migrations unchanged: PASS/FAIL

Engineering
- Typecheck: PASS/FAIL
- Lint: PASS/FAIL
- Frontend tests: PASS/FAIL
- Build: PASS/FAIL
- cargo fmt: PASS/FAIL
- cargo check: PASS/FAIL
- Clippy: PASS/FAIL
- cargo test: PASS/FAIL

Manual Windows Acceptance
- PASS/FAIL

FINAL RESULT:
PASS / FAIL
```

Part 01 is complete only if every required item passes.

If any mandatory item fails:

```
FINAL RESULT = FAIL
```

Do not hide, skip, or downgrade failures merely to finish the task.

```
