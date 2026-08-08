import { useState } from 'react';
import type { Locale } from '../../shared/i18n';
import type { HistoricalTradeAnalyticsResult } from '../../shared/ipc/onboardingDto';
import { HistoricalKpiCard } from './HistoricalKpiCard';
import { HistoricalRankingChart, type RankingItem } from './HistoricalRankingChart';
import { HistoricalTrendChart } from './HistoricalTrendChart';

interface Props {
  analytics: HistoricalTradeAnalyticsResult;
  locale: Locale;
}

type SubTab =
  | 'overview'
  | 'sales'
  | 'purchases'
  | 'products'
  | 'brands'
  | 'parties'
  | 'quality'
  | 'overrides';

export function HistoricalAnalyticsDashboard({ analytics, locale }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('overview');

  if (!analytics) return null;

  const formatMoney = (val: number | null | undefined) =>
    val === null || val === undefined ? '—' : `${new Intl.NumberFormat(locale).format(val)} DZD`;

  // Ranking data transformations
  const topProducts: RankingItem[] = analytics.products.map((p) => ({
    label: p.productName,
    value: p.salesDzd,
    secondaryValue: p.purchasesDzd,
    sublabel: p.qtySold > 0 ? `${p.qtySold} sold` : undefined,
    benefit: p.recordedBenefitDzd,
  }));

  const topBrands: RankingItem[] = analytics.brands.map((b) => ({
    label: b.brand,
    value: b.salesDzd,
    secondaryValue: b.purchasesDzd,
    benefit: b.recordedBenefitDzd,
  }));

  const topParties: RankingItem[] = analytics.parties.map((p) => ({
    label: p.partyCompany,
    value: p.totalVolumeDzd,
    benefit: p.recordedBenefitDzd,
  }));

  return (
    <div className="sk-analytics-dashboard" data-testid="historical-trade-analytics">
      {/* Sub-tab Navigation */}
      <div className="sk-analytics-tabs">
        <button
          type="button"
          className={`sk-tab-btn ${subTab === 'overview' ? 'sk-tab-btn--active' : ''}`}
          onClick={() => setSubTab('overview')}
        >
          {locale === 'ar' ? 'اللوحة العامة' : locale === 'fr' ? 'Vue d’ensemble' : 'Overview'}
        </button>
        <button
          type="button"
          className={`sk-tab-btn ${subTab === 'sales' ? 'sk-tab-btn--active' : ''}`}
          onClick={() => setSubTab('sales')}
        >
          {locale === 'ar' ? 'المبيعات' : locale === 'fr' ? 'Ventes' : 'Sales & Payments'}
        </button>
        <button
          type="button"
          className={`sk-tab-btn ${subTab === 'purchases' ? 'sk-tab-btn--active' : ''}`}
          onClick={() => setSubTab('purchases')}
        >
          {locale === 'ar' ? 'المشتريات' : locale === 'fr' ? 'Achats' : 'Purchases'}
        </button>
        <button
          type="button"
          className={`sk-tab-btn ${subTab === 'products' ? 'sk-tab-btn--active' : ''}`}
          onClick={() => setSubTab('products')}
        >
          {locale === 'ar' ? 'المنتجات' : locale === 'fr' ? 'Produits' : 'Products'} ({analytics.products.length})
        </button>
        <button
          type="button"
          className={`sk-tab-btn ${subTab === 'brands' ? 'sk-tab-btn--active' : ''}`}
          onClick={() => setSubTab('brands')}
        >
          {locale === 'ar' ? 'العلامات' : locale === 'fr' ? 'Marques' : 'Brands'} ({analytics.brands.length})
        </button>
        <button
          type="button"
          className={`sk-tab-btn ${subTab === 'parties' ? 'sk-tab-btn--active' : ''}`}
          onClick={() => setSubTab('parties')}
        >
          {locale === 'ar' ? 'الأطراف والشركات' : locale === 'fr' ? 'Partenaires' : 'Parties & Suppliers'} ({analytics.parties.length})
        </button>
        <button
          type="button"
          className={`sk-tab-btn ${subTab === 'quality' ? 'sk-tab-btn--active' : ''}`}
          onClick={() => setSubTab('quality')}
        >
          {locale === 'ar' ? 'جودة البيانات' : locale === 'fr' ? 'Qualité Données' : 'Data Quality'}
        </button>
        <button
          type="button"
          className={`sk-tab-btn ${subTab === 'overrides' ? 'sk-tab-btn--active' : ''}`}
          onClick={() => setSubTab('overrides')}
        >
          {locale === 'ar' ? 'التجاوزات اليدوية' : locale === 'fr' ? 'Ajustements Manuels' : 'Manual Overrides'}
        </button>
      </div>

      {/* OVERVIEW TAB */}
      {subTab === 'overview' && (
        <div className="sk-analytics-content space-y-6">
          {/* KPI Grid */}
          <div className="sk-kpi-grid">
            <HistoricalKpiCard
              title={locale === 'ar' ? 'إجمالي المبيعات' : 'Total Sales'}
              value={analytics.overview.totalSalesDzd}
              locale={locale}
              tone="success"
              badgeText={`${analytics.overview.transactionCount} Txns`}
              subtitle={
                locale === 'ar'
                  ? `مدفوع: ${formatMoney(analytics.overview.paidSalesDzd)} · غير مدفوع: ${formatMoney(analytics.overview.unpaidSalesDzd)}`
                  : `Paid: ${formatMoney(analytics.overview.paidSalesDzd)} · Unpaid: ${formatMoney(analytics.overview.unpaidSalesDzd)}`
              }
            />
            <HistoricalKpiCard
              title={locale === 'ar' ? 'إجمالي المشتريات' : 'Total Purchases'}
              value={analytics.overview.totalPurchasesDzd}
              locale={locale}
              tone="info"
              subtitle={
                locale === 'ar'
                  ? `مدفوع: ${formatMoney(analytics.overview.paidPurchasesDzd)} · غير مدفوع: ${formatMoney(analytics.overview.unpaidPurchasesDzd)}`
                  : `Paid: ${formatMoney(analytics.overview.paidPurchasesDzd)} · Unpaid: ${formatMoney(analytics.overview.unpaidPurchasesDzd)}`
              }
            />
            <HistoricalKpiCard
              title={locale === 'ar' ? 'إجمالي المصاريف' : 'Total Expenses'}
              value={analytics.overview.totalExpensesDzd}
              locale={locale}
              tone="warning"
              subtitle={
                locale === 'ar'
                  ? `مدفوع: ${formatMoney(analytics.overview.paidExpensesDzd)}`
                  : `Paid: ${formatMoney(analytics.overview.paidExpensesDzd)}`
              }
            />
            <HistoricalKpiCard
              title={locale === 'ar' ? 'الفائدة اليدوية المسجلة' : 'Recorded Benefit (Sell Only)'}
              value={analytics.overview.totalManualBenefitDzd}
              locale={locale}
              tone="primary"
              badgeText="Line-Level Aggregate"
              subtitle={
                locale === 'ar'
                  ? `إجمالي الفائدة المدخلة في خانة الفائدة بالورقة`
                  : 'Total manually declared profit column in paper book'
              }
            />
          </div>

          {/* Trade Difference Summary Banner */}
          <div className="sk-card sk-card--featured">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-xs uppercase tracking-wider text-muted font-semibold">
                  {locale === 'ar' ? 'فارق المبيعات - المشتريات - المصاريف' : 'Recorded Net Trade Difference (Sales - Purchases - Expenses)'}
                </span>
                <div className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">
                  {formatMoney(analytics.overview.tradeDifferenceDzd)}
                </div>
              </div>
              <div className="sk-banner sk-banner--warning max-w-md text-xs">
                <strong>{locale === 'ar' ? 'تنبيه مهم:' : 'Important Notice:'}</strong>{' '}
                {locale === 'ar'
                  ? 'هذا الفارق ليس فائدة محاسبية صافية لأن المشتريات قد تبقى في المخزون. Benefit (Sell Only) تعكس الفائدة الحقيقية المسجلة.'
                  : 'This net difference is not accounting net profit because purchased inventory remains on hand.'}
              </div>
            </div>
          </div>

          {/* Timeline Chart */}
          <HistoricalTrendChart timeline={analytics.timeline} locale={locale} />

          {/* Rankings Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <HistoricalRankingChart
              title={locale === 'ar' ? 'أعلى المنتجات مبيعاً وفائدة' : 'Top Products by Sales & Benefit'}
              items={topProducts}
              locale={locale}
              tone="emerald"
            />
            <HistoricalRankingChart
              title={locale === 'ar' ? 'أعلى الأطراف والشركات حجماً' : 'Top Parties & Suppliers by Volume'}
              items={topParties}
              locale={locale}
              tone="purple"
            />
          </div>
        </div>
      )}

      {/* SALES TAB */}
      {subTab === 'sales' && (
        <div className="sk-analytics-content space-y-6">
          <div className="sk-kpi-grid">
            <HistoricalKpiCard
              title="Total Sales"
              value={analytics.payment.sales.total}
              locale={locale}
              tone="success"
            />
            <HistoricalKpiCard
              title="Paid Sales"
              value={analytics.payment.sales.paid}
              locale={locale}
              tone="success"
              badgeText="Cash/Received"
            />
            <HistoricalKpiCard
              title="Unpaid Sales (Receivables)"
              value={analytics.payment.sales.unpaid}
              locale={locale}
              tone="warning"
              badgeText="Credit"
            />
            <HistoricalKpiCard
              title="Recorded Manual Benefit"
              value={analytics.benefits.totalManualBenefitDzd}
              locale={locale}
              tone="primary"
            />
          </div>

          <HistoricalRankingChart
            title="Top Sales Products"
            items={topProducts}
            locale={locale}
            tone="emerald"
          />
        </div>
      )}

      {/* PURCHASES TAB */}
      {subTab === 'purchases' && (
        <div className="sk-analytics-content space-y-6">
          <div className="sk-kpi-grid">
            <HistoricalKpiCard
              title="Total Purchases"
              value={analytics.payment.purchases.total}
              locale={locale}
              tone="info"
            />
            <HistoricalKpiCard
              title="Paid Purchases"
              value={analytics.payment.purchases.paid}
              locale={locale}
              tone="info"
            />
            <HistoricalKpiCard
              title="Unpaid Purchases (Payables)"
              value={analytics.payment.purchases.unpaid}
              locale={locale}
              tone="danger"
            />
          </div>

          <HistoricalRankingChart
            title="Top Suppliers / Parties by Purchase Volume"
            items={topParties}
            locale={locale}
            tone="blue"
          />
        </div>
      )}

      {/* PRODUCTS TAB */}
      {subTab === 'products' && (
        <div className="sk-analytics-content space-y-6">
          <div className="sk-table-container">
            <table className="sk-table">
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th className="text-right">Qty Sold</th>
                  <th className="text-right">Sales (DZD)</th>
                  <th className="text-right">Qty Bought</th>
                  <th className="text-right">Purchases (DZD)</th>
                  <th className="text-right">Recorded Benefit</th>
                </tr>
              </thead>
              <tbody>
                {analytics.products.map((p, idx) => (
                  <tr key={`${p.productName}-${idx}`}>
                    <td>
                      <strong>{p.productName}</strong>
                      {p.matchedProductId && (
                        <span className="sk-badge sk-badge--success ml-2">Catalog Matched</span>
                      )}
                    </td>
                    <td className="text-right">{p.qtySold}</td>
                    <td className="text-right font-medium">{formatMoney(p.salesDzd)}</td>
                    <td className="text-right">{p.qtyPurchased}</td>
                    <td className="text-right">{formatMoney(p.purchasesDzd)}</td>
                    <td className="text-right">
                      {(p.recordedBenefitDzd ?? 0) > 0 ? (
                        <span className="sk-badge sk-badge--success">
                          {formatMoney(p.recordedBenefitDzd)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* BRANDS TAB */}
      {subTab === 'brands' && (
        <div className="sk-analytics-content space-y-6">
          <HistoricalRankingChart
            title="Top Brands by Sales Volume"
            items={topBrands}
            locale={locale}
            tone="blue"
          />

          <div className="sk-table-container">
            <table className="sk-table">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th className="text-right">Lines</th>
                  <th className="text-right">Sales (DZD)</th>
                  <th className="text-right">Purchases (DZD)</th>
                  <th className="text-right">Recorded Benefit</th>
                </tr>
              </thead>
              <tbody>
                {analytics.brands.map((b, idx) => (
                  <tr key={`${b.brand}-${idx}`}>
                    <td><strong>{b.brand}</strong></td>
                    <td className="text-right">{b.lineCount}</td>
                    <td className="text-right font-medium">{formatMoney(b.salesDzd)}</td>
                    <td className="text-right">{formatMoney(b.purchasesDzd)}</td>
                    <td className="text-right">{formatMoney(b.recordedBenefitDzd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PARTIES TAB */}
      {subTab === 'parties' && (
        <div className="sk-analytics-content space-y-6">
          <div className="sk-table-container">
            <table className="sk-table">
              <thead>
                <tr>
                  <th>Party / Company</th>
                  <th className="text-right">Sales (DZD)</th>
                  <th className="text-right">Purchases (DZD)</th>
                  <th className="text-right">Expenses (DZD)</th>
                  <th className="text-right">Total Volume</th>
                  <th className="text-right">Recorded Benefit</th>
                </tr>
              </thead>
              <tbody>
                {analytics.parties.map((p, idx) => (
                  <tr key={`${p.partyCompany}-${idx}`}>
                    <td><strong>{p.partyCompany}</strong></td>
                    <td className="text-right">{formatMoney(p.salesDzd)}</td>
                    <td className="text-right">{formatMoney(p.purchasesDzd)}</td>
                    <td className="text-right">{formatMoney(p.expensesDzd)}</td>
                    <td className="text-right font-medium">{formatMoney(p.totalVolumeDzd)}</td>
                    <td className="text-right">{formatMoney(p.recordedBenefitDzd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DATA QUALITY TAB */}
      {subTab === 'quality' && (
        <div className="sk-analytics-content space-y-6">
          <div className="sk-card">
            <h4>Data Coverage & Field Completeness</h4>
            <div className="space-y-4 mt-4">
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span>Product Name Coverage</span>
                  <span>{analytics.dataQuality.productNameCoveragePct.toFixed(1)}%</span>
                </div>
                <div className="sk-progress-bar">
                  <div
                    className="sk-progress-bar__fill bg-emerald-500"
                    style={{ width: `${analytics.dataQuality.productNameCoveragePct}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span>Brand Coverage</span>
                  <span>{analytics.dataQuality.brandCoveragePct.toFixed(1)}%</span>
                </div>
                <div className="sk-progress-bar">
                  <div
                    className="sk-progress-bar__fill bg-blue-500"
                    style={{ width: `${analytics.dataQuality.brandCoveragePct}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span>Party / Supplier Coverage</span>
                  <span>{analytics.dataQuality.partyCoveragePct.toFixed(1)}%</span>
                </div>
                <div className="sk-progress-bar">
                  <div
                    className="sk-progress-bar__fill bg-purple-500"
                    style={{ width: `${analytics.dataQuality.partyCoveragePct}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span>Page Number Coverage</span>
                  <span>{analytics.dataQuality.pageNumberCoveragePct.toFixed(1)}%</span>
                </div>
                <div className="sk-progress-bar">
                  <div
                    className="sk-progress-bar__fill bg-amber-500"
                    style={{ width: `${analytics.dataQuality.pageNumberCoveragePct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL OVERRIDES TAB */}
      {subTab === 'overrides' && (
        <div className="sk-analytics-content space-y-6">
          <dl className="sk-details-grid">
            <div>
              <dt>Calculated Formula Lines</dt>
              <dd>{analytics.manualOverrides.calculatedLineCount}</dd>
            </div>
            <div>
              <dt>Manual Line Total Overrides</dt>
              <dd>{analytics.manualOverrides.manualOverrideCount}</dd>
            </div>
            <div>
              <dt>Calculated Mathematical Total</dt>
              <dd>{formatMoney(analytics.manualOverrides.calculatedMathematicalTotalDzd)}</dd>
            </div>
            <div>
              <dt>Final Effective Total</dt>
              <dd>{formatMoney(analytics.manualOverrides.finalEffectiveTotalDzd)}</dd>
            </div>
            <div>
              <dt>Total Override Difference</dt>
              <dd>
                <strong>{formatMoney(analytics.manualOverrides.totalOverrideDifferenceDzd)}</strong>
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
