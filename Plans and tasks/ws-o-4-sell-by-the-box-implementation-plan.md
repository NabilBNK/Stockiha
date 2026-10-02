# WS-O-4 — Sell by the Box: Implementation Plan

**Workstream:** WS-O — Units & Packaging ("Boxes and Pieces")  
**Sub-plan:** O-4 of 6 (Sell by the box)  
**Spec Reference:** `Plans and tasks/WS-O-boxes-and-pieces-spec.md` (Section 11)  
**Target Branch:** `task/ws-o-4-5-batch-selection-stock-filter`  
**Build Version Marker:** `[ version = WS-O-4.7 ]`  

---

## 0. Authority and Precedence

Before touching any code, read in this order:
1. `Plans and tasks/WS-O-boxes-and-pieces-spec.md` (Section 11)
2. `STOCKIHA_GROUND_TRUTH.md`
3. `AGENTS.md`
4. This document

### Confirmed Design Alignments (via Socratic Gate / `/grill-me`):
1. **Branch**: Continue directly on the active branch (`task/ws-o-4-5-batch-selection-stock-filter`), retaining single-warehouse consolidation and catalog enhancements.
2. **Till Cart Unit Chips**: Inline touch chips directly in the cart item card (`[Piece] [Carton ×12] [Bale ×50]`) for one-tap switching.
3. **Mixed Quantity Interaction**: Dedicated stepper row always visible for packs with automatic carry-over to full packs when extra pieces reach the pack factor.
4. **Price Overrides**: Inline editable price field with a quick "Reset" link and below-WAC amber warning (non-blocking per R5).
5. **Receipts & Documents**: Sub-row detail on thermal and A4 receipts (`Name` on line 1, `Qty × Unit (Rate) = Total` on line 2).

---

## 1. Architectural & Database Scope

### 1.1 Database Migration (`<timestamp>_ws_o_4_sell_by_pack.sql`)
1. **New Columns on `sales.cash_sale_lines` and `sales.credit_sale_lines`**:
   - `price_basis`: `'BASE' | 'PACK' | 'PACK_RATE'` (NOT NULL DEFAULT `'BASE'`)
   - `pack_unit_id`: `bigint NULL REFERENCES catalog.units(id)`
   - `pack_unit_name_snapshot`: `text NULL`
   - `pack_factor_snapshot`: `numeric(20,6) NULL`
   - `pack_quantity`: `numeric(18,3) NULL`
   - `pack_price`: `numeric(14,2) NULL`
   - `list_price_snapshot`: `numeric(14,2) NULL`
   - `price_overridden`: `boolean NOT NULL DEFAULT false`
2. **Updated Constraints**:
   - Drop legacy `cash_sale_lines_line_total_matches_quantity_and_price`.
   - Add `cash_sale_lines_price_basis_valid`.
   - Add `cash_sale_lines_pack_columns_consistent`.
   - Add `cash_sale_lines_line_total_matches_by_basis`:
     - If `PACK`: `line_total = round(pack_quantity * pack_price, 2)`
     - Else: `line_total = round(quantity * unit_price, 2)`
   - Mirror all constraints on `sales.credit_sale_lines`.
3. **Private Line Expansion Function `sales._expand_sale_lines(p_lines jsonb)`**:
   - Expands incoming requests atomically inside PostgreSQL.
   - For `sale_unit = 'PACK'`: splits into one `PACK` line and, if `extra_quantity > 0`, one `PACK_RATE` line priced at `round(pack_price / factor, 0)`.
   - Legacy lines pass through with `price_basis = 'BASE'`.
4. **Update Posting Functions**:
   - Update `sales.confirm_cash_sale` and `sales.confirm_credit_sale` to expand lines using `v_lines_expanded := sales._expand_sale_lines(p_lines);`.
   - Update `catalog._pack_is_used` to check for sales in both `cash_sale_lines` and `credit_sale_lines`.
5. **Payload Hash Fingerprint**:
   - Update `receivables.credit_sale_payload_hash` so pack fields (`sale_unit`, `pack_unit_id`, `pack_quantity`, `extra_quantity`, `pack_price`) are included in the SHA-256 fingerprint.

---

## 2. Rust Backend & IPC Scope

