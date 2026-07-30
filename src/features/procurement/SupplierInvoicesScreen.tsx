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
    <section className="sk-screen">
      <header className="sk-screen__header">
        <h1>Supplier Invoices</h1>
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
        <div className="sk-spinner">Loading supplier invoices…</div>
      ) : invoices.length === 0 ? (
        <div className="sk-card sk-muted">
          No supplier invoices found.
        </div>
      ) : (
        <div className="sk-table-wrap">
          <table className="sk-table">
            <thead>
              <tr>
                <th>Document #</th>
                <th>Supplier</th>
                <th>Currency</th>
                <th>Total Amount (DZD)</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.document_id}>
                  <td><strong>{inv.document_number || `Draft #${inv.document_id}`}</strong></td>
                  <td>{inv.supplier_name}</td>
                  <td>{inv.currency_code}</td>
                  <td className="sk-num"><strong>{inv.base_total_amount} DZD</strong></td>
                  <td>
                    <span className={`sk-badge ${inv.status === 'POSTED' ? 'sk-badge--success' : 'sk-button--warning'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td>
                    {inv.status === 'DRAFT' && (
                      <button type="button" className="sk-button sk-button--small sk-button--success"
                        onClick={() => handleConfirm(inv.document_id)}
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
    </section>
  );
};
