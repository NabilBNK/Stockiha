import React, { useState, useEffect } from 'react';
import { useTranslation } from '../../shared/i18n';
import {
  paperbookGetTxn,
  paperbookDeleteManual,
} from '../../shared/ipc/gateway';
import type {
  PaperBookTxnDetailDto,
  PaperBookTxnRowDto,
  PaperBookLineDto,
} from '../../shared/ipc/dto';

interface Props {
  txnId: number | null;
  sessionToken: string;
  onClose: () => void;
  onEdit: (txn: PaperBookTxnRowDto, lines: PaperBookLineDto[]) => void;
  onDeleted: () => void;
}

export const RecordDetailDrawer: React.FC<Props> = ({
  txnId,
  sessionToken,
  onClose,
  onEdit,
  onDeleted,
}) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<PaperBookTxnDetailDto | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    if (!txnId) {
      setDetail(null);
      return;
    }
    let isMounted = true;
    setLoading(true);
    setError(null);

    paperbookGetTxn(sessionToken, txnId)
      .then((res) => {
        if (isMounted) setDetail(res);
      })
      .catch((err: unknown) => {
        if (isMounted) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [txnId, sessionToken]);

  if (!txnId) return null;

  const handleDelete = async () => {
    if (!detail) return;
    if (!window.confirm(t('paperbook.detail.delete_confirm'))) return;

    setDeleting(true);
    try {
      await paperbookDeleteManual(sessionToken, detail.txn.id);
      onDeleted();
      onClose();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const txn = detail?.txn;
  const lines = detail?.lines ?? [];

  return (
    <div className="sk-paperbook-drawer-backdrop" onClick={onClose}>
      <div className="sk-paperbook-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="sk-paperbook-drawer__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>
              {t('paperbook.detail.title', { id: String(txnId) })}
            </h2>
            {txn && (
              <span className={`sk-paperbook-badge sk-paperbook-badge--${txn.txn_type}`}>
                {txn.txn_type.toUpperCase()}
              </span>
            )}
            {txn && (
              <span className={`sk-paperbook-badge sk-paperbook-badge--${txn.is_paid ? 'paid' : 'unpaid'}`}>
                {txn.is_paid ? t('paperbook.records.filter_paid_yes') : t('paperbook.records.filter_paid_no')}
              </span>
            )}
            {txn && (
              <span className={`sk-paperbook-badge sk-paperbook-badge--${txn.source}`}>
                {txn.source === 'import' ? t('paperbook.records.filter_source_import') : t('paperbook.records.filter_source_manual')}
              </span>
            )}
          </div>
          <button
            type="button"
            className="sk-btn sk-btn--ghost sk-btn--sm"
            onClick={onClose}
            style={{ fontSize: '1.2rem', padding: '4px 8px' }}
          >
            ✕
          </button>
        </div>

        <div className="sk-paperbook-drawer__body">
          {loading && <p style={{ color: 'var(--sk-muted)' }}>{t('common.loading')}</p>}
          {error && (
            <div style={{ padding: '12px', background: 'var(--sk-danger-soft)', color: 'var(--sk-danger)' }}>
              {error}
            </div>
          )}

          {txn && (
            <>
              {/* Meta Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '12px',
                  padding: '14px',
                  background: 'var(--sk-surface-soft)',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                }}
              >
                <div>
                  <span style={{ color: 'var(--sk-muted)', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>
                    {t('paperbook.records.col_date')}
                  </span>
                  <strong>{txn.txn_date}</strong>
                </div>

                <div>
                  <span style={{ color: 'var(--sk-muted)', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>
                    {t('paperbook.records.col_total')}
                  </span>
                  <strong style={{ fontSize: '1.1rem', color: 'var(--sk-primary)' }}>
                    {Number(txn.total).toLocaleString()} DZD
                  </strong>
                </div>

                <div>
                  <span style={{ color: 'var(--sk-muted)', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>
                    {t('paperbook.records.col_party')}
                  </span>
                  <strong>{txn.party_label || txn.party_raw || '—'}</strong>
                  {txn.party_label && txn.party_raw && txn.party_label !== txn.party_raw && (
                    <span style={{ display: 'block', color: 'var(--sk-muted)', fontSize: '0.72rem' }}>
                      (raw: {txn.party_raw})
                    </span>
                  )}
                </div>

                <div>
                  <span style={{ color: 'var(--sk-muted)', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>
                    {t('paperbook.records.col_benefit')}
                  </span>
                  <strong>{txn.benefit ? `${Number(txn.benefit).toLocaleString()} DZD` : '—'}</strong>
                </div>

                <div>
                  <span style={{ color: 'var(--sk-muted)', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>
                    {t('paperbook.records.col_source')}
                  </span>
                  {txn.source === 'import' ? (
                    <span>
                      Excel Row {txn.excel_first_row ?? '—'}
                      {txn.excel_txn_no ? ` (Txn #${txn.excel_txn_no})` : ''}
                    </span>
                  ) : (
                    <span>{t('paperbook.detail.source_manual')}</span>
                  )}
                </div>

                <div>
                  <span style={{ color: 'var(--sk-muted)', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>
                    {t('paperbook.records.col_page')}
                  </span>
                  <span>{txn.page_no || '—'}</span>
                </div>

                {txn.note && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ color: 'var(--sk-muted)', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>
                      {t('paperbook.form.note')}
                    </span>
                    <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{txn.note}</p>
                  </div>
                )}
              </div>

              {/* Lines Section */}
              <div>
                <h3 style={{ margin: '0 0 10px', fontSize: '0.92rem', fontWeight: 800 }}>
                  {t('paperbook.detail.lines_title', { count: String(lines.length) })}
                </h3>

                <div className="sk-paperbook-table-container">
                  <table className="sk-paperbook-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t('paperbook.detail.col_product')}</th>
                        <th>{t('paperbook.detail.col_brand')}</th>
                        <th>{t('paperbook.detail.col_details')}</th>
                        <th style={{ textAlign: 'right' }}>{t('paperbook.detail.col_qty')}</th>
                        <th style={{ textAlign: 'right' }}>{t('paperbook.detail.col_unit_price')}</th>
                        <th style={{ textAlign: 'right' }}>{t('paperbook.detail.col_line_total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.id}>
                          <td style={{ color: 'var(--sk-muted)', fontSize: '0.75rem' }}>{l.line_no}</td>
                          <td>
                            <strong>{l.product_label || l.product_raw || '—'}</strong>
                            {l.product_label && l.product_raw && l.product_label !== l.product_raw && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--sk-muted)' }}>
                                ({l.product_raw})
                              </div>
                            )}
                          </td>
                          <td>{l.brand_label || l.brand_raw || '—'}</td>
                          <td style={{ color: 'var(--sk-muted)' }}>{l.details_label || l.details_raw || '—'}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {l.quantity ? Number(l.quantity).toLocaleString() : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {l.unit_price ? Number(l.unit_price).toLocaleString() : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {Number(l.line_total).toLocaleString()} DZD
                            {l.total_overridden && (
                              <span
                                title="Line total overridden / preserved"
                                style={{ marginInlineStart: '4px', color: 'var(--sk-warn, #f59e0b)' }}
                              >
                                ⚠
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {txn && txn.source === 'manual' && (
          <div className="sk-paperbook-drawer__footer">
            <button
              type="button"
              className="sk-btn sk-btn--danger sk-btn--sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? t('common.loading') : t('paperbook.detail.delete_manual')}
            </button>
            <button
              type="button"
              className="sk-btn sk-btn--secondary sk-btn--sm"
              onClick={() => onEdit(txn, lines)}
              disabled={deleting}
            >
              {t('paperbook.detail.edit_manual')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
