import React, { useEffect, useState, useCallback } from 'react';
import { listSupplierLiabilities } from '../../shared/ipc/gateway';
import type { SupplierLiabilityDto } from '../../shared/ipc/dto';
import { SupplierPaymentModal } from './SupplierPaymentModal';

interface SupplierLiabilitiesScreenProps {
  sessionToken: string;
}

export const SupplierLiabilitiesScreen: React.FC<SupplierLiabilitiesScreenProps> = ({ sessionToken }) => {
  const [liabilities, setLiabilities] = useState<SupplierLiabilityDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLiability, setSelectedLiability] = useState<SupplierLiabilityDto | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listSupplierLiabilities(sessionToken);
      setLiabilities(res);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load supplier liabilities.');
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalOutstanding = liabilities
    .reduce((sum, l) => sum + parseFloat(l.remaining_amount || '0'), 0)
    .toFixed(2);

  return (
    <div style={{ padding: '24px', color: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Supplier Payables & Liabilities</h2>
          <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '4px' }}>
            Total Outstanding Payables: <strong style={{ color: '#f87171' }}>{totalOutstanding} DZD</strong>
          </div>
        </div>
        <button
          onClick={loadData}
          style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#1e293b', color: '#fff', cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div>Loading supplier liabilities…</div>
      ) : liabilities.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', backgroundColor: '#1e293b', borderRadius: '8px' }}>
          No open supplier payables.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', backgroundColor: '#0f172a' }}>
                <th style={{ padding: '12px' }}>Supplier Code</th>
                <th style={{ padding: '12px' }}>Supplier Name</th>
                <th style={{ padding: '12px' }}>Original Amount</th>
                <th style={{ padding: '12px' }}>Outstanding Balance</th>
                <th style={{ padding: '12px' }}>Due Date</th>
                <th style={{ padding: '12px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {liabilities.map((l) => (
                <tr key={l.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px', fontWeight: 600 }}>{l.supplier_code}</td>
                  <td style={{ padding: '12px' }}>{l.supplier_name}</td>
                  <td style={{ padding: '12px' }}>{l.original_amount} DZD</td>
                  <td style={{ padding: '12px', fontWeight: 600, color: '#f87171' }}>{l.remaining_amount} DZD</td>
                  <td style={{ padding: '12px' }}>{l.due_date || 'N/A'}</td>
                  <td style={{ padding: '12px' }}>
                    <button
                      onClick={() => setSelectedLiability(l)}
                      style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontSize: '0.85rem', cursor: 'pointer' }}
                    >
                      Pay Supplier
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedLiability && (
        <SupplierPaymentModal
          liability={selectedLiability}
          sessionToken={sessionToken}
          onClose={() => setSelectedLiability(null)}
          onPaymentPosted={loadData}
        />
      )}
    </div>
  );
};
