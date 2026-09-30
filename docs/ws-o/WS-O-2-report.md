# WS-O-2 Result Report: Pack Setup Screens

## Gate 0 findings

Every Gate 0 query was examined in the live codebase:

| # | Item checked | Method | Result & Status |
|---|---|---|---|
| G1 | Product advanced editor screen & where variant alternate units are rendered | `src/features/catalog2/CatalogPanel.tsx`, `src/features/catalog2/VariantEditor.tsx` | **Verified**. Variants are edited one at a time via `VariantEditor` in `CatalogPanel.tsx`. Injected as a collapsible section `packs`. |
| G2 | Variant barcode list component & loading function | `BarcodeSection` in `src/features/catalog2/CatalogPanel.tsx` | **Verified**. Loaded via `catalog.get_product_detail`. `BarcodeSection` accepts `packBarcodeIds` to filter out pack barcodes and displays note `pack.barcodesElsewhere` when any are hidden. `catalog.get_product_detail` was NOT modified. |
| G3 | Quick add form and function called | `CatalogCreatePanel` in `src/features/catalog2/CatalogPanel.tsx` calling `ipc.quickCreateProduct` | **Verified**. `ipc.quickCreateProduct` returns `{ product_id, variant_id }`. The new `variant_id` is passed directly to `createPack` when the box section is populated. |
| G4 | Units list DTO and flags reaching React | `ipc.listUnitsV2` returning `UnitLifecycleItem[]` | **Verified**. DTO carries `allows_fractions: boolean`, `is_active: boolean`, `id: number`, `code: string`, `name: string`. |
| G5 | i18n structure and key naming | `src/shared/i18n/locales.ts` | **Verified**. All keys registered across `fr`, `ar`, and `en` with prefix `pack.*`. |
| G6 | Existing UI building blocks in `DESIGN.md` | `src/shared/components` (`Banner`, `Button`, `ConfirmDialog`, `TextField`, `Spinner`) | **Verified**. Used existing primitives for dialogs, inputs, buttons, and status banners. |
| G7 | Whether any screen imports `UnitManager.tsx` | Ripgrep across codebase | **Verified**. `UnitManager.tsx` does not exist in the codebase. Legacy conversions were rendered by `AlternateUnitsSection` in `CatalogPanel.tsx`. `AlternateUnitsSection` was preserved alongside `PackManager` to ensure zero regression in pre-existing test suites. |

---

## What changed

### TypeScript Frontend & Components
1. `src/features/products/packValidation.ts` (O-2.1):
   - `normalizeDecimalInput(text: string): string | null`: trims, normalises `,` to `.`, validates regex `^\d+(\.\d+)?$`.
   - `validatePackForm(input, ctx)`: mirrors backend validation rules in exact order: unit required, unit is base, unit already used, factor required, factor invalid, factor <= 1, factor > 100,000, factor > 6 decimals, factor whole when base unit does not allow fractions, price decimal and <= 2 decimals, barcode non-blank.
2. `src/features/products/packValidation.test.ts`:
   - Unit tests covering all branches, boundary checks, and the 6 normalization examples. (9 tests, all passing).
3. `src/features/products/PackManager.tsx` (O-2.2):
   - Complete Pack Manager panel for variant:
     - Skeleton loading state & inline error with retry.
     - Empty state when no packs exist.
     - Table of pack rows (`is_pack = true`) sorted with active rows first.
     - Columns: Main pack (radio calling `setPackPrimary`), Unit name, Holds ("{factor} {base}"), Sale price, Per-base rate (`packRate`, amber warning when pack rate > piece price), Barcodes (chips with removal confirmation and inline "+ Barcode" entry), Status pill, Actions (Edit, Deactivate/Activate, Delete when `is_used = false`).
     - Dialog for Add/Edit pack: validates with `validatePackForm`, calls `resolveBarcode` for uniqueness check, creates or updates pack, and adds barcode.
     - Smaller units section (`is_pack = false`, e.g. gram 0.001) with factor and removal action.
4. `src/features/products/PackManager.test.tsx`:
   - Unit tests verifying empty state, add flow (`createPack` + `addPackBarcode`), uniqueness error on duplicate barcode, `is_used` disabling Holds, and deletion confirmation. (5 tests, all passing).
