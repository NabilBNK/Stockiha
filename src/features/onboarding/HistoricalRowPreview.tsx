import { useState } from 'react';
import type { Locale } from '../../shared/i18n';
import type { PaperBookTransaction } from './xlsxParser';

interface Props {
  transactions: PaperBookTransaction[];
  locale: Locale;
  isPartial?: boolean;
}

export function HistoricalRowPreview({ transactions, locale, isPartial = false }: Props) {
  const [filterType, setFilterType] = useState<'ALL' | 'SALE' | 'PURCHASE' | 'EXPENSE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  if (!transactions || transactions.length === 0) return null;

  const filteredTransactions = transactions.filter((txn) => {
    if (filterType !== 'ALL' && txn.transactionType !== filterType) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (txn.sourceExcelTxnRef ?? '').toLowerCase().includes(q) ||
      (txn.partyCompany && txn.partyCompany.toLowerCase().includes(q)) ||
      txn.lines.some(
        (l) =>
          (l.productName && l.productName.toLowerCase().includes(q)) ||
          (l.brand && l.brand.toLowerCase().includes(q)) ||
          (l.partyCompany && l.partyCompany.toLowerCase().includes(q)) ||
          (l.customDetails && l.customDetails.toLowerCase().includes(q)),
      )
    );
  });

  const formatDzd = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '—';
    return `${new Intl.NumberFormat(locale).format(amount)} DZD`;
  };

  return (
    <div className="sk-row-preview" data-testid="paperbook-preview">
      {isPartial && (
        <div className="sk-banner sk-banner--warning mb-4">
          <strong>
            {locale === 'ar'
              ? 'معاينة جزئية — المجاميع الموضحة هي إجمالي الحسابات الجزئية وليست النهائية'
              : locale === 'fr'
                ? 'Aperçu Partiel — Les totaux affichés sont des sous-totaux partiels'
                : 'Partial Preview — Displayed totals are parsed sub-totals, not final approval numbers'}
          </strong>
        </div>
      )}

      <div className="sk-row-preview__controls">
        <div className="sk-row-preview__filters">
          <button
            type="button"
            className={`sk-tab-btn ${filterType === 'ALL' ? 'sk-tab-btn--active' : ''}`}
            onClick={() => setFilterType('ALL')}
          >
            {locale === 'ar' ? 'الكل' : locale === 'fr' ? 'Tous' : 'All'} ({transactions.length})
          </button>
          <button
            type="button"
            className={`sk-tab-btn ${filterType === 'SALE' ? 'sk-tab-btn--active' : ''}`}
            onClick={() => setFilterType('SALE')}
          >
            {locale === 'ar' ? 'مبيعات (SELL)' : 'Sales (SELL)'}
          </button>
          <button
            type="button"
            className={`sk-tab-btn ${filterType === 'PURCHASE' ? 'sk-tab-btn--active' : ''}`}
            onClick={() => setFilterType('PURCHASE')}
          >
            {locale === 'ar' ? 'مشتريات (BUY)' : 'Purchases (BUY)'}
          </button>
          <button
            type="button"
            className={`sk-tab-btn ${filterType === 'EXPENSE' ? 'sk-tab-btn--active' : ''}`}
            onClick={() => setFilterType('EXPENSE')}
          >
            {locale === 'ar' ? 'مصاريف (EXPENSE)' : 'Expenses'}
          </button>
        </div>

        <input
          type="text"
          className="sk-field__input sk-row-preview__search"
          placeholder={
            locale === 'ar'
              ? 'بحث في المعاملات أو الموردين أو المنتجات...'
              : 'Search transaction, party, or product...'
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="sk-table-container">
        <table className="sk-table">
          <thead>
            <tr>
              <th>{locale === 'ar' ? 'السطر' : 'Row'}</th>
              <th>{locale === 'ar' ? 'المرجع' : 'Txn Ref'}</th>
              <th>{locale === 'ar' ? 'التاريخ' : 'Date'}</th>
              <th>{locale === 'ar' ? 'النوع' : 'Type'}</th>
              <th>{locale === 'ar' ? 'الحالة' : 'Payment'}</th>
              <th>{locale === 'ar' ? 'الطرف / الشركة' : 'Party / Company'}</th>
              <th>{locale === 'ar' ? 'المنتج / العلامة' : 'Product / Brand'}</th>
              <th className="text-right">{locale === 'ar' ? 'الكمية' : 'Qty'}</th>
              <th className="text-right">{locale === 'ar' ? 'سعر الوحدة' : 'Unit Price'}</th>
              <th className="text-right">{locale === 'ar' ? 'إجمالي السطر' : 'Line Total'}</th>
              <th className="text-right">{locale === 'ar' ? 'الفائدة' : 'Benefit'}</th>
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.flatMap((txn) =>
              txn.lines.map((line, lIdx) => {
                const isFirstLine = lIdx === 0;
                return (
                  <tr
                    key={`${txn.sourceTransactionSequence}-${line.lineSequence}`}
                    className={isFirstLine ? 'sk-table__row--txn-start' : 'sk-table__row--continuation'}
                  >
                    <td className="text-muted text-xs">{line.sourceRowNumber}</td>
                    <td>{isFirstLine ? <strong>{txn.sourceExcelTxnRef}</strong> : null}</td>
                    <td>{isFirstLine ? txn.transactionDate : null}</td>
                    <td>
                      {isFirstLine && (
                        <span
                          className={`sk-badge ${
                            txn.transactionType === 'SALE'
                              ? 'sk-badge--success'
                              : txn.transactionType === 'PURCHASE'
                                ? 'sk-badge--info'
                                : 'sk-badge--warning'
                          }`}
                        >
                          {txn.transactionType}
                        </span>
                      )}
                    </td>
                    <td>
                      {isFirstLine && (
                        <span
                          className={`sk-badge ${
                            txn.paymentStatus === 'PAID' ? 'sk-badge--success' : 'sk-badge--danger'
                          }`}
                        >
                          {txn.paymentStatus}
                        </span>
                      )}
                    </td>
                    <td>
                      {line.partyCompany ? (
                        <span className="sk-tag sk-tag--party">{line.partyCompany}</span>
                      ) : isFirstLine && txn.partyCompany ? (
                        <span>{txn.partyCompany}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {line.productName ? (
                        <div>
                          <strong>{line.productName}</strong>
                          {line.brand && <span className="text-muted text-xs ml-1">({line.brand})</span>}
                        </div>
                      ) : line.customDetails ? (
                        <span className="italic">{line.customDetails}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-right">{line.quantity ?? '—'}</td>
                    <td className="text-right">{formatDzd(line.unitPriceDzd)}</td>
                    <td className="text-right font-medium">
                      {formatDzd(line.manualLineTotalDzd ?? (line.quantity && line.unitPriceDzd ? line.quantity * line.unitPriceDzd : null))}
                    </td>
                    <td className="text-right">
                      {line.manualBenefitDzd !== null && line.manualBenefitDzd !== undefined ? (
                        <span className="sk-badge sk-badge--success">
                          {formatDzd(line.manualBenefitDzd)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
