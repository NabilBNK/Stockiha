# WS-D Surface Map

Where things are. **Not** what they currently say — the code is the truth, and catalogue functions change shape often. Always confirm live signatures per `SKILL.md` §0.

## Contents

1. Schemas and tables
2. Migrations
3. Function inventory — `catalog.*`
4. Function inventory — `inventory.*`
5. Rust
6. React
7. Verification commands and environment
8. Cross-workstream and protected files

---

## 1. Schemas and tables

WS-D owns `catalog` and `inventory`.

`catalog.products` — `category_id` (nullable, FK → `catalog.categories`, added D-1), `unit_id`, `name`, `is_active`.
`catalog.product_variants` — `minimum_stock numeric NOT NULL DEFAULT 0` with a non-negative check (added D-1). **Zero means "no low-stock warning", per the column comment.** Stock, barcodes, and price live at this level, not on the product.
`catalog.categories` — added D-1. `normalized_name` unique, `is_active`, `updated_at` trigger.
`catalog.brands` — pre-existed but was unused; D-1 wired it up and added `normalized_code` with case-insensitive uniqueness.
`catalog.attributes`, `catalog.attribute_values`, `catalog.units` — all gained `is_active` in D-1 so all five reference types behave uniformly.
`catalog.variant_barcodes`, `catalog.variant_units` — barcode and alternate-unit mappings.

## 2. Migrations

`src-tauri/migrations/`. Read in filename order; later files redefine earlier ones and, since D-1, sometimes *add alongside* them.

**Foundation** — `20260722125404` products and variants; `20260722125405` warehouses, positions, movements, `forbid_movement_mutation`; `20260722125413` stock receipt; `20260722200002` catalog and warehouse management; `20260722200003` MVP read queries.

**Catalogue expansion** — `20260724120000` attributes, values, units, barcodes; `20260724120100` the bulk of the `catalog.*` API.

**The August repair cluster.** `20260813180000` identity and SKU redesign, then `20260815100000` attribute mapping fix, `20260815113000` runtime contract hardening, `20260815114000` ambiguous barcode helper removal, `20260815115000` legacy create repair, `20260815120000` legacy batch create removal, `20260815121000` default legacy unit. Six repairs in two days. Worth reading as a record of which mistakes this codebase has already made.

`20260820200000` — variant search update.

**`20260901090000_ws_d_001_catalogue_foundation.sql` — the D-1 deliverable, 1,085 lines, current authority for the catalogue.** Adds categories, wires brands, adds `minimum_stock`, adds the full reference-data lifecycle for all five types, adds `quick_create_product` and `list_products_v2`, and adds widened overloads of `update_product` and `update_variant`.

**Inventory** — `20260724130000` adjustments; `20260724140000` zero-quantity safeguards and residuals; `20260724140100` redefines `confirm_stock_adjustment`; `20260811120000` read side (`get_capabilities`, `list_inventory_snapshot`, `get_stock_receipt_result` — **copy this pattern for D-8 analytics**); `20260817090000` inventory corrections policy (**protected**).

## 3. Function inventory — `catalog.*`

**Current, D-1 (prefer these):**
`list_products_v2` (8 params, returns 20 columns), `quick_create_product`, `list_categories`, `create_category`, `rename_category`, `set_category_active`, `delete_category`, `list_brands`, `create_brand`, `rename_brand`, `set_brand_active`, `delete_brand`, `list_attributes_v2`, `rename_attribute`, `set_attribute_active`, `delete_attribute`, `list_attribute_values`, `rename_attribute_value`, `set_attribute_value_active`, `delete_attribute_value`, `list_units_v2`, `rename_unit`, `set_unit_active`, `delete_unit`, `_product_has_stock_history`.

**Live overloads — read `SKILL.md` §2.1 before calling:**
`update_product` — 5-arg and 7-arg. `update_variant` — 5-arg and 6-arg. Target the wide one.

**Superseded by a `_v2`; use only until existing callers migrate. Never create a `_v3`:**
`list_products`, `list_catalog_products` → `list_products_v2`. `list_attributes` → `list_attributes_v2`. `list_units` → `list_units_v2`.

**Identity and lookup, unchanged by D-1:**
`_generate_sku`, `_effective_variant_name`, `_insert_variant`, `_insert_barcode`, `compute_attribute_signature`, `resolve_barcode`, `get_product_detail`, `create_product_with_variant`, `create_product_with_variants`, `add_variant`, `set_variant_active`, `set_variant_attributes`, `create_attribute`, `add_attribute_value`, `create_unit`, `add_variant_barcode`, `remove_variant_barcode`, `add_variant_alt_unit`, `remove_variant_alt_unit`, `set_variant_base_unit`.

`list_products_v2` returned columns — all twenty must appear in the Rust struct:
`product_id, variant_id, sku, product_name, variant_name, primary_barcode, display_identifier, identifier_type, sale_price, minimum_stock, is_active, product_is_active, category_id, category_name, brand_id, brand_name, quantity_on_hand, last_known_wac, attributes (jsonb), total_count`.

`last_known_wac` is **display only**. See `SKILL.md` §6.

## 4. Function inventory — `inventory.*`