5. `src/features/catalog2/VariantEditor.tsx` (O-2.3):
   - Added collapsible `packs?: ReactNode` section with toggle test ID `catalog2-packs-toggle-${variant.variant_id}`.
6. `src/features/catalog2/CatalogPanel.tsx` (O-2.3, O-2.4, O-2.5):
   - **O-2.3**: Injected `<PackManager>` into `VariantEditor`.
   - **O-2.4**: Added `packBarcodeIdsByVariant` state loaded immediately on variant selection and on refresh via `ipc.listVariantPacks`. `BarcodeSection` filters out any barcode ID present in this set and renders `pack.barcodesElsewhere` note when pack barcodes are hidden.
   - **O-2.5**: Integrated "Sold by the box (optional)" collapsible section in `CatalogCreatePanel`. When filled, validates via `validatePackForm` and `resolveBarcode` prior to product creation, then invokes `createPack` with `makePrimary = true` and `addPackBarcode`. Handles partial failures gracefully without losing the created product.
7. `src/features/products/PackIntegration.test.tsx`:
   - Integration tests covering pack barcode exclusion in `BarcodeSection` and quick add box creation flow. (3 tests, all passing).
8. `src/shared/i18n/locales.ts` (O-2.6):
   - Added all `pack.*` translation keys in `fr`, `ar`, and `en`.
9. `src/shared/utils/packMath.ts`:
   - Re-exported `formatExactDecimal` for convenience in pack displays.
10. `src/shared/version.ts` (O-2.7):
   - Updated `APP_VERSION_MARKER` to `'WS-O-2.1'`.

---

## Strings Added (O-2.6)

Added across `fr`, `ar`, and `en` in `src/shared/i18n/locales.ts`:
- `pack.title`: "Packs (boxes, cartons, bales)"
- `pack.help`: "A pack holds a fixed number of {base}. Stock is always counted in {base}."
- `pack.empty`: "No packs. This product is bought and sold by the {base} only."
- `pack.add`: "Add pack"
- `pack.edit`: "Edit pack"
- `pack.main`: "Main"
- `pack.unit`: "Unit"
- `pack.holds`: "Holds"
- `pack.price`: "Sale price"
- `pack.perBase`: "Per {base}"
- `pack.barcodes`: "Barcodes"
- `pack.addBarcode`: "+ Barcode"
- `pack.notSold`: "Not sold (buy only)"
- `pack.inUse`: "Used in purchases or stock records — the quantity cannot change. Deactivate this pack and create a new one instead."
- `pack.smallerUnits`: "Other units"
- `pack.barcodesElsewhere`: "Pack barcodes are managed in the Packs section."
- `pack.confirmRemoveBarcode`: "Remove this barcode?"
- `pack.confirmDelete`: "Delete this pack? This cannot be undone."
- `pack.confirmRemoveSmallerUnit`: "Remove this unit conversion?"
- `pack.holdsLabel`: "How many {base} in one pack"
- `pack.priceLabel`: "Sale price for one pack"
- `pack.barcodeLabel`: "Barcode (optional)"
- `pack.mainCheckbox`: "Main pack"
- `pack.perPiece`: "= {rate} per {base} (single {base}: {piecePrice})"
- `pack.saved`: "Pack saved."
- `pack.savedBarcodeFailed`: "Pack saved, but the barcode was not saved. Add it again from the pack row."
- `pack.quick.title`: "Sold by the box (optional)"
- `pack.quick.productSavedPackFailed`: "Product saved, but the box was not saved. Open the product and add the box in Packs."
- `pack.warn.rateHigher`: "This pack costs more per {base} than a single {base}."
- `pack.error.unitRequired`: "Select a unit."
- `pack.error.unitIsBase`: "A pack cannot use the base unit."
- `pack.error.unitAlreadyUsed`: "This variant already has a pack with this unit."
- `pack.error.factorRequired`: "Enter how many pieces this pack holds."
- `pack.error.factorInvalid`: "Enter a valid positive number."
- `pack.error.factorTooSmall`: "A pack must hold more than 1 piece."
- `pack.error.factorTooLarge`: "Pack quantity cannot exceed 100,000."
- `pack.error.factorDecimals`: "Quantity cannot have more than 6 decimal places."
- `pack.error.factorWhole`: "This unit is counted in whole numbers. Enter a whole number."
- `pack.error.priceInvalid`: "Enter a valid price with at most 2 decimal places."
- `pack.error.barcodeBlank`: "Enter a barcode or leave the field empty."
- `pack.error.barcodeUsed`: "This barcode is already used by {product}."

