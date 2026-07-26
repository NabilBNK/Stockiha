import React, { useState } from 'react';
import { submitSessionClosing } from '../../shared/ipc/gateway';
import type { DenominationInput } from '../../shared/ipc/dto';

interface DenominationCountModalProps {
  cashSessionId: number;
  sessionToken: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const DEFAULT_DENOMINATIONS = [2000, 1000, 500, 200, 100, 50, 20, 10, 5];

export const DenominationCountModal: React.FC<DenominationCountModalProps> = ({
  cashSessionId,
  sessionToken,
  onClose,
  onSubmitted,
}) => {
  const [counts, setCounts] = useState<{ [denom: number]: number }>(
    Object.fromEntries(DEFAULT_DENOMINATIONS.map((d) => [d, 0]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCounted = DEFAULT_DENOMINATIONS.reduce(
    (sum, d) => sum + d * (counts[d] || 0),
    0
  );

  const handleCountChange = (denom: number, val: string) => {
    const parsed = parseInt(val, 10);
    setCounts((prev) => ({
      ...prev,
      [denom]: isNaN(parsed) || parsed < 0 ? 0 : parsed,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const denominations: DenominationInput[] = DEFAULT_DENOMINATIONS.map((d) => ({
        denomination: d,
        bill_count: counts[d] || 0,
      })).filter((item) => item.bill_count > 0);

      await submitSessionClosing(sessionToken, {
        cash_session_id: cashSessionId,
        denominations,
      });

      onSubmitted();
      onClose();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to submit cash session closing.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', padding: '24px', maxWidth: '520px', width: '100%', border: '1px solid #334155', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0, color: '#f8fafc' }}>Close Cash Session — Denomination Count</h3>
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '16px' }}>
          Count and enter physical cash amounts by denomination.
        </p>

        {error && (
          <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '10px', borderRadius: '6px', marginBottom: '12px', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            {DEFAULT_DENOMINATIONS.map((denom) => (
              <div key={denom} style={{ backgroundColor: '#0f172a', padding: '10px', borderRadius: '6px', border: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontWeight: 600, color: '#38bdf8' }}>{denom} DZD</span>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Subtotal: {denom * (counts[denom] || 0)} DZD
                  </div>
                </div>
                <input
                  type="number"
                  min="0"
                  value={counts[denom] || ''}
                  placeholder="0"
                  onChange={(e) => handleCountChange(denom, e.target.value)}
                  style={{ width: '70px', padding: '6px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#1e293b', color: '#fff', textAlign: 'center' }}
                />
              </div>
            ))}
          </div>

          <div style={{ backgroundColor: '#0f172a', padding: '12px', borderRadius: '6px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.95rem', color: '#cbd5e1' }}>Total Counted Cash:</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#34d399' }}>{totalCounted.toFixed(2)} DZD</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button type="button" onClick={onClose} disabled={submitting}
              style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: 'transparent', color: '#fff', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>
              {submitting ? 'Submitting…' : 'Submit & Close Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
