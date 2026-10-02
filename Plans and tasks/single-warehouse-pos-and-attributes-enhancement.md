# Implementation Plan: Global Attributes, Single Warehouse, Sellable Packs & POS Fix

## Objectives
1. **Global Compact Attribute Selection**: Apply the modern, compact inline chip row design to `src/styles/global.css` so that attribute selection everywhere across the app (including the standalone product edit/attributes modal) matches the streamlined design.
2. **Single Warehouse Enforcement**: Remove all warehouse dropdowns and selectors from the UI (`CatalogScreen`, `StockReceiptScreen`, `StockAdjustmentScreen`, `InventoryScreen`) and bind the application seamlessly to the primary default warehouse (`warehouses[0].id`).
3. **Sellable Packs (Remove 'Not sold')**: In `PackManager.tsx`, auto-populate pack selling prices from the base unit price × pack quantity so every pack is sellable by default, removing the `"Not sold (buy only)"` restriction.
4. **Catalog Product Page Zero-Stock Filter**: Add the `[📦 In Stock Only]` toggle button to the main Products catalog page toolbar (`CatalogScreen.tsx` / `useCatalogList.ts`), allowing operators to quickly hide out-of-stock items.
5. **POS In-Stock Products Bug Fix**: In `PosScreen.tsx`, fix the issue where in-stock variants on subsequent pages were hidden when `inStockOnly` was active, by auto-prefetching subsequent pages if visible in-stock items are low, and ensuring the "Show more" / loading indicator is visible when `hasMore` is true.

---

## Detailed Scope & Affected Files

### 1. `src/styles/global.css`
- Update `.sk-attr__list`, `.sk-attr__row`, `.sk-attr__row-header`, `.sk-attr__name`, `.sk-attr__chips`, and `.sk-attr__chip`.
- Transform the bulky stacked grey cards into slim horizontal rows with label on the left and compact pills (30px height, 6px radius) on the right.
- Maintain visually-hidden `<input type="radio">` so accessibility, keyboard arrows, and all automated regression tests remain intact.

### 2. Single Warehouse UI Consolidation
- **`src/features/catalog2/CatalogScreen.tsx`**: Remove the warehouse `<select id="catalog2-warehouse">` dropdown.
- **`src/features/inventory/StockReceiptScreen.tsx`**: Remove the warehouse `<select id="stock-wh">` dropdown.
- **`src/features/inventory/StockAdjustmentScreen.tsx`**: Remove the warehouse `<select id="adjustment-warehouse">` dropdown.
- **`src/features/inventory/InventoryScreen.tsx`**: Remove the warehouse `<select>` dropdown.
- **`src/app/AppDataContext.tsx`**: Ensure `selectedWarehouseId` defaults to `warehouses[0]?.id` so all backend operations use the single primary warehouse.

### 3. `src/features/products/PackManager.tsx`
- When selecting a packaging unit or opening the add pack modal, auto-populate the selling price field with `suggestedMaxPrice` (`unitPrice * conversionFactor`).
- In `sortedPackRows`, if a pack's `sale_price` is missing, calculate and display the unit price × factor instead of rendering `t('pack.notSold')`.
- Remove `"Not sold (buy only)"` wording so all packs and packaging units are sellable.

### 4. `src/features/catalog2/CatalogScreen.tsx` & `src/features/catalog2/useCatalogList.ts`
- In `useCatalogList.ts`: Add `inStockOnly` state and filter `rows` via exact decimal check (`isExactDecimalPositive`).
- In `CatalogScreen.tsx`: Add the `[📦 In Stock Only]` toggle pill button in the search toolbar next to the search and category filters.

### 5. `src/features/pos/PosScreen.tsx`
- When `inStockOnly` is enabled and `displayedProducts.length === 0 && hasMore && !catalogBusy`:
  Auto-fetch the next page (`loadMoreProducts()`) so in-stock products on later pages are loaded immediately.
- If `displayedProducts.length === 0 && hasMore`, render the loading/load-more action so the user is never stranded on an empty catalog.
- Verify `posWarehouseId` reliably defaults to `warehouses[0]?.id` in the single-warehouse model.

### 6. Verification
- `npm.cmd test -- tests/pos-touch.workflow.test.tsx tests/catalog2.workflow.test.tsx tests/stock-receipt.workflow.test.tsx tests/stock-adjustment.workflow.test.tsx tests/purchase-item-picker.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`
- Bump `APP_VERSION_MARKER` in `src/shared/version.ts` to `'WS-O-4.6'`.
