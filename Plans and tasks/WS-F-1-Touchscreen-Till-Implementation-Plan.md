# WS-F-1 — Touchscreen Till

**Workstream:** WS-F — POS, Sales & Cash Operations
**Sub-plan:** 1 of 4
**Executing agent:** Gemini (Antigravity IDE)
**Base branch:** `task/ws-e-3-supplier-returns` (commit `4229b9f`)
**Branch to create:** `task/ws-f-1-touchscreen-till`
**Risk class:** Frontend only. No SQL. No migration. No Rust. No accounting change. No change to how a sale posts.

---

## 0. Authority and precedence

Read in this order before touching anything:

1. This document.
2. `GEMINI.md`
3. `AGENTS.md`

This document wins where they differ.

**No override is granted in this sub-plan, and none is needed.** Every task below is achievable by editing TypeScript, TSX and CSS. If a step appears to require SQL, a migration, a Rust file, a change to how a sale is posted or priced, a permission change, or a dependency change, **you have misread the step — stop and report**.

The rules that matter most here:

> **Do not change the sale-posting path.** `confirmSale`, `confirmCreditSale`, `authorizeCreditOverride`, the request-id / sale-intent logic, and the manager-override flow are finished code. You are rebuilding how a cashier *chooses* items, not how a sale is *recorded*.

If any file does not look the way this plan describes, **stop and report the difference**.

---

## 1. Repository safety — do this first

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin --prune
```

If `git status --short` shows changes that are not yours, **STOP** and report. Never reset, clean, stash, or discard.

Then:

```bash
git checkout task/ws-e-3-supplier-returns
git pull origin task/ws-e-3-supplier-returns
git checkout -b task/ws-f-1-touchscreen-till
```

Work only on `task/ws-f-1-touchscreen-till`.

---

## 2. Verified current state

You do not need to re-derive this. It is given so you know what you are walking into.

- The till is `src/features/pos/PosScreen.tsx`, about 500 lines. Its styles live in `src/styles/global.css` under the `.sk-pos__*` and `.sk-cart*` class names.
- On load it calls `ipc.listProducts(token, selectedWarehouseId)`, which returns **every product in the catalogue at once**, and filters them in the browser inside `filteredProducts`. The pilot store will have thousands of products. This is the main problem this sub-plan fixes.
- `src/shared/ipc/gateway.ts` already exports `listProductsV2(sessionToken, warehouseId, filters)` where `filters` is `{ search, categoryId, includeInactive, limit, offset }`, returning `ProductListItemV2[]`. It already does the searching and paging in the database. **Use it. Do not write a new IPC command.**
- `src/shared/ipc/gateway.ts` already exports `listCategories(sessionToken)`, returning `ReferenceLifecycleItem[]` — `{ id, name, is_active, usage_count }`.
- The search box has `data-testid="pos-search"`. `tests/global-search.workflow.test.tsx` depends on that exact testid and on Enter resolving a barcode. **That testid and that behaviour must survive this task.**
- `provisionalTotal` currently computes the cart total with `Number(l.unitPrice) * l.qty`. That is floating-point arithmetic on money and is a house-rule violation. Task T7 fixes it.
- The credit-sale panel, the customer picker, and the manager-override dialog all work and are out of scope.

---

## 3. Objective

Make the till usable with a finger on a touchscreen, and make it load only the products it is showing instead of the whole catalogue.

The shape the cashier gets: category buttons across the top, a grid of large product tiles below them, a scan/search box as the secondary way in, and a cart down the side with big quantity buttons and a large Confirm button pinned at the bottom.

---

## 4. Scope — IN

Nine tasks, in this order. Do not reorder them.

---

### T1 — Exact money helper for the cart total

Create `src/shared/money/exactMoney.ts` with exactly this content:

```ts
/**
 * Exact decimal arithmetic for money shown in the till.
 *
 * The database remains the authority for every posted amount. These helpers
 * exist so the on-screen cart total matches that authority to the centime
 * instead of drifting through binary floating point.
 *
 * Every value in and out is a decimal STRING. Never convert money to a number.
 */

