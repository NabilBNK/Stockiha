import React, { useState, useEffect } from 'react';
import { useTranslation } from '../../shared/i18n';
import {
  paperbookCreateManual,
  paperbookUpdateManual,
  paperbookAutocomplete,
} from '../../shared/ipc/gateway';
import type {
  PaperBookTxnRowDto,
  PaperBookLineDto,
} from '../../shared/ipc/dto';

interface FormLine {
  id?: number;
  product: string;
  brand: string;
  details: string;
  qty: string;
  unitPrice: string;
  lineTotal: string;
  page: string;
}

interface Props {
  isOpen: boolean;
  sessionToken: string;
  editingTxn: PaperBookTxnRowDto | null;
  editingLines: PaperBookLineDto[] | null;
  onClose: () => void;
  onSaved: (id: number) => void;
}

export const RecordFormModal: React.FC<Props> = ({
  isOpen,
  sessionToken,
  editingTxn,
  editingLines,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation();

  const [date, setDate] = useState<string>('');
  const [txnType, setTxnType] = useState<'sell' | 'buy' | 'expense'>('sell');
  const [isPaid, setIsPaid] = useState<boolean>(true);
  const [party, setParty] = useState<string>('');
  const [benefit, setBenefit] = useState<string>('');
  const [pageNo, setPageNo] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const [lines, setLines] = useState<FormLine[]>([
    { product: '', brand: '', details: '', qty: '', unitPrice: '', lineTotal: '', page: '' },
  ]);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Autocomplete state
  const [partySuggestions, setPartySuggestions] = useState<string[]>([]);
  const [activeAcField, setActiveAcField] = useState<{ rowIdx: number; field: string } | null>(null);
  const [lineSuggestions, setLineSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    if (editingTxn) {
      setDate(editingTxn.txn_date);
      setTxnType(editingTxn.txn_type);
      setIsPaid(editingTxn.is_paid);
      setParty(editingTxn.party_raw || '');
      setBenefit(editingTxn.benefit || '');
      setPageNo(editingTxn.page_no || '');
      setNote(editingTxn.note || '');

      if (editingLines && editingLines.length > 0) {
        setLines(
          editingLines.map((l) => ({
            id: l.id,
            product: l.product_raw || '',
            brand: l.brand_raw || '',
            details: l.details_raw || '',
            qty: l.quantity || '',
            unitPrice: l.unit_price || '',
            lineTotal: l.line_total || '',
            page: l.page_no || '',
          }))
        );
      }
    } else {
      setDate(new Date().toISOString().slice(0, 10));
      setTxnType('sell');
      setIsPaid(true);
      setParty('');
      setBenefit('');
      setPageNo('');
      setNote('');
      setLines([
        { product: '', brand: '', details: '', qty: '', unitPrice: '', lineTotal: '', page: '' },
      ]);
    }
    setError(null);
  }, [isOpen, editingTxn, editingLines]);

  if (!isOpen) return null;

  const handlePartyChange = async (val: string) => {
    setParty(val);
    if (val.trim().length >= 1) {
      try {
        const list = await paperbookAutocomplete(sessionToken, 'party', val.trim(), 8);
        setPartySuggestions(list);
      } catch {
        setPartySuggestions([]);
      }
    } else {
      setPartySuggestions([]);
    }
  };

  const handleLineChange = async (
    idx: number,
    field: keyof FormLine,
    val: string
  ) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: val };

    // Auto-compute line total if qty and unitPrice are typed
    if (field === 'qty' || field === 'unitPrice') {
      const q = parseInt(field === 'qty' ? val : updated[idx].qty, 10);
      const p = parseInt(field === 'unitPrice' ? val : updated[idx].unitPrice, 10);
      if (!isNaN(q) && !isNaN(p) && q > 0 && p >= 0) {
        updated[idx].lineTotal = String(q * p);
      }
    }

    setLines(updated);

    // Autocomplete for line fields
    if (field === 'product' || field === 'brand' || field === 'details') {
      if (val.trim().length >= 1) {
        setActiveAcField({ rowIdx: idx, field });
        try {
          const list = await paperbookAutocomplete(sessionToken, field, val.trim(), 8);
          setLineSuggestions(list);
        } catch {
          setLineSuggestions([]);
        }
      } else {
        setActiveAcField(null);
        setLineSuggestions([]);
      }
    }
  };

  const addLine = () => {
    setLines([
      ...lines,
      { product: '', brand: '', details: '', qty: '', unitPrice: '', lineTotal: '', page: '' },
    ]);
  };

  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const sumTotal = lines.reduce((acc, l) => {
    const num = parseInt(l.lineTotal, 10);
    return acc + (isNaN(num) ? 0 : num);
  }, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (lines.length === 0) {
      setError(t('paperbook.form.error_no_lines'));
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const total = parseInt(lines[i].lineTotal, 10);
      if (isNaN(total) || total <= 0) {
        setError(`Line #${i + 1}: Line total must be greater than zero.`);
        return;
      }
    }

    const payload = {
      date,
      type: txnType,
      paid: isPaid,
      party: party.trim() || null,
      benefit: txnType === 'sell' && benefit.trim() ? benefit.trim() : null,
      page: pageNo.trim() || null,
      note: note.trim() || null,
      lines: lines.map((l) => ({
        product: l.product.trim() || null,
        brand: l.brand.trim() || null,
        details: l.details.trim() || null,
        qty: l.qty.trim() || null,
        unit_price: l.unitPrice.trim() || null,
        line_total: l.lineTotal.trim(),
        page: l.page.trim() || null,
      })),
    };

    setLoading(true);
    try {
      if (editingTxn) {
        const id = await paperbookUpdateManual(sessionToken, editingTxn.id, payload);
        onSaved(id);
      } else {
        const id = await paperbookCreateManual(sessionToken, payload);
        onSaved(id);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sk-paperbook-modal-backdrop" onClick={onClose}>
      <div
        className="sk-paperbook-modal"
        style={{ width: 'min(900px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sk-paperbook-modal__header">
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
            {editingTxn ? t('paperbook.form.edit_title') : t('paperbook.form.create_title')}
          </h2>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className="sk-paperbook-modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {error && (
              <div style={{ padding: '10px 14px', background: 'var(--sk-danger-soft)', color: 'var(--sk-danger)', borderRadius: '6px' }}>
                {error}
              </div>
            )}

            {/* Header row 1: Date, Type, Paid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                  {t('paperbook.form.date')} *
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="sk-paperbook-date-input"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                  {t('paperbook.form.type')} *
                </label>
                <select
                  value={txnType}
                  onChange={(e) => setTxnType(e.target.value as 'sell' | 'buy' | 'expense')}
                  className="sk-paperbook-select"
                  style={{ width: '100%' }}
                >
                  <option value="sell">{t('paperbook.records.filter_type_sell')}</option>
                  <option value="buy">{t('paperbook.records.filter_type_buy')}</option>
                  <option value="expense">{t('paperbook.records.filter_type_expense')}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                  {t('paperbook.form.paid')} *
                </label>
                <select
                  value={isPaid ? 'true' : 'false'}
                  onChange={(e) => setIsPaid(e.target.value === 'true')}
                  className="sk-paperbook-select"
                  style={{ width: '100%' }}
                >
                  <option value="true">{t('paperbook.records.filter_paid_yes')}</option>
                  <option value="false">{t('paperbook.records.filter_paid_no')}</option>
                </select>
              </div>
            </div>

            {/* Header row 2: Party, Benefit, Page */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                  {t('paperbook.form.party')}
                </label>
                <input
                  type="text"
                  value={party}
                  onChange={(e) => handlePartyChange(e.target.value)}
                  onBlur={() => setTimeout(() => setPartySuggestions([]), 200)}
                  placeholder="Customer or supplier name"
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 10px',
                    border: '1px solid var(--sk-border)',
                    borderRadius: '6px',
                    background: 'var(--sk-surface-soft)',
                  }}
                />
                {partySuggestions.length > 0 && (
                  <ul
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      zIndex: 50,
                      margin: '2px 0 0',
                      padding: '4px 0',
                      listStyle: 'none',
                      background: 'var(--sk-surface)',
                      border: '1px solid var(--sk-border)',
                      borderRadius: '6px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      maxHeight: '180px',
                      overflowY: 'auto',
                    }}
                  >
                    {partySuggestions.map((s, idx) => (
                      <li
                        key={idx}
                        onMouseDown={() => {
                          setParty(s);
                          setPartySuggestions([]);
                        }}
                        style={{
                          padding: '6px 12px',
                          cursor: 'pointer',
                          fontSize: '0.82rem',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sk-surface-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                  {t('paperbook.form.benefit')}
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  disabled={txnType !== 'sell'}
                  value={benefit}
                  onChange={(e) => setBenefit(e.target.value)}
                  placeholder={txnType === 'sell' ? 'DZD' : 'N/A for non-sale'}
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 10px',
                    border: '1px solid var(--sk-border)',
                    borderRadius: '6px',
                    background: txnType === 'sell' ? 'var(--sk-surface-soft)' : 'var(--sk-surface-disabled, #eee)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                  {t('paperbook.form.page')}
                </label>
                <input
                  type="text"
                  value={pageNo}
                  onChange={(e) => setPageNo(e.target.value)}
                  placeholder="e.g. 42"
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 10px',
                    border: '1px solid var(--sk-border)',
                    borderRadius: '6px',
                    background: 'var(--sk-surface-soft)',
                  }}
                />
              </div>
            </div>

            {/* Note */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                {t('paperbook.form.note')}
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional notes or remarks"
                style={{
                  width: '100%',
                  height: '38px',
                  padding: '0 10px',
                  border: '1px solid var(--sk-border)',
                  borderRadius: '6px',
                  background: 'var(--sk-surface-soft)',
                }}
              />
            </div>

            {/* Line Items Section */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800 }}>
                  {t('paperbook.form.lines')} ({lines.length})
                </h3>
                <button
                  type="button"
                  className="sk-btn sk-btn--secondary sk-btn--sm"
                  onClick={addLine}
                >
                  + {t('paperbook.form.add_line')}
                </button>
              </div>

              <div className="sk-paperbook-table-container">
                <table className="sk-paperbook-table">
                  <thead>
                    <tr>
                      <th style={{ width: '28%' }}>{t('paperbook.detail.col_product')}</th>
                      <th style={{ width: '18%' }}>{t('paperbook.detail.col_brand')}</th>
                      <th style={{ width: '18%' }}>{t('paperbook.detail.col_details')}</th>
                      <th style={{ width: '10%', textAlign: 'right' }}>{t('paperbook.detail.col_qty')}</th>
                      <th style={{ width: '12%', textAlign: 'right' }}>{t('paperbook.detail.col_unit_price')}</th>
                      <th style={{ width: '14%', textAlign: 'right' }}>{t('paperbook.detail.col_line_total')} *</th>
                      <th style={{ width: '4%' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => (
                      <tr key={idx}>
                        <td style={{ position: 'relative' }}>
                          <input
                            type="text"
                            value={line.product}
                            onChange={(e) => handleLineChange(idx, 'product', e.target.value)}
                            onBlur={() => setTimeout(() => setActiveAcField(null), 200)}
                            placeholder="Item name"
                            style={{ width: '100%', height: '32px', padding: '0 6px', fontSize: '0.8rem' }}
                          />
                          {activeAcField?.rowIdx === idx && activeAcField.field === 'product' && lineSuggestions.length > 0 && (
                            <ul
                              style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                zIndex: 60,
                                minWidth: '180px',
                                margin: 0,
                                padding: '4px 0',
                                listStyle: 'none',
                                background: 'var(--sk-surface)',
                                border: '1px solid var(--sk-border)',
                                borderRadius: '4px',
                                boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
                                maxHeight: '140px',
                                overflowY: 'auto',
                              }}
                            >
                              {lineSuggestions.map((s, sIdx) => (
                                <li
                                  key={sIdx}
                                  onMouseDown={() => handleLineChange(idx, 'product', s)}
                                  style={{ padding: '4px 8px', fontSize: '0.78rem', cursor: 'pointer' }}
                                >
                                  {s}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>

                        <td>
                          <input
                            type="text"
                            value={line.brand}
                            onChange={(e) => handleLineChange(idx, 'brand', e.target.value)}
                            placeholder="Brand"
                            style={{ width: '100%', height: '32px', padding: '0 6px', fontSize: '0.8rem' }}
                          />
                        </td>

                        <td>
                          <input
                            type="text"
                            value={line.details}
                            onChange={(e) => handleLineChange(idx, 'details', e.target.value)}
                            placeholder="Size, color, spec"
                            style={{ width: '100%', height: '32px', padding: '0 6px', fontSize: '0.8rem' }}
                          />
                        </td>

                        <td>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={line.qty}
                            onChange={(e) => handleLineChange(idx, 'qty', e.target.value)}
                            placeholder="1"
                            style={{ width: '100%', height: '32px', padding: '0 6px', textAlign: 'right', fontSize: '0.8rem' }}
                          />
                        </td>

                        <td>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={line.unitPrice}
                            onChange={(e) => handleLineChange(idx, 'unitPrice', e.target.value)}
                            placeholder="DZD"
                            style={{ width: '100%', height: '32px', padding: '0 6px', textAlign: 'right', fontSize: '0.8rem' }}
                          />
                        </td>

                        <td>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            required
                            value={line.lineTotal}
                            onChange={(e) => handleLineChange(idx, 'lineTotal', e.target.value)}
                            placeholder="Total"
                            style={{
                              width: '100%',
                              height: '32px',
                              padding: '0 6px',
                              textAlign: 'right',
                              fontWeight: 700,
                              fontSize: '0.82rem',
                            }}
                          />
                        </td>

                        <td>
                          {lines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeLine(idx)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--sk-danger)',
                                cursor: 'pointer',
                                fontSize: '1rem',
                                padding: '2px 4px',
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Total summary */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: '12px',
                  marginTop: '10px',
                  padding: '8px 14px',
                  background: 'var(--sk-surface-soft)',
                  borderRadius: '6px',
                  fontWeight: 800,
                }}
              >
                <span>{t('paperbook.records.col_total')}:</span>
                <span style={{ fontSize: '1.15rem', color: 'var(--sk-primary)' }}>
                  {sumTotal.toLocaleString()} DZD
                </span>
              </div>
            </div>
          </div>

          <div className="sk-paperbook-modal__footer">
            <button
              type="button"
              className="sk-btn sk-btn--secondary"
              onClick={onClose}
              disabled={loading}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="sk-btn sk-btn--primary"
              disabled={loading || sumTotal <= 0}
            >
              {loading ? t('common.loading') : t('paperbook.form.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
