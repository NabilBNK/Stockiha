import React, { useState } from 'react';
import { generateCreditOverrideToken } from '../../shared/ipc/gateway';
import type { CreditOverrideTokenResult } from '../../shared/ipc/dto';

interface CreditOverrideModalProps {
  customerId: number;
  customerName: string;
  payloadHash: string;
  sessionToken: string;
  onClose: () => void;
  onTokenGenerated: (tokenResult: CreditOverrideTokenResult) => void;
}

export const CreditOverrideModal: React.FC<CreditOverrideModalProps> = ({
  customerId,
  customerName,
  payloadHash,
  sessionToken,
  onClose,
  onTokenGenerated,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuthorize = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await generateCreditOverrideToken(sessionToken, {
        customer_id: customerId,
        payload_hash: payloadHash,
        valid_minutes: 15,
      });
      onTokenGenerated(result);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to authorize credit override.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
      <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', padding: '24px', maxWidth: '440px', width: '100%', border: '1px solid #7f1d1d' }}>
        <h3 style={{ marginTop: 0, color: '#f87171' }}>⚠️ Credit Limit Override Required</h3>
        <p style={{ color: '#cbd5e1', fontSize: '0.9rem', marginBottom: '16px' }}>
          Client <strong style={{ color: '#fff' }}>{customerName}</strong> has exceeded their authorized credit limit or overdue threshold.
        </p>

        {error && (
          <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '10px', borderRadius: '6px', marginBottom: '12px', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <div style={{ backgroundColor: '#0f172a', padding: '12px', borderRadius: '6px', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '20px' }}>
          Manager authorization generates a <strong>single-use 15-minute token</strong> linked strictly to this exact cart payload. Modifying the cart will invalidate the token.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button type="button" onClick={onClose} disabled={submitting}
            style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: 'transparent', color: '#fff', cursor: 'pointer' }}>
            Cancel Sale
          </button>
          <button type="button" onClick={handleAuthorize} disabled={submitting}
            style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#dc2626', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            {submitting ? 'Authorizing…' : 'Authorize Credit Override'}
          </button>
        </div>
      </div>
    </div>
  );
};
