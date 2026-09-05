/**
 * Slice 1 — small operational dashboard. Shows only backend-supported
 * figures: product/variant counts, selected warehouse, active cash session,
 * latest posted document, and pending generation/print job counts. No
 * analytics or charts.
 */
import { useCallback, useEffect, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import type { DashboardSummary } from '../../shared/ipc/dto';

export function DashboardScreen() {
  const { t } = useI18n();
  const { user, workstationId } = useSession();
  const { warehouses, selectedWarehouseId } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setSummary(await ipc.getDashboardSummary(token, workstationId));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [token, workstationId, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedWarehouse = warehouses.find((w) => w.id === selectedWarehouseId);

  return (
    <section className="sk-page sk-dashboard">
      <div className="sk-dashboard__header">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <div className="sk-muted" style={{ fontSize: '0.8rem', fontWeight: 500, marginBlock: '2px 4px' }}>
            [ version = WS-D-10.1 ]
          </div>
          <p>{t('dashboard.subtitle')}</p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          {t('jobs.refresh')}
        </Button>
      </div>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Banner tone="error">{error}</Banner>
      ) : summary ? (
        <div className="sk-dashboard__layout" data-testid="dashboard">
          <section className="sk-dashboard__catalog" aria-labelledby="dashboard-catalog-title">
            <div className="sk-dashboard__section-heading">
              <div>
                <span className="sk-dashboard__eyebrow">{t('dashboard.inventoryOverview')}</span>
                <h2 id="dashboard-catalog-title">{t('dashboard.catalog')}</h2>
              </div>
              <span className="sk-dashboard__section-icon" aria-hidden>▦</span>
            </div>
            <div className="sk-dashboard__stats">
              <Metric label={t('dashboard.products')} value={String(summary.product_count)} icon="□" />
              <Metric label={t('dashboard.variants')} value={String(summary.variant_count)} icon="◇" />
            </div>
          </section>

          <section className="sk-dashboard__operations" aria-labelledby="dashboard-operations-title">
            <div className="sk-dashboard__section-heading">
              <div>
                <span className="sk-dashboard__eyebrow">{t('dashboard.currentStatus')}</span>
                <h2 id="dashboard-operations-title">{t('dashboard.operations')}</h2>
              </div>
              <span className="sk-dashboard__section-icon" aria-hidden>◎</span>
            </div>
            <DashboardDetail
              label={t('dashboard.warehouse')}
              value={
                selectedWarehouse
                  ? `${selectedWarehouse.code} — ${selectedWarehouse.name}`
                  : t('common.none')
              }
              icon="▣"
            />
            <DashboardDetail
              label={t('dashboard.session')}
              value={
                summary.active_cash_session_id
                  ? t('header.session.open')
                  : t('header.session.closed')
              }
              icon="◉"
              tone={summary.active_cash_session_id ? 'ok' : 'muted'}
            />
          </section>

          <section className="sk-dashboard__activity" aria-labelledby="dashboard-activity-title">
            <div className="sk-dashboard__section-heading">
              <div>
                <span className="sk-dashboard__eyebrow">{t('dashboard.processing')}</span>
                <h2 id="dashboard-activity-title">{t('dashboard.activity')}</h2>
              </div>
              <span className="sk-dashboard__section-icon" aria-hidden>↻</span>
            </div>
            <div className="sk-dashboard__activity-grid">
              <DashboardDetail
                label={t('dashboard.latestDocument')}
                value={summary.latest_document_number ?? t('common.none')}
                icon="▤"
              />
              <DashboardDetail
                label={t('dashboard.generationJobs')}
                value={String(summary.pending_generation_jobs)}
                icon="⚙"
                compact
              />
              <DashboardDetail
                label={t('dashboard.printJobs')}
                value={String(summary.pending_print_jobs)}
                icon="▧"
                compact
              />
              <DashboardDetail
                label={t('dashboard.pendingJobs')}
                value={String(summary.pending_generation_jobs + summary.pending_print_jobs)}
                icon="!"
                compact
                tone={
                  summary.pending_generation_jobs + summary.pending_print_jobs > 0
                    ? 'warning'
                    : 'ok'
                }
              />
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="sk-metric">
      <span className="sk-metric__icon" aria-hidden>{icon}</span>
      <span className="sk-metric__value">{value}</span>
      <span className="sk-metric__label">{label}</span>
    </div>
  );
}

function DashboardDetail({
  label,
  value,
  icon,
  compact = false,
  tone,
}: {
  label: string;
  value: string;
  icon: string;
  compact?: boolean;
  tone?: 'ok' | 'muted' | 'warning';
}) {
  return (
    <div className={`sk-dashboard-detail ${compact ? 'sk-dashboard-detail--compact' : ''}`}>
      <span className="sk-dashboard-detail__icon" aria-hidden>{icon}</span>
      <span className="sk-dashboard-detail__copy">
        <span>{label}</span>
        {tone ? (
          <strong className={`sk-badge sk-badge--${tone}`}>{value}</strong>
        ) : (
          <strong>{value}</strong>
        )}
      </span>
    </div>
  );
}
