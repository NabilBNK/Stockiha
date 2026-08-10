import { useMemo, useState } from 'react';
import type { Locale } from '../../shared/i18n';
import type { HistoricalTradeAnalyticsResult } from '../../shared/ipc/onboardingDto';
import { HistoricalKpiCard } from './HistoricalKpiCard';
import { HistoricalRankingChart, type RankingItem } from './HistoricalRankingChart';
import { HistoricalTrendChart } from './HistoricalTrendChart';

interface Props { analytics: HistoricalTradeAnalyticsResult; locale: Locale; }
type SubTab = 'overview' | 'sales' | 'purchases' | 'products' | 'brands' | 'parties' | 'quality' | 'overrides';
type Direction = 'ascending' | 'descending';
interface AnalyticsSort { key: string; direction: Direction; }

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    overview: 'Overview', salesTab: 'Sales & payments', purchasesTab: 'Purchases', productsTab: 'Products', brandsTab: 'Brands', partiesTab: 'Parties & suppliers', qualityTab: 'Data quality', overridesTab: 'Manual overrides',
    totalSales: 'Total sales', totalPurchases: 'Total purchases', totalExpenses: 'Total expenses', recordedBenefit: 'Recorded benefit (sell only)', paid: 'Paid', unpaid: 'Unpaid', transactions: 'transactions', lineAggregate: 'Line-level aggregate',
    netDifference: 'Recorded trade difference (sales − purchases − expenses)', notice: 'This difference is not accounting net profit because purchased inventory may remain on hand.',
    topProducts: 'Top products by sales & benefit', topParties: 'Top parties & suppliers by volume', paidSales: 'Paid sales', unpaidSales: 'Unpaid sales (receivables)', paidPurchases: 'Paid purchases', unpaidPurchases: 'Unpaid purchases (payables)',
    product: 'Product', qtySold: 'Qty sold', sales: 'Sales (DZD)', qtyBought: 'Qty bought', purchases: 'Purchases (DZD)', benefit: 'Recorded benefit', catalogMatched: 'Catalog matched', brand: 'Brand', lines: 'Lines', party: 'Party / company', expenses: 'Expenses (DZD)', volume: 'Total volume',
    coverage: 'Data coverage & field completeness', productCoverage: 'Product-name coverage', brandCoverage: 'Brand coverage', partyCoverage: 'Party / supplier coverage', pageCoverage: 'Page-number coverage', calculatedLines: 'Calculated formula lines', overrideLines: 'Manual line-total overrides', calculatedTotal: 'Calculated mathematical total', finalTotal: 'Final effective total', difference: 'Total override difference', empty: 'No approved data for this view.',
  },
  fr: {
    overview: 'Vue d’ensemble', salesTab: 'Ventes et paiements', purchasesTab: 'Achats', productsTab: 'Produits', brandsTab: 'Marques', partiesTab: 'Partenaires et fournisseurs', qualityTab: 'Qualité des données', overridesTab: 'Ajustements manuels',
    totalSales: 'Ventes totales', totalPurchases: 'Achats totaux', totalExpenses: 'Dépenses totales', recordedBenefit: 'Bénéfice enregistré (ventes)', paid: 'Payé', unpaid: 'Impayé', transactions: 'transactions', lineAggregate: 'Agrégat par ligne',
    netDifference: 'Écart commercial enregistré (ventes − achats − dépenses)', notice: 'Cet écart n’est pas un bénéfice comptable net car des achats peuvent rester en stock.',
    topProducts: 'Produits principaux par ventes et bénéfice', topParties: 'Partenaires et fournisseurs par volume', paidSales: 'Ventes payées', unpaidSales: 'Ventes impayées (créances)', paidPurchases: 'Achats payés', unpaidPurchases: 'Achats impayés (dettes)',
    product: 'Produit', qtySold: 'Qté vendue', sales: 'Ventes (DZD)', qtyBought: 'Qté achetée', purchases: 'Achats (DZD)', benefit: 'Bénéfice enregistré', catalogMatched: 'Lié au catalogue', brand: 'Marque', lines: 'Lignes', party: 'Partenaire / société', expenses: 'Dépenses (DZD)', volume: 'Volume total',
    coverage: 'Couverture et complétude des données', productCoverage: 'Couverture des produits', brandCoverage: 'Couverture des marques', partyCoverage: 'Couverture partenaires / fournisseurs', pageCoverage: 'Couverture des numéros de page', calculatedLines: 'Lignes calculées', overrideLines: 'Totaux de ligne remplacés', calculatedTotal: 'Total mathématique calculé', finalTotal: 'Total final effectif', difference: 'Écart total des ajustements', empty: 'Aucune donnée approuvée pour cette vue.',
  },
  ar: {
    overview: 'نظرة عامة', salesTab: 'المبيعات والمدفوعات', purchasesTab: 'المشتريات', productsTab: 'المنتجات', brandsTab: 'العلامات', partiesTab: 'الأطراف والموردون', qualityTab: 'جودة البيانات', overridesTab: 'التعديلات اليدوية',
    totalSales: 'إجمالي المبيعات', totalPurchases: 'إجمالي المشتريات', totalExpenses: 'إجمالي المصاريف', recordedBenefit: 'الفائدة المسجلة (المبيعات)', paid: 'مدفوع', unpaid: 'غير مدفوع', transactions: 'معاملات', lineAggregate: 'مجموع على مستوى الأسطر',
    netDifference: 'الفارق التجاري المسجل (المبيعات − المشتريات − المصاريف)', notice: 'هذا الفارق ليس ربحاً محاسبياً صافياً لأن بعض المشتريات قد تبقى في المخزون.',
    topProducts: 'أعلى المنتجات حسب المبيعات والفائدة', topParties: 'أعلى الأطراف والموردين حسب الحجم', paidSales: 'المبيعات المدفوعة', unpaidSales: 'المبيعات غير المدفوعة (ديون الزبائن)', paidPurchases: 'المشتريات المدفوعة', unpaidPurchases: 'المشتريات غير المدفوعة (ديون الموردين)',
    product: 'المنتج', qtySold: 'الكمية المباعة', sales: 'المبيعات (دج)', qtyBought: 'الكمية المشتراة', purchases: 'المشتريات (دج)', benefit: 'الفائدة المسجلة', catalogMatched: 'مرتبط بالفهرس', brand: 'العلامة', lines: 'الأسطر', party: 'الطرف / الشركة', expenses: 'المصاريف (دج)', volume: 'الحجم الإجمالي',
    coverage: 'تغطية البيانات واكتمال الحقول', productCoverage: 'تغطية أسماء المنتجات', brandCoverage: 'تغطية العلامات', partyCoverage: 'تغطية الأطراف والموردين', pageCoverage: 'تغطية أرقام الصفحات', calculatedLines: 'أسطر محسوبة بالصيغة', overrideLines: 'تعديلات إجمالي السطر', calculatedTotal: 'المجموع الحسابي', finalTotal: 'المجموع النهائي الفعلي', difference: 'فارق التعديلات الإجمالي', empty: 'لا توجد بيانات معتمدة لهذا العرض.',
  },
};

