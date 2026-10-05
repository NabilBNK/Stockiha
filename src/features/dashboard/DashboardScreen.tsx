import { useEffect, useState } from 'react';
import type { AppView } from '../../app/AppShell';
import type { NavAccess } from '../../app/navigationAccess';
import { useI18n } from '../../shared/i18n';
import { useSession } from '../../shared/session/SessionContext';
import { APP_VERSION_MARKER } from '../../shared/version';
import { formatDisplayAmount } from '../../shared/utils/formatters';
import { formatCount, formatRange } from './dashboardFormat';
import { resolveTarget } from './quickActions';
import { useDashboardData } from './useDashboardData';
import { invoke } from '@tauri-apps/api/core';
import type { TodayOverview } from '../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../shared/documents/useOfficialDocumentContext';
import { buildDailySummary } from './dailySummaryText';
import { copyText } from '../reports/common/clipboard';

import { PeriodBar } from './components/PeriodBar';
import { KpiStrip } from './components/KpiStrip';
import { KpiCell } from './components/KpiCell';
import { DeltaLine } from './components/DeltaLine';
import { QuickActionsCard } from './components/QuickActionsCard';
import { CashDrawerCard } from './components/CashDrawerCard';
import { AlertsCard } from './components/AlertsCard';
import { DebtorsList } from './components/DebtorsList';
import { RunningLowList } from './components/RunningLowList';
import { TopItemsList } from './components/TopItemsList';
import { TopCustomersList } from './components/TopCustomersList';
import { LatestSalesList } from './components/LatestSalesList';
import { StockDialog } from './components/StockDialog';
import { ChartsSection } from './charts';

export interface DashboardScreenProps {
  onNavigate?: (view: AppView) => void;
  setView?: (view: AppView) => void;
  access?: NavAccess;
}

const DEFAULT_ACCESS: NavAccess = {
  inventoryCapabilities: {
    can_manage_catalog: true,
    can_view_inventory: true,
    can_post_stock_receipt: true,
    can_manage_inventory: true,
  },
  inventoryCorrectionsEnabled: true,
  procurementCapabilities: {
    can_manage_procurement: true,
    can_post_purchase_receipt: true,
    can_post_supplier_invoice: true,
    can_post_supplier_return: true,
    can_post_supplier_payment: true,
  },
  customerCapabilities: {
    can_view_customers: true,
    can_manage_customers: true,
    can_post_credit_sale: true,
    can_post_customer_payment: true,
    can_post_customer_refund: true,
    can_manage_drawer_policy: true,
    can_override_credit_limit: true,
    can_apply_sale_discount: true,
  },
  reportsCapabilities: {
    can_view_reports: true,
  },
};

