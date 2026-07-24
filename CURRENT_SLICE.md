# Current Slice Status

## Active Context
- **Current Phase:** Slice 2 Catalog & Advanced Inventory
- **Current Task:** S2-003 — Implement zero-quantity WAC safeguards and rounding residual handlers
- **Implementation Status:** Not started

## Objective
Implement zero-quantity inventory WAC preservation rules, stock clearance zero-value adjustments, and monetary/inventory valuation rounding residual handlers.

## Included Task ID
- `S2-003`

## Database Scope
- Implement zero-quantity inventory position WAC preservation or reset rules.
- Handle zero-value residual clearance postings when stock quantity reaches zero.
- Account for monetary rounding residuals between unit costs and journal balances.
- Enforce strict caller session permissions.

## Rust/Tauri Scope
- Add service helpers for zero-quantity inventory valuation handling.
- Maintain exact decimal precision for WAC calculations (`rust_decimal`).
- Map errors for zero-quantity valuation safeguards.

## React Scope
- Display warnings when attempting positive adjustments on items with uninitialized WAC.
- Expose residual adjustment status in inventory reports.

## Tests and Validation
- SQL assertions for zero-quantity stock depletion, residual value clearance, and WAC retention.
- Rust unit tests for decimal rounding and residual allocation.
- Integration tests for stock clearance posting workflows.

## Production Invariants
- Confirmed negative stock is forbidden.
- Journal entries must balance (Debits = Credits).
- Movements and posted ledgers are immutable.

## Explicit Exclusions
- Inter-warehouse transfers (deferred to Slice 5).
- Procurement / Goods Receipts (deferred to Slice 3).
- Broad UI redesign.
