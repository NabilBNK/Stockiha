# Stockiha — WS-O Fixes, Single-Warehouse Consolidation & Visibility

**Task Target:** WS-O Follow-up Fixes & Refinements  
**Target Version Marker:** `[ version = WS-O-6.3 ]`  
**Target Environment:** Windows Desktop (Tauri v2 + WebView2 + PostgreSQL 18.x)

---

## 1. Problem Statements & Root Causes

1. **Missing Translation Key (`typeFlexiblePack`):**
   - `catalogueSetup.units.typeFlexiblePack` is missing in `src/shared/i18n/locales.ts` for FR, AR, EN, causing the raw translation key to be rendered on the Unit tab.
2. **Missing/Confusing Edit Button on Units:**
   - In `UnitManager.tsx`, the action button is labeled `catalogueSetup.actions.rename` ("Rename" / "Renommer"), but it actually edits the name, holds factor, base unit, and decimal fraction flags. Users expect an explicit **Edit** button.
3. **Product Table Showing Only One Product:**
   - `catalog.list_products_v2` paginates by `product_variants` (`LIMIT 50 OFFSET 0`). When a product has 50 variants, all 50 rows returned belong to that one product. The frontend groups them by product, resulting in only 1 product on page 1.
   - **Resolution:** Paginate the query by **products** (`DISTINCT ON (p.id)` or product ID pagination) so each page displays 50 products with all their variants.
4. **Bulk Variant Generator Pre-configured Unit Factor:**
   - In `BulkVariantGenerator.tsx`, selecting a pre-configured unit (e.g. `Carton 50`) does not auto-populate `packFactor = "50"` and does not lock the factor input.
   - **Resolution:** When selecting a pre-configured unit, auto-fill `packFactor = formatExactDecimal(u.conversion_factor)` and disable the factor input.
5. **Purchases Page Item Picker Multi-Select:**
   - In `PurchasesScreen.tsx`, `PurchaseItemPicker` is opened without `multiSelect` and `onSelectMultiple`, causing it to act as single-select and close after picking 1 item.
   - **Resolution:** Enable `multiSelect={pickerTargetIndex === null}` and wire `onSelectMultiple` to append all checked items.
6. **Direct Purchase Report Cut Off / Scroll:**
   - In `PurchaseReceiptDetailModal.tsx` and `procurement.css`, dialog flex constraints and padding prevent smooth scrolling to the bottom of the Accounting Impact card.
   - **Resolution:** Set clear height limits, flex scrolling, and bottom padding on `.pr-receipt-detail-dialog` and `.sk-detail-dialog__body`.
7. **Pillow Test Variants Not Showing in Search & POS:**
   - In `ItemSearchModal.tsx` and `PosScreen.tsx`, `inStockOnly` defaults to `true`. Newly created variants have `quantity_on_hand = 0` and are completely hidden.
   - Furthermore, the purchase receipt of 250 pieces was posted to `Direct Purchase Warehouse` (Warehouse 2), while POS was active on `Main Warehouse` (Warehouse 1).
   - **Resolution:**
     1. Default `inStockOnly` to `false` in both `ItemSearchModal.tsx` and `PosScreen.tsx`, with a clear "Out of stock / 0 stock" indicator.
     2. Enforce single-warehouse operation: lock the entire app to Main Warehouse (Warehouse 1) and hide warehouse selectors.
     3. Add SQL migration to merge/consolidate any existing inventory positions from Warehouse 2 into Warehouse 1 so the 250 pieces of Pillow test appear immediately.

---

## 2. In-Scope Files to Modify

1. **`src-tauri/migrations/20261003190000_single_warehouse_and_product_pagination.sql`**:
   - Merge `inventory.positions` from non-default warehouses into Warehouse 1 (`Main Warehouse`).
   - Update `catalog.list_products_v2` to paginate over distinct `product_id`s (50 products per page) instead of raw variants.
2. **`src/shared/i18n/locales.ts`**:
   - Add `catalogueSetup.units.typeFlexiblePack` in FR, AR, EN.
   - Add `catalogueSetup.actions.edit` ("Modifier" / "تعديل" / "Edit").
3. **`src/features/catalogue-setup/UnitManager.tsx`**:
   - Label unit edit button as Edit (`catalogueSetup.actions.edit`).
4. **`src/features/catalog2/BulkVariantGenerator.tsx`**:
   - Auto-fill `packFactor` and lock factor input for pre-configured pack units.
5. **`src/features/catalog2/useCatalogList.ts` & `CatalogScreen.tsx`**:
   - Update pagination range display to count products ("Products 1–50 of N").
6. **`src/features/procurement/PurchasesScreen.tsx`**:
   - Enable `multiSelect` and `onSelectMultiple` for `PurchaseItemPicker`.
   - Default warehouse to Warehouse 1 and hide warehouse selector.
7. **`src/features/procurement/PurchaseReceiptDetailModal.tsx` & `procurement.css`**:
   - Ensure receipt modal body is fully scrollable to the bottom.
8. **`src/shared/components/ItemSearchModal.tsx`**:
   - Default `inStockOnly` to `false` so 0-stock variants are visible in search.
9. **`src/features/pos/PosScreen.tsx`**:
   - Default `inStockOnly` to `false`.
   - Lock `posWarehouseId` to Warehouse 1.
10. **`src/shared/version.ts`**:
    - Update version marker to `WS-O-6.3`.

---

## 3. Database & Security Impact

- **Database:**
  - One clean migration that merges positions from secondary warehouses into Warehouse 1 and optimizes `catalog.list_products_v2` for product-level pagination.
  - Safe, idempotent, preserves all existing ledger journal entries and audit trails.
- **Security:**
  - Session verification and `SECURITY DEFINER` constraints remain fully intact.

---

## 4. Verification Plan

1. Apply migration via `scripts/run-sqlx-migrations.ps1`.
2. Run frontend typecheck: `npm run typecheck`.
3. Run frontend tests: `npm run test`.
4. Verify build: `npm run build`.
5. Verify in running application:
   - Check that unit tab displays "Emballage flexible" / "تعبئة مرنة" and "Edit" button.
   - Check that products table displays all products (not just 1).
   - Check that Pillow test and its 18 variants appear in search and POS.
   - Check that Pillow test has 250 pieces in POS.
   - Check that direct purchase item picker allows selecting multiple items at once.
   - Check that direct purchase report modal scrolls smoothly to the very bottom.
