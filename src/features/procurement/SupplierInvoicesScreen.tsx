import React, { useEffect, useState, useCallback } from 'react';
import { listSupplierInvoices, confirmSupplierInvoice } from '../../shared/ipc/gateway';
import type { SupplierInvoiceSummary } from '../../shared/ipc/dto';

interface SupplierInvoicesScreenProps {
  sessionToken: string;
  openFiscalPeriodId: number | null;
}

export const SupplierInvoicesScreen: React.FC<SupplierInvoicesScreenProps> = ({
  sessionToken,
  openFiscalPeriodId,
}) => {
  const [invoices, setInvoices] = useState<SupplierInvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const invList = await listSupplierInvoices(sessionToken);
      setInvoices(invList);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load supplier invoices.');
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleConfirm = async (docId: number) => {
    if (!openFiscalPeriodId) {
      setError('An open fiscal period is required to confirm invoices.');
      return;
    }
    if (!window.confirm('Confirm this supplier invoice (3-way match & ledger posting)?')) {
      return;
    }

    try {
      setError(null);
      await confirmSupplierInvoice(sessionToken, {
        request_id: crypto.randomUUID(),
        invoice_doc_id: docId,
        fiscal_period_id: openFiscalPeriodId,
        document_date: new Date().toISOString().slice(0, 10),
      });
      loadData();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to confirm supplier invoice.');
    }
  };

  return (
    <div style={{ padding: '24px', color: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Supplier Invoices</h2>
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
        <div>Loading supplier invoices…</div>
      ) : invoices.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', backgroundColor: '#1e293b', borderRadius: '8px' }}>
          No supplier invoices found.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', backgroundColor: '#0f172a' }}>
                <th style={{ padding: '12px' }}>Document #</th>
                <th style={{ padding: '12px' }}>Supplier</th>
                <th style={{ padding: '12px' }}>Currency</th>
                <th style={{ padding: '12px' }}>Total Amount (DZD)</th>
                <th style={{ padding: '12px' }}>Status</th>
                <th style={{ padding: '12px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.document_id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px', fontWeight: 600 }}>{inv.document_number || `Draft #${inv.document_id}`}</td>
                  <td style={{ padding: '12px' }}>{inv.supplier_name}</td>
                  <td style={{ padding: '12px' }}>{inv.currency_code}</td>
                  <td style={{ padding: '12px', fontWeight: 600 }}>{inv.base_total_amount} DZD</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{
                      padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                      backgroundColor: inv.status === 'POSTED' ? '#166534' : '#854d0e',
                      color: inv.status === 'POSTED' ? '#4ade80' : '#fef08a'
                    }}>
                      {inv.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>
                    {inv.status === 'DRAFT' && (
                      <button
                        onClick={() => handleConfirm(inv.document_id)}
                        style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', backgroundColor: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Confirm (3-Way Match)
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
