# Current Slice Status

## Active Context
- **Current Phase:** Slice 3 Procurement & Supplier Purchasing
- **Current Task:** S3-001 — Implement supplier master, purchase order workflow, and goods receipt posting
- **Implementation Status:** Not started

## Objective
Implement the complete supplier procurement workflow: supplier directory management, purchase order generation (`PO-YYYY-XXXXXX`), purchase order line items, purchase receipt confirmation (`inventory.confirm_purchase_receipt`), warehouse-specific WAC recalculation, inventory position increments, supplier payables tracking, and double-entry accounting journals (`Dr INVENTORY_MERCHANDISE / Cr ACCOUNTS_PAYABLE`).

## Included Task ID
- `S3-001`

## Database Scope
- `procurement.suppliers`: Supplier master directory (code, name, tax ID / NIF, contact details, active status).
- `procurement.purchase_orders` & `procurement.purchase_order_lines`: Purchase order header and lines (unit price, quantity, line total).
- `procurement.purchase_receipts`: Official purchase receipt document (`PR-YYYY-XXXXXX`).
- `inventory.confirm_purchase_receipt`: `SECURITY DEFINER` function posting purchase receipt, recalculating WAC, creating `RECEIPT` movements, and recording balanced journals (`Dr INVENTORY_MERCHANDISE / Cr ACCOUNTS_PAYABLE`).
- Permissions: `MANAGE_PROCUREMENT`, `POST_PURCHASE_RECEIPT`.

## Rust/Tauri Scope
- DTOs and commands for supplier directory CRUD, purchase order management, and purchase receipt posting.
- Error mapping for invalid suppliers, unapproved POs, or unit mismatches.

## React Scope
- Suppliers screen (list, add, edit).
- Purchase Order screen (create, view, receive stock).
- Navigation integration under Procurement section.

## Tests and Validation
- SQL assertions for purchase receipt posting, WAC updates, movement creation, and journal balancing.
- Cargo tests for procurement domain types.
- Frontend workflow tests for purchase order and receipt UI.

## Production Invariants
- Confirmed negative stock is forbidden.
- Journal entries must balance (Debits = Credits).
- Posted ledgers are immutable.

## Explicit Exclusions
- Supplier payments and cash disbursements (deferred to Slice 4 / Slice 6).
- Broad UI redesign.
