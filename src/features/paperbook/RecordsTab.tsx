import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../shared/i18n';
import {
  paperbookListTxns,
  paperbookListTotals,
} from '../../shared/ipc/gateway';
import type {
  PaperBookTxnRowDto,
  PaperBookTotalsDto,
  PaperBookLineDto,
} from '../../shared/ipc/dto';
import { RecordDetailDrawer } from './RecordDetailDrawer';
import { RecordFormModal } from './RecordFormModal';

interface Props {
  sessionToken: string;
}

const PAGE_SIZE = 50;

export const RecordsTab: React.FC<Props> = ({ sessionToken }) => {
  const { t } = useTranslation();

  // Filters state
  const [search, setSearch] = useState<string>('');
  const [txnType, setTxnType] = useState<string>('');
  const [paid, setPaid] = useState<string>('');
  const [source, setSource] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [page, setPage] = useState<number>(0);

  // Data state
  const [txns, setTxns] = useState<PaperBookTxnRowDto[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totals, setTotals] = useState<PaperBookTotalsDto | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Modal / Drawer state
  const [selectedTxnId, setSelectedTxnId] = useState<number | null>(null);
  const [isFormModalOpen, setIsFormModalOpen] = useState<boolean>(false);
  const [editingTxn, setEditingTxn] = useState<PaperBookTxnRowDto | null>(null);
  const [editingLines, setEditingLines] = useState<PaperBookLineDto[] | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filterParams = {
        from: fromDate || undefined,
        to: toDate || undefined,
        txnType: txnType || undefined,
        paid: paid || undefined,
        source: source || undefined,
        search: search.trim() || undefined,
      };

      const [listRes, totalsRes] = await Promise.all([
        paperbookListTxns(sessionToken, {
          ...filterParams,
          sort: 'newest',
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        paperbookListTotals(sessionToken, filterParams),
      ]);

      setTxns(listRes.txns);
      setTotalCount(listRes.total_count);
      setTotals(totalsRes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, fromDate, toDate, txnType, paid, source, search, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset page when filters change
  const handleFilterChange = (setter: (val: string) => void, val: string) => {
    setter(val);
    setPage(0);
  };

  const handleOpenCreate = () => {
    setEditingTxn(null);
    setEditingLines(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (txn: PaperBookTxnRowDto, lines: PaperBookLineDto[]) => {
    setEditingTxn(txn);
    setEditingLines(lines);
    setSelectedTxnId(null);
    setIsFormModalOpen(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top KPI Cards */}
      {totals && (
        <div className="sk-paperbook-kpis">
          <div className="sk-paperbook-kpi-card sk-paperbook-kpi-card--primary">
            <div className="sk-paperbook-kpi-label">{t('paperbook.records.kpi_count')}</div>
            <div className="sk-paperbook-kpi-value">{Number(totals.txn_count).toLocaleString()}</div>
            <div className="sk-paperbook-kpi-sub">Total matches</div>
          </div>

          <div className="sk-paperbook-kpi-card sk-paperbook-kpi-card--success">
            <div className="sk-paperbook-kpi-label">{t('paperbook.records.kpi_sells')}</div>
            <div className="sk-paperbook-kpi-value">{Number(totals.sell_total).toLocaleString()} DZD</div>
            <div className="sk-paperbook-kpi-sub">
              {t('paperbook.records.kpi_benefit')}: {Number(totals.benefit_total).toLocaleString()} DZD
            </div>
          </div>

          <div className="sk-paperbook-kpi-card sk-paperbook-kpi-card--info">
            <div className="sk-paperbook-kpi-label">{t('paperbook.records.kpi_buys')}</div>
            <div className="sk-paperbook-kpi-value">{Number(totals.buy_total).toLocaleString()} DZD</div>
            <div className="sk-paperbook-kpi-sub">Procurement</div>
          </div>

          <div className="sk-paperbook-kpi-card sk-paperbook-kpi-card--warning">
            <div className="sk-paperbook-kpi-label">{t('paperbook.records.kpi_expenses')}</div>
            <div className="sk-paperbook-kpi-value">{Number(totals.expense_total).toLocaleString()} DZD</div>
            <div className="sk-paperbook-kpi-sub">Operating expenses</div>
          </div>

          <div className="sk-paperbook-kpi-card sk-paperbook-kpi-card--danger">
            <div className="sk-paperbook-kpi-label">{t('paperbook.records.kpi_unpaid')}</div>
            <div className="sk-paperbook-kpi-value">{Number(totals.not_paid_total).toLocaleString()} DZD</div>
            <div className="sk-paperbook-kpi-sub">Credit / pending balance</div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="sk-paperbook-filters">
        <div className="sk-paperbook-filters__group">
          <div className="sk-paperbook-search">
            <input
              type="text"
              value={search}
              onChange={(e) => handleFilterChange(setSearch, e.target.value)}
              placeholder={t('paperbook.records.search')}
            />
          </div>

          <select
            value={txnType}
            onChange={(e) => handleFilterChange(setTxnType, e.target.value)}
            className="sk-paperbook-select"
          >
            <option value="">{t('paperbook.records.filter_type_all')}</option>
            <option value="sell">{t('paperbook.records.filter_type_sell')}</option>
            <option value="buy">{t('paperbook.records.filter_type_buy')}</option>
            <option value="expense">{t('paperbook.records.filter_type_expense')}</option>
          </select>

          <select
            value={paid}
            onChange={(e) => handleFilterChange(setPaid, e.target.value)}
            className="sk-paperbook-select"
          >
            <option value="">{t('paperbook.records.filter_paid_all')}</option>
            <option value="paid">{t('paperbook.records.filter_paid_yes')}</option>
            <option value="not_paid">{t('paperbook.records.filter_paid_no')}</option>
          </select>

          <select
            value={source}
            onChange={(e) => handleFilterChange(setSource, e.target.value)}
            className="sk-paperbook-select"
          >
            <option value="">{t('paperbook.records.filter_source_all')}</option>
            <option value="import">{t('paperbook.records.filter_source_import')}</option>
            <option value="manual">{t('paperbook.records.filter_source_manual')}</option>
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--sk-muted)' }}>{t('paperbook.records.from')}:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => handleFilterChange(setFromDate, e.target.value)}
              className="sk-paperbook-date-input"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--sk-muted)' }}>{t('paperbook.records.to')}:</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => handleFilterChange(setToDate, e.target.value)}
              className="sk-paperbook-date-input"
            />
          </div>
        </div>

        <button
          type="button"
          className="sk-btn sk-btn--primary"
          onClick={handleOpenCreate}
        >
          + {t('paperbook.records.btn_new')}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ padding: '12px', background: 'var(--sk-danger-soft)', color: 'var(--sk-danger)', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div className="sk-paperbook-table-container">
        <table className="sk-paperbook-table">
          <thead>
            <tr>
              <th>{t('paperbook.records.col_date')}</th>
              <th>{t('paperbook.records.col_type')}</th>
              <th>{t('paperbook.records.col_party')}</th>
              <th>{t('paperbook.records.col_what')}</th>
              <th style={{ textAlign: 'right' }}>{t('paperbook.records.col_total')}</th>
              <th style={{ textAlign: 'center' }}>{t('paperbook.records.col_paid')}</th>
              <th style={{ textAlign: 'right' }}>{t('paperbook.records.col_benefit')}</th>
              <th>{t('paperbook.records.col_source')}</th>
              <th style={{ textAlign: 'center' }}>{t('paperbook.records.col_page')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && txns.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: 'var(--sk-muted)' }}>
                  {t('common.loading')}
                </td>
              </tr>
            ) : txns.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: 'var(--sk-muted)' }}>
                  {t('paperbook.records.no_records')}
                </td>
              </tr>
            ) : (
              txns.map((row) => (
                <tr key={row.id} onClick={() => setSelectedTxnId(row.id)}>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{row.txn_date}</strong>
                  </td>
                  <td>
                    <span className={`sk-paperbook-badge sk-paperbook-badge--${row.txn_type}`}>
                      {row.txn_type.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <strong>{row.party_label || row.party_raw || '—'}</strong>
                    {row.party_label && row.party_raw && row.party_label !== row.party_raw && (
                      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--sk-muted)' }}>
                        ({row.party_raw})
                      </span>
                    )}
                  </td>
                  <td style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.what_label || (row.line_count > 0 ? t('paperbook.records.lines_count', { count: String(row.line_count) }) : '—')}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {Number(row.total).toLocaleString()} DZD
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`sk-paperbook-badge sk-paperbook-badge--${row.is_paid ? 'paid' : 'unpaid'}`}>
                      {row.is_paid ? t('paperbook.records.filter_paid_yes') : t('paperbook.records.filter_paid_no')}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {row.benefit ? `${Number(row.benefit).toLocaleString()} DZD` : '—'}
                  </td>
                  <td>
                    <span className={`sk-paperbook-badge sk-paperbook-badge--${row.source}`}>
                      {row.source === 'import' ? t('paperbook.records.filter_source_import') : t('paperbook.records.filter_source_manual')}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', color: 'var(--sk-muted)' }}>
                    {row.page_no || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination Footer */}
        <div className="sk-paperbook-pagination">
          <div>
            {t('paperbook.records.pagination', {
              from: String(totalCount === 0 ? 0 : page * PAGE_SIZE + 1),
              to: String(Math.min((page + 1) * PAGE_SIZE, totalCount)),
              total: String(totalCount),
            })}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="sk-btn sk-btn--secondary sk-btn--sm"
              disabled={page === 0 || loading}
              onClick={() => setPage(page - 1)}
            >
              {t('paperbook.records.btn_previous')}
            </button>
            <button
              type="button"
              className="sk-btn sk-btn--secondary sk-btn--sm"
              disabled={(page + 1) * PAGE_SIZE >= totalCount || loading}
              onClick={() => setPage(page + 1)}
            >
              {t('paperbook.records.btn_next')}
            </button>
          </div>
        </div>
      </div>

      {/* Detail Drawer */}
      <RecordDetailDrawer
        txnId={selectedTxnId}
        sessionToken={sessionToken}
        onClose={() => setSelectedTxnId(null)}
        onEdit={handleOpenEdit}
        onDeleted={loadData}
      />

      {/* Manual Entry Form Modal */}
      <RecordFormModal
        isOpen={isFormModalOpen}
        sessionToken={sessionToken}
        editingTxn={editingTxn}
        editingLines={editingLines}
        onClose={() => setIsFormModalOpen(false)}
        onSaved={loadData}
      />
    </div>
  );
};
