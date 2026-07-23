/**
 * Slice 1 — product management. Lists active products/variants (with the
 * selected warehouse's stock + WAC, read-only) and creates a product with its
 * default variant via the backend. No direct stock editing here; totals and
 * validation are backend-authoritative.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Banner, Button, Spinner, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import type { ProductListItem } from '../../shared/ipc/dto';

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

export function ProductsScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const { selectedWarehouseId } = useAppData();
  const errorText = useErrorText();

  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const token = user?.token ?? '';

  const load = useCallback(
    async (searchTerm: string) => {
      if (!token || selectedWarehouseId == null) return;
      setLoading(true);
      setListError(null);
      try {
        setProducts(await ipc.listProducts(token, selectedWarehouseId, searchTerm || undefined));
      } catch (err) {
        setListError(errorText(err));
      } finally {
        setLoading(false);
      }
    },
    [token, selectedWarehouseId, errorText],
  );

  useEffect(() => {
    void load(search);
  }, [selectedWarehouseId]);

  const priceInvalid = price !== '' && !DECIMAL_RE.test(price);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (creating || !token) return;
    if (!DECIMAL_RE.test(price)) {
      setFormError(t('errors.validation'));
      return;
    }
    setCreating(true);
    setFormError(null);
    setCreated(false);
    try {
      await ipc.createProduct(token, name, sku, price, true);
      setName('');
      setSku('');
      setPrice('');
      setCreated(true);
      await load(search);
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="sk-page">
      <h1>{t('products.title')}</h1>

      <form className="sk-card sk-form" onSubmit={onCreate} aria-label={t('products.new')}>
        <h2>{t('products.new')}</h2>
        {formError ? <Banner tone="error" testId="product-error">{formError}</Banner> : null}
        {created ? <Banner tone="success" testId="product-created">{t('products.created')}</Banner> : null}
        <div className="sk-form__grid">
          <TextField label={t('products.name')} value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField label={t('products.sku')} value={sku} onChange={(e) => setSku(e.target.value)} required />
          <TextField
            label={t('products.price')}
            value={price}
            inputMode="decimal"
            onChange={(e) => setPrice(e.target.value)}
            error={priceInvalid ? t('errors.validation') : undefined}
            required
          />
        </div>
        <Button type="submit" loading={creating} disabled={!name || !sku || !price || priceInvalid}>
          {t('common.create')}
        </Button>
      </form>

      <div className="sk-card">
        <div className="sk-toolbar">
          <TextField
            label={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button variant="secondary" onClick={() => void load(search)}>
            {t('common.search')}
          </Button>
        </div>

        {loading ? (
          <Spinner />
        ) : listError ? (
          <Banner tone="error">{listError}</Banner>
        ) : products.length === 0 ? (
          <Banner tone="info">{t('products.empty')}</Banner>
        ) : (
          <table className="sk-table" data-testid="products-table">
            <thead>
              <tr>
                <th>{t('products.sku')}</th>
                <th>{t('products.name')}</th>
                <th className="sk-num">{t('products.price')}</th>
                <th className="sk-num">{t('products.stock')}</th>
                <th className="sk-num">{t('products.wac')}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.variant_id}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td className="sk-num">{p.sale_price}</td>
                  <td className="sk-num">{p.quantity_on_hand}</td>
                  <td className="sk-num">{p.last_known_wac}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