function splitDecimal(value: string): { negative: boolean; digits: string; scale: number } {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`exactMoney: not a decimal string: ${value}`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');
  return { negative, digits: `${whole}${fraction}`, scale: fraction.length };
}

function toScaledBigInt(value: string, scale: number): bigint {
  const parts = splitDecimal(value);
  const padded = parts.digits + '0'.repeat(scale - parts.scale);
  const magnitude = BigInt(padded === '' ? '0' : padded);
  return parts.negative ? -magnitude : magnitude;
}

function fromScaledBigInt(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? '' : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Adds decimal strings exactly. Returns a string with 2 decimal places. */
export function addExactMoney(values: string[]): string {
  const total = values.reduce((sum, value) => sum + toScaledBigInt(value, 2), 0n);
  return fromScaledBigInt(total, 2);
}

/** Multiplies a decimal money string by a whole-number quantity, exactly. */
export function multiplyMoneyByQuantity(amount: string, quantity: number): string {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`exactMoney: quantity must be a non-negative whole number: ${quantity}`);
  }
  const scaled = toScaledBigInt(amount, 2) * BigInt(quantity);
  return fromScaledBigInt(scaled, 2);
}
```

Do not modify `src/features/procurement/procurementDecimal.ts` or `src/features/inventory/exactDecimal.ts`. They belong to other screens and are out of scope.

---

### T2 — Load products from the database, not from memory

All edits are in `src/features/pos/PosScreen.tsx`.

**2a.** Change the type imports. Replace

```tsx
import type { ProductListItem } from '../../shared/ipc/dto';
```

with

```tsx
import type { ProductListItemV2, ReferenceLifecycleItem } from '../../shared/ipc/dto';
```

**2b.** Replace the `products` state and add the new catalogue state. Replace

```tsx
  const [products, setProducts] = useState<ProductListItem[]>([]);
```

with

```tsx
  const PAGE_SIZE = 60;
  const [products, setProducts] = useState<ProductListItemV2[]>([]);
  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