`create_warehouse`, `list_warehouses`, `confirm_stock_receipt`, `confirm_stock_adjustment`, `list_stock_adjustment_units`, `_stock_adjustment_response`, `_handle_residual_at_zero_quantity`, `get_capabilities`, `list_inventory_snapshot`, `get_stock_receipt_result`, and the three immutability triggers `forbid_movement_mutation`, `forbid_stock_adjustment_mutation`, `forbid_residual_clearance_mutation`.

Written by WS-E, consumed by WS-D, not modified here: `confirm_purchase_receipt`, `allocate_landed_cost`, `confirm_supplier_return`, `procurement.list_purchase_product_options`.

## 5. Rust

**Domain** (`src-tauri/src/domain/`) — pure, unit-testable: `catalog.rs`, `product.rs`, `stock.rs`, `warehouse.rs`, `identifiers.rs`, `money.rs`, `residual.rs`.

**Application** (`src-tauri/src/application/`) — orchestration and SQL: `catalog.rs`, `inventory.rs`, `stock_receipt.rs`, `stock_adjustment.rs`, `warehouse.rs`.

**Commands** (`src-tauri/src/commands/`) — thin IPC boundary: `catalog.rs`, `inventory.rs`, `stock_receipt.rs`, `stock_adjustment.rs`, `warehouse.rs`, `reference.rs`.

**Registration** — `src-tauri/src/lib.rs` holds the command handler list. A command not registered there fails silently at runtime. Also `application/mod.rs`, `commands/mod.rs`, `domain/mod.rs`.

**Errors** — `src-tauri/src/error.rs`, `domain/error.rs`. Codes surface through `src/shared/utils/tauriError.ts` and `src/shared/hooks/useErrorText.ts`. A new code without a translation shows the operator a raw string.

**Tests** — `src-tauri/tests/catalog/`, `src-tauri/tests/inventory/`, driven by `src-tauri/tests/run_current_sql_suites.sh`.

## 6. React

**Products** (`src/features/products/`) — `ProductsScreen.tsx`, `ProductEditor.tsx`, `VariantForm.tsx`, `AttributeManager.tsx`, `UnitManager.tsx`, `BarcodeManager.tsx`, `useCatalog.ts`. D-4 and D-5 rebuild these.

**Inventory** (`src/features/inventory/`) — `InventoryScreen.tsx`, `StockReceiptScreen.tsx`, `StockAdjustmentScreen.tsx`, `ZeroQuantityWarning.tsx`, `exactDecimal.ts`. The Inventory screen already demonstrates the barcode-first, variant-first pattern that Products is being brought up to.

**Shared** — `src/shared/components/ItemSearchModal.tsx` (extend, do not fork); `src/shared/ipc/dto.ts`, `gateway.ts`, `commands.ts` (the TypeScript corner of the contract triangle); `src/shared/i18n/`; `src/shared/utils/formatters.ts`; `src/app/AppRouter.tsx`; `src/app/AppShell.tsx`.

**Styling** — tokens in `src/styles/global.css`, authority in `DESIGN.md`. D-0 ruling: new layout system, existing blue `#2457d6`, no repaint.

## 7. Verification commands and environment

From the repository root:

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build

cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib

bash src-tauri/tests/run_current_sql_suites.sh
```

Cargo package `stockiha-backend`; lib target `stockiha_lib`. Different names. Scope tests by module path, not file path: `cargo test --manifest-path src-tauri/Cargo.toml --lib application::catalog::tests`. `.cargo/config.toml` forces `RUST_TEST_THREADS = 1` deliberately — do not override.

Windows database, PowerShell, repository root:

```powershell
.\scripts\ensure-postgres.ps1
.\scripts\run-sqlx-migrations.ps1
```

| Setting | Value |
|---|---|
| Data directory | `%LOCALAPPDATA%\Stockiha\r8-acceptance\data-55433` |
| Port | `5433` (the `55433` is a folder name only) |
| Database | `stockiha_r8_acceptance_inventory_test` |
| Control | `pg_ctl` / `pg_isready` only — never launch `postgres.exe` directly |

Never run a global process kill to free a port; use `scripts/cleanup-dev-processes.ps1`. A successful migration run prints `Database migrations: PASS`; absence of that line means it did not succeed. `run.bat` is the authoritative launcher — bare `npm run tauri dev` does not export the recovery environment variables and is not valid for acceptance testing.

**PowerShell scripts must be pure 7-bit ASCII** — no em-dashes, smart quotes, or arrows, in code or comments. Verify before committing:

```powershell
$bytes = [IO.File]::ReadAllBytes('scripts\your-script.ps1')
if ($bytes | Where-Object { $_ -gt 127 }) { 'NON-ASCII PRESENT' } else { 'ASCII CLEAN' }
```

## 8. Cross-workstream and protected

**Read, do not reshape:** `src/features/procurement/` and `application/procurement_service.rs` (WS-E, writes inventory movements); `src/features/pos/PosScreen.tsx` and `application/cash_sale.rs` (WS-F, consumes barcode resolution — a barcode change breaks POS); `src/features/settings/` (WS-C, feature toggles gating WS-D capabilities).

**Protected — extend only:** `20260817090000_inventory_corrections_policy.sql`, `src/features/settings/InventoryCorrectionsSettingsScreen.tsx`, `src/shared/ipc/inventoryCorrectionsGateway.ts`, `20260816150000_direct_purchase_foundation.sql` and its `20260816160000`–`20260816195000` repair chain.

Changing barcode resolution or movement shape has blast radius into POS and Procurement. Name that radius in your plan before touching either.
