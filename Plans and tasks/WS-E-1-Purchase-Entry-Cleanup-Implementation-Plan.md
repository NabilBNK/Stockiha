# WS-E-1 — Purchases Page Cleanup and Fast Item Entry

**Workstream:** WS-E — Procurement & Supplier Operations
**Sub-plan:** 1 of 3
**Executing agent:** Gemini (Antigravity IDE)
**Branch to create:** `task/ws-e-1-purchase-entry`
**Risk class:** Frontend only. No SQL. No migration. No Rust. No accounting change.

---

## 0. Authority and precedence for this task

Read, in this order, before touching anything:

1. This document.
2. `GEMINI.md`
3. `AGENTS.md`

This document wins over both where they differ.

**Explicit override of `GEMINI.md` section 2:** this task deletes React screen files and deletes test blocks. `GEMINI.md` normally forbids deleting code and tests. For this task only, the deletions listed by name in section 4 are authorised and required. No deletion outside that explicit list is authorised.

**No override for anything else.** If a step in this plan appears to require you to write SQL, create a migration, change a Rust file, change an accounting number, change a permission, or change `package.json`, you have misread the step. Stop and report. This entire sub-plan is achievable by editing TypeScript/TSX/CSS files only.

If any file does not look the way this plan describes it, **stop and report the difference**. Do not adapt. Do not improvise a fix.

---

## 1. Repository safety — do this first

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin --prune
```

If `git status --short` shows uncommitted changes that are not yours, **STOP** and report them. Do not stash, reset, clean, or discard anything.

Then:

```bash
git checkout main
git pull origin main
git checkout -b task/ws-e-1-purchase-entry
```

Work only on this branch.

---

## 2. Verified current state (established by reading the pushed `main`)

You do not need to re-derive this. It is given so you know what you are walking into.

- The Purchases page is `src/features/procurement/PurchaseOrdersScreen.tsx`, rendered by `AppRouter.tsx` for `view === 'purchases'`. It is ~1050 lines.
- Direct Purchase works. It calls `confirmDirectPurchase` in the gateway, which calls the backend command `confirm_direct_purchase`. **Do not touch any of that logic.**
- The same page still renders a leftover Purchase Order section (heading `text.purchaseOrder`, table `data-testid="po-table"`, and a PO detail modal `data-testid="po-detail-modal"`). Its handlers `viewDetail`, `editDraft`, `handleConfirmOrder`, `openReceiptModal`, `handleCancelOrder`, `handleReceiptSuccess` are already dead stubs that return `undefined`.
- The same page still renders landed-cost UI (`LandedCostModal`, `data-testid="landed-cost-result"`).
- The product picker inside the Direct Purchase form is a plain `<select>` that lists **every product in the catalogue**. The target store has 5,000 products. This is the main usability problem this sub-plan fixes.
- `src/features/procurement/PurchaseTransactionScreen.tsx` (~51 KB) is imported by nothing. It is dead code.
- The sidebar (`src/app/AppShell.tsx`, `NAV` array) still contains `supplier_invoices`, `supplier_liabilities`, `supplier_returns`.
- `PurchaseProductOption` (in `src/shared/ipc/dto.ts`) already carries `sku`, `primary_barcode`, `product_name`, `variant_name`, `attributes`, `default_unit_id`, `default_unit_code`, `alternate_units`, and `last_purchase_cost`. Everything the new picker needs is already there. **No DTO change is needed and none is authorised.**

---

## 3. Objective

Make the Purchases page contain exactly one workflow — Direct Purchase — and make entering a purchase line fast with a searchable, barcode-aware item picker instead of a 5,000-row dropdown.

---

## 4. Scope — IN

Do these eleven tasks, in this order.

### T1 — Delete the dead purchase-transaction screen

First prove it is dead:

```bash
grep -rn "PurchaseTransactionScreen" src tests
```

Expected: matches **only** inside `src/features/procurement/PurchaseTransactionScreen.tsx` itself and inside `tests/purchase-transaction.workflow.test.tsx`.

If anything else imports it, **STOP and report**.

If the expectation holds, delete both files:

- `src/features/procurement/PurchaseTransactionScreen.tsx`
- `tests/purchase-transaction.workflow.test.tsx`

Do not delete anything else. Do not touch `src/shared/ipc/gateway.ts`, `commands.ts`, or `dto.ts` — the `post_purchase_transaction` plumbing stays exactly as it is.

### T2 — Remove three obsolete screens from navigation and routing

**In `src/app/AppShell.tsx`:**

Delete these three lines from the `NAV` array:

```tsx
  { view: 'supplier_invoices', labelKey: 'nav.supplierInvoices', group: 'buy', icon: '▤' },
  { view: 'supplier_liabilities', labelKey: 'nav.supplierLiabilities', group: 'buy', icon: '₫' },
  { view: 'supplier_returns', labelKey: 'nav.supplierReturns', group: 'buy', icon: '↩' },