---

## Verification Results

### 1. TypeScript Typecheck
```
> stockiha@0.1.0 typecheck
> tsc -b
Exit code: 0
```

### 2. ESLint
```
> stockiha@0.1.0 lint
> eslint .
Exit code: 0 (0 warnings, 0 errors)
```

### 3. Pack Tests (Vitest)
```
 ✓ src/features/products/packValidation.test.ts (9 tests)
 ✓ src/features/products/PackManager.test.tsx (5 tests)
 ✓ src/features/products/PackIntegration.test.tsx (3 tests)
Test Files: 3 passed (3)
Tests: 17 passed (17)
Exit code: 0
```

### 4. Existing Catalog2 Tests
```
 ✓ tests/catalog2.workflow.test.tsx (85 tests)
Test Files: 1 passed (1)
Tests: 85 passed (85)
Exit code: 0
```

### 5. Full Frontend Test Suite
```
Test Files: 80 passed (80)
Tests: 791 passed (791)
Exit code: 0
```

### 6. Production Frontend Build
```
> stockiha@0.1.0 build
> tsc -b && vite build
✓ built in 7.97s
Exit code: 0
```

### 7. Rust Library Tests
```
cargo test --manifest-path src-tauri/Cargo.toml --lib
test result: ok. 515 passed; 0 failed; 62 ignored; 0 measured; 0 filtered out; finished in 21.65s
Exit code: 0
```

---

## Git Status and Diff Stat

### `git status --short`
```
 M src/features/catalog2/CatalogPanel.tsx
 M src/features/catalog2/VariantEditor.tsx
 M src/shared/i18n/locales.ts
 M src/shared/utils/packMath.ts
 M src/shared/version.ts
?? docs/ws-o/WS-O-2-report.md
?? src/features/products/
```

### `git diff --stat`
```
 src/features/catalog2/CatalogPanel.tsx  | 300 +++++++++++++++++++++++++++++++-
 src/features/catalog2/VariantEditor.tsx |  15 ++
 src/shared/i18n/locales.ts              | 144 +++++++++++++++
 src/shared/utils/packMath.ts            |   2 +
 src/shared/version.ts                   |   2 +-
 5 files changed, 453 insertions(+), 10 deletions(-)
```

---

## Acceptance Criteria Checklist (O-2)
- [x] **1. Advanced Editor Pack Management:** The owner can add, edit (price always; holds only when unused), deactivate, re-activate, delete (unused only), choose the main pack, and add/remove pack barcodes.
- [x] **2. Pre-IPC Friendly Validation:** Every rule of 7.5 surfaces a specific, localized error message before any backend IPC call.
- [x] **3. Quick Add Box Integration:** Quick add can create a product with its box in one flow; partial failure keeps the product and alerts the operator.
- [x] **4. Pack Barcode Filtering:** Pack barcodes are filtered out of the piece barcode list, accompanied by the note "Pack barcodes are managed in the Packs section."
- [x] **5. Backward Compatibility:** Existing product editor and quick add workflows remain intact, and all 791 automated tests pass.

---

## Manual Checks for the Owner
1. Verify the build marker in the app reads `[ version = WS-O-2.1 ]`.
2. Navigate to **Catalogue Setup → Units** and ensure "Carton" (code `CTN`, whole numbers only) exists.
3. Open a pillow product → **Packs** → click **Add pack**: Select Carton, holds 12, price 15,000.00, barcode of a box, Main. Verify the row shows "Holds 12 Unit", "15,000.00", "Per Unit 1,250.00".
4. Attempt typing holds `12,5` → verify the error "This unit is counted in whole numbers. Enter a whole number." Type price `15000.505` → verify price error.
5. Enter the product's own piece barcode as the box barcode → verify the error "This barcode is already used by …".
6. In **Products**, click **+ New product**, expand "Sold by the box (optional)", fill in product and box fields, and save → verify the product opens with its Carton pack marked as main.
7. *(Reminder: Do not scan box barcodes at the till yet — the till learns boxes in Sub-plan O-4).*

---

## Verdict
`PASS`
