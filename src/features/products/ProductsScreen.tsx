/**
 * Slice 2 — product management: catalog list + create/edit workflow.
 */
import { useEffect, useState, type FormEvent } from 'react';

import { Banner, Button, Spinner, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useSession } from '../../shared/session/SessionContext';
import { useCatalog } from './useCatalog';
import { ProductEditor } from './ProductEditor';

type View = 'list' | 'create' | 'edit';

export function ProductsScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const token = user?.token ?? '';

  const catalog = useCatalog(token);

  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('list');
  const [editProductId, setEditProductId] = useState<number | null>(null);

  // Load products when we return to list view
  useEffect(() => {
    if (view === 'list') {
      void catalog.loadProducts(search || undefined);
    }
    // intentionally only re-run when view changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    void catalog.loadProducts(search || undefined);
  }

  function goEdit(productId: number) {
    setEditProductId(productId);
    setView('edit');
  }

  function goList() {
    setView('list');
    setEditProductId(null);
  }

  if (view === 'create') {
    return (
      <ProductEditor
        token={token}
        onCreated={() => goList()}
        onBack={() => setView('list')}
      />
    );
  }

  if (view === 'edit' && editProductId != null) {
    return (
      <ProductEditor
        token={token}
        productId={editProductId}
        onBack={goList}
      />
    );
  }

  // List view
  return (
    <section className="sk-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1>{t('catalog.title')}</h1>
        <Button onClick={() => setView('create')} data-testid="new-product-btn">
          {t('catalog.new')}
        </Button>
      </div>

      <div className="sk-card">
        <form className="sk-toolbar" onSubmit={handleSearch}>
          <TextField
            label={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit" variant="secondary">{t('common.search')}</Button>
        </form>

        {catalog.productsLoading ? (
          <Spinner />
        ) : catalog.productsError ? (
          <Banner tone="error" testId="catalog-error">{catalog.productsError}</Banner>
        ) : catalog.products.length === 0 ? (
          <Banner tone="info">{t('catalog.empty')}</Banner>
        ) : (
          <table className="sk-table" data-testid="catalog-table">
            <thead>
              <tr>
                <th>{t('catalog.name')}</th>
                <th className="sk-num">{t('variants.title')}</th>
                <th>{t('catalog.active')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {catalog.products.map((p) => (
                <tr key={p.product_id} data-testid={`product-row-${p.product_id}`}>
                  <td>{p.name}</td>
                  <td className="sk-num">
                    {t('catalog.activeVariants', {
                      active: p.active_variant_count,
                      total: p.variant_count,
                    })}
                  </td>
                  <td>{p.is_active ? t('catalog.active') : t('catalog.inactive')}</td>
                  <td>
                    <Button
                      variant="secondary"
                      onClick={() => goEdit(p.product_id)}
                      data-testid={`edit-product-${p.product_id}`}
                    >
                      {t('catalog.edit')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
