# WS-F-1 POS Advanced Item Search Plan

## Overview
Enhance the Point of Sale (till) screen with two distinct search methods:
1. **Regular Search**: The existing on-screen search bar for rapid typing and barcode scanner resolution.
2. **Advanced Search**: An icon button adjacent to the regular search bar that opens a rich item search modal (styled after the purchase page's item picker).

---

## Key Requirements & Agreed Decisions

1. **Access Point**:
   - An icon button with a search symbol positioned right next to the regular search input on the POS screen.
   - Touch-friendly sizing (minimum 56px touch target).

2. **Full Store Scope**:
   - The modal searches across all products in the store's warehouse, not just the 60 items currently displayed on the till grid.
   - Fetches product options/catalogue using the database-backed IPC commands (`listProductsV2` or full purchasable/sellable options).

3. **Smart Selection Behavior**:
   - **Barcode / SKU search**: If the search was conducted by barcode or SKU, selecting/matching an item adds it to the cart and closes the search window immediately.
   - **Name / Filter / Browse search**: When searching by name or browsing categories/filters, selecting an item adds it to the cart silently and keeps the search window open so the cashier can pick multiple items.

4. **Window Controls**:
   - A prominent "Done" / "Finished" button at the bottom of the window, plus the top-corner close button.

5. **Frontend Architecture (`/frontend-architecture`)**:
   - Separate the modal into a dedicated, clean component `src/features/pos/PosItemSearchModal.tsx` to prevent `PosScreen.tsx` from becoming a bloated god-component.
   - Keep UI rendering, search logic, and cart mutation clearly separated.
   - Reuse existing design tokens and `procurement.css` styling patterns.

---

## Files to Change

### [NEW] `src/features/pos/PosItemSearchModal.tsx`
- Modal component styled after the purchase page item picker (`pr-picker-modal`).
- Left column: Category / Unit / Attribute filter chips.
- Right column: Search input, results count, list of item cards showing Name, SKU, Barcode, Stock, and Sale Price in DZD.
- Smart auto-close on barcode/SKU match vs. multi-select keeping modal open on text/browse.
- Bottom "Done" button and top-right close button.

### [MODIFY] `src/features/pos/PosScreen.tsx`
- Add advanced search button next to the regular search box in `.sk-pos__search`.
- Maintain `advancedSearchOpen` state.
- Handle item selection from modal: call `addToCart(item)` and close if barcode/SKU matched.

### [MODIFY] `src/shared/i18n/locales.ts`
- Add translations for the advanced search button tooltip/label (`pos.advancedSearch`), "Done" button (`common.done`), and modal title in French, English, and Arabic.

### [MODIFY] `src/styles/global.css`
- Add styling for the search action button group in the POS catalog header.

### [NEW / MODIFY] Tests
- Add tests in `tests/pos-touch.workflow.test.tsx` verifying:
  1. Opening advanced search via the button.
  2. Searching and selecting an item by SKU/barcode closes the modal immediately and updates cart.
  3. Selecting an item by browsing/name adds to cart while keeping the modal open, and clicking "Done" closes it.
- Ensure all existing tests pass (`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`).
