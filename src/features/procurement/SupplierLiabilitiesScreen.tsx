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
    <section className="sk-screen">
      <header className="sk-screen__header">
        <div>
          <h1>Supplier Payables & Liabilities</h1>
          <div className="sk-muted">
            Total Outstanding Payables: <strong>{totalOutstanding} DZD</strong>
          </div>
        </div>
        <button type="button" className="sk-button sk-button--secondary" onClick={loadData}>
          Refresh
        </button>
      </header>

      {error && (
        <div className="sk-banner sk-banner--error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="sk-spinner">Loading supplier liabilities…</div>
      ) : liabilities.length === 0 ? (
        <div className="sk-card sk-muted">
          No open supplier payables.
        </div>
      ) : (
        <div className="sk-table-wrap">
          <table className="sk-table">
            <thead>
              <tr>
                <th>Supplier Code</th>
                <th>Supplier Name</th>
                <th>Original Amount</th>
                <th>Outstanding Balance</th>
                <th>Due Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {liabilities.map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.supplier_code}</strong></td>
                  <td>{l.supplier_name}</td>
                  <td className="sk-num">{l.original_amount} DZD</td>
                  <td className="sk-num"><strong>{l.remaining_amount} DZD</strong></td>
                  <td>{l.due_date || 'N/A'}</td>
                  <td>
                    <button type="button" className="sk-button sk-button--small sk-button--primary"
                      onClick={() => setSelectedLiability(l)}
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
    </section>
  );
};