```

**2c.** Replace the whole loading `useEffect` — the one that calls `ipc.listProducts` and `listCustomers` — with these two effects:

```tsx
  // Customers and categories load once. Neither depends on the search box.
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      listCustomers(token, false).catch(() => []),
      ipc.listCategories(token).catch(() => []),
    ])
      .then(([customerRows, categoryRows]) => {
        setCustomers(customerRows);
        setCategories(categoryRows.filter((category) => category.is_active));
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Products are fetched from the database for the current category and search
  // text, 60 at a time. The catalogue is never loaded into the browser whole.
  useEffect(() => {
    if (!token || selectedWarehouseId == null) return;
    let active = true;
    const timer = setTimeout(() => {
      setCatalogBusy(true);
      ipc
        .listProductsV2(token, selectedWarehouseId, {
          search: search.trim() || null,
          categoryId,
          includeInactive: false,
          limit: PAGE_SIZE,
          offset: 0,
        })
        .then((rows) => {
          if (!active) return;
          setProducts(rows);
          setHasMore(rows.length === PAGE_SIZE);
        })
        .catch(() => {
          if (!active) return;
          setProducts([]);
          setHasMore(false);
        })
        .finally(() => {
          if (active) setCatalogBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [token, selectedWarehouseId, search, categoryId]);
```

The 250 ms timer is a debounce: it stops a database query firing on every keystroke. Do not remove it and do not change the number.

**2d.** Add a "show more" loader immediately after those effects:

```tsx
  const loadMoreProducts = useCallback(async () => {
    if (!token || selectedWarehouseId == null || catalogBusy) return;
    setCatalogBusy(true);
    try {
      const rows = await ipc.listProductsV2(token, selectedWarehouseId, {
        search: search.trim() || null,
        categoryId,
        includeInactive: false,
        limit: PAGE_SIZE,
        offset: products.length,
      });
      setProducts((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setCatalogBusy(false);
    }
  }, [token, selectedWarehouseId, search, categoryId, products.length, catalogBusy]);
```

**2e.** Delete the `filteredProducts` `useMemo` entirely. The database now does the filtering. Every later reference to `filteredProducts` becomes `products`.

---

### T3 — Keep barcode scanning working now that products are paged

A scanned item may not be among the 60 currently on screen, so the old `products.find(...)` lookup would fail. Replace the body of `handleSearchEnter` with exactly this, leaving its JSDoc comment block above it in place:

```tsx
  async function handleSearchEnter() {
    const trimmed = search.trim();
    if (!trimmed || !token || selectedWarehouseId == null) return;

    const result = await resolveBarcodeFirst(token, trimmed);
    if (result.type !== 'match') {
      setBanner({ tone: 'warning', text: t('pos.barcodeNotFound', { query: trimmed }) });
      return;
    }

    // The scanned variant may not be on the current page, so fetch it by the
    // scanned value rather than searching the already-loaded rows.
    const matches = await ipc
      .listProductsV2(token, selectedWarehouseId, {
        search: trimmed,
        categoryId: null,
        includeInactive: false,
        limit: 5,
        offset: 0,
      })
      .catch(() => [] as ProductListItemV2[]);

    const matchedProduct = matches.find((row) => row.variant_id === result.resolved.variant_id);
    if (!matchedProduct) {
      setBanner({ tone: 'warning', text: t('pos.barcodeNotInWarehouse', { query: trimmed }) });
      return;
    }

    addToCart(matchedProduct);
    setSearch('');
    setBanner(null);
  }
```

---

### T4 — Adapt the cart to the new product shape

`ProductListItemV2` has `product_name` and `variant_name` instead of a single `name`.

**4a.** Add this helper immediately above `addToCart`:

```tsx
  function displayNameOf(product: ProductListItemV2): string {
    return product.variant_name
      ? `${product.product_name} — ${product.variant_name}`
      : product.product_name;
  }
```

**4b.** Change the signature and body of `addToCart` to:

```tsx
  function addToCart(p: ProductListItemV2) {
    mutateCart((prev) => {
      const existing = prev.find((l) => l.variantId === p.variant_id);
      if (existing) {
        return prev.map((l) => (l.variantId === p.variant_id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        {
          variantId: p.variant_id,
          sku: p.sku,
          name: displayNameOf(p),
          unitPrice: p.sale_price,
          qty: 1,
        },
      ];
    });
  }
```

The `CartLine` interface is unchanged. Everything downstream of the cart — `saleLines`, `confirmSale`, the credit path — is unchanged.

---

### T5 — The catalogue panel: category buttons, big tiles, show more

Replace the entire `<div className="sk-pos__catalog"> … </div>` block — from its opening tag through its closing tag, including the catalog header, the search label and the products grid — with exactly this:

```tsx
        <div className="sk-pos__catalog">
          <div className="sk-pos__catalog-header">
            <div>
              <h2>{t('pos.catalog')}</h2>
              <span>{t('pos.productsAvailable', { count: products.length })}</span>
            </div>
            <label className="sk-pos__search">
              <span className="sk-visually-hidden">{t('pos.search')}</span>
              <span aria-hidden>⌕</span>
              <input
                type="search"
                value={search}
                placeholder={t('pos.search')}
                autoComplete="off"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleSearchEnter();
                  }
                }}
                data-testid="pos-search"
              />
            </label>
          </div>

          <div className="sk-pos__categories" role="group" aria-label={t('pos.categories')} data-testid="pos-categories">
            <button
              type="button"
              className={`sk-pos__category ${categoryId === null ? 'sk-pos__category--active' : ''}`}
              aria-pressed={categoryId === null}
              onClick={() => setCategoryId(null)}
              data-testid="pos-category-all"
            >
              {t('pos.allCategories')}
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`sk-pos__category ${categoryId === category.id ? 'sk-pos__category--active' : ''}`}
                aria-pressed={categoryId === category.id}
                onClick={() => setCategoryId(category.id)}
                data-testid={`pos-category-${category.id}`}
              >
                {category.name}
              </button>
            ))}
          </div>

          {loading ? (
            <Spinner />
          ) : products.length === 0 ? (
            <div className="sk-pos__empty">{catalogBusy ? t('pos.searching') : t('pos.noProducts')}</div>
          ) : (
            <>
              <div className="sk-pos__products" data-testid="pos-products">
                {products.map((p) => (
                  <button
                    key={p.variant_id}
                    type="button"
                    className="sk-pos__product"
                    aria-label={`${t('pos.addProduct')} ${displayNameOf(p)}`}
                    onClick={() => addToCart(p)}
                    data-testid={`pos-product-${p.variant_id}`}
                  >
                    <span className="sk-pos__product-top">
                      <span className="sk-pos__product-mark" aria-hidden>
                        {p.product_name.trim().charAt(0).toLocaleUpperCase() || '•'}
                      </span>
                      <span className="sk-pos__product-sku">{p.display_identifier}</span>
                    </span>
                    <span className="sk-pos__product-name">{displayNameOf(p)}</span>
                    <span className="sk-pos__product-price">{p.sale_price}</span>
                  </button>
                ))}
              </div>
              {hasMore && (
                <button
                  type="button"
                  className="sk-button sk-button--secondary sk-pos__more"
                  onClick={() => void loadMoreProducts()}
                  disabled={catalogBusy}
                  data-testid="pos-load-more"
                >
                  {catalogBusy ? t('pos.searching') : t('pos.showMore')}
                </button>
              )}
            </>
          )}
        </div>
```

Do not rename `data-testid="pos-search"` or `data-testid="pos-products"`. Other tests depend on both.

---

### T6 — Make the cart touch-sized and pin the confirm bar

In the cart column of `PosScreen.tsx`:

**6a.** The quantity controls currently render as small `−` and `+` buttons inside `.sk-cart__qty`. Keep the structure and the `aria-label`s exactly as they are, keep `data-testid={`qty-${l.variantId}`}` on the quantity value, and add `className="sk-cart__qty-btn"` to both the decrement and the increment button. Add nothing else to them.

**6b.** Add `className="sk-cart__remove"` to the existing per-line remove button. Do not change its `aria-label`.

**6c.** Wrap the existing total row and the existing Confirm and Clear buttons in a single pinned footer. Find the block containing `<div className="sk-cart__summary">` and the Confirm/Clear buttons, and wrap it — without changing any of the buttons' props, handlers, `data-testid`s or disabled logic — like this:

```tsx
<div className="sk-pos__checkout" data-testid="pos-checkout-bar">
  {/* existing summary row and existing action buttons, unchanged */}
</div>
```

Do not alter what the Confirm button does, when it is disabled, or the confirmation dialog it opens.

---

### T7 — Fix the floating-point cart total

Replace the `provisionalTotal` `useMemo` with:

```tsx
  const provisionalTotal = useMemo(
    () => addExactMoney(cart.map((l) => multiplyMoneyByQuantity(l.unitPrice, l.qty))),
    [cart],
  );
```

and add the import at the top of the file:

```tsx
import { addExactMoney, multiplyMoneyByQuantity } from '../../shared/money/exactMoney';
```

`addExactMoney([])` returns `"0.00"`, so an empty cart still shows a total. Do not add a fallback for that case.

There must be no `Number(...)`, `parseFloat(...)`, `+value`, `*`, `-` or `/` applied to any money or price string anywhere in `PosScreen.tsx` after this task. The existing `Number(value)` inside `selectCustomer` converts a select element's **id**, not money — leave it alone.

---

### T8 — Styles

Append this to the **end** of `src/styles/global.css`. Do not edit any existing rule in that file.

```css
/* ==========================================================================
   WS-F-1 — touchscreen till
   Every interactive control on the till is at least 56px on its short edge so
   it can be hit reliably with a finger. Logical properties keep Arabic RTL.
   ========================================================================== */

.sk-pos__categories {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-block: 10px;
  margin-block-start: 12px;
  scrollbar-width: thin;
}

.sk-pos__category {
  flex: 0 0 auto;
  min-height: 56px;
  padding: 0 20px;
  border: 1px solid var(--sk-border);
  border-radius: var(--sk-radius);
  background: var(--sk-surface-soft);
  color: var(--sk-text);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color .15s, background-color .15s;
}

.sk-pos__category--active {
  border-color: var(--sk-primary);
  background: var(--sk-primary);
  color: var(--sk-on-primary, #fff);
}

.sk-pos__products {
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
}

.sk-pos__product {
  min-height: 168px;
  font-size: 1.02rem;
}

.sk-pos__product-name {
  font-size: 1.05rem;
  line-height: 1.3;
}

.sk-pos__product-price {
  font-size: 1.25rem;
  font-weight: 700;
}

.sk-pos__more {
  min-height: 56px;
  margin-block-start: 12px;
  width: 100%;
}

.sk-cart__qty-btn {
  min-width: 56px;
  min-height: 56px;
  border: 1px solid var(--sk-border);
  border-radius: var(--sk-radius);
  background: var(--sk-surface-soft);
  color: var(--sk-text);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.sk-cart__qty-btn:active {
  background: var(--sk-primary);
  color: var(--sk-on-primary, #fff);
}

.sk-cart__remove {
  min-width: 56px;
  min-height: 56px;
}

.sk-pos__checkout {
  position: sticky;
  inset-block-end: 0;
  padding-block: 14px;
  margin-block-start: 10px;
  border-block-start: 1px solid var(--sk-border);
  background: var(--sk-surface);
}

.sk-pos__checkout .sk-cart__summary strong {
  font-size: 1.75rem;
}

.sk-pos__checkout .sk-button {
  min-height: 68px;
  font-size: 1.1rem;
}
```

If `--sk-on-primary` is not defined in the theme, the `#fff` fallback already written above covers it. Do not add the variable and do not change the palette.

---

### T9 — Copy keys and tests

**9a. Copy keys.** In `src/shared/i18n/locales.ts`, add four keys to each of the three locale blocks, placed immediately after the existing `'pos.noProducts'` entry in that block. Use exactly these values.

| key | en | fr | ar |
|---|---|---|---|
| `pos.categories` | `Categories` | `Catégories` | `الفئات` |
| `pos.allCategories` | `All` | `Tous` | `الكل` |
| `pos.showMore` | `Show more` | `Afficher plus` | `عرض المزيد` |
| `pos.searching` | `Searching…` | `Recherche…` | `جارٍ البحث…` |

The Arabic block in this file stores its strings as escaped `\uXXXX` sequences. Match that existing style for the Arabic values rather than pasting raw Arabic characters into that block. The French and English blocks take the text as written.

Remove no existing key.

**9b. New test file.** Create `tests/pos-touch.workflow.test.tsx`. Copy the structure, mocks and login helper of `tests/global-search.workflow.test.tsx`, which already drives the POS screen. It must contain four tests:

1. **Products come from the paged command.** After the till loads, assert `list_products_v2` was called with `limit: 60` and `offset: 0`, and assert the old `list_products` command was **not** called by the POS screen.
2. **Category buttons filter.** With `list_categories` mocked to return one active category `{ id: 7, name: 'Drinks', is_active: true, usage_count: 3 }`, click `pos-category-7` and assert `list_products_v2` was called again with `categoryId: 7`.
3. **Tapping a tile adds to the cart.** With one mocked product `{ variant_id: 42, sale_price: '150.00', product_name: 'Water', variant_name: '1L' }`, click `pos-product-42` and assert `qty-42` shows `1` and `pos-total` shows `150.00`.
4. **The total is exact.** Add the same product three times and assert `pos-total` shows `450.00`. Then, with a mocked product priced `0.10`, add it three times and assert the total shows `0.30` and not `0.30000000000000004`.

**9c. New unit test.** Create `tests/exactMoney.test.ts` with three tests against `src/shared/money/exactMoney.ts`:

1. `addExactMoney(['0.10', '0.20'])` returns `'0.30'`.
2. `multiplyMoneyByQuantity('19.99', 3)` returns `'59.97'`.
3. `addExactMoney([])` returns `'0.00'`.

**9d. Existing tests.** `tests/global-search.workflow.test.tsx` must keep passing unchanged. If it fails because the POS screen now fetches the scanned item instead of reading it from memory, update **only its mock setup** so `list_products_v2` returns the scanned variant. Do not weaken or delete any assertion in that file. If it fails for any other reason, **stop and report**.

---

## 5. Scope — OUT. Do not touch.

- `confirmSale`, `confirmCreditSale`, `authorizeCreditOverride`, `invalidateSaleIntent`, `requestId`, `saleIntentDate`, `creditOverrideToken`, and the manager-override dialog.
- The credit payment panel, the customer picker, `CREDIT_COPY`, and anything under `src/shared/ipc/creditSaleGateway.ts` or `customerGateway.ts`.
- Discounts. There is no discount anywhere in this app yet and none is being added here. That is WS-F-3.
- Receipt printing, the thermal printer, ESC/POS, `ReceiptView`, and `src/shared/documents/`. That is WS-F-2.
- The cash drawer. Deferred to a future workstream; do not add an open-drawer call.
- Cash sessions, `CashSessionScreen.tsx`, blind counts, variance approval, handover. That is WS-F-4.
- Any file under `src-tauri/`. No Rust, no migrations, no SQL.
- `src/shared/ipc/gateway.ts`, `commands.ts`, `dto.ts` — no additions, no removals, no renames. Everything you need is already exported.
- `src/features/procurement/`, `src/features/inventory/`, `src/features/catalog2/`.
- `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`.
- `STOCKIHA_GROUND_TRUTH.md`, `AGENTS.md`, `CURRENT_STEP.md`, `README.md`, `TASKS.md`, `GEMINI.md`.
- Any existing rule inside `src/styles/global.css`. You append at the end; you do not edit what is there.

If you find a genuine unrelated bug: **report it, do not fix it.**

---

## 6. Constraints

- **Never use floating point for money.** After T7 there must be no arithmetic operator and no `Number()`/`parseFloat()` applied to a price, a unit price, or a total anywhere in `PosScreen.tsx`.
- The database stays the authority for the posted total. The on-screen total is a preview and nothing else — do not send it anywhere.
- Every user-facing string comes from `t('pos.…')` in all three locales. No hardcoded English in JSX.
- Logical CSS properties only (`inset-block-end`, `margin-block-start`, `padding-inline`). Never `left`, `right`, `margin-left`, `margin-right`. Arabic RTL must keep working.
- Every control a cashier touches is at least 56px on its short edge. Product tiles are at least 168px tall.
- No new npm dependency.
- No placeholder, no `TODO`, no mock, no commented-out block left behind.
- Show your file plan before editing. If it names a file not listed in section 4, you have misread the task — stop.

The complete list of files this task may touch:

```
src/shared/money/exactMoney.ts          (new)
src/features/pos/PosScreen.tsx          (edited)
src/styles/global.css                   (appended to)
src/shared/i18n/locales.ts              (edited)
tests/pos-touch.workflow.test.tsx       (new)
tests/exactMoney.test.ts                (new)
tests/global-search.workflow.test.tsx   (mock setup only, if required)
```

---

## 7. Acceptance criteria

1. The till no longer calls `list_products`. It calls `list_products_v2` with a limit of 60.
2. Typing in the search box triggers at most one database query per 250 ms, not one per keystroke.
3. Category buttons appear across the top, with **All** first and selected by default.
4. Tapping a category reloads the grid with only that category's products.
5. When more than 60 products match, a **Show more** button appears and appends the next 60.
6. Tapping a product tile adds it to the cart; tapping it again increases the quantity to 2.
7. Scanning a barcode adds the right item to the cart even when that item is not one of the 60 currently shown.
8. Scanning an unknown barcode shows the existing "not found" warning and adds nothing.
9. The cart total is exact: three items at 0.10 show 0.30, not 0.30000000000000004.
10. Every quantity button, remove button, category button and the Confirm button is at least 56px on its short edge; product tiles are at least 168px tall.
11. The total and the Confirm button stay visible at the bottom of the cart without scrolling, with a long cart.
12. Confirming a cash sale still posts exactly as before and still shows the same confirmation.
13. The credit payment panel, customer picker and manager-override flow are unchanged and still work.
14. All text appears correctly in French, Arabic (RTL layout intact) and English.
15. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass, including `tests/global-search.workflow.test.tsx`.
16. `git status --short` shows only the files listed at the end of section 6.

---

## 8. Verification required

Paste the real, unedited output of every command.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

```bash
git status --short
git diff --stat
grep -rn "listProducts(" src/features/pos/
grep -rn "Number(\|parseFloat" src/features/pos/PosScreen.tsx
```

The first grep must return nothing. The second must return only the single `Number(value)` inside `selectCustomer`.

Do not run `npm run tauri build`. The Windows build and the manual acceptance run are the owner's steps.

Commit once:

```
feat(pos): WS-F-1 touchscreen till with paged catalogue and exact cart total
```

Push the branch. Do not merge into `main`.

---

## 9. Report back — required format

```
WS-F-1 REPORT

Git
- Branch:
- Full commit hash:
- Pushed: yes/no
- Working tree clean: yes/no

Files changed (full list):
Files created (full list):
Files touched that are NOT in section 6's list (must be none):

Acceptance criteria 1-16: PASS / FAIL each, one line each

Commands run (paste real output):
- npm run typecheck:
- npm run lint:
- npm test:
- npm run build:
- grep listProducts( in src/features/pos/:
- grep Number(/parseFloat in PosScreen.tsx:

Anything not finished, and why:

Unrelated problems found but NOT fixed:
```

If any acceptance criterion fails, the final result is FAIL. Do not hide or downgrade a failure to finish.

---

## 10. Manual acceptance checklist for the owner (not for the agent)

Run on Windows after the agent reports PASS. Use the touchscreen, not a mouse, wherever you can.

1. Open a cash session and go to the till. The grid loads quickly even with the full catalogue.
2. Check the category strip. Tap one — only that category's products show. Tap **All** — everything comes back.
3. Scroll to the bottom of a big category. Tap **Show more** and confirm more products load.
4. Type part of a product name. The grid updates after a short pause, not on every letter.
5. Tap four different product tiles with a finger. Every tap registers the first time.
6. Use the − and + buttons on a cart line with a finger. Both are easy to hit.
7. Fill the cart with ten lines. The total and Confirm button stay visible without scrolling.
8. Find a product priced with centimes (for example 0.10 or 19.99), add three, and check the total is exactly right.
9. Scan a barcode for a product that is **not** currently on screen. It should land in the cart.
10. Scan a made-up barcode. Expect the "not found" warning and nothing added.
11. Confirm a cash sale. It should post exactly as it did before this change.
12. Switch to credit, pick a customer, and confirm the credit panel and override prompt still behave as before.
13. Switch the language to French, then Arabic. Check the category strip, tiles and cart read correctly and Arabic stays right-to-left.