```

Then delete these three members from the `AppView` union type in the same file:

```
  | 'supplier_invoices'
  | 'supplier_liabilities'
  | 'supplier_returns';
```

Keep the union syntactically valid — the member that becomes last must end with `;`.

**In `src/app/AppRouter.tsx`:**

- Delete the three imports for `SupplierInvoicesScreen`, `SupplierLiabilitiesScreen`, `SupplierReturnsScreen`.
- Delete the three render blocks `{view === 'supplier_invoices' && ...}`, `{view === 'supplier_liabilities' && ...}`, `{view === 'supplier_returns' && ...}`.
- In the `useEffect` that redirects away from procurement views when `can_manage_procurement` is false, the array of procurement view names currently lists the removed views. Remove the three removed names from that array. Leave `'suppliers'` and `'purchases'` in it.

**Delete these four component files:**

- `src/features/procurement/SupplierInvoicesScreen.tsx`
- `src/features/procurement/SupplierLiabilitiesScreen.tsx`
- `src/features/procurement/SupplierReturnsScreen.tsx`
- `src/features/procurement/SupplierPaymentModal.tsx`

**Do not** delete or edit any Rust file, any SQL migration, any gateway function, or any DTO. Historical supplier invoices, payables, returns and their journals stay in the database untouched. This is a navigation and UI removal only.

### T3 — Remove the Purchase Order section from the Purchases page

In `src/features/procurement/PurchaseOrdersScreen.tsx`:

- Delete the entire `<section>` that starts with the heading `{text.purchaseOrder}` and contains `data-testid="po-table"`.
- Delete the entire PO detail modal block containing `data-testid="po-detail-modal"`.
- Delete the `PurchaseReceiptModal` render block and its import.
- Delete these now-unused state hooks: `orders`, `selectedDetail`, `receiptPoDetail`.
- Delete these now-unused dead stub functions: `viewDetail`, `editDraft`, `handleConfirmOrder`, `openReceiptModal`, `handleCancelOrder`, `handleReceiptSuccess`.
- In `loadData`, remove the dynamic `listPurchaseOrders` import and its entry in the `Promise.all` array and in the destructuring. The remaining four calls stay: `listPurchaseReceipts`, `listSuppliers`, `listWarehouses`, `listPurchaseProductOptions`.
- Remove the now-unused type imports `PurchaseOrderSummary`, `PurchaseOrderDetailDto`, `ConfirmPurchaseReceiptResult`.
- Remove the receipt-history origin filter (`originFilter` state, its `<select>` with `data-testid="filter-receipt-origin-select"`, and its use inside `filteredReceipts`) — with only one workflow left, it has nothing to filter.
- Keep the `directPurchasesCount` metric card, but change its source to `receipts.length` and keep its existing label. Do not delete the metric row.
- Keep the `Origin` column in the receipts table. A historical receipt may legitimately show `PURCHASE_ORDER`. It is read-only history.

Rename the file at the end of this task:

```bash
git mv src/features/procurement/PurchaseOrdersScreen.tsx src/features/procurement/PurchasesScreen.tsx
```

Rename the default-exported component from `PurchaseOrdersScreen` to `PurchasesScreen`, and update the import and usage in `src/app/AppRouter.tsx`. Update the import in any test file that imports it directly (search with `grep -rn "PurchaseOrdersScreen" src tests` and fix every hit).

### T4 — Remove landed cost from the Purchases page

In `PurchasesScreen.tsx`:

- Delete the `LandedCostModal` import and its render block.
- Delete the state `landedCostReceipt`, `landedCostResult`, and the handler `handleLandedCostSuccess`.
- Delete the `<section data-testid="landed-cost-result">` block.
- Delete any `Allocate landed cost` button in the receipts table row actions.
- Remove the now-unused type import `AllocateLandedCostResult`.

Delete the file `src/features/procurement/LandedCostModal.tsx`.

Do **not** touch `allocateLandedCost` in `gateway.ts`, do not touch the Rust command, and do not touch any landed-cost migration or historical landed-cost row.

In `PurchaseReceiptDetailModal.tsx`, leave the landed-cost display fields alone if they only *display* historical values. Do not add new landed-cost UI.

### T5 — Create the purchase item picker component

Create a new file `src/features/procurement/PurchaseItemPicker.tsx` with exactly this content:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PurchaseProductOption } from '../../shared/ipc/dto';
import { PROCUREMENT_COPY } from './procurementCopy';
import { useI18n } from '../../shared/i18n';

export function matchesPurchaseOption(item: PurchaseProductOption, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;

  const haystack = [
    item.sku,
    item.primary_barcode,
    item.product_name,
    item.variant_name,
    item.brand?.name,
    ...(item.attributes?.map((a) => `${a.name ?? ''} ${a.value ?? ''}`) ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();

  const tokens = query.split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token));
}

interface Props {
  isOpen: boolean;
  items: PurchaseProductOption[];
  disabledVariantIds: number[];
  onSelect: (item: PurchaseProductOption) => void;
  onClose: () => void;
}

export function PurchaseItemPicker({
  isOpen,
  items,
  disabledVariantIds,
  onSelect,
  onClose,
}: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const results = useMemo(() => {
    return items
      .filter((item) => item.is_active)
      .filter((item) => matchesPurchaseOption(item, query))
      .slice(0, 50);
  }, [items, query]);

  if (!isOpen) return null;

  return (
    <div
      className="sk-modal__backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="purchase-item-picker-backdrop"
    >
      <div
        className="sk-modal sk-modal-content--large"
        role="dialog"
        aria-modal="true"
        aria-label={text.chooseItem}
        onClick={(event) => event.stopPropagation()}
        style={{ width: 'min(100%, 780px)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        data-testid="purchase-item-picker"
      >
        <div className="sk-modal-header" style={{ marginBottom: 12 }}>
          <h2 className="sk-modal__title">{text.chooseItem}</h2>
          <button
            type="button"
            className="sk-modal-close"
            onClick={onClose}
            aria-label={text.close}
            data-testid="purchase-item-picker-close"
          >
            ✕
          </button>
        </div>

        <div style={{ marginBlockEnd: 14 }}>
          <input
            ref={inputRef}
            type="text"
            className="sk-field__input"
            placeholder={text.searchItemsPlaceholder}
            aria-label={text.searchItemsPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            data-testid="purchase-item-picker-input"
          />
        </div>

        <div
          style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 180 }}
          data-testid="purchase-item-picker-results"
        >
          {results.length === 0 ? (
            <div
              style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--sk-muted)' }}
              data-testid="purchase-item-picker-empty"
            >
              {text.noItemsFound}
            </div>
          ) : (
            results.map((item) => {
              const alreadyAdded = disabledVariantIds.includes(item.variant_id);
              return (
                <button
                  key={item.variant_id}
                  type="button"
                  className="sk-card"
                  disabled={alreadyAdded}
                  onClick={() => onSelect(item)}
                  data-testid={`purchase-item-option-${item.variant_id}`}
                  style={{
                    textAlign: 'start',
                    padding: '10px 14px',
                    cursor: alreadyAdded ? 'not-allowed' : 'pointer',
                    opacity: alreadyAdded ? 0.5 : 1,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {item.product_name}
                    {item.variant_name ? ` — ${item.variant_name}` : ''}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--sk-muted)' }}>
                    {item.primary_barcode ? `${item.primary_barcode} · ` : ''}
                    {item.sku}
                    {alreadyAdded ? ` · ${text.itemAlreadyAdded}` : ''}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
```

