# Current Slice Status

## Active Context
- **Current Phase:** Slice 2 Catalog & Advanced Inventory
- **Current Task:** S2-002 — Implement advanced posting handler `inventory.confirm_stock_adjustment`
- **Implementation Status:** Not started

## Objective
Implement the authoritative SECURITY DEFINER database posting function `inventory.confirm_stock_adjustment` and application layer integration for manual stock counts, damage write-offs, and initial inventory adjustments.

## Included Task ID
- `S2-002`

## Database Scope
- Implement `inventory.confirm_stock_adjustment` SECURITY DEFINER posting function.
- Update inventory positions and log immutable inventory movements (`INVENTORY_ADJUSTMENT`).
- Create balanced double-entry accounting journals for inventory gain/loss against variance accounts.
- Enforce caller session authentication (`MANAGE_INVENTORY` permission).

## Rust/Tauri Scope
- Add application service methods and IPC Tauri commands for stock adjustments.
- Enforce exact decimal math (`rust_decimal`) for quantities, unit costs, and journal amounts.
- Request idempotency validation (`core.request_idempotency`).

## React Scope
- Implement stock adjustment form in inventory section (quantity delta / count input, reason selection, provisional totals).
- Form validation and backend error handling.

## Tests and Validation
- SQL integration assertions for gain, loss, permission failure, negative stock guard, and balanced journals.
- Rust unit and integration tests.
- React workflow tests for adjustment submission.

## Production Invariants
- Confirmed negative stock is forbidden.
- Journal entries must balance (Debits = Credits).
- Movements and journals are immutable once posted.

## Explicit Exclusions
- S2-003 zero-quantity WAC safeguards and residual clearance handlers.
- Inter-warehouse transfers (deferred to Slice 5).
- Procurement / Goods Receipts (deferred to Slice 3).
- Broad UI redesign.
