# Current Slice Status

## Active Context
- **Current Phase:** Slice 2 Catalog & Advanced Inventory
- **Current Task:** S2-001 — Implement variant catalog, attributes, units, and barcodes
- **Implementation Status:** Implemented on branch `task/s2-catalog-and-advanced-inventory` (pending review/merge). Database layer (migrations, constraints, SECURITY DEFINER functions, backfill, concurrency) validated against a local PostgreSQL 15 standards-proxy with a full SQL assertion suite. Rust `cargo fmt --check` passes; Rust compile/clippy/tests and the frontend typecheck/lint/vitest/build are deferred to local PostgreSQL 18 / Antigravity because the sandbox lacks a C linker, the Tauri WebKitGTK libraries, and npm registry access. See the batch report for exact evidence and deferred checks.

## Objective
Implement product variant catalog tracking with attributes, variant SKU, single/multiple barcodes per variant, active/inactive status, base units, and alternate unit conversions.

## Included Task ID
- `S2-001`

## Database Scope
- Extension of product catalog schema (e.g. `catalog.product_variants`, `catalog.attributes`, `catalog.attribute_values`, `catalog.variant_attribute_values`, `catalog.variant_barcodes`).
- Database constraints for barcode uniqueness and active state.

## Rust/Tauri Scope
- Rust domain models for variants, attributes, units, and barcodes.
- SQLx queries/repositories for catalog operations.
- Tauri commands to add, edit, query, and search variants (including barcode scan lookup).

## React Scope
- Extend product catalog forms to allow configuration of attributes, base units, and alternate units.
- Extend POS UI to support searching and scanning variants by barcode or text.

## Tests and Validation
- Unit tests for unit conversion factors (exact decimal representation).
- Database constraint integration tests for uniqueness/integrity.
- IPC integration tests for commands.

## Production Invariants
- Enforce exact decimal math (no floating point) for unit conversion factors.
- Global barcode uniqueness verification.

## Explicit Exclusions
- S2-002 stock-adjustment posting handler.
- S2-003 zero-quantity WAC safeguards and rounding residual handlers.
- Warehouse transfers (deferred to Slice 5).
- Procurement, Goods Receipts, POs, and Supplier Invoices (deferred to Slice 3).
- Broad UI redesign.
- Cosmetic UI polish.
