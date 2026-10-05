import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AppView } from '../../../app/AppShell';
import type { NavAccess } from '../../../app/navigationAccess';
import { Button } from '../../../shared/components';
import { PackQuantity } from '../../../shared/components/PackQuantity';
import { usePrimaryPacks } from '../../../shared/hooks/usePrimaryPacks';
import { useErrorText } from '../../../shared/hooks/useErrorText';
import { useI18n } from '../../../shared/i18n';
import { listDashboardStockItems } from '../../../shared/ipc/dashboardGateway';
import type { DashboardStockItem } from '../../../shared/ipc/dashboardDto';
import { useSession } from '../../../shared/session/SessionContext';
import { formatDisplayAmount, formatDisplayDate } from '../../../shared/utils/formatters';
import { resolveTarget } from '../quickActions';

interface StockDialogProps {
  kind: 'low' | 'out' | 'dead';
  deadDays: 30 | 60 | 90 | 180;
  onClose: () => void;
  onNavigate: (view: AppView) => void;
  access: NavAccess;
}

const PAGE_SIZE = 25;

export function StockDialog({
  kind,
  deadDays,
  onClose,
  onNavigate,
  access,
}: StockDialogProps) {
  const { t, locale } = useI18n();
  const { user } = useSession() ?? {};
  const token = user?.token ?? '';
  const errorText = useErrorText();

  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [page, setPage] = useState(1);
  const [items, setItems] = useState<DashboardStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const inventoryTarget = resolveTarget(['M-INVENTORY'], access);

  const loadData = useCallback(async (p: number) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const offset = (p - 1) * PAGE_SIZE;
      const data = await listDashboardStockItems(token, kind, deadDays, PAGE_SIZE, offset);
      setItems(data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [token, kind, deadDays, errorText]);

  useEffect(() => {
    void loadData(page);
  }, [loadData, page]);

  // Trap focus and handle Escape
  useEffect(() => {
    titleRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const totalCount = items[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const variantIds = useMemo(() => items.map((i) => i.variant_id), [items]);
  const { packs } = usePrimaryPacks(variantIds);

  let title = '';
  if (kind === 'low') title = t('dash.stockDialog.low');
  else if (kind === 'out') title = t('dash.stockDialog.out');
  else if (kind === 'dead') title = t('dash.stockDialog.dead', { days: deadDays });

  return (
    <div className="sk-modal__backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="sk-modal sk-dash-stock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: 720 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sk-modal__header">
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="sk-modal__title"
          >
            {title}
          </h2>
          <button
            type="button"
            className="sk-modal__close"
            onClick={onClose}
            aria-label={t('dash.stockDialog.close')}
          >
            ×
          </button>
        </div>

        <div className="sk-modal__body">
          {loading ? (
            <div className="sk-dash-dialog__loading">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="sk-dash-skeleton sk-dash-skeleton--row" />
              ))}
            </div>
          ) : error ? (
            <div className="sk-dash-dialog__error" role="alert">
              <p>{error}</p>
              <Button type="button" variant="secondary" onClick={() => void loadData(page)}>
                {t('common.retry')}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="sk-dash-dialog__empty">
              {t('dash.stockDialog.empty')}
            </div>
          ) : (
            <table className="sk-dash-table">
              <thead>
                <tr>
                  <th>{t('dash.stockDialog.item')}</th>
                  <th className="sk-dash-table__right">{t('dash.stockDialog.quantity')}</th>
                  {kind !== 'out' && (
                    <th className="sk-dash-table__right">{t('dash.stockDialog.minimum')}</th>
                  )}
                  <th className="sk-dash-table__right">{t('dash.stockDialog.value')}</th>
                  {kind === 'dead' && (
                    <th>{t('dash.stockDialog.lastSold')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const pack = packs.get(item.variant_id);
                  let lastSoldText = t('dash.stockDialog.never');
                  if (item.last_sold_on) {
                    lastSoldText = formatDisplayDate(item.last_sold_on, locale);
                  }

                  return (
                    <tr key={item.variant_id}>
                      <td>
                        <div className="sk-dash-table__item-name">{item.item_name}</div>
                        <div className="sk-dash-table__sku sk-muted">
                          {item.display_identifier}
                        </div>
                      </td>
                      <td className="sk-dash-table__right">
                        <PackQuantity
                          baseQuantity={item.quantity}
                          baseUnitName={item.base_unit_name}
                          pack={pack}
                        />
                      </td>
                      {kind !== 'out' && (
                        <td className="sk-dash-table__right">
                          <PackQuantity
                            baseQuantity={item.minimum_stock}
                            baseUnitName={item.base_unit_name}
                            pack={pack}
                          />
                        </td>
                      )}
                      <td className="sk-dash-table__right sk-dash-tnum">
                        {formatDisplayAmount(item.stock_value)}
                      </td>
                      {kind === 'dead' && (
                        <td>{lastSoldText}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {totalPages > 1 && (
            <div className="sk-dash-dialog__pagination">
              <Button
                type="button"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('dash.stockDialog.previous')}
              </Button>
              <span className="sk-muted">
                {t('dash.stockDialog.page', { page, pages: totalPages })}
              </span>
              <Button
                type="button"
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t('dash.stockDialog.next')}
              </Button>
            </div>
          )}
        </div>

        <div className="sk-modal__footer">
          {inventoryTarget && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onClose();
                onNavigate(inventoryTarget);
              }}
            >
              {t('dash.stockDialog.openInventory')}
            </Button>
          )}
          <Button type="button" variant="primary" onClick={onClose}>
            {t('dash.stockDialog.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