Do not add libraries. Do not add CSS files. Every class name used above already exists in the project stylesheet.

### T6 — Wire the picker and barcode entry into the Direct Purchase form

In `PurchasesScreen.tsx`:

**6a.** Import the picker:

```tsx
import { PurchaseItemPicker } from './PurchaseItemPicker';
```

**6b.** Add state, next to the existing form state:

```tsx
const [pickerOpen, setPickerOpen] = useState(false);
const [pickerTargetIndex, setPickerTargetIndex] = useState<number | null>(null);
const [barcodeInput, setBarcodeInput] = useState('');
const [barcodeError, setBarcodeError] = useState<string | null>(null);
```

**6c.** Replace the existing `addLine` function entirely with these three functions:

```tsx
const appendLineFromOption = (option: PurchaseProductOption) => {
  setLines((prev) => [
    ...prev,
    {
      variant_id: option.variant_id,
      unit_id: option.default_unit_id,
      quantity_ordered: '1',
      unit_cost: option.last_purchase_cost ?? option.default_unit_cost ?? '0',
    },
  ]);
};

const openPickerForNewLine = () => {
  setPickerTargetIndex(null);
  setPickerOpen(true);
};

const openPickerForLine = (index: number) => {
  setPickerTargetIndex(index);
  setPickerOpen(true);
};
```

