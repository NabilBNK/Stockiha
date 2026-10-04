import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '../../shared/i18n';
import { paperbookGetAnalyticsReport } from '../../shared/ipc/gateway';
import type {
  PaperBookAnalyticsPayloadDto,
  PaperBookMonthlyPointDto,
  PaperBookTopProductDto,
  PaperBookExpenseCategoryDto,
  PaperBookTopBrandDto,
} from '../../shared/ipc/dto';
import { formatDisplayAmount } from '../../shared/utils/formatters';

interface Props {
  sessionToken: string;
}

type PeriodPreset = 'all' | '2025' | '2026' | 'custom';
type ProductRankMode = 'revenue' | 'qty' | 'txns';

export const AnalyticsTab: React.FC<Props> = ({ sessionToken }) => {
  const { t, locale } = useTranslation();

  const [preset, setPreset] = useState<PeriodPreset>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaperBookAnalyticsPayloadDto | null>(null);

  // Active chart metric view for monthly timeline
  const [chartMetric, setChartMetric] = useState<'all' | 'sales' | 'profit' | 'expenses'>('all');

  // Active mode for Top Products diagram (revenue vs quantity)
  const [productRankMode, setProductRankMode] = useState<ProductRankMode>('revenue');

  const fetchReport = useCallback(
    async (from?: string, to?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await paperbookGetAnalyticsReport(sessionToken, from || undefined, to || undefined);
        setData(res);
      } catch (err) {
        console.error('Failed to load paper book analytics:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [sessionToken],
  );

  useEffect(() => {
    let f = '';
    let to = '';
    if (preset === '2025') {
      f = '2025-01-01';
      to = '2025-12-31';
    } else if (preset === '2026') {
      f = '2026-01-01';
      to = '2026-12-31';
    } else if (preset === 'custom') {
      f = fromDate;
      to = toDate;
    }
    fetchReport(f, to);
  }, [preset, fromDate, toDate, fetchReport]);

  const handlePresetChange = (p: PeriodPreset) => {
    setPreset(p);
    if (p === '2025') {
      setFromDate('2025-01-01');
      setToDate('2025-12-31');
    } else if (p === '2026') {
      setFromDate('2026-01-01');
      setToDate('2026-12-31');
    } else if (p === 'all') {
      setFromDate('');
      setToDate('');
    }
  };

  // CSV Export utility
  const handleExportCsv = () => {
    if (!data) return;

    const summary = data.summary;
    const lines: string[] = [];

    // Title & Metadata
    lines.push(`"STOCKIHA HISTORICAL PAPER BOOK ANALYTICS REPORT"`);
    lines.push(`"Generated At:","${new Date().toISOString()}"`);
    lines.push(`"Period:","${fromDate || 'Earliest'} to ${toDate || 'Latest'}"`);
    lines.push('');

    // Summary Section
    lines.push(`"--- FINANCIAL SUMMARY ---"`);
    lines.push(`"Metric","Amount (DZD)","Transactions"`);
    lines.push(`"Total Revenue (Sales)","${summary?.sell_total ?? '0'}","${summary?.sell_count ?? 0}"`);
    lines.push(`"Gross Benefit","${summary?.benefit_total ?? '0'}","-"`);
    lines.push(`"Margin Rate","${summary?.margin_rate ?? '0'}%","-"`);
    lines.push(`"Total Operating Expenses","${summary?.expense_total ?? '0'}","${summary?.expense_count ?? 0}"`);
    lines.push(`"Net Profit (Benefit - Expenses)","${summary?.net_profit ?? '0'}","-"`);
    lines.push(`"Total Purchases","${summary?.buy_total ?? '0'}","${summary?.buy_count ?? 0}"`);
    lines.push(`"Unpaid Customer Credits (Owed to Shop)","${summary?.unpaid_sell_total ?? '0'}","-"`);
    lines.push(`"Unpaid Supplier Debts (Owed by Shop)","${summary?.unpaid_buy_total ?? '0'}","-"`);
    lines.push('');

    // Monthly Data
    lines.push(`"--- MONTHLY TIMELINE ---"`);
    lines.push(`"Month","Sales (DZD)","Gross Benefit (DZD)","Expenses (DZD)","Net Profit (DZD)","Purchases (DZD)","Unpaid Sales"`);
    (data.monthly ?? []).forEach((m) => {
      lines.push(
        `"${m.year_month}","${m.sell_total}","${m.benefit_total}","${m.expense_total}","${m.net_profit}","${m.buy_total}","${m.unpaid_sell_total}"`,
      );
    });
    lines.push('');

    // Top Products
    lines.push(`"--- TOP 10 BEST SELLERS ---"`);
    lines.push(`"Product","Total Quantity","Total Revenue (DZD)","Avg Price (DZD)","Transactions"`);
    (data.top_products ?? []).forEach((p) => {
      lines.push(
        `"${(p.product_label ?? '').replace(/"/g, '""')}","${p.total_qty}","${p.total_revenue}","${p.avg_price}","${p.txn_count}"`,
      );
    });
    lines.push('');

    // Top Customers
    lines.push(`"--- TOP CUSTOMERS ---"`);
    lines.push(`"Customer","Total Volume (DZD)","Unpaid Credit (DZD)","Transactions"`);
    (data.top_customers ?? []).forEach((c) => {
      lines.push(`"${(c.party_label ?? '').replace(/"/g, '""')}","${c.total_amount}","${c.unpaid_amount}","${c.txn_count}"`);
    });
    lines.push('');

    // Top Suppliers
    lines.push(`"--- TOP SUPPLIERS ---"`);
    lines.push(`"Supplier","Total Volume (DZD)","Unpaid Debt (DZD)","Transactions"`);
    (data.top_suppliers ?? []).forEach((s) => {
      lines.push(`"${(s.party_label ?? '').replace(/"/g, '""')}","${s.total_amount}","${s.unpaid_amount}","${s.txn_count}"`);
    });
    lines.push('');

    // Top Brands
    lines.push(`"--- TOP BRANDS ---"`);
    lines.push(`"Brand","Total Quantity","Total Revenue (DZD)"`);
    (data.top_brands ?? []).forEach((b) => {
      lines.push(`"${(b.brand_label ?? '').replace(/"/g, '""')}","${b.total_qty}","${b.total_revenue}"`);
    });
    lines.push('');

    // Expense Breakdown
    lines.push(`"--- OPERATING EXPENSES BREAKDOWN ---"`);
    lines.push(`"Category","Total Amount (DZD)","Transactions","Percent"`);
    (data.expenses ?? []).forEach((e) => {
      lines.push(`"${(e.category_label ?? '').replace(/"/g, '""')}","${e.total_amount}","${e.txn_count}","${e.percent_of_total}%"`);
    });

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `paperbook-analytics-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const summary = data?.summary;
  const isNetProfitPositive = summary ? !summary.net_profit.startsWith('-') : false;

  const topProducts = data?.top_products ?? [];
  const topCustomers = data?.top_customers ?? [];
  const topSuppliers = data?.top_suppliers ?? [];
  const topBrands = data?.top_brands ?? [];
  const expensesList = data?.expenses ?? [];
  const monthlyList = data?.monthly ?? [];

  return (
    <div className="sk-paperbook-analytics">
      {/* Controls Bar: Presets, Date inputs, CSV Export, Print */}
      <div className="sk-pb-analytics-controls">
        <div className="sk-pb-analytics-presets">
          <button
            type="button"
            className={`sk-pb-preset-btn ${preset === 'all' ? 'sk-pb-preset-btn--active' : ''}`}
            onClick={() => handlePresetChange('all')}
          >
            {t('paperbook.analytics.preset.all')}
          </button>
          <button
            type="button"
            className={`sk-pb-preset-btn ${preset === '2025' ? 'sk-pb-preset-btn--active' : ''}`}
            onClick={() => handlePresetChange('2025')}
          >
            2025
          </button>
          <button
            type="button"
            className={`sk-pb-preset-btn ${preset === '2026' ? 'sk-pb-preset-btn--active' : ''}`}
            onClick={() => handlePresetChange('2026')}
          >
            2026
          </button>
          <button
            type="button"
            className={`sk-pb-preset-btn ${preset === 'custom' ? 'sk-pb-preset-btn--active' : ''}`}
            onClick={() => handlePresetChange('custom')}
          >
            {t('paperbook.analytics.preset.custom')}
          </button>
        </div>

        {preset === 'custom' && (
          <div className="sk-pb-analytics-dates">
            <label>
              <span>{t('paperbook.records.from')}:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="sk-paperbook-input"
              />
            </label>
            <label>
              <span>{t('paperbook.records.to')}:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="sk-paperbook-input"
              />
            </label>
          </div>
        )}

        <div className="sk-pb-analytics-actions">
          <button
            type="button"
            className="sk-paperbook-btn sk-paperbook-btn--outline"
            onClick={() => fetchReport(fromDate, toDate)}
            disabled={loading}
          >
            🔄 {t('paperbook.analytics.refresh')}
          </button>
          <button
            type="button"
            className="sk-paperbook-btn sk-paperbook-btn--outline"
            onClick={handleExportCsv}
            disabled={loading || !data}
          >
            📥 {t('paperbook.analytics.export_csv')}
          </button>
          <button
            type="button"
            className="sk-paperbook-btn sk-paperbook-btn--outline"
            onClick={handlePrint}
            disabled={loading || !data}
          >
            🖨️ {t('paperbook.analytics.print')}
          </button>
        </div>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div className="sk-paperbook-loading">
          <div className="sk-paperbook-spinner" />
          <p>{t('common.loading')}</p>
        </div>
      )}

      {error && (
        <div className="sk-paperbook-error-banner">
          ⚠️ <span>{error}</span>
        </div>
      )}

      {!loading && data && (
        <>
          {/* KPI Headline Cards Grid */}
          <div className="sk-pb-kpi-grid">
            {/* Total Revenue */}
            <div className="sk-pb-kpi-card sk-pb-kpi-card--primary">
              <div className="sk-pb-kpi-card__header">
                <span className="sk-pb-kpi-card__icon">💰</span>
                <span className="sk-pb-kpi-card__label">{t('paperbook.analytics.kpi.revenue')}</span>
              </div>
              <div className="sk-pb-kpi-card__value">{formatDisplayAmount(summary?.sell_total)}</div>
              <div className="sk-pb-kpi-card__meta">
                {summary?.sell_count} {t('paperbook.import.summary.sells').toLowerCase()}
              </div>
            </div>

            {/* Gross Benefit & Margin */}
            <div className="sk-pb-kpi-card sk-pb-kpi-card--success">
              <div className="sk-pb-kpi-card__header">
                <span className="sk-pb-kpi-card__icon">📈</span>
                <span className="sk-pb-kpi-card__label">{t('paperbook.analytics.kpi.gross_benefit')}</span>
              </div>
              <div className="sk-pb-kpi-card__value">{formatDisplayAmount(summary?.benefit_total)}</div>
              <div className="sk-pb-kpi-card__meta">
                <span className="sk-pb-badge sk-pb-badge--success">
                  {summary?.margin_rate}% {t('paperbook.analytics.kpi.margin')}
                </span>
              </div>
            </div>

            {/* Total Operating Expenses */}
            <div className="sk-pb-kpi-card sk-pb-kpi-card--danger">
              <div className="sk-pb-kpi-card__header">
                <span className="sk-pb-kpi-card__icon">💸</span>
                <span className="sk-pb-kpi-card__label">{t('paperbook.analytics.kpi.expenses')}</span>
              </div>
              <div className="sk-pb-kpi-card__value">{formatDisplayAmount(summary?.expense_total)}</div>
              <div className="sk-pb-kpi-card__meta">
                {summary?.expense_count} {t('paperbook.import.summary.expenses').toLowerCase()}
              </div>
            </div>

            {/* Net Profit */}
            <div
              className={`sk-pb-kpi-card ${isNetProfitPositive ? 'sk-pb-kpi-card--emerald' : 'sk-pb-kpi-card--coral'}`}
            >
              <div className="sk-pb-kpi-card__header">
                <span className="sk-pb-kpi-card__icon">⚖️</span>
                <span className="sk-pb-kpi-card__label">{t('paperbook.analytics.kpi.net_profit')}</span>
              </div>
              <div
                className={`sk-pb-kpi-card__value ${isNetProfitPositive ? 'sk-pb-val-positive' : 'sk-pb-val-negative'}`}
              >
                {formatDisplayAmount(summary?.net_profit)}
              </div>
              <div className="sk-pb-kpi-card__meta">
                <small>{t('paperbook.analytics.kpi.net_profit_desc')}</small>
              </div>
            </div>

            {/* Total Purchases */}
            <div className="sk-pb-kpi-card">
              <div className="sk-pb-kpi-card__header">
                <span className="sk-pb-kpi-card__icon">📦</span>
                <span className="sk-pb-kpi-card__label">{t('paperbook.analytics.kpi.purchases')}</span>
              </div>
              <div className="sk-pb-kpi-card__value">{formatDisplayAmount(summary?.buy_total)}</div>
              <div className="sk-pb-kpi-card__meta">
                {summary?.buy_count} {t('paperbook.import.summary.buys').toLowerCase()}
              </div>
            </div>

            {/* Unpaid Customer Credits */}
            <div className="sk-pb-kpi-card sk-pb-kpi-card--warning">
              <div className="sk-pb-kpi-card__header">
                <span className="sk-pb-kpi-card__icon">⏳</span>
                <span className="sk-pb-kpi-card__label">{t('paperbook.analytics.kpi.unpaid_sales')}</span>
              </div>
              <div className="sk-pb-kpi-card__value">{formatDisplayAmount(summary?.unpaid_sell_total)}</div>
              <div className="sk-pb-kpi-card__meta">
                <span className="sk-pb-badge sk-pb-badge--warning">{t('paperbook.analytics.owed_by_clients')}</span>
              </div>
            </div>

            {/* Unpaid Supplier Debts */}
            <div className="sk-pb-kpi-card sk-pb-kpi-card--warning">
              <div className="sk-pb-kpi-card__header">
                <span className="sk-pb-kpi-card__icon">🏢</span>
                <span className="sk-pb-kpi-card__label">{t('paperbook.analytics.kpi.unpaid_purchases')}</span>
              </div>
              <div className="sk-pb-kpi-card__value">{formatDisplayAmount(summary?.unpaid_buy_total)}</div>
              <div className="sk-pb-kpi-card__meta">
                <span className="sk-pb-badge sk-pb-badge--warning">{t('paperbook.analytics.owed_to_suppliers')}</span>
              </div>
            </div>
          </div>

          {/* ================================================================
              FOCUS SECTION: Best Selling Products Analysis & Visual Charts
             ================================================================ */}
          <div className="sk-pb-section-card">
            <div className="sk-pb-section-card__header">
              <div>
                <h3>🏆 {t('paperbook.analytics.products_chart_title')}</h3>
                <p>Visual breakdown of top-performing items and catalog revenue concentration</p>
              </div>

              {/* Mode Toggle: Revenue vs Quantity vs Txns */}
              <div className="sk-pb-chart-tabs">
                <button
                  type="button"
                  className={`sk-pb-chart-tab ${productRankMode === 'revenue' ? 'sk-pb-chart-tab--active' : ''}`}
                  onClick={() => setProductRankMode('revenue')}
                >
                  💵 {t('paperbook.analytics.products_by_revenue')}
                </button>
                <button
                  type="button"
                  className={`sk-pb-chart-tab ${productRankMode === 'qty' ? 'sk-pb-chart-tab--active' : ''}`}
                  onClick={() => setProductRankMode('qty')}
                >
                  📦 {t('paperbook.analytics.products_by_qty')}
                </button>
                <button
                  type="button"
                  className={`sk-pb-chart-tab ${productRankMode === 'txns' ? 'sk-pb-chart-tab--active' : ''}`}
                  onClick={() => setProductRankMode('txns')}
                >
                  🛒 {t('paperbook.analytics.products_by_txns')}
                </button>
              </div>
            </div>

            {/* Top 3 Best Sellers Champions Podium */}
            <BestSellersPodium
              products={topProducts}
              totalRevenue={summary?.sell_total ?? '0'}
              unitsLabel={t('paperbook.analytics.units')}
            />

            {/* Sales Concentration & Pareto 80/20 Bar */}
            <ParetoConcentrationBar
              products={topProducts}
              totalRevenue={summary?.sell_total ?? '0'}
            />

            {/* Dual Chart Grid: Left = Horizontal Bar Diagram, Right = Donut Share Diagram */}
            <div className="sk-pb-product-charts-grid">
              {/* Left Column: Horizontal Bar Diagram */}
              <ProductBarDiagram
                products={topProducts}
                mode={productRankMode}
                avgPriceLabel={t('paperbook.analytics.avg_price')}
                txnsLabel={t('paperbook.analytics.th.txns')}
                unitsLabel={t('paperbook.analytics.units')}
              />

              {/* Right Column: Donut Concentration Diagram */}
              <div className="sk-pb-donut-container">
                <h4 style={{ margin: '0', fontSize: '0.9rem', fontWeight: 700, color: 'var(--sk-text)' }}>
                  🍩 {t('paperbook.analytics.revenue_share')}
                </h4>
                <ProductsDonutDiagram
                  products={topProducts}
                  totalRevenue={summary?.sell_total ?? '0'}
                  otherLabel={t('paperbook.analytics.other_products')}
                />
              </div>
            </div>
          </div>

          {/* Monthly Performance SVG Chart */}
          <div className="sk-pb-section-card">
            <div className="sk-pb-section-card__header">
              <div>
                <h3>{t('paperbook.analytics.chart.monthly_title')}</h3>
                <p>{t('paperbook.analytics.chart.monthly_desc')}</p>
              </div>

              {/* Metric filter tabs */}
              <div className="sk-pb-chart-tabs">
                <button
                  type="button"
                  className={`sk-pb-chart-tab ${chartMetric === 'all' ? 'sk-pb-chart-tab--active' : ''}`}
                  onClick={() => setChartMetric('all')}
                >
                  {t('paperbook.analytics.chart.view_all')}
                </button>
                <button
                  type="button"
                  className={`sk-pb-chart-tab ${chartMetric === 'sales' ? 'sk-pb-chart-tab--active' : ''}`}
                  onClick={() => setChartMetric('sales')}
                >
                  {t('paperbook.analytics.kpi.revenue')}
                </button>
                <button
                  type="button"
                  className={`sk-pb-chart-tab ${chartMetric === 'profit' ? 'sk-pb-chart-tab--active' : ''}`}
                  onClick={() => setChartMetric('profit')}
                >
                  {t('paperbook.analytics.kpi.net_profit')}
                </button>
                <button
                  type="button"
                  className={`sk-pb-chart-tab ${chartMetric === 'expenses' ? 'sk-pb-chart-tab--active' : ''}`}
                  onClick={() => setChartMetric('expenses')}
                >
                  {t('paperbook.analytics.kpi.expenses')}
                </button>
              </div>
            </div>

            <MonthlyBarChart monthly={monthlyList} metric={chartMetric} locale={locale} />
          </div>

          {/* Columns Grid: Top Customers & Top Suppliers */}
          <div className="sk-pb-columns-grid">
            {/* Top Customers (Volume & Debt) */}
            <div className="sk-pb-section-card">
              <div className="sk-pb-section-card__header">
                <h3>👥 {t('paperbook.analytics.top_customers')}</h3>
              </div>
              <div className="sk-pb-table-wrapper">
                <table className="sk-paperbook-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('paperbook.records.col_party')}</th>
                      <th style={{ textAlign: 'right' }}>{t('paperbook.records.col_total')}</th>
                      <th style={{ textAlign: 'right' }}>{t('paperbook.analytics.th.unpaid')}</th>
                      <th style={{ textAlign: 'right' }}>{t('paperbook.analytics.th.txns')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="sk-paperbook-empty">
                          {t('paperbook.records.no_records')}
                        </td>
                      </tr>
                    ) : (
                      topCustomers.map((c, idx) => (
                        <tr key={c.party_label}>
                          <td>
                            <span className={`sk-pb-rank-badge ${idx < 3 ? 'sk-pb-rank-badge--top' : ''}`}>
                              {idx + 1}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{c.party_label}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {formatDisplayAmount(c.total_amount)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {c.unpaid_amount !== '0' && c.unpaid_amount !== '0.00' ? (
                              <span className="sk-pb-badge sk-pb-badge--warning">
                                {formatDisplayAmount(c.unpaid_amount)}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--sk-muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--sk-muted)' }}>{c.txn_count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top Suppliers */}
            <div className="sk-pb-section-card">
              <div className="sk-pb-section-card__header">
                <h3>🚚 {t('paperbook.analytics.top_suppliers')}</h3>
              </div>
              <div className="sk-pb-table-wrapper">
                <table className="sk-paperbook-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('paperbook.records.col_party')}</th>
                      <th style={{ textAlign: 'right' }}>{t('paperbook.records.col_total')}</th>
                      <th style={{ textAlign: 'right' }}>{t('paperbook.analytics.th.unpaid')}</th>
                      <th style={{ textAlign: 'right' }}>{t('paperbook.analytics.th.txns')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSuppliers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="sk-paperbook-empty">
                          {t('paperbook.records.no_records')}
                        </td>
                      </tr>
                    ) : (
                      topSuppliers.map((s, idx) => (
                        <tr key={s.party_label}>
                          <td>
                            <span className={`sk-pb-rank-badge ${idx < 3 ? 'sk-pb-rank-badge--top' : ''}`}>
                              {idx + 1}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{s.party_label}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {formatDisplayAmount(s.total_amount)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {s.unpaid_amount !== '0' && s.unpaid_amount !== '0.00' ? (
                              <span className="sk-pb-badge sk-pb-badge--warning">
                                {formatDisplayAmount(s.unpaid_amount)}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--sk-muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--sk-muted)' }}>{s.txn_count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Secondary Columns Grid: Expense Distribution Diagram & Top Brands */}
          <div className="sk-pb-columns-grid">
            {/* Operating Expense Breakdown Diagram & Table */}
            <div className="sk-pb-section-card">
              <div className="sk-pb-section-card__header">
                <h3>📑 {t('paperbook.analytics.expense_breakdown')}</h3>
              </div>

              {/* Visual Bars for Expenses */}
              {expensesList.length > 0 && <ExpenseDistributionDiagram expenses={expensesList} />}

              <div className="sk-pb-table-wrapper" style={{ marginTop: '10px' }}>
                <table className="sk-paperbook-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('paperbook.records.col_what')}</th>
                      <th style={{ textAlign: 'right' }}>{t('paperbook.records.col_total')}</th>
                      <th style={{ textAlign: 'right' }}>{t('paperbook.analytics.th.txns')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expensesList.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="sk-paperbook-empty">
                          {t('paperbook.records.no_records')}
                        </td>
                      </tr>
                    ) : (
                      expensesList.map((e, idx) => (
                        <tr key={e.category_label}>
                          <td>
                            <span className="sk-pb-rank-badge">{idx + 1}</span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{e.category_label}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--sk-danger)' }}>
                            {formatDisplayAmount(e.total_amount)}
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--sk-muted)' }}>{e.txn_count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top Brands Grid */}
            <div className="sk-pb-section-card">
              <div className="sk-pb-section-card__header">
                <h3>🏷️ {t('paperbook.analytics.top_brands')}</h3>
              </div>

              {/* Visual Brand Market Share Bar Diagram */}
              {topBrands.length > 0 && <BrandBarDiagram brands={topBrands} />}

              <div className="sk-pb-table-wrapper">
                <table className="sk-paperbook-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('paperbook.detail.col_brand')}</th>
                      <th style={{ textAlign: 'right' }}>{t('paperbook.detail.col_qty')}</th>
                      <th style={{ textAlign: 'right' }}>{t('paperbook.records.col_total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topBrands.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="sk-paperbook-empty">
                          {t('paperbook.records.no_records')}
                        </td>
                      </tr>
                    ) : (
                      topBrands.map((b, idx) => (
                        <tr key={b.brand_label}>
                          <td>
                            <span className={`sk-pb-rank-badge ${idx < 3 ? 'sk-pb-rank-badge--top' : ''}`}>
                              {idx + 1}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{b.brand_label}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{b.total_qty}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {formatDisplayAmount(b.total_revenue)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/* ==========================================================================
   Best Sellers Podium (Top 3 Champions)
   ========================================================================== */

interface PodiumProps {
  products: PaperBookTopProductDto[];
  totalRevenue: string;
  unitsLabel: string;
}

const BestSellersPodium: React.FC<PodiumProps> = ({ products, totalRevenue, unitsLabel }) => {
  const totalRevNum = parseFloat(totalRevenue) || 0;
  const top3 = [...products]
    .sort((a, b) => (parseFloat(b.total_revenue) || 0) - (parseFloat(a.total_revenue) || 0))
    .slice(0, 3);

  if (top3.length === 0) return null;

  const podiumRanks = [
    { label: '#1 Champion', icon: '👑', classModifier: 'gold', badgeClass: 'gold' },
    { label: '#2 Runner-up', icon: '🥈', classModifier: 'silver', badgeClass: 'silver' },
    { label: '#3 Third Place', icon: '🥉', classModifier: 'bronze', badgeClass: 'bronze' },
  ];

  return (
    <div className="sk-pb-podium-grid">
      {top3.map((p, idx) => {
        const meta = podiumRanks[idx] ?? podiumRanks[2];
        const revNum = parseFloat(p.total_revenue) || 0;
        const sharePct = totalRevNum > 0 ? ((revNum / totalRevNum) * 100).toFixed(1) : '0';
        const vel = (parseFloat(p.total_qty) / Math.max(1, p.txn_count)).toFixed(1);

        return (
          <div key={p.product_label} className={`sk-pb-podium-card sk-pb-podium-card--${meta.classModifier}`}>
            <div className={`sk-pb-podium-badge sk-pb-podium-badge--${meta.badgeClass}`}>
              <span>{meta.icon}</span>
              <span>{meta.label}</span>
              <span className="sk-pb-badge sk-pb-badge--success" style={{ marginInlineStart: 'auto' }}>
                {sharePct}% CA
              </span>
            </div>

            <div className="sk-pb-podium-title" title={p.product_label}>
              {p.product_label}
            </div>

            <div className="sk-pb-podium-val">
              {formatDisplayAmount(p.total_revenue)}
            </div>

            <div className="sk-pb-podium-stats">
              <span className="sk-pb-mini-pill">📦 {p.total_qty} {unitsLabel}</span>
              <span className="sk-pb-mini-pill">🏷️ {formatDisplayAmount(p.avg_price)}</span>
              <span className="sk-pb-mini-pill">⚡ {vel} {unitsLabel}/cmd</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ==========================================================================
   Sales Concentration & Pareto 80/20 Meter
   ========================================================================== */

interface ParetoProps {
  products: PaperBookTopProductDto[];
  totalRevenue: string;
}

const PARETO_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#94a3b8'];

const ParetoConcentrationBar: React.FC<ParetoProps> = ({ products, totalRevenue }) => {
  const totalRevNum = parseFloat(totalRevenue) || 0;
  if (totalRevNum <= 0 || !products || products.length === 0) return null;

  const sorted = [...products].sort((a, b) => (parseFloat(b.total_revenue) || 0) - (parseFloat(a.total_revenue) || 0));
  const top3 = sorted.slice(0, 3);
  let top3Sum = 0;
  let top3Txns = 0;
  top3.forEach((p) => {
    top3Sum += parseFloat(p.total_revenue) || 0;
    top3Txns += p.txn_count;
  });

  const top3Pct = ((top3Sum / totalRevNum) * 100).toFixed(1);

  const p1Rev = parseFloat(sorted[0]?.total_revenue || '0') || 0;
  const p2Rev = parseFloat(sorted[1]?.total_revenue || '0') || 0;
  const p3Rev = parseFloat(sorted[2]?.total_revenue || '0') || 0;
  const p4p5Rev = sorted.slice(3, 5).reduce((acc, p) => acc + (parseFloat(p.total_revenue) || 0), 0);
  const otherRev = Math.max(0, totalRevNum - (p1Rev + p2Rev + p3Rev + p4p5Rev));

  const segments = [
    { label: sorted[0]?.product_label ?? '#1', pct: (p1Rev / totalRevNum) * 100, color: PARETO_COLORS[0] },
    { label: sorted[1]?.product_label ?? '#2', pct: (p2Rev / totalRevNum) * 100, color: PARETO_COLORS[1] },
    { label: sorted[2]?.product_label ?? '#3', pct: (p3Rev / totalRevNum) * 100, color: PARETO_COLORS[2] },
    { label: 'Top 4-5', pct: (p4p5Rev / totalRevNum) * 100, color: PARETO_COLORS[3] },
    { label: 'Catalog', pct: (otherRev / totalRevNum) * 100, color: PARETO_COLORS[4] },
  ].filter((s) => s.pct > 0.1);

  return (
    <div className="sk-pb-pareto-box">
      <div className="sk-pb-pareto-header">
        <span>📊 Concentration des ventes (Pareto)</span>
        <span style={{ color: 'var(--sk-primary)', fontVariantNumeric: 'tabular-nums' }}>
          Top 3 = <strong>{top3Pct}%</strong> du CA total ({formatDisplayAmount(top3Sum.toFixed(2))}) — {top3Txns} transactions
        </span>
      </div>

      <div className="sk-pb-pareto-bar">
        {segments.map((s) => (
          <div
            key={s.label}
            className="sk-pb-pareto-segment"
            style={{ width: `${s.pct}%`, background: s.color }}
            title={`${s.label}: ${s.pct.toFixed(1)}%`}
          />
        ))}
      </div>

      <div className="sk-pb-pareto-legend">
        {segments.map((s) => (
          <div key={s.label} className="sk-pb-pareto-legend-item">
            <span className="sk-pb-pareto-legend-color" style={{ background: s.color }} />
            <span>{s.label} ({s.pct.toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ==========================================================================
   Product Horizontal Bar Diagram (Focus on Best Sellers)
   ========================================================================== */

interface ProductBarProps {
  products: PaperBookTopProductDto[];
  mode: ProductRankMode;
  avgPriceLabel: string;
  txnsLabel: string;
  unitsLabel: string;
}

const ProductBarDiagram: React.FC<ProductBarProps> = ({ products, mode, avgPriceLabel, txnsLabel, unitsLabel }) => {
  if (!products || products.length === 0) {
    return <div className="sk-pb-chart-empty">No product data available.</div>;
  }

  // Sort according to active rank mode
  const sorted = [...products].sort((a, b) => {
    if (mode === 'revenue') {
      return (parseFloat(b.total_revenue) || 0) - (parseFloat(a.total_revenue) || 0);
    }
    if (mode === 'qty') {
      return (parseFloat(b.total_qty) || 0) - (parseFloat(a.total_qty) || 0);
    }
    return (b.txn_count || 0) - (a.txn_count || 0);
  });

  const maxVal = Math.max(
    1,
    ...sorted.map((p) => {
      if (mode === 'revenue') return parseFloat(p.total_revenue) || 0;
      if (mode === 'qty') return parseFloat(p.total_qty) || 0;
      return p.txn_count || 0;
    }),
  );

  return (
    <div className="sk-pb-bar-diagram">
      {sorted.map((p, idx) => {
        let numVal = 0;
        let valDisplay = '';
        let fillClass = 'sk-pb-bar-item__fill--revenue';

        if (mode === 'revenue') {
          numVal = parseFloat(p.total_revenue) || 0;
          valDisplay = formatDisplayAmount(p.total_revenue);
          fillClass = 'sk-pb-bar-item__fill--revenue';
        } else if (mode === 'qty') {
          numVal = parseFloat(p.total_qty) || 0;
          valDisplay = `${p.total_qty} ${unitsLabel}`;
          fillClass = 'sk-pb-bar-item__fill--qty';
        } else {
          numVal = p.txn_count || 0;
          valDisplay = `${p.txn_count} ${txnsLabel}`;
          fillClass = 'sk-pb-bar-item__fill--txns';
        }

        const pct = Math.min(100, Math.max(3, (numVal / maxVal) * 100));
        const vel = (parseFloat(p.total_qty) / Math.max(1, p.txn_count)).toFixed(1);

        return (
          <div key={p.product_label} className="sk-pb-bar-item">
            <div className="sk-pb-bar-item__header">
              <div className="sk-pb-bar-item__title">
                <span className={`sk-pb-rank-badge ${idx < 3 ? 'sk-pb-rank-badge--top' : ''}`}>{idx + 1}</span>
                <span>{p.product_label}</span>
              </div>
              <div className="sk-pb-bar-item__value">{valDisplay}</div>
            </div>

            <div className="sk-pb-bar-item__track">
              <div
                className={`sk-pb-bar-item__fill ${fillClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="sk-pb-bar-item__footer">
              <div className="sk-pb-bar-item__pills">
                <span className="sk-pb-mini-pill">
                  {avgPriceLabel}: {formatDisplayAmount(p.avg_price)}
                </span>
                <span className="sk-pb-mini-pill">
                  {p.txn_count} {txnsLabel}
                </span>
                <span className="sk-pb-mini-pill">
                  ⚡ {vel} {unitsLabel}/cmd
                </span>
              </div>
              <span>{pct.toFixed(0)}% of #1</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ==========================================================================
   Product Revenue Concentration Donut / Ring Diagram
   ========================================================================== */

const DONUT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#0ea5e9', '#94a3b8'];

interface DonutProps {
  products: PaperBookTopProductDto[];
  totalRevenue: string;
  otherLabel: string;
}

const ProductsDonutDiagram: React.FC<DonutProps> = ({ products, totalRevenue, otherLabel }) => {
  const totalRevNum = parseFloat(totalRevenue) || 0;

  const slices = useMemo(() => {
    if (totalRevNum <= 0 || !products || products.length === 0) return [];

    const top5 = products.slice(0, 5);
    let top5Sum = 0;

    const items = top5.map((p, idx) => {
      const rev = parseFloat(p.total_revenue) || 0;
      top5Sum += rev;
      const pct = (rev / totalRevNum) * 100;
      return {
        label: p.product_label,
        amount: p.total_revenue,
        pct,
        color: DONUT_COLORS[idx % DONUT_COLORS.length],
      };
    });

    const otherRev = Math.max(0, totalRevNum - top5Sum);
    if (otherRev > 0) {
      items.push({
        label: otherLabel,
        amount: otherRev.toFixed(2),
        pct: (otherRev / totalRevNum) * 100,
        color: DONUT_COLORS[5],
      });
    }

    return items;
  }, [products, totalRevNum, otherLabel]);

  if (slices.length === 0) {
    return <div className="sk-pb-chart-empty">No revenue data available.</div>;
  }

  // Radius = 65, Circumference = 2 * PI * 65 ≈ 408.4
  const radius = 65;
  const circumference = 2 * Math.PI * radius;
  let cumulativeOffset = 0;

  const top1Pct = slices[0]?.pct.toFixed(0) ?? '0';

  return (
    <div className="sk-pb-donut-container" style={{ width: '100%' }}>
      <div className="sk-pb-donut-wrapper">
        <svg viewBox="0 0 170 170" width="170" height="170">
          {/* Background circle track */}
          <circle
            cx="85"
            cy="85"
            r={radius}
            fill="transparent"
            stroke="var(--sk-surface-soft, #f3f4f6)"
            strokeWidth="20"
          />

          {/* Slices */}
          {slices.map((s) => {
            const strokeDash = (s.pct / 100) * circumference;
            const currentOffset = cumulativeOffset;
            cumulativeOffset += strokeDash;

            return (
              <circle
                key={s.label}
                cx="85"
                cy="85"
                r={radius}
                fill="transparent"
                stroke={s.color}
                strokeWidth="20"
                strokeDasharray={`${strokeDash} ${circumference - strokeDash}`}
                strokeDashoffset={-currentOffset}
                transform="rotate(-90 85 85)"
                style={{ transition: 'stroke-dasharray 0.5s ease' }}
              />
            );
          })}
        </svg>

        {/* Center Text */}
        <div className="sk-pb-donut-center">
          <span className="sk-pb-donut-center__val">{top1Pct}%</span>
          <span className="sk-pb-donut-center__label">#1 Product</span>
        </div>
      </div>

      {/* Legend Rows */}
      <div className="sk-pb-donut-legend">
        {slices.map((s) => (
          <div key={s.label} className="sk-pb-donut-legend-row">
            <div className="sk-pb-donut-legend-left">
              <span className="sk-pb-donut-legend-dot" style={{ background: s.color }} />
              <span className="sk-pb-donut-legend-name" title={s.label}>
                {s.label}
              </span>
            </div>
            <div className="sk-pb-donut-legend-right">
              <span className="sk-pb-donut-legend-pct">{s.pct.toFixed(1)}%</span>
              <span className="sk-pb-donut-legend-amount">{formatDisplayAmount(s.amount)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ==========================================================================
   Operating Expense Distribution Diagram
   ========================================================================== */

interface ExpenseDiagProps {
  expenses: PaperBookExpenseCategoryDto[];
}

const ExpenseDistributionDiagram: React.FC<ExpenseDiagProps> = ({ expenses }) => {
  return (
    <div className="sk-pb-expense-bars">
      {expenses.slice(0, 6).map((e) => {
        const pct = Math.min(100, Math.max(2, parseFloat(e.percent_of_total) || 0));
        return (
          <div key={e.category_label} className="sk-pb-expense-bar-item">
            <div className="sk-pb-expense-bar-header">
              <span>{e.category_label}</span>
              <span style={{ color: 'var(--sk-danger)', fontVariantNumeric: 'tabular-nums' }}>
                {formatDisplayAmount(e.total_amount)} ({e.percent_of_total}%)
              </span>
            </div>
            <div className="sk-pb-expense-bar-track">
              <div className="sk-pb-expense-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ==========================================================================
   Brand Market Share Bar Diagram
   ========================================================================== */

interface BrandBarProps {
  brands: PaperBookTopBrandDto[];
}

const BrandBarDiagram: React.FC<BrandBarProps> = ({ brands }) => {
  if (!brands || brands.length === 0) return null;

  const maxRev = Math.max(1, ...brands.map((b) => parseFloat(b.total_revenue) || 0));

  return (
    <div className="sk-pb-brand-bars">
      {brands.slice(0, 5).map((b) => {
        const rev = parseFloat(b.total_revenue) || 0;
        const pct = Math.min(100, Math.max(3, (rev / maxRev) * 100));

        return (
          <div key={b.brand_label} className="sk-pb-brand-bar-item">
            <div className="sk-pb-brand-bar-header">
              <span>{b.brand_label}</span>
              <span style={{ color: 'var(--sk-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {formatDisplayAmount(b.total_revenue)} ({b.total_qty} units)
              </span>
            </div>
            <div className="sk-pb-brand-bar-track">
              <div className="sk-pb-brand-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ==========================================================================
   Hand-crafted SVG Monthly Bar Chart (Zero External Dependencies)
   ========================================================================== */

interface MonthlyChartProps {
  monthly: PaperBookMonthlyPointDto[];
  metric: 'all' | 'sales' | 'profit' | 'expenses';
  locale: string;
}

const MonthlyBarChart: React.FC<MonthlyChartProps> = ({ monthly, metric }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!monthly || monthly.length === 0) {
    return <div className="sk-pb-chart-empty">No historical data available for selected period.</div>;
  }

  // Parse numeric values (for visual bar scaling ONLY — display uses exact formatted string)
  const chartData = monthly.map((m) => {
    const s = parseFloat(m.sell_total) || 0;
    const g = parseFloat(m.benefit_total) || 0;
    const e = parseFloat(m.expense_total) || 0;
    const np = parseFloat(m.net_profit) || 0;
    return {
      month: m.year_month,
      sales: s,
      gross_benefit: g,
      expenses: e,
      net_profit: np,
      raw: m,
    };
  });

  // Calculate dynamic scale max
  let maxVal = 1;
  chartData.forEach((d) => {
    if (metric === 'all') {
      maxVal = Math.max(maxVal, d.sales, d.expenses, d.gross_benefit, Math.abs(d.net_profit));
    } else if (metric === 'sales') {
      maxVal = Math.max(maxVal, d.sales);
    } else if (metric === 'profit') {
      maxVal = Math.max(maxVal, Math.abs(d.net_profit), d.gross_benefit);
    } else if (metric === 'expenses') {
      maxVal = Math.max(maxVal, d.expenses);
    }
  });

  const chartHeight = 260;
  const paddingLeft = 60;
  const paddingRight = 30;
  const paddingTop = 25;
  const paddingBottom = 45;
  const barSlotWidth = Math.max(50, Math.min(90, 800 / chartData.length));
  const svgWidth = Math.max(680, paddingLeft + paddingRight + chartData.length * barSlotWidth);
  const drawHeight = chartHeight - paddingTop - paddingBottom;

  return (
    <div className="sk-pb-svg-chart-container">
      {/* Legend */}
      <div className="sk-pb-chart-legend">
        {(metric === 'all' || metric === 'sales') && (
          <div className="sk-pb-legend-item">
            <span className="sk-pb-legend-color sk-pb-legend-color--sales" />
            <span>Revenue</span>
          </div>
        )}
        {(metric === 'all' || metric === 'profit') && (
          <div className="sk-pb-legend-item">
            <span className="sk-pb-legend-color sk-pb-legend-color--benefit" />
            <span>Gross Benefit</span>
          </div>
        )}
        {(metric === 'all' || metric === 'expenses') && (
          <div className="sk-pb-legend-item">
            <span className="sk-pb-legend-color sk-pb-legend-color--expenses" />
            <span>Expenses</span>
          </div>
        )}
        {(metric === 'all' || metric === 'profit') && (
          <div className="sk-pb-legend-item">
            <span className="sk-pb-legend-color sk-pb-legend-color--net" />
            <span>Net Profit</span>
          </div>
        )}
      </div>

      <div className="sk-pb-svg-scroll">
        <svg
          viewBox={`0 0 ${svgWidth} ${chartHeight}`}
          className="sk-pb-svg-chart"
          style={{ width: `${svgWidth}px`, height: `${chartHeight}px` }}
        >
          {/* Horizontal Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
            const y = paddingTop + drawHeight * (1 - pct);
            const val = maxVal * pct;
            return (
              <g key={pct}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - paddingRight}
                  y2={y}
                  stroke="var(--sk-border, #e5e7eb)"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--sk-muted, #6b7280)"
                  fontFamily="system-ui, sans-serif"
                >
                  {val >= 1000000
                    ? `${(val / 1000000).toFixed(1)}M`
                    : val >= 1000
                      ? `${(val / 1000).toFixed(0)}k`
                      : val.toFixed(0)}
                </text>
              </g>
            );
          })}

          {/* Baseline */}
          <line
            x1={paddingLeft}
            y1={paddingTop + drawHeight}
            x2={svgWidth - paddingRight}
            y2={paddingTop + drawHeight}
            stroke="var(--sk-border, #9ca3af)"
            strokeWidth="1.5"
          />

          {/* Bars and Month Labels */}
          {chartData.map((d, idx) => {
            const groupX = paddingLeft + idx * barSlotWidth + 10;
            const availableGroupWidth = barSlotWidth - 20;

            let numBars = 1;
            if (metric === 'all') numBars = 3;
            else if (metric === 'profit') numBars = 2;
            const singleBarWidth = Math.max(6, (availableGroupWidth - (numBars - 1) * 3) / numBars);

            // Heights
            const salesH = Math.max(2, (d.sales / maxVal) * drawHeight);
            const benefitH = Math.max(2, (d.gross_benefit / maxVal) * drawHeight);
            const expH = Math.max(2, (d.expenses / maxVal) * drawHeight);
            const netH = Math.max(2, (Math.abs(d.net_profit) / maxVal) * drawHeight);

            const isHovered = hoveredIdx === idx;

            return (
              <g
                key={d.month}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Background highlight on hover */}
                {isHovered && (
                  <rect
                    x={groupX - 5}
                    y={paddingTop}
                    width={availableGroupWidth + 10}
                    height={drawHeight}
                    fill="color-mix(in srgb, var(--sk-primary, #3b82f6) 6%, transparent)"
                    rx={4}
                  />
                )}

                {/* Render bars based on metric */}
                {metric === 'all' && (
                  <>
                    {/* Sales Bar */}
                    <rect
                      x={groupX}
                      y={paddingTop + drawHeight - salesH}
                      width={singleBarWidth}
                      height={salesH}
                      fill="var(--sk-primary, #3b82f6)"
                      rx={2}
                    />
                    {/* Benefit Bar */}
                    <rect
                      x={groupX + singleBarWidth + 3}
                      y={paddingTop + drawHeight - benefitH}
                      width={singleBarWidth}
                      height={benefitH}
                      fill="var(--sk-success, #10b981)"
                      rx={2}
                    />
                    {/* Expenses Bar */}
                    <rect
                      x={groupX + (singleBarWidth + 3) * 2}
                      y={paddingTop + drawHeight - expH}
                      width={singleBarWidth}
                      height={expH}
                      fill="var(--sk-danger, #ef4444)"
                      rx={2}
                    />
                  </>
                )}

                {metric === 'sales' && (
                  <rect
                    x={groupX + availableGroupWidth / 4}
                    y={paddingTop + drawHeight - salesH}
                    width={availableGroupWidth / 2}
                    height={salesH}
                    fill="var(--sk-primary, #3b82f6)"
                    rx={3}
                  />
                )}

                {metric === 'expenses' && (
                  <rect
                    x={groupX + availableGroupWidth / 4}
                    y={paddingTop + drawHeight - expH}
                    width={availableGroupWidth / 2}
                    height={expH}
                    fill="var(--sk-danger, #ef4444)"
                    rx={3}
                  />
                )}

                {metric === 'profit' && (
                  <>
                    <rect
                      x={groupX}
                      y={paddingTop + drawHeight - benefitH}
                      width={singleBarWidth}
                      height={benefitH}
                      fill="var(--sk-success, #10b981)"
                      rx={2}
                    />
                    <rect
                      x={groupX + singleBarWidth + 4}
                      y={paddingTop + drawHeight - netH}
                      width={singleBarWidth}
                      height={netH}
                      fill={d.net_profit >= 0 ? '#059669' : '#dc2626'}
                      rx={2}
                    />
                  </>
                )}

                {/* X-axis Month Label */}
                <text
                  x={groupX + availableGroupWidth / 2}
                  y={paddingTop + drawHeight + 18}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={isHovered ? '700' : '500'}
                  fill={isHovered ? 'var(--sk-primary, #3b82f6)' : 'var(--sk-text, #374151)'}
                  fontFamily="system-ui, sans-serif"
                >
                  {d.month}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Tooltip Card for Hovered Month */}
      {hoveredIdx !== null && chartData[hoveredIdx] && (
        <div className="sk-pb-chart-tooltip">
          <div className="sk-pb-chart-tooltip__header">
            <strong>📅 {chartData[hoveredIdx].month}</strong>
          </div>
          <div className="sk-pb-chart-tooltip__grid">
            <span style={{ color: 'var(--sk-primary)' }}>Revenue:</span>
            <strong>{formatDisplayAmount(chartData[hoveredIdx].raw.sell_total)}</strong>

            <span style={{ color: 'var(--sk-success)' }}>Gross Benefit:</span>
            <strong>{formatDisplayAmount(chartData[hoveredIdx].raw.benefit_total)}</strong>

            <span style={{ color: 'var(--sk-danger)' }}>Expenses:</span>
            <strong>{formatDisplayAmount(chartData[hoveredIdx].raw.expense_total)}</strong>

            <span>Net Profit:</span>
            <strong
              style={{
                color: chartData[hoveredIdx].net_profit >= 0 ? 'var(--sk-success)' : 'var(--sk-danger)',
              }}
            >
              {formatDisplayAmount(chartData[hoveredIdx].raw.net_profit)}
            </strong>

            <span>Purchases:</span>
            <span>{formatDisplayAmount(chartData[hoveredIdx].raw.buy_total)}</span>

            <span>Unpaid Sales:</span>
            <span>{formatDisplayAmount(chartData[hoveredIdx].raw.unpaid_sell_total)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