function sortRows<T>(rows: T[], sort: AnalyticsSort, locale: Locale): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const multiplier = sort.direction === 'ascending' ? 1 : -1;
  return rows.slice().sort((left, right) => {
    const a = (left as Record<string, unknown>)[sort.key];
    const b = (right as Record<string, unknown>)[sort.key];
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    const result = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
    return result * multiplier;
  });
}

function SortHeader({ label, field, sort, onSort, numeric = false }: { label: string; field: string; sort: AnalyticsSort; onSort: (field: string) => void; numeric?: boolean }) {
  const active = sort.key === field;
  return (
    <th aria-sort={active ? sort.direction : 'none'} className={numeric ? 'sk-num' : undefined}>
      <button type="button" className="sk-sort-header" onClick={() => onSort(field)}>
        {label}<span className={`sk-sort-header__icon ${active ? 'sk-sort-header__icon--active' : ''}`} aria-hidden>{active ? (sort.direction === 'ascending' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

export function HistoricalAnalyticsDashboard({ analytics, locale }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [sort, setSort] = useState<AnalyticsSort>({ key: 'salesDzd', direction: 'descending' });
  const text = COPY[locale];
  const money = (value: number | null | undefined) => value == null ? '—' : `${new Intl.NumberFormat(locale).format(value)} DZD`;
  const changeSort = (key: string) => setSort((current) => ({ key, direction: current.key === key && current.direction === 'ascending' ? 'descending' : 'ascending' }));
  const products = useMemo(() => sortRows(analytics.products, sort, locale), [analytics.products, sort, locale]);
  const brands = useMemo(() => sortRows(analytics.brands, sort, locale), [analytics.brands, sort, locale]);
  const parties = useMemo(() => sortRows(analytics.parties, sort, locale), [analytics.parties, sort, locale]);
  const topProducts: RankingItem[] = analytics.products.map((item) => ({ label: item.productName, value: item.salesDzd, secondaryValue: item.purchasesDzd, sublabel: item.qtySold > 0 ? `${item.qtySold}` : undefined, benefit: item.recordedBenefitDzd }));
  const topParties: RankingItem[] = analytics.parties.map((item) => ({ label: item.partyCompany, value: item.totalVolumeDzd, benefit: item.recordedBenefitDzd }));
  const topBrands: RankingItem[] = analytics.brands.map((item) => ({ label: item.brand, value: item.salesDzd, benefit: item.recordedBenefitDzd }));
  const tabs: Array<[SubTab, string, number?]> = [
    ['overview', text.overview], ['sales', text.salesTab], ['purchases', text.purchasesTab], ['products', text.productsTab, analytics.products.length], ['brands', text.brandsTab, analytics.brands.length], ['parties', text.partiesTab, analytics.parties.length], ['quality', text.qualityTab], ['overrides', text.overridesTab],
  ];

  return (
    <div className="sk-analytics-dashboard" data-testid="historical-trade-analytics">
      <div className="sk-analytics-tabs" role="tablist">
        {tabs.map(([key, label, count]) => <button key={key} type="button" role="tab" aria-selected={subTab === key} className={`sk-tab-btn ${subTab === key ? 'sk-tab-btn--active' : ''}`} onClick={() => setSubTab(key)}>{label}{count !== undefined ? ` (${count})` : ''}</button>)}
      </div>

      {subTab === 'overview' && <div className="sk-analytics-content">
        <div className="sk-kpi-grid">
          <HistoricalKpiCard title={text.totalSales} value={analytics.overview.totalSalesDzd} locale={locale} tone="success" badgeText={`${analytics.overview.transactionCount} ${text.transactions}`} subtitle={`${text.paid}: ${money(analytics.overview.paidSalesDzd)} · ${text.unpaid}: ${money(analytics.overview.unpaidSalesDzd)}`} />
          <HistoricalKpiCard title={text.totalPurchases} value={analytics.overview.totalPurchasesDzd} locale={locale} tone="info" subtitle={`${text.paid}: ${money(analytics.overview.paidPurchasesDzd)} · ${text.unpaid}: ${money(analytics.overview.unpaidPurchasesDzd)}`} />
          <HistoricalKpiCard title={text.totalExpenses} value={analytics.overview.totalExpensesDzd} locale={locale} tone="warning" subtitle={`${text.paid}: ${money(analytics.overview.paidExpensesDzd)}`} />
          <HistoricalKpiCard title={text.recordedBenefit} value={analytics.overview.totalManualBenefitDzd} locale={locale} tone="primary" badgeText={text.lineAggregate} />
        </div>
        <div className="sk-card sk-card--featured"><div className="sk-featured-summary"><div><span className="sk-featured-summary__label">{text.netDifference}</span><div className="sk-featured-summary__value">{money(analytics.overview.tradeDifferenceDzd)}</div></div><div className="sk-banner sk-banner--warning"><strong>{text.notice}</strong></div></div></div>
        <HistoricalTrendChart timeline={analytics.timeline} locale={locale} />
        <div className="sk-analytics-grid"><HistoricalRankingChart title={text.topProducts} items={topProducts} locale={locale} tone="emerald" /><HistoricalRankingChart title={text.topParties} items={topParties} locale={locale} tone="purple" /></div>
      </div>}

      {subTab === 'sales' && <div className="sk-analytics-content"><div className="sk-kpi-grid"><HistoricalKpiCard title={text.totalSales} value={analytics.payment.sales.total} locale={locale} tone="success" /><HistoricalKpiCard title={text.paidSales} value={analytics.payment.sales.paid} locale={locale} tone="success" /><HistoricalKpiCard title={text.unpaidSales} value={analytics.payment.sales.unpaid} locale={locale} tone="warning" /><HistoricalKpiCard title={text.recordedBenefit} value={analytics.benefits.totalManualBenefitDzd} locale={locale} tone="primary" /></div><HistoricalRankingChart title={text.topProducts} items={topProducts} locale={locale} tone="emerald" /></div>}
      {subTab === 'purchases' && <div className="sk-analytics-content"><div className="sk-kpi-grid"><HistoricalKpiCard title={text.totalPurchases} value={analytics.payment.purchases.total} locale={locale} tone="info" /><HistoricalKpiCard title={text.paidPurchases} value={analytics.payment.purchases.paid} locale={locale} tone="info" /><HistoricalKpiCard title={text.unpaidPurchases} value={analytics.payment.purchases.unpaid} locale={locale} tone="danger" /></div><HistoricalRankingChart title={text.topParties} items={topParties} locale={locale} tone="blue" /></div>}

      {subTab === 'products' && <div className="sk-table-container" tabIndex={0}><table className="sk-table"><thead><tr><SortHeader label={text.product} field="productName" sort={sort} onSort={changeSort} /><SortHeader label={text.qtySold} field="qtySold" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.sales} field="salesDzd" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.qtyBought} field="qtyPurchased" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.purchases} field="purchasesDzd" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.benefit} field="recordedBenefitDzd" sort={sort} onSort={changeSort} numeric /></tr></thead><tbody>{products.map((item, index) => <tr key={`${item.productName}-${index}`}><td><strong>{item.productName}</strong>{item.matchedProductId ? <span className="sk-badge sk-badge--success">{text.catalogMatched}</span> : null}</td><td className="sk-num">{item.qtySold}</td><td className="sk-num">{money(item.salesDzd)}</td><td className="sk-num">{item.qtyPurchased}</td><td className="sk-num">{money(item.purchasesDzd)}</td><td className="sk-num">{money(item.recordedBenefitDzd)}</td></tr>)}{products.length === 0 && <tr><td colSpan={6} className="sk-table-empty">{text.empty}</td></tr>}</tbody></table></div>}

      {subTab === 'brands' && <div className="sk-analytics-content"><HistoricalRankingChart title={text.brandsTab} items={topBrands} locale={locale} tone="blue" /><div className="sk-table-container" tabIndex={0}><table className="sk-table"><thead><tr><SortHeader label={text.brand} field="brand" sort={sort} onSort={changeSort} /><SortHeader label={text.lines} field="lineCount" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.sales} field="salesDzd" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.purchases} field="purchasesDzd" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.benefit} field="recordedBenefitDzd" sort={sort} onSort={changeSort} numeric /></tr></thead><tbody>{brands.map((item, index) => <tr key={`${item.brand}-${index}`}><td><strong>{item.brand}</strong></td><td className="sk-num">{item.lineCount ?? '—'}</td><td className="sk-num">{money(item.salesDzd)}</td><td className="sk-num">{money(item.purchasesDzd)}</td><td className="sk-num">{money(item.recordedBenefitDzd)}</td></tr>)}</tbody></table></div></div>}

      {subTab === 'parties' && <div className="sk-table-container" tabIndex={0}><table className="sk-table"><thead><tr><SortHeader label={text.party} field="partyCompany" sort={sort} onSort={changeSort} /><SortHeader label={text.sales} field="salesDzd" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.purchases} field="purchasesDzd" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.expenses} field="expensesDzd" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.volume} field="totalVolumeDzd" sort={sort} onSort={changeSort} numeric /><SortHeader label={text.benefit} field="recordedBenefitDzd" sort={sort} onSort={changeSort} numeric /></tr></thead><tbody>{parties.map((item, index) => <tr key={`${item.partyCompany}-${index}`}><td><strong>{item.partyCompany}</strong></td><td className="sk-num">{money(item.salesDzd)}</td><td className="sk-num">{money(item.purchasesDzd)}</td><td className="sk-num">{money(item.expensesDzd)}</td><td className="sk-num">{money(item.totalVolumeDzd)}</td><td className="sk-num">{money(item.recordedBenefitDzd)}</td></tr>)}</tbody></table></div>}

      {subTab === 'quality' && <div className="sk-chart-card"><h3>{text.coverage}</h3><div className="sk-quality-grid">{[[text.productCoverage, analytics.dataQuality.productNameCoveragePct, 'bg-emerald-500'], [text.brandCoverage, analytics.dataQuality.brandCoveragePct, 'bg-blue-500'], [text.partyCoverage, analytics.dataQuality.partyCoveragePct, 'bg-purple-500'], [text.pageCoverage, analytics.dataQuality.pageNumberCoveragePct, 'bg-amber-500']].map(([label, value, tone]) => <div key={String(label)} className="sk-quality-row"><div className="sk-quality-row__header"><span>{label}</span><span>{Number(value).toFixed(1)}%</span></div><div className="sk-progress-bar" role="progressbar" aria-label={String(label)} aria-valuenow={Number(value)} aria-valuemin={0} aria-valuemax={100}><div className={`sk-progress-bar__fill ${tone}`} style={{ width: `${Number(value)}%` }} /></div></div>)}</div></div>}

      {subTab === 'overrides' && <dl className="sk-details-grid"><div><dt>{text.calculatedLines}</dt><dd>{analytics.manualOverrides.calculatedLineCount}</dd></div><div><dt>{text.overrideLines}</dt><dd>{analytics.manualOverrides.manualOverrideCount}</dd></div><div><dt>{text.calculatedTotal}</dt><dd>{money(analytics.manualOverrides.calculatedMathematicalTotalDzd)}</dd></div><div><dt>{text.finalTotal}</dt><dd>{money(analytics.manualOverrides.finalEffectiveTotalDzd)}</dd></div><div><dt>{text.difference}</dt><dd>{money(analytics.manualOverrides.totalOverrideDifferenceDzd)}</dd></div></dl>}
    </div>
  );
}