**6d.** Add the picker's selection handler:

```tsx
const handlePickerSelect = (option: PurchaseProductOption) => {
  if (pickerTargetIndex === null) {
    appendLineFromOption(option);
  } else {
    const index = pickerTargetIndex;
    setLines((prev) =>
      prev.map((line, idx) =>
        idx === index
          ? { ...line, variant_id: option.variant_id, unit_id: option.default_unit_id }
          : line,
      ),
    );
  }
  setPickerOpen(false);
  setPickerTargetIndex(null);
};
```

**6e.** Add the barcode handler:

```tsx
const handleBarcodeSubmit = () => {
  const code = barcodeInput.trim();
  if (!code) return;
  const match = products.find(
    (item) => item.is_active && item.primary_barcode && item.primary_barcode === code,
  );
  if (!match) {
    setBarcodeError(text.barcodeNotFound);
    return;
  }
  if (lines.some((line) => line.variant_id === match.variant_id)) {
    setBarcodeError(text.itemAlreadyAdded);
    return;
  }
  appendLineFromOption(match);
  setBarcodeError(null);
  setBarcodeInput('');
};
```

The barcode match is **exact and case-sensitive**. Never fall back to a partial match. If there is no exact match, show the error and add nothing.

**6f.** Above the purchased-items table, insert this barcode row:

```tsx
<div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '10px 0 12px 0' }}>
  <div style={{ flex: '0 0 320px' }}>
    <input
      type="text"
      className="sk-field__input"
      placeholder={text.scanBarcodePlaceholder}
      aria-label={text.scanBarcodePlaceholder}
      value={barcodeInput}
      onChange={(event) => {
        setBarcodeInput(event.target.value);
        setBarcodeError(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          handleBarcodeSubmit();
        }
      }}
      data-testid="purchase-barcode-input"
    />
    {barcodeError && (
      <div className="sk-field-error" data-testid="purchase-barcode-error">
        {barcodeError}
      </div>
    )}
  </div>
  <button
    type="button"
    className="sk-button sk-button--secondary"
    onClick={openPickerForNewLine}
    data-testid="add-purchase-line-btn"
  >
    + {text.chooseItem}
  </button>
</div>
```

**6g.** Delete the old `+ {text.addLine}` button (`data-testid="add-po-line-btn"`). The subtotal preview line that sat next to it stays; keep it where it is.

**6h.** In the line table, replace the product `<select>` cell with:

```tsx
<td>
  <button
    type="button"
    className="sk-button sk-button--small sk-button--secondary"
    onClick={() => openPickerForLine(idx)}
    data-testid={`purchase-line-product-${idx}`}
    style={{ width: '100%', textAlign: 'start' }}
  >
    {product
      ? `${product.product_name}${product.variant_name ? ` — ${product.variant_name}` : ''}`
      : text.chooseItem}
  </button>
  {product?.primary_barcode && (
    <div style={{ fontSize: '0.75rem', color: 'var(--sk-muted)' }}>{product.primary_barcode}</div>
  )}
</td>
```

