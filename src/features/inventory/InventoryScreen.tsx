import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { useAppData } from '../../app/AppDataContext';
import { Banner, Button, PackQuantity, Spinner, TextField } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { usePrimaryPacks } from '../../shared/hooks/usePrimaryPacks';
import { useI18n } from '../../shared/i18n';
import * as ipc from '../../shared/ipc/gateway';
import type { InventorySnapshotItem } from '../../shared/ipc/dto';
import { useSession } from '../../shared/session/SessionContext';
import { formatExactDecimal } from './exactDecimal';

export function InventoryScreen() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { user } = useSession();
  const { selectedWarehouseId } = useAppData();
  const token = user?.token ?? '';

  const [items, setItems] = useState<InventorySnapshotItem[]>([]);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variantIds = useMemo(() => items.map((i) => i.variant_id), [items]);
  const { packs } = usePrimaryPacks(variantIds);

  const load = useCallback(async () => {
    if (!token || selectedWarehouseId == null) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await ipc.listInventorySnapshot(
        token,
        selectedWarehouseId,
        appliedSearch,
        includeInactive,
      ));
    } catch (loadError) {
      setItems([]);
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, errorText, includeInactive, selectedWarehouseId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedSearch(search.trim());
  }

  return (
    <section className="sk-page" data-testid="inventory-screen">
      <div className="sk-page-header">
        <div>
          <h1>{t('inventory.title')}</h1>
          <p className="sk-muted">{t('inventory.subtitle')}</p>
        </div>
        <span className="sk-badge sk-badge--secondary">
          {t('inventory.rowCount', { count: items.length })}
        </span>
      </div>

      <form className="sk-card sk-form" onSubmit={submitSearch} aria-label={t('inventory.filters')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 280px', minWidth: 200 }}>
            <TextField
              label={t('inventory.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <button
            type="button"
            className={`sk-inactive-toggle-btn ${includeInactive ? 'sk-inactive-toggle-btn--active' : 'sk-inactive-toggle-btn--inactive'}`}
            onClick={() => setIncludeInactive(!includeInactive)}
            aria-pressed={includeInactive}
            aria-label={t('inventory.includeInactive')}
            title={t('inventory.includeInactive')}
            data-testid="inventory-include-inactive"
            style={{ height: '40px', marginBottom: '2px', flex: '0 0 auto' }}
          >
            <span aria-hidden>{includeInactive ? '👁️' : '👁️‍🗨️'}</span>
            <span>{t('inventory.includeInactive')}</span>
          </button>
        </div>

      </form>

      {error ? (
        <Banner tone="error" testId="inventory-error">
          {error}
          {' '}
          <Button variant="secondary" type="button" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </Banner>
      ) : null}

      {loading && items.length === 0 ? <Spinner /> : (
        <div className="sk-table-wrap" tabIndex={0} aria-label={t('inventory.table')}>
          <table className="sk-table" data-testid="inventory-table">
            <thead>
              <tr>
                <th>{t('adjustment.variant')}</th>
                <th>{t('inventory.skuBarcode')}</th>
                <th>{t('inventory.unit')}</th>
                <th>{t('inventory.status')}</th>
                <th className="sk-num">{t('inventory.quantity')}</th>
                <th className="sk-num">{t('inventory.wac')}</th>
                <th className="sk-num">{t('inventory.totalValue')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="sk-table-empty">{t('inventory.empty')}</td>
                </tr>
              ) : items.map((item) => {
                const active = item.product_is_active && item.variant_is_active;
                return (
                  <tr key={item.variant_id} className={active ? undefined : 'sk-row--inactive'}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{item.variant_name}</div>
                      {item.variant_name !== item.product_name && (
                        <div className="sk-muted" style={{ fontSize: '0.85em', marginTop: 2 }}>
                          {item.product_name}
                        </div>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--sk-font-mono, monospace)', fontSize: '0.9em' }}>
                      {item.primary_barcode || item.sku}
                    </td>
                    <td>{item.base_unit_code}</td>
                    <td>
                      <span className={`sk-badge ${active ? 'sk-badge--success' : 'sk-badge--danger'}`}>
                        {active ? t('catalog.active') : t('catalog.inactive')}
                      </span>
                    </td>
                    <td className="sk-num">
                      <PackQuantity
                        baseQuantity={item.quantity_on_hand}
                        baseUnitName={packs.get(item.variant_id)?.base_unit_name || item.base_unit_code}
                        pack={packs.get(item.variant_id)}
                      />
                    </td>
                    <td className="sk-num">{formatExactDecimal(item.last_known_wac)} DZD</td>
                    <td className="sk-num">{formatExactDecimal(item.total_value)} DZD</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
