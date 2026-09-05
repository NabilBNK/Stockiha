/**
 * WS-D-9 — the new Catalog page, built fresh alongside the existing Products
 * page. The old page is untouched and stays in the navigation until the Owner
 * approves this one.
 *
 * RULING 1 — the warm light theme is scoped to `.sk-catalog2` in catalog2.css.
 * No global token is redefined anywhere; see the file header there.
 * RULING 2 — grouped rows: products, with variants nested.
 * RULING 3 — inline cell editing for price and minimum stock, in the table.
 * RULING 4 — everything else lives in the right slide-in panel; the table
 * keeps full width when the panel is closed.
 * RULING 5 — one search field, autofocused, doubling as the scanner target.
 * RULING 6 — destructive and structural actions stay explicit.
 *
 * WS-D-9B — "New product" opens the same panel in create mode. On success
 * the list refreshes and the new product opens in the panel straight away,
 * so adding its remaining variants, attributes and barcodes is the next
 * click rather than a hunt through the list.
 */
import { useCallback, useRef, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useSession } from '../../shared/session/SessionContext';
import { CatalogCreatePanel, CatalogPanel } from './CatalogPanel';
import { CatalogTable } from './CatalogTable';
import { useCatalogList } from './useCatalogList';
import './catalog2.css';

interface PanelTarget {
  productId: number;
  variantId: number | null;
}

type PanelState =
  | { mode: 'edit'; target: PanelTarget }
  | { mode: 'create' }
  | null;

export function CatalogScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const token = user?.token ?? '';

  const list = useCatalogList(token);
  const {
    warehouses, selectedWarehouseId, selectWarehouse,
    search, setSearch, submitSearch,
    categoryId, changeCategory,
    includeInactive, changeIncludeInactive,
    categories,
    groups, totalCount, rowCount, loading, error,
    pageIndex, setPageIndex, pageSize,
    hasPreviousPage, hasNextPage,
    reload, commitVariantField,
  } = list;

  const [expandedProductIds, setExpandedProductIds] = useState<ReadonlySet<number>>(new Set());
  const [panel, setPanel] = useState<PanelState>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const toggleProduct = useCallback((productId: number) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  const openPanel = useCallback((productId: number, variantId?: number) => {
    setPanel({ mode: 'edit', target: { productId, variantId: variantId ?? null } });
  }, []);

  const closePanel = useCallback((changed: boolean) => {
    setPanel(null);
    // The panel writes product name, category, active state, variant names,
    // attributes and barcodes — all of which the table displays or filters on.
    // Refetch once on close rather than mid-edit, so the rows underneath do
    // not churn while the user is still working in the panel.
    if (changed) void reload();
    searchRef.current?.focus();
  }, [reload]);

  const handleCreated = useCallback((productId: number) => {
    // Refresh the list and land the operator straight on the new product, with
    // its first variant already there and the add-variant control one click
    // away. Making them search for what they just created is the kind of extra
    // step this page exists to remove.
    void reload();
    setExpandedProductIds((prev) => new Set(prev).add(productId));
    setPanel({ mode: 'edit', target: { productId, variantId: null } });
  }, [reload]);

  const from = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(totalCount, pageIndex * pageSize + rowCount);

  return (
    <div className="sk-catalog2" data-testid="catalog2-screen">
      <div className="sk-catalog2__header">
        <div>
          <h1>{t('catalog2.title')}</h1>
          <p className="sk-catalog2__subtitle">{t('catalog2.subtitle')}</p>
        </div>
        <Button
          type="button"
          onClick={() => setPanel({ mode: 'create' })}
          data-testid="catalog2-new-product"
        >
          {t('catalog2.newProduct')}
        </Button>
      </div>

      {/* RULING 5: one field, autofocused, matching name / SKU / barcode.
          A scanner types fast and terminates with Enter; the form submit
          applies the term immediately instead of waiting out the 300ms
          debounce that covers ordinary typing. */}
      <form
        className="sk-catalog2__toolbar"
        onSubmit={submitSearch}
        aria-label={t('productsList.filters')}
      >
        <div className="sk-catalog2__field">
          <label className="sk-catalog2__label" htmlFor="catalog2-search">
            {t('catalog2.searchLabel')}
          </label>
          <input
            id="catalog2-search"
            ref={searchRef}
            className="sk-catalog2__input"
            type="search"
            autoFocus
            autoComplete="off"
            placeholder={t('catalog2.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="catalog2-search"
          />
        </div>

        <div className="sk-catalog2__field">
          <label className="sk-catalog2__label" htmlFor="catalog2-warehouse">
            {t('inventory.warehouse')}
          </label>
          <select
            id="catalog2-warehouse"
            className="sk-catalog2__select"
            value={selectedWarehouseId ?? ''}
            onChange={(e) => selectWarehouse(Number(e.target.value))}
            data-testid="catalog2-warehouse"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
            ))}
          </select>
        </div>

        <div className="sk-catalog2__field">
          <label className="sk-catalog2__label" htmlFor="catalog2-category">
            {t('productsList.category')}
          </label>
          <select
            id="catalog2-category"
            className="sk-catalog2__select"
            value={categoryId ?? ''}
            onChange={(e) => changeCategory(e.target.value ? Number(e.target.value) : null)}
            data-testid="catalog2-category"
          >
            <option value="">{t('productsList.allCategories')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <label className="sk-catalog2__checkbox">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => changeIncludeInactive(e.target.checked)}
            data-testid="catalog2-include-inactive"
          />
          <span>{t('inventory.includeInactive')}</span>
        </label>
      </form>

      {error ? (
        <Banner tone="error" testId="catalog2-error">
          {error}{' '}
          <Button variant="secondary" type="button" onClick={() => void reload()}>
            {t('common.retry')}
          </Button>
        </Banner>
      ) : null}

      {selectedWarehouseId == null ? (
        <div className="sk-catalog2__empty">{t('productsList.selectWarehouse')}</div>
      ) : loading && groups.length === 0 ? (
        <Spinner />
      ) : !error && groups.length === 0 ? (
        <div className="sk-catalog2__empty" data-testid="catalog2-empty">{t('productsList.empty')}</div>
      ) : (
        <>
          <CatalogTable
            groups={groups}
            expandedProductIds={expandedProductIds}
            onToggleProduct={toggleProduct}
            onOpenPanel={openPanel}
            onCommitField={commitVariantField}
          />

          <div className="sk-catalog2__footer">
            <span className="sk-catalog2__note" data-testid="catalog2-range">
              {t('catalog2.showing', { from, to, total: totalCount })}
            </span>
            <div className="sk-catalog2__actions">
              <Button
                variant="secondary"
                type="button"
                disabled={!hasPreviousPage || loading}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                data-testid="catalog2-prev"
              >
                {t('productsList.previous')}
              </Button>
              <Button
                variant="secondary"
                type="button"
                disabled={!hasNextPage || loading}
                onClick={() => setPageIndex((p) => p + 1)}
                data-testid="catalog2-next"
              >
                {t('productsList.next')}
              </Button>
            </div>
          </div>
        </>
      )}

      {panel?.mode === 'edit' ? (
        <CatalogPanel
          key={`${panel.target.productId}:${panel.target.variantId ?? 'product'}`}
          token={token}
          productId={panel.target.productId}
          initialVariantId={panel.target.variantId}
          onClose={closePanel}
        />
      ) : null}

      {panel?.mode === 'create' ? (
        <CatalogCreatePanel
          token={token}
          onClose={() => {
            setPanel(null);
            searchRef.current?.focus();
          }}
          onCreated={handleCreated}
        />
      ) : null}
    </div>
  );
}