The `const product = products.find(...)` line directly above stays unchanged. The unit `<select>`, quantity input, unit-cost input, total cell and remove button all stay exactly as they are.

**6i.** Render the picker just before the closing tag of the form, passing already-chosen variants so the same item cannot be added twice (the database rejects duplicate lines):

```tsx
<PurchaseItemPicker
  isOpen={pickerOpen}
  items={products}
  disabledVariantIds={pickerTargetIndex === null ? lines.map((line) => line.variant_id) : []}
  onSelect={handlePickerSelect}
  onClose={() => {
    setPickerOpen(false);
    setPickerTargetIndex(null);
  }}
/>
```

**6j.** Add `PurchaseProductOption` to the type imports at the top of the file if it is not already imported.

**6k.** When the form is closed or a purchase is confirmed successfully, also reset `barcodeInput` to `''` and `barcodeError` to `null` in the same place where `lines` is already reset.

### T7 — Relabel the note field as the supplier reference

The client records a purchase after the goods have physically arrived, and the supplier's document number is optional. The existing free-text note field carries it. No schema change.

In `procurementCopy.ts`, change the value of the existing `note` key in all three locales:

- `en`: `'Supplier reference / note (optional)'`
- `fr`: `'Référence fournisseur / note (facultatif)'`
- `ar`: `'مرجع المورد / ملاحظة (اختياري)'`

Do not rename the key. Do not change any other key's value.

### T8 — Add a date range filter to the receipt history

In `PurchasesScreen.tsx`, add:

```tsx
const [dateFrom, setDateFrom] = useState('');
const [dateTo, setDateTo] = useState('');
```

Inside `filteredReceipts`, after the existing supplier/warehouse/search checks, add:

```tsx
const postedDay = receipt.posted_at ? receipt.posted_at.slice(0, 10) : '';
if (dateFrom && postedDay && postedDay < dateFrom) return false;
if (dateTo && postedDay && postedDay > dateTo) return false;
```

Add `dateFrom` and `dateTo` to that `useMemo`'s dependency array.

In the filter row, next to the existing supplier and warehouse selects, add two date inputs:

```tsx
<label className="sk-field">
  {text.dateFrom}
  <input
    type="date"
    className="sk-field__input"
    value={dateFrom}
    onChange={(event) => setDateFrom(event.target.value)}
    data-testid="filter-receipt-date-from"
  />
</label>
<label className="sk-field">
  {text.dateTo}
  <input
    type="date"
    className="sk-field__input"
    value={dateTo}
    onChange={(event) => setDateTo(event.target.value)}
    data-testid="filter-receipt-date-to"
  />
</label>
```

This filters data already loaded in the browser. Do not change the gateway call, the Rust command, or the SQL function.

### T9 — Add a print button to the purchase detail modal

In `src/features/procurement/PurchaseReceiptDetailModal.tsx`, add a print button in the footer, immediately before the existing XLSX export button:

```tsx
<button
  type="button"
  className="sk-button sk-button--primary"
  onClick={() => window.print()}
  data-testid="print-receipt-btn"
>
  {text.printReceipt}
</button>
```

Wrap the two left-hand buttons in a `<div style={{ display: 'flex', gap: '8px' }}>` so the footer layout stays a left group and a right Close button.

Then append this to the end of `src/features/procurement/procurement.css`:

```css
/* Print: only the open purchase detail dialog is printed */
@media print {
  body * {
    visibility: hidden;
  }

  .sk-detail-dialog,
  .sk-detail-dialog * {
    visibility: visible;
  }

  .sk-detail-dialog {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    width: 100%;
    max-height: none;
    box-shadow: none;
    border: none;
  }

  .sk-detail-dialog__footer {
    display: none;
  }
}
```

Do not add a print button anywhere else. Do not touch ESC/POS, the printer queue, or `enqueue_customer_reprint`.

### T10 — Add the new copy keys

In `src/features/procurement/procurementCopy.ts`, add these nine keys to the `ProcurementCopy` type and to all three locale objects, with exactly these values.

