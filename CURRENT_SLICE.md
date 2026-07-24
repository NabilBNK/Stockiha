# Current Slice Status

## Active Context
- **Current Phase:** Slice 2 Catalog & Advanced Inventory
- **Current Task:** S2-002 — Implement advanced posting handler `inventory.confirm_stock_adjustment`
- **Implementation Status:** Implemented on `task/s2-002-stock-adjustment-posting`; verification pending

## Objective
Implement the authoritative SECURITY DEFINER posting function `inventory.confirm_stock_adjustment` and the complete PostgreSQL → Rust → Tauri → React workflow for signed manual stock adjustments.

## Included Task ID
- `S2-002`

## Database Scope
- Implement `inventory.confirm_stock_adjustment` SECURITY DEFINER posting function.
- Use one signed exact `quantity_delta` contract in base units: positive increases, negative decreases, zero rejects.
- Convert configured alternate units exactly before posting and persist the conversion snapshot.
- Update locked inventory positions and append immutable `ADJUSTMENT` movements.
- Create balanced journals using `INVENTORY_MERCHANDISE`, `INVENTORY_ADJUSTMENT_GAIN`, and `INVENTORY_ADJUSTMENT_LOSS`.
- Allocate official `STOCK_ADJUSTMENT` document numbers transactionally.
- Enforce authenticated `MANAGE_INVENTORY` sessions and idempotent requests.

## Rust/Tauri Scope
- Add application service methods and IPC Tauri commands for stock adjustments.
- Enforce exact decimal math (`rust_decimal`) for quantities, unit costs, and journal amounts.
- Request idempotency validation (`core.request_idempotency`).

## React Scope
- Present `Increase stock` / `Decrease stock` with a positive exact quantity input.
- Convert direction to the signed decimal IPC string without client-side balance or valuation calculations.
- Submit stable localized reason codes; `OTHER` requires a non-blank note.
- Prevent duplicate submission and preserve the idempotency key for uncertain retries.

## Tests and Validation
- SQL integration assertions cover gain/loss, exact valuation, movement, journals, numbering, validation, rollback, idempotency, regressions, and security.
- Dedicated concurrency assertions cover duplicate requests and competing negative adjustments.
- Rust tests cover the reason vocabulary, canonical signed payload, note normalization, and cohesive response mapping.
- React tests cover signed direction conversion, alternate units, reasons, duplicate-submit prevention, safe errors, and Arabic RTL.

## Production Invariants
- Confirmed negative stock is forbidden.
- Journal entries must balance (Debits = Credits).
- Movements and journals are immutable once posted.

## Explicit Exclusions
- Counted-quantity, physical-count, and submitted-final-stock contracts.
- Estimated-cost input or S2-003 zero-quantity valuation/residual handlers; S2-002 instead rejects unsafe zero-stock gains.
- Inter-warehouse transfers (deferred to Slice 5).
- Procurement / Goods Receipts (deferred to Slice 3).
- Broad UI redesign.
