import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../shared/i18n';
import type { PaperBookTransaction } from './xlsxParser';
import {
  filterHistoricalRows,
  flattenHistoricalTransactions,
  formatExactAmount,
  historicalRowsKpis,
  nextHistoricalSort,
  sortHistoricalRows,
  type HistoricalTableRow,
  type HistoricalTableSort,
  type HistoricalTableSortKey,
} from './historicalTableModel';

interface Props {
  transactions: PaperBookTransaction[];
  locale: Locale;
  isPartial?: boolean;
  onRowsChange?: (rows: HistoricalTableRow[]) => void;
}

const COPY = {
  en: {
    all: 'All', sales: 'Sales (SELL)', purchases: 'Purchases (BUY)', expenses: 'Expenses',
    search: 'Search transaction, party, or product…', row: 'Row', reference: 'Txn Ref', date: 'Date',
    type: 'Type', payment: 'Payment', party: 'Party / Company', product: 'Product / Brand', qty: 'Qty',
    unitPrice: 'Unit Price', total: 'Line Total', benefit: 'Benefit', empty: 'No rows match the current filters.',
    scope: 'Table and Excel export use the filtered, sorted rows shown here.', rows: 'rows', transactions: 'transactions',
    partial: 'Partial Preview — Displayed totals are parsed sub-totals, not final approval numbers',
  },
  fr: {
    all: 'Tous', sales: 'Ventes (SELL)', purchases: 'Achats (BUY)', expenses: 'Dépenses',
    search: 'Rechercher une transaction, un partenaire ou un produit…', row: 'Ligne', reference: 'Réf. txn', date: 'Date',
    type: 'Type', payment: 'Paiement', party: 'Partenaire / Société', product: 'Produit / Marque', qty: 'Qté',
    unitPrice: 'Prix unitaire', total: 'Total ligne', benefit: 'Bénéfice', empty: 'Aucune ligne ne correspond aux filtres.',
    scope: 'Le tableau et l’export Excel utilisent les lignes filtrées et triées affichées ici.', rows: 'lignes', transactions: 'transactions',
    partial: 'Aperçu partiel — Les totaux affichés sont des sous-totaux partiels',
  },
  ar: {
    all: 'الكل', sales: 'المبيعات (SELL)', purchases: 'المشتريات (BUY)', expenses: 'المصاريف',
    search: 'ابحث في المعاملات أو الأطراف أو المنتجات…', row: 'السطر', reference: 'المرجع', date: 'التاريخ',
    type: 'النوع', payment: 'الدفع', party: 'الطرف / الشركة', product: 'المنتج / العلامة', qty: 'الكمية',
    unitPrice: 'سعر الوحدة', total: 'إجمالي السطر', benefit: 'الفائدة', empty: 'لا توجد أسطر مطابقة لعوامل التصفية.',
    scope: 'يعرض الجدول ويصدّر Excel الأسطر المصفّاة والمرتّبة الحالية.', rows: 'أسطر', transactions: 'معاملات',
    partial: 'معاينة جزئية — المجاميع المعروضة مؤقتة وليست أرقام الموافقة النهائية',
  },
} as const;

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  numeric = false,
}: {
  label: string;
  sortKey: HistoricalTableSortKey;
  sort: HistoricalTableSort | null;
  onSort: (key: HistoricalTableSortKey) => void;
  numeric?: boolean;
}) {
  const active = sort?.key === sortKey;
  const ariaSort = active ? sort.direction : 'none';
  return (
    <th aria-sort={ariaSort} className={numeric ? 'sk-num' : undefined}>
      <button type="button" className="sk-sort-header" onClick={() => onSort(sortKey)}>
        <span>{label}</span>
        <span className={`sk-sort-header__icon ${active ? 'sk-sort-header__icon--active' : ''}`} aria-hidden>
          {active ? (sort.direction === 'ascending' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

export function HistoricalRowPreview({ transactions, locale, isPartial = false, onRowsChange }: Props) {
  const [filterType, setFilterType] = useState<'ALL' | PaperBookTransaction['transactionType']>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<HistoricalTableSort | null>(null);
  const text = COPY[locale];
  const allRows = useMemo(() => flattenHistoricalTransactions(transactions), [transactions]);
  const visibleRows = useMemo(
    () => sortHistoricalRows(filterHistoricalRows(allRows, filterType, searchQuery), sort, locale),
    [allRows, filterType, searchQuery, sort, locale],
  );
  const kpis = useMemo(() => historicalRowsKpis(visibleRows), [visibleRows]);

  useEffect(() => onRowsChange?.(visibleRows), [onRowsChange, visibleRows]);

  const formatDzd = (amount: string | null) => {
    const formatted = formatExactAmount(amount, locale);
    return formatted === null ? '—' : `${formatted} DZD`;
  };
  const updateSort = (key: HistoricalTableSortKey) => setSort((current) => nextHistoricalSort(current, key));

  return (
    <div className="sk-row-preview" data-testid="paperbook-preview">
      {isPartial && <div className="sk-banner sk-banner--warning"><strong>{text.partial}</strong></div>}

      <div className="sk-row-preview__controls">
        <div className="sk-row-preview__filters" role="group" aria-label={text.type}>
          {([
            ['ALL', text.all, transactions.length],
            ['SALE', text.sales, transactions.filter((item) => item.transactionType === 'SALE').length],
            ['PURCHASE', text.purchases, transactions.filter((item) => item.transactionType === 'PURCHASE').length],
            ['EXPENSE', text.expenses, transactions.filter((item) => item.transactionType === 'EXPENSE').length],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              className={`sk-tab-btn ${filterType === value ? 'sk-tab-btn--active' : ''}`}
              aria-pressed={filterType === value}
              onClick={() => setFilterType(value)}
            >
              {label} <span className="sk-tab-btn__count">{count}</span>
            </button>
          ))}
        </div>
        <label className="sk-row-preview__search-wrap">
          <span className="sk-visually-hidden">{text.search}</span>
          <span aria-hidden>⌕</span>
          <input
            type="search"
            className="sk-field__input sk-row-preview__search"
            placeholder={text.search}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="sk-table-scope" role="status">
        <span>{kpis.transactionCount} {text.transactions} · {kpis.rowCount} {text.rows}</span>
        <span>{text.scope}</span>
      </div>

      <div className="sk-table-container" tabIndex={0} aria-label={text.scope}>
        <table className="sk-table sk-table--historical">
          <thead>
            <tr>
              <SortableHeader label={text.row} sortKey="row" sort={sort} onSort={updateSort} />
              <SortableHeader label={text.reference} sortKey="reference" sort={sort} onSort={updateSort} />
              <SortableHeader label={text.date} sortKey="date" sort={sort} onSort={updateSort} />
              <SortableHeader label={text.type} sortKey="type" sort={sort} onSort={updateSort} />
              <SortableHeader label={text.payment} sortKey="payment" sort={sort} onSort={updateSort} />
              <SortableHeader label={text.party} sortKey="party" sort={sort} onSort={updateSort} />
              <SortableHeader label={text.product} sortKey="product" sort={sort} onSort={updateSort} />
              <SortableHeader label={text.qty} sortKey="quantity" sort={sort} onSort={updateSort} numeric />
              <SortableHeader label={text.unitPrice} sortKey="unitPrice" sort={sort} onSort={updateSort} numeric />
              <SortableHeader label={text.total} sortKey="lineTotal" sort={sort} onSort={updateSort} numeric />
              <SortableHeader label={text.benefit} sortKey="benefit" sort={sort} onSort={updateSort} numeric />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={`${row.transactionSequence}-${row.lineSequence}`}>
                <td className="sk-muted">{row.row}</td>
                <td><strong>{row.reference ?? '—'}</strong></td>
                <td className="sk-nowrap">{row.date}</td>
                <td><span className={`sk-badge sk-badge--${row.type === 'SALE' ? 'success' : row.type === 'PURCHASE' ? 'info' : 'warning'}`}>{row.type}</span></td>
                <td><span className={`sk-badge sk-badge--${row.payment === 'PAID' ? 'success' : 'danger'}`}>{row.payment}</span></td>
                <td><span className="sk-cell-ellipsis" title={row.party ?? undefined}>{row.party ?? '—'}</span></td>
                <td>
                  <span className="sk-cell-ellipsis" title={[row.product, row.brand, row.details].filter(Boolean).join(' · ') || undefined}>
                    <strong>{row.product ?? row.details ?? '—'}</strong>{row.brand ? <small> ({row.brand})</small> : null}
                  </span>
                </td>
                <td className="sk-num">{row.quantity ?? '—'}</td>
                <td className="sk-num">{formatDzd(row.unitPrice)}</td>
                <td className="sk-num"><strong>{formatDzd(row.lineTotal)}</strong></td>
                <td className="sk-num">{row.benefit !== null ? <span className="sk-badge sk-badge--success">{formatDzd(row.benefit)}</span> : '—'}</td>
              </tr>
            ))}
            {visibleRows.length === 0 && <tr><td colSpan={11} className="sk-table-empty">{text.empty}</td></tr>}
          </tbody>
          {visibleRows.length > 0 && (
            <tfoot>
              {/*
                No monetary totals here on purpose: every total the owner sees
                is computed by PostgreSQL in exact decimal arithmetic once the
                rows are staged. The footer reports coverage only.
              */}
              <tr>
                <th colSpan={7}>
                  {kpis.rowCount} {text.rows} · {kpis.transactionCount} {text.transactions}
                </th>
                <td className="sk-num sk-muted">{kpis.linesWithoutQuantity ? `−${kpis.linesWithoutQuantity}` : ''}</td>
                <td />
                <td className="sk-num sk-muted">{kpis.linesWithoutAmount ? `−${kpis.linesWithoutAmount}` : ''}</td>
                <td className="sk-num sk-muted">{kpis.linesWithoutBenefit ? `−${kpis.linesWithoutBenefit}` : ''}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