| key | en | fr | ar |
|---|---|---|---|
| `chooseItem` | `Choose item` | `Choisir un article` | `اختيار صنف` |
| `searchItemsPlaceholder` | `Search by name, SKU or barcode` | `Rechercher par nom, SKU ou code-barres` | `البحث بالاسم أو الرمز أو الباركود` |
| `scanBarcodePlaceholder` | `Scan barcode, then Enter` | `Scanner le code-barres, puis Entrée` | `امسح الباركود ثم اضغط Enter` |
| `barcodeNotFound` | `No product matches this barcode` | `Aucun produit ne correspond à ce code-barres` | `لا يوجد منتج مطابق لهذا الباركود` |
| `itemAlreadyAdded` | `Already added to this purchase` | `Déjà ajouté à cet achat` | `مضاف مسبقاً إلى هذا الشراء` |
| `noItemsFound` | `No matching products` | `Aucun produit correspondant` | `لا توجد منتجات مطابقة` |
| `dateFrom` | `From` | `Du` | `من` |
| `dateTo` | `To` | `Au` | `إلى` |
| `printReceipt` | `Print` | `Imprimer` | `طباعة` |

Do not remove any existing key, even one that now looks unused. A later WS-E sub-plan does the translation and dead-key sweep.

### T11 — Update the tests

**In `tests/procurement.workflow.test.tsx`**, delete these five `it(...)` blocks by their exact titles:

- `navigates to Purchase Orders screen and confirms a goods receipt`
- `creates a DZD supplier invoice from an exact posted receipt line`
- `posts landed cost from receipt history and shows the confirmed result`
- `confirms supplier return with the real open fiscal period and exact result`
- `posts an allocated supplier payment and keeps official result evidence`

Keep the other tests in that file, including `safe-denies procurement navigation when backend capabilities are absent`. Remove any helper, mock handler or import that becomes unused **only** because of these five deletions. If removing a mock handler breaks a surviving test, put it back.

**In `tests/direct-purchase.workflow.test.tsx`**, the existing test selects a product through the old `<select>`. Update the selection step to the new flow:

1. click `add-purchase-line-btn`
2. click `purchase-item-option-<variantId>` for the mocked variant
3. continue with the existing quantity/cost/confirm assertions unchanged

Do not weaken any assertion about the posted payload, the WAC result, the journal, or the document number.

**Add a new test file** `tests/purchase-item-picker.test.tsx` containing exactly two tests against `matchesPurchaseOption` imported from `src/features/procurement/PurchaseItemPicker`:

1. an option whose `primary_barcode` is `6191234567890` is matched by the query `6191234567890` and not matched by the query `999`
2. an option with `product_name: 'Café moulu'` and `sku: 'CAF-001'` is matched by the query `cafe`… — **use the exact stored string** `café` in the query for this assertion, because the matcher does not strip accents. Assert `matchesPurchaseOption(option, 'café mou')` is `true` and `matchesPurchaseOption(option, 'thé')` is `false`.

Follow the import style and setup of an existing test file in `tests/`. Add no new dependency.

**Add a sidebar assertion** to `tests/procurement.workflow.test.tsx`: after login, assert that the sidebar contains `Suppliers` and `Purchases` and does **not** contain `Supplier Invoices`, `Supplier Payables`, or `Supplier Returns`. Follow the query style already used in that file for sidebar buttons.

---

## 5. Scope — OUT. Do not touch.

- Any file under `src-tauri/` — no Rust, no migrations, no SQL, no tests there.
- Any `.sql` file anywhere.
- `src/shared/ipc/gateway.ts`, `commands.ts`, `dto.ts` — no additions, no removals, no renames.
- The direct-purchase submit path: `handleConfirmDirectPurchase`, `validateLines`, `directRequestId`, `newRequestId`, `procurementDecimal.ts`, and every decimal calculation. Quantities and money stay exact-decimal strings. Never introduce `parseFloat`, `Number()`, or arithmetic operators on a money or quantity value.
- Accounting: no journal, account, GRNI, or WAC change of any kind.
- Permissions, roles, `ProcurementCapabilities`, session handling.
- `SuppliersScreen.tsx`.
- POS, cash sessions, drawer, customers, inventory screens, products screens, settings, backup, historical import.
- `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`.
- `STOCKIHA_GROUND_TRUTH.md`, `AGENTS.md`, `CURRENT_STEP.md`, `README.md`, `TASKS.md`, `GEMINI.md`.
- Arabic RTL behaviour: use logical CSS properties (`inset-inline-start`, `margin-block-end`) as the existing code does. Never `left`/`right`.