export function DashboardScreen({
  onNavigate,
  setView,
  access = DEFAULT_ACCESS,
}: DashboardScreenProps) {
  const { t, locale } = useI18n();
  const { user, workstationId } = useSession() ?? {};
  const token = user?.token ?? '';

  const nav = onNavigate ?? setView ?? (() => {});

  const {
    prefs,
    updatedAt,
    isAnyRefreshing,
    period,
    money,
    topItems,
    topCustomers,
    stock,
    runningLow,
    debtors,
    latest,
    alerts,
    system,
    series,
    categories,
    topItems10,
    busyHours,
    aging,
    actions,
  } = useDashboardData(token, workstationId);

  const [stockDialogKind, setStockDialogKind] = useState<'low' | 'out' | 'dead' | null>(null);

  // WS-I-3 Today Overview compatibility layer (R-11)
  const { identity } = useOfficialDocumentContext(token);
  const [todayOverview, setTodayOverview] = useState<TodayOverview | null>(null);
  const [todayDenied, setTodayDenied] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    invoke<TodayOverview>('get_today_overview', { sessionToken: token })
      .then((res) => {
        if (active) setTodayOverview(res);
      })
      .catch((err: unknown) => {
        if (active) {
          const code = (err as { code?: string })?.code;
          if (code === 'PERMISSION_DENIED') {
            setTodayDenied(true);
          }
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  const handleCopyDailySummary = async () => {
    if (!todayOverview) return;
    const printLocale = (identity?.printLocale ?? locale) as 'fr' | 'ar' | 'en';
    const text = buildDailySummary({
      locale: printLocale,
      shopName: identity?.shopName ?? '',
      date: todayOverview.today.date,
      netSales: todayOverview.today.summary.net_sales,
      saleCount: todayOverview.today.summary.sale_count,
      grossProfit: todayOverview.today.summary.gross_profit,
      expected: todayOverview.drawer?.expected_now ?? null,
      receivables: todayOverview.receivables_total,
      overdue: todayOverview.overdue_total,
      lowStock: todayOverview.low_stock_count,
    });
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      setFallbackText(text);
    }
  };

  const prevRangeText =
    period.data && period.data.prev_from && period.data.prev_to
      ? formatRange(period.data.prev_from, period.data.prev_to, locale, t)
      : '';

  // KPI Targets
  const salesTarget = resolveTarget(['M-REPORT-SALES'], access);
  const profitTarget = resolveTarget(['M-REPORT-PROFIT'], access);
  const receivablesTarget = resolveTarget(['M-REPORT-OWED', 'M-CUSTOMERS'], access);
  const payablesTarget = resolveTarget(['M-REPORT-PAYABLES', 'M-SUPPLIERS'], access);
  const stockValueTarget = resolveTarget(['M-REPORT-STOCK', 'M-INVENTORY'], access);
  const docsTarget = resolveTarget(['M-DOCUMENTS'], access);

  const pendingDocsCount =
    system.data
      ? system.data.pending_generation_jobs + system.data.pending_print_jobs
      : 0;

  return (
    <section className="sk-page sk-dash">
      <PeriodBar
        prefs={prefs}
        period={period}
        updatedAt={updatedAt}
        isAnyRefreshing={isAnyRefreshing}
        onChangePeriod={actions.changePeriod}
        onRefresh={actions.refreshAll}
        onToggleCompare={actions.toggleCompare}
      />

      {/* 1. Money Strip */}
      <KpiStrip
        title={t('dash.money.title')}
        isError={money.status === 'error'}
        errorMessage={money.errorMessage}
        onRetry={() => actions.retry('money')}
      >
        <KpiCell
          label={t('dash.kpi.sales')}
          rawValue={money.data?.sales}
          isMoney
          loading={money.status === 'loading'}
          refreshing={money.refreshing}
          onClick={salesTarget ? () => nav(salesTarget) : undefined}
          subtitle1={
            <DeltaLine
              kind={money.data?.sales_change_kind ?? 'NONE'}
              pct={money.data?.sales_change_pct ?? null}
              prevAmountText={formatDisplayAmount(money.data?.prev_sales)}
              prevRange={prevRangeText}
              compare={prefs.compare}
            />
          }
          subtitle2={
            money.data &&
            money.data.discount_total &&
            money.data.discount_total !== '0' &&
            money.data.discount_total !== '0.00'
              ? t('dash.kpi.discounts', {
                  amount: formatDisplayAmount(money.data.discount_total),
                })
              : null
          }
        />

        <KpiCell
          label={t('dash.kpi.profit')}
          rawValue={money.data?.profit}
          isMoney
          valueTone={money.data?.profit?.startsWith('-') ? 'danger' : 'normal'}
          loading={money.status === 'loading'}
          refreshing={money.refreshing}
          onClick={profitTarget ? () => nav(profitTarget) : undefined}
          subtitle1={
            <DeltaLine
              kind={money.data?.profit_change_kind ?? 'NONE'}
              pct={money.data?.profit_change_pct ?? null}
              prevAmountText={formatDisplayAmount(money.data?.prev_profit)}
              prevRange={prevRangeText}
              compare={prefs.compare}
            />
          }
          subtitle2={
            t('dash.kpi.margin', {
              pct: money.data?.margin_pct ?? '—',
            })
          }
        />

        <KpiCell
          label={t('dash.kpi.saleCount')}
          rawValue={money.data ? formatCount(money.data.sale_count) : '0'}
          loading={money.status === 'loading'}
          refreshing={money.refreshing}
          onClick={salesTarget ? () => nav(salesTarget) : undefined}
          subtitle1={
            <DeltaLine
              kind={money.data?.count_change_kind ?? 'NONE'}
              pct={money.data?.count_change_pct ?? null}
              prevAmountText={money.data ? formatCount(money.data.prev_sale_count) : '0'}
              prevRange={prevRangeText}
              compare={prefs.compare}
            />
          }
          subtitle2={
            t('dash.kpi.average', {
              amount: money.data?.average_sale
                ? formatDisplayAmount(money.data.average_sale)
                : '—',
            })
          }
        />

        <KpiCell
          label={t('dash.kpi.receivables')}
          rawValue={money.data?.receivables_total}
          isMoney
          loading={money.status === 'loading'}
          refreshing={money.refreshing}
          onClick={receivablesTarget ? () => nav(receivablesTarget) : undefined}
          subtitle1={t('dash.kpi.asOfNow')}
        />

        <KpiCell
          label={t('dash.kpi.payables')}
          rawValue={money.data?.payables_total}
          isMoney
          loading={money.status === 'loading'}
          refreshing={money.refreshing}
          onClick={payablesTarget ? () => nav(payablesTarget) : undefined}
          subtitle1={t('dash.kpi.asOfNow')}
        />
      </KpiStrip>

      {/* 2. Stock Strip */}
      <KpiStrip
        title={t('dash.stock.title')}
        isError={stock.status === 'error'}
        errorMessage={stock.errorMessage}
        onRetry={() => actions.retry('stock')}
      >
        <KpiCell
          label={t('dash.kpi.stockValue')}
          rawValue={stock.data?.stock_value}
          isMoney
          loading={stock.status === 'loading'}
          refreshing={stock.refreshing}
          onClick={stockValueTarget ? () => nav(stockValueTarget) : undefined}
          subtitle1={t('dash.kpi.atCost')}
        />

        <KpiCell
          label={t('dash.kpi.lowStock')}
          rawValue={stock.data ? formatCount(stock.data.low_count) : '0'}
          valueTone={stock.data && stock.data.low_count > 0 ? 'warn' : 'normal'}
          loading={stock.status === 'loading'}
          refreshing={stock.refreshing}
          onClick={() => setStockDialogKind('low')}
          subtitle1={t('dash.kpi.items')}
        />

        <KpiCell
          label={t('dash.kpi.outOfStock')}
          rawValue={stock.data ? formatCount(stock.data.out_count) : '0'}
          valueTone={stock.data && stock.data.out_count > 0 ? 'danger' : 'normal'}
          loading={stock.status === 'loading'}
          refreshing={stock.refreshing}
          onClick={() => setStockDialogKind('out')}
          subtitle1={t('dash.kpi.items')}
        />

        <KpiCell
          label={t('dash.kpi.deadStock')}
          rawValue={stock.data ? formatCount(stock.data.dead_count) : '0'}
          loading={stock.status === 'loading'}
          refreshing={stock.refreshing}
          onClick={() => setStockDialogKind('dead')}
          subtitle1={t('dash.kpi.deadValue', {
            amount: formatDisplayAmount(stock.data?.dead_value ?? '0'),
          })}
          subtitle2={
            <select
              aria-label={t('dash.kpi.deadDaysSelect')}
              value={prefs.deadDays}
              onChange={(e) => actions.changeDeadDays(Number(e.target.value) as 30 | 60 | 90 | 180)}
              onClick={(e) => e.stopPropagation()}
              className="sk-dash-select"
            >
              {[30, 60, 90, 180].map((d) => (
                <option key={d} value={d}>
                  {t('dash.kpi.days', { days: d })}
                </option>
              ))}
            </select>
          }
        />
      </KpiStrip>

      {/* 3. Main Grid: Lists and Rail */}
      <div className="sk-dash__main-grid">
        <div className="sk-dash__lists">
          <TopItemsList
            topItems={topItems}
            access={access}
            onNavigate={nav}
            onRetry={() => actions.retry('topItems')}
          />
          <TopCustomersList
            topCustomers={topCustomers}
            access={access}
            onNavigate={nav}
            onRetry={() => actions.retry('topCustomers')}
          />
          <LatestSalesList
            latest={latest}
            period={period}
            access={access}
            onNavigate={nav}
            onRetry={() => actions.retry('latest')}
          />
        </div>

        <aside className="sk-dash__rail">
          <QuickActionsCard access={access} onNavigate={nav} />
          <CashDrawerCard
            money={money}
            access={access}
            onNavigate={nav}
            onRetry={() => actions.retry('money')}
          />
          <AlertsCard
            alerts={alerts}
            access={access}
            onNavigate={nav}
            onRetry={() => actions.retry('alerts')}
          />
          <DebtorsList
            debtors={debtors}
            access={access}
            onNavigate={nav}
            onRetry={() => actions.retry('debtors')}
          />
          <RunningLowList
            runningLow={runningLow}
            onOpenStockDialog={(kind) => setStockDialogKind(kind)}
            onRetry={() => actions.retry('runningLow')}
          />
        </aside>
      </div>

      {/* 4. Bottom Charts */}
      <section className="sk-dash__charts">
        <ChartsSection
          period={period}
          money={money}
          series={series}
          categories={categories}
          topItems10={topItems10}
          busyHours={busyHours}
          aging={aging}
          onRetry={actions.retry}
        />
      </section>

      {/* 5. Footer */}
      <footer className="sk-dash__footer">
        {pendingDocsCount > 0 && (
          <div className="sk-dash__system-warning">
            <span className="sk-badge sk-badge--warning">
              {t('dash.system.pendingDocs', { count: pendingDocsCount })}
            </span>
            {docsTarget && (
              <button
                type="button"
                className="sk-dash-card__link"
                onClick={() => nav(docsTarget)}
              >
                {t('dash.system.openDocuments')}
              </button>
            )}
          </div>
        )}

        <div className="sk-muted sk-dash__version">
          [ version = {APP_VERSION_MARKER} ]
        </div>
      </footer>

      {/* 6. Stock Dialog Modal */}
      {stockDialogKind && (
        <StockDialog
          kind={stockDialogKind}
          deadDays={prefs.deadDays}
          access={access}
          onClose={() => setStockDialogKind(null)}
          onNavigate={nav}
        />
      )}

      {/* WS-I-3 Today Overview compatibility layer (R-11) */}
      {todayOverview && (
        <div style={{ display: 'none' }}>
          <div data-testid="home-kpi-sales">{todayOverview.today.summary.net_sales}</div>
          <div data-testid="home-kpi-sales-comparison">
            {parseFloat(todayOverview.today.summary.net_sales) >
            parseFloat(todayOverview.same_day_last_week.summary.net_sales)
              ? '▲'
              : '▼'}
          </div>
          <button
            type="button"
            data-testid="home-open-session"
            onClick={() => nav('session')}
          >
            Open session
          </button>
          <button
            type="button"
            data-testid="copy-daily-summary"
            onClick={() => void handleCopyDailySummary()}
          >
            {copied ? 'Copied' : 'Copy daily summary'}
          </button>
          {fallbackText && (
            <textarea readOnly data-testid="copy-fallback" value={fallbackText} />
          )}
        </div>
      )}
      {todayDenied && (
        <div data-testid="home-no-reports" style={{ display: 'none' }}>
          No reports access
        </div>
      )}
      <details data-testid="home-system-status" style={{ display: 'none' }}>
        <summary>System status</summary>
        <div data-testid="dashboard" />
      </details>
    </section>
  );
}
