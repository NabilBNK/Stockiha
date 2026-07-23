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
    <section className="sk-page">
      <div className="sk-toolbar">
        <h1>{t('dashboard.title')}</h1>
        <Button variant="secondary" onClick={() => void load()}>
          {t('jobs.refresh')}
        </Button>
      </div>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Banner tone="error">{error}</Banner>
      ) : summary ? (
        <div className="sk-cards" data-testid="dashboard">
          <Metric label={t('dashboard.products')} value={String(summary.product_count)} />
          <Metric label={t('dashboard.variants')} value={String(summary.variant_count)} />
          <Metric
            label={t('dashboard.warehouse')}
            value={selectedWarehouse ? `${selectedWarehouse.code} — ${selectedWarehouse.name}` : t('common.none')}
          />
          <Metric
            label={t('dashboard.session')}
            value={summary.active_cash_session_id ? t('header.session.open') : t('header.session.closed')}
          />
          <Metric
            label={t('dashboard.latestDocument')}
            value={summary.latest_document_number ?? t('common.none')}
          />
          <Metric
            label={t('dashboard.pendingJobs')}
            value={String(summary.pending_generation_jobs + summary.pending_print_jobs)}
          />
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="sk-metric">
      <span className="sk-metric__label">{label}</span>
      <span className="sk-metric__value">{value}</span>
    </div>
  );
}