If you find a genuine unrelated bug while working: **write it in your report. Do not fix it.**

---

## 6. Constraints

- React is never the authority for business truth. This sub-plan only changes how a user picks an item; the backend still validates and posts everything.
- No placeholder, no `TODO`, no mock, no commented-out block left behind.
- No new npm dependency.
- Every string shown to a user comes from `procurementCopy.ts` in all three locales. No hardcoded English in JSX.
- Do not disable, skip, or weaken any test.
- Show your file plan before editing. If your plan contains a file not named in section 4, you have misread the task — stop.

---

## 7. Acceptance criteria

Each is independently checkable.

1. The sidebar under Purchasing shows exactly two items: Suppliers, Purchases.
2. `grep -rn "supplier_invoices\|supplier_liabilities\|supplier_returns" src/app` returns nothing.
3. `src/features/procurement/` no longer contains `SupplierInvoicesScreen.tsx`, `SupplierLiabilitiesScreen.tsx`, `SupplierReturnsScreen.tsx`, `SupplierPaymentModal.tsx`, `LandedCostModal.tsx`, `PurchaseTransactionScreen.tsx`, or `PurchaseOrdersScreen.tsx`.
4. `src/features/procurement/PurchasesScreen.tsx` exists and is what `AppRouter` renders for `purchases`.
5. The Purchases page shows no Purchase Order table, no Confirm order, no Cancel order, no Receive goods, no Allocate landed cost.
6. `+ New purchase` still opens the Direct Purchase form with supplier, warehouse, date and the supplier-reference field.
7. Typing an existing barcode into the barcode box and pressing Enter adds a line for that exact product, with quantity `1` and the unit cost prefilled from `last_purchase_cost` when present.
8. Typing a barcode that matches nothing shows the "no product matches" message and adds no line.
9. Scanning the same barcode twice shows the "already added" message and does not add a second line.
10. `+ Choose item` opens a search dialog; typing part of a product name filters the list; clicking a result adds a line.
11. Clicking the product button on an existing line reopens the dialog and replaces that line's product and unit.
12. Confirming a purchase still posts successfully, still returns a `PR-` document number, and the receipt appears in the history list.
13. The history list filters correctly by supplier, warehouse, text search, and the new From/To dates.
14. Opening a receipt's details and clicking Print opens the browser print dialog showing only the purchase document.
15. All UI text appears correctly in French, Arabic (RTL intact) and English.
16. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
17. `git status --short` shows only files named in this plan.

---

## 8. Verification required

Run all of these and paste the real, unedited output:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

On the Windows dev machine:

```powershell
$env:PATH="C:\Program Files\nodejs;$env:PATH"
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Then:

```bash
git status --short
git diff --stat
grep -rn "PurchaseOrdersScreen\|PurchaseTransactionScreen\|LandedCostModal\|SupplierPaymentModal" src tests
```

The last grep must return nothing.

Do not run `npm run tauri build`. The Windows build is the owner's manual step.

Commit once, on the task branch:

```
refactor(procurement): WS-E-1 single-workflow purchases page with fast item entry
```

Push the branch. Do not merge into `main`.

---

## 9. Report back — required format

```
WS-E-1 REPORT

Git
- Branch:
- Full commit hash:
- Pushed: yes/no
- Working tree clean: yes/no

Files changed (full list):

Files deleted (full list):

Acceptance criteria 1-17: PASS / FAIL each, one line each

Commands run (paste real output):
- npm run typecheck:
- npm run lint:
- npm test:
- npm run build:

Anything not finished, and why:

Unrelated problems found but NOT fixed:
```

If any acceptance criterion fails, the final result is FAIL. Do not downgrade or hide a failure to finish.