### 2.1 Structs & Serialization
1. Update `CashSaleLineInput` in `src-tauri/src/application/cash_sale.rs`:
   - Optional fields for pack: `sale_unit`, `pack_unit_id`, `pack_quantity`, `extra_quantity`, `pack_price`.
   - Validate exactly one shape: either base (`quantity`, `unit_price`) or pack (`sale_unit == "PACK"`, `pack_unit_id`, `pack_quantity`, `pack_price`).
2. Update `CreditSaleLineInput` in `src-tauri/src/application/credit_sale.rs`.
3. Update commands in `src-tauri/src/commands/sales.rs`.

### 2.2 TypeScript IPC DTOs
1. Update `src/shared/ipc/dto.ts` and `creditSaleDto.ts`:
   ```ts
   export type SaleLineInput =
     | { variant_id: number; quantity: string; unit_price: string }
     | { variant_id: number; sale_unit: 'PACK'; pack_unit_id: number; pack_quantity: string; extra_quantity?: string; pack_price: string };
   ```

---

## 3. Frontend & POS Till Scope (`src/features/pos/`)

### 3.1 Cart State Model (`PosScreen.tsx`)
1. Implement discriminated union `CartLine`:
   - `kind: 'BASE'`: standard piece line.
   - `kind: 'PACK'`: pack line holding `pack: SellablePack`, `packQuantity`, `extraQuantity`, `price`, `listPrice`, `wac`.
2. When adding a product (tile click, search, barcode scan):
   - Query `listVariantPacks` (cached per variant).
   - If the variant has an active main pack with a sale price, default to `PACK` (`packQuantity: '1'`, `extraQuantity: '0'`).
   - If no sellable pack exists, default to `BASE`.
   - Scanning a pack barcode increases that specific pack line.

### 3.2 Row Controls & Ergonomics
1. **Unit Chips**: Render `[Piece]` + `[{pack.unit_name} ×{factor}]` for all sellable packs.
2. **Steppers**:
   - Pack stepper: `[-] {packQuantity} {unit_name} [+]` (min 1).
   - Extra loose pieces stepper: `[-] {extraQuantity} Loose [+]` (min 0).
   - Carry rule: When `extraQuantity >= factor`, auto-increment `packQuantity` and wrap `extraQuantity`.
3. **Price Editing**:
   - Inline touch-editable price with label `"per {unit}"`.
   - Show amber warning if `price < wac * factor` (or `rate < wac`).
   - Show `"edited"` badge and a `[↺ Reset]` button if modified from list price.
4. **Receipt Builder (`receiptBuilder.ts`)**:
   - Support rendering pack breakdown and pack-rate sub-rows on thermal receipts and in `ReceiptView.tsx`.

---

## 4. Step-by-Step Implementation Sequence

| Step | Focus Area | Files Involved | Verification |
|---|---|---|---|
| **Phase 1** | SQL Migration & Core Functions | `src-tauri/migrations/20261002090000_ws_o_4_sell_by_pack.sql` | `sqlx migrate run`, `psql` schema check |
| **Phase 2** | Rust Domain & Application | `src-tauri/src/application/cash_sale.rs`, `credit_sale.rs` | `cargo test --lib` |
| **Phase 3** | TypeScript IPC & DTOs | `src/shared/ipc/dto.ts`, `creditSaleDto.ts` | `npm run typecheck` |
| **Phase 4** | POS Till Cart & UI | `src/features/pos/PosScreen.tsx`, `receiptBuilder.ts` | Vitest `pos-touch.workflow.test.tsx` |
| **Phase 5** | Integration Tests & W4 Example | `src-tauri/tests/sales/ws_o_4_sell_by_pack_integration.sql` | SQL test runner |
| **Phase 6** | Version Bump & Final Verification | `src/shared/version.ts` -> `'WS-O-4.7'` | Full test suite, lint, build |

---

## 5. Verification Commands

1. `npm.cmd test -- tests/pos-touch.workflow.test.tsx src/features/products/PackManager.test.tsx tests/catalog2.workflow.test.tsx`
2. `npm.cmd run typecheck`
3. `npm.cmd run lint`
4. `npm.cmd run build`
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
