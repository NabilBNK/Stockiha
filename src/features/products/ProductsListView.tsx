/**
 * WS-D-4 — variant-level, server-paginated, server-filtered products list
 * built on catalog.list_products_v2. Presentational half; state and
 * fetching live in useProductsList.ts. Loading/error/empty-state pattern
 * follows src/features/inventory/InventoryScreen.tsx.
 */
import type { FormEvent } from 'react';

import { Banner, Button, Spinner, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { formatDisplayAmount } from '../../shared/utils/formatters';
import { formatExactDecimal, isLowStock, isExactDecimalZero } from '../inventory/exactDecimal';
import { useProductsList } from './useProductsList';

export function ProductsListView({
  token, onEdit, onCreateNew,
}: {
  token: string;
  onEdit: (productId: number) => void;
  onCreateNew: () => void;
}) {
  const { t } = useI18n();
  const list = useProductsList(token);
  const {
    warehouses, selectedWarehouseId, selectWarehouse,
    search, setSearch, submitSearch,
    categoryId, changeCategory,
    brandId, changeBrand,
    includeInactive, changeIncludeInactive,
    categories, brands,
    rows, totalCount, loading, error,
    pageIndex, setPageIndex, pageSize,
    reload,
  } = list;

  function handleSubmit(e: FormEvent) {
    submitSearch(e);
  }

  const from = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(totalCount, pageIndex * pageSize + rows.length);
  const hasNextPage = pageIndex * pageSize + rows.length < totalCount;

  return (
    <section className="sk-page" data-testid="products-list-view">
      <div className="sk-page-header">
        <div>
          <h1>{t('catalog.title')}</h1>
          <p className="sk-muted">{t('productsList.subtitle')}</p>
        </div>
        <Button onClick={onCreateNew} data-testid="new-product-btn">
          {t('catalog.new')}
        </Button>
      </div>

      <form className="sk-card sk-form" onSubmit={handleSubmit} aria-label={t('productsList.filters')}>
        <div className="sk-form__grid">
          <div className="sk-field">
            <label className="sk-field__label" htmlFor="products-warehouse">
              {t('inventory.warehouse')}
            </label>
            <select
              id="products-warehouse"
              className="sk-field__input"
              value={selectedWarehouseId ?? ''}
              onChange={(e) => selectWarehouse(Number(e.target.value))}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
              ))}
            </select>
          </div>

          <TextField
            label={t('inventory.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="sk-field">
            <label className="sk-field__label" htmlFor="products-category-filter">
              {t('productsList.category')}
            </label>
            <select
              id="products-category-filter"
              className="sk-field__input"
              value={categoryId ?? ''}
              onChange={(e) => changeCategory(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t('productsList.allCategories')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="sk-field">
            <label className="sk-field__label" htmlFor="products-brand-filter">
              {t('productsList.brand')}
            </label>
            <select
              id="products-brand-filter"
              className="sk-field__input"
              value={brandId ?? ''}
              onChange={(e) => changeBrand(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t('productsList.allBrands')}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
              ))}
            </select>
          </div>

          <label className="sk-checkbox-row">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => changeIncludeInactive(e.target.checked)}
            />
            <span>{t('inventory.includeInactive')}</span>
          </label>
        </div>
      </form>

      {error ? (
        <Banner tone="error" testId="products-list-error">
          {error}
          {' '}
          <Button variant="secondary" type="button" onClick={() => void reload()}>
            {t('common.retry')}
          </Button>
        </Banner>
      ) : null}

      {selectedWarehouseId == null ? (
        <Banner tone="info">{t('productsList.selectWarehouse')}</Banner>
      ) : loading && rows.length === 0 ? (
        <Spinner />
      ) : !error && rows.length === 0 ? (
        <Banner tone="info">{t('productsList.empty')}</Banner>
      ) : (
        <>
          <div className="sk-table-wrap" tabIndex={0} aria-label={t('productsList.table')}>
            <table className="sk-table" data-testid="products-table">
              <thead>
                <tr>
                  <th>{t('productsList.identifier')}</th>
                  <th>{t('catalog.name')}</th>
                  <th>{t('variants.title')}</th>
                  <th>{t('productsList.category')}</th>
                  <th>{t('productsList.brand')}</th>
                  <th className="sk-num">{t('productsList.stock')}</th>
                  <th className="sk-num">{t('productsList.min')}</th>
                  <th className="sk-num">{t('productsList.price')}</th>
                  <th>{t('productsList.status')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const effectivelyActive = row.is_active && row.product_is_active;
                  const low = isLowStock(row.quantity_on_hand, row.minimum_stock);
                  const outOfStock = isExactDecimalZero(row.quantity_on_hand);
                  return (
                    <tr key={row.variant_id} data-testid={`product-row-${row.variant_id}`}>
                      <td>
                        <span
                          className={`sk-badge ${row.identifier_type === 'BARCODE' ? 'sk-badge--ok' : 'sk-badge--muted'}`}
                          title={row.identifier_type === 'BARCODE' ? t('productsList.identifierBarcode') : t('productsList.identifierSku')}
                        >
                          {row.identifier_type === 'BARCODE' ? t('productsList.identifierBarcode') : t('productsList.identifierSku')}
                        </span>
                        {' '}
                        {row.display_identifier}
                      </td>
                      <td>{row.product_name}</td>
                      <td>{row.variant_name}</td>
                      <td>{row.category_name ?? t('common.none')}</td>
                      <td>{row.brand_name ?? t('common.none')}</td>
                      <td className="sk-num">
                        {formatExactDecimal(row.quantity_on_hand)}
                        {outOfStock ? (
                          <span className="sk-badge sk-badge--danger" style={{ marginInlineStart: '6px' }}>
                            {t('productsList.outOfStock')}
                          </span>
                        ) : low ? (
                          <span className="sk-badge sk-badge--warning" style={{ marginInlineStart: '6px' }}>
                            {t('productsList.lowStock')}
                          </span>
                        ) : null}
                      </td>
                      <td className="sk-num">{formatExactDecimal(row.minimum_stock)}</td>
                      <td className="sk-num">{formatDisplayAmount(row.sale_price)}</td>
                      <td>{effectivelyActive ? t('catalog.active') : t('catalog.inactive')}</td>
                      <td>
                        <Button
                          variant="secondary"
                          onClick={() => onEdit(row.product_id)}
                          data-testid={`edit-product-${row.product_id}`}
                        >
                          {t('catalog.edit')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="sk-catalogue-setup__actions" style={{ justifyContent: 'space-between', alignItems: 'center', marginBlockStart: '12px' }}>
            <span className="sk-muted" data-testid="products-list-range">
              {t('productsList.showing', { from, to, total: totalCount })}
            </span>
            <div className="sk-catalogue-setup__actions">
              <Button
                variant="secondary"
                disabled={pageIndex === 0 || loading}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                data-testid="products-list-prev"
              >
                {t('productsList.previous')}
              </Button>
              <Button
                variant="secondary"
                disabled={!hasNextPage || loading}
                onClick={() => setPageIndex((p) => p + 1)}
                data-testid="products-list-next"
              >
                {t('productsList.next')}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
