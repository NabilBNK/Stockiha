/**
 * WS-I-3 STEP I3-08 — the "Today" home page: today's KPIs, hourly sales,
 * top products, notifications, money owed/owing, low stock and a
 * month-to-date strip, with a WhatsApp-ready daily summary. The former
 * Slice-1 operational dashboard (product/variant counts, warehouse, cash
 * session, pending jobs) moves unchanged into a collapsible
 * `home-system-status` section — every one of its old test ids stays.
 */
import { useCallback, useEffect, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { APP_VERSION_MARKER } from '../../shared/version';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import type { DashboardSummary } from '../../shared/ipc/dto';
import type { AppView } from '../../app/AppShell';
import { useOfficialDocumentContext } from '../../shared/documents/useOfficialDocumentContext';
import { getTodayOverview } from '../../shared/ipc/reportsGateway';
import type { TodayOverview } from '../../shared/ipc/reportsDto';
import { NotificationPanel } from '../notifications/NotificationPanel';
import { KpiCard } from '../reports/common/KpiCard';
import { BarChart } from '../reports/common/charts/BarChart';
import { ReportTable } from '../reports/common/ReportTable';
import { REPORTS_LAST_TAB_STORAGE_KEY } from '../reports/ReportsScreen';
import { useReportCopy } from '../reports/common/reportCopy';
import { copyText } from '../reports/common/clipboard';
import { buildDailySummary } from './dailySummaryText';
import './dashboard.css';

export function DashboardScreen({ setView }: { setView: (v: AppView) => void }) {
  const { t, locale } = useI18n();
  const copy = useReportCopy();
  const { user, workstationId } = useSession();
  const { warehouses, selectedWarehouseId } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

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

  const [today, setToday] = useState<TodayOverview | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayDenied, setTodayDenied] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    if (!token) return;
    setTodayLoading(true);
    try {
      const result = await getTodayOverview(token);
      setToday(result);
      setTodayDenied(false);
    } catch {
      // Insufficient permission (VIEW_REPORTS) or any other failure: the
      // "no reports access" banner covers both, per STEP I3-08.
      setToday(null);
      setTodayDenied(true);
    } finally {
      setTodayLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadToday();
    const interval = window.setInterval(() => void loadToday(), 2 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [loadToday]);

  const selectedWarehouse = warehouses.find((w) => w.id === selectedWarehouseId);

  function greeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return copy.greetingMorning;
    if (hour < 18) return copy.greetingAfternoon;
    return copy.greetingEvening;
  }

  function navigateToSubReport(tab: string, sub: string) {
    try {
      window.sessionStorage.setItem(REPORTS_LAST_TAB_STORAGE_KEY, `${tab}/${sub}`);
    } catch {
      // Best effort only.
    }
    setView('reports');
  }

  async function handleCopyDailySummary() {
    if (!today) return;
    const printLocale = identity?.printLocale ?? locale;
    const text = buildDailySummary({
      locale: printLocale,
      shopName: identity?.shopName ?? '',
      date: today.today.date,
      netSales: today.today.summary.net_sales,
      saleCount: today.today.summary.sale_count,
      grossProfit: today.today.summary.gross_profit,
      expected: today.drawer?.expected_now ?? null,
      receivables: today.receivables_total,
      overdue: today.overdue_total,
      lowStock: today.low_stock_count,
    });
    const ok = await copyText(text);
    if (ok) {
      setFallbackText(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      setFallbackText(text);
    }
  }

  const hourlyPoints = (() => {
    if (!today) return [];
    const rows = today.hourly_today;
    const hasOutsideCore = rows.some(
      (r) => (r.hour < 7 || r.hour > 22) && Number(r.net_sales) > 0,
    );
    const filtered = hasOutsideCore ? rows : rows.filter((r) => r.hour >= 7 && r.hour <= 22);
    return filtered.map((r) => ({ label: String(r.hour), value: Number(r.net_sales) }));
  })();

  return (
    <section className="sk-page sk-dashboard sk-home">
      <p className="sk-muted sk-home__version">[ version = {APP_VERSION_MARKER} ]</p>

      <div className="sk-section-heading">
        <div>
          {/* Kept as the page's h1 with the same accessible name every other
              screen's post-login assertion relies on ("Dashboard" heading);
              the greeting itself is a secondary line, not a heading. */}
          <h1>{t('dashboard.title')}</h1>
          <p data-testid="home-greeting">{greeting()}</p>
        </div>
      </div>

      {todayLoading ? (
        <div className="sk-centered">
          <Spinner />
        </div>
      ) : todayDenied || !today ? (
        <Banner tone="info" testId="home-no-reports">
          {copy.homeNoReports}
        </Banner>
      ) : (
        <>
          <div className="sk-kpi-grid">
            <KpiCard
              label={copy.kpiSales}
              value={today.today.summary.net_sales}
              previous={today.same_day_last_week.summary.net_sales}
              testId="home-kpi-sales"
            />
            <KpiCard
              label={copy.kpiProfit}
              value={today.today.summary.gross_profit}
              previous={today.same_day_last_week.summary.gross_profit}
              testId="home-kpi-profit"
            />
            <KpiCard
              label={copy.kpiCount}
              value={String(today.today.summary.sale_count)}
              previous={String(today.same_day_last_week.summary.sale_count)}
              testId="home-kpi-count"
            />
            <KpiCard
              label={copy.kpiBasket}
              value={today.today.summary.avg_basket ?? '—'}
              previous={today.same_day_last_week.summary.avg_basket}
              testId="home-kpi-basket"
            />
            <div className="sk-kpi-card" data-testid="home-kpi-drawer">
              <div className="sk-kpi-card__title">{copy.kpiDrawer}</div>
              {today.drawer ? (
                <div className="sk-kpi-card__value">{today.drawer.expected_now}</div>
              ) : (
                <>
                  <div className="sk-kpi-card__value">{copy.noSessionOpen}</div>
                  <button
                    type="button"
                    className="sk-btn sk-btn--secondary"
                    data-testid="home-open-session"
                    onClick={() => setView('session')}
                  >
                    {copy.openSession}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="sk-home__columns">
            <div className="sk-home__column">
              <BarChart
                points={hourlyPoints}
                formatValue={(n) => String(n)}
                testId="home-chart-hourly"
                title={copy.hourlySalesToday}
              />
              <div className="sk-chart-card" data-testid="home-top-products">
                <div className="sk-chart-card__header">
                  <h3 className="sk-chart-card__title">{copy.topProductsToday}</h3>
                </div>
                <ReportTable
                  testId="home-top-products-table"
                  columns={[
                    { key: 'product_name', label: copy.salesByProduct, align: 'start' },
                    { key: 'net_revenue', label: copy.netSales, align: 'end' },
                  ]}
                  rows={today.top_products_today}
                />
              </div>
            </div>

            <div className="sk-home__column">
              <div className="sk-chart-card" data-testid="home-notifications">
                <div className="sk-chart-card__header">
                  <h3 className="sk-chart-card__title">{copy.notifications}</h3>
                </div>
                <NotificationPanel setView={setView} onClose={() => {}} />
              </div>

              <div className="sk-chart-card" data-testid="home-receivables">
                <div className="sk-chart-card__header">
                  <h3 className="sk-chart-card__title">{copy.owedToYouHome}</h3>
                </div>
                <p>
                  {copy.receivables}: {today.receivables_total} · {copy.daysOverdue}: {today.overdue_total}
                </p>
                <Button variant="secondary" onClick={() => navigateToSubReport('owed', 'receivables')}>
                  {copy.notifGoTo}
                </Button>
              </div>

              <div className="sk-chart-card" data-testid="home-payables">
                <div className="sk-chart-card__header">
                  <h3 className="sk-chart-card__title">{copy.youOweHome}</h3>
                </div>
                <p>{today.payables_total}</p>
                <Button variant="secondary" onClick={() => navigateToSubReport('owed', 'suppliers')}>
                  {copy.notifGoTo}
                </Button>
              </div>

              <div className="sk-chart-card" data-testid="home-low-stock">
                <div className="sk-chart-card__header">
                  <h3 className="sk-chart-card__title">{copy.lowStockHome}</h3>
                </div>
                <p>
                  {copy.lowStock}: {today.low_stock_count} · {copy.notifOutOfStockTitle}: {today.out_of_stock_count}
                </p>
                <Button variant="secondary" onClick={() => navigateToSubReport('stock', 'low-stock')}>
                  {copy.notifGoTo}
                </Button>
              </div>
            </div>
          </div>

          <div className="sk-chart-card" data-testid="home-mtd">
            <div className="sk-chart-card__header">
              <h3 className="sk-chart-card__title">{copy.monthToDate}</h3>
            </div>
            <p>
              {copy.netSales}: {today.month_to_date.net_sales} · {copy.grossProfit}: {today.month_to_date.gross_profit}
            </p>
          </div>

          <Button
            type="button"
            variant="secondary"
            data-testid="copy-daily-summary"
            onClick={() => void handleCopyDailySummary()}
          >
            {copied ? copy.copied : copy.copyDailySummary}
          </Button>
          {fallbackText ? <textarea readOnly data-testid="copy-fallback" value={fallbackText} /> : null}
        </>
      )}

      <details data-testid="home-system-status">
        <summary>{copy.systemStatus}</summary>
        <section className="sk-dashboard">
          <div className="sk-dashboard__header">
            <div>
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
      </details>
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
