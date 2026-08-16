import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { listPurchaseReceipts } from '../../shared/ipc/gateway';
import type { PurchaseReceiptSummary } from '../../shared/ipc/dto';
import { PurchaseTransactionScreen } from './PurchaseTransactionScreen';

interface Props {
  sessionToken: string;
}

const HISTORY_COPY = {
  en: {
    title: 'Posted purchases',
    refresh: 'Refresh',
    empty: 'No Direct Purchases have been posted yet.',
    purchase: 'Purchase #',
    date: 'Date',
    supplier: 'Supplier',
    warehouse: 'Warehouse',
    total: 'Total',
    status: 'Status',
    journal: 'Journal',
  },
  fr: {
    title: 'Achats comptabilisés',
    refresh: 'Actualiser',
    empty: 'Aucun achat direct n’a encore été comptabilisé.',
    purchase: 'Achat n°',
    date: 'Date',
    supplier: 'Fournisseur',
    warehouse: 'Dépôt',
    total: 'Total',
    status: 'Statut',
    journal: 'Journal',
  },
  ar: {
    title: 'المشتريات المرحلة',
    refresh: 'تحديث',
    empty: 'لم يتم ترحيل أي شراء مباشر بعد.',
    purchase: 'رقم الشراء',
    date: 'التاريخ',
    supplier: 'المورد',
    warehouse: 'المخزن',
    total: 'الإجمالي',
    status: 'الحالة',
    journal: 'القيد',
  },
} as const;

/**
 * MVP purchasing entry point.
 *
 * Direct Purchase is the only active operator workflow in this release. The
 * historical Purchase Order implementation remains in the repository for a
 * future advanced policy, but it is deliberately not selectable here.
 */
export default function PurchasesScreen({ sessionToken }: Props) {
  const { locale } = useI18n();
  const text = HISTORY_COPY[locale];
  const errorText = useErrorText();
  const [receipts, setReceipts] = useState<PurchaseReceiptSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      setHistoryError(null);
      const rows = await listPurchaseReceipts(sessionToken);
      setReceipts(rows.filter((receipt) => receipt.receipt_origin === 'DIRECT_PURCHASE'));
    } catch (error: unknown) {
      setHistoryError(errorText(error));
    } finally {
      setHistoryLoading(false);
    }
  }, [sessionToken, errorText]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <>
      <PurchaseTransactionScreen sessionToken={sessionToken} />

      <section className="sk-screen" aria-labelledby="direct-purchase-history-title">
        <header className="sk-screen__header">
          <h2 id="direct-purchase-history-title">{text.title}</h2>
          <button type="button" className="sk-button sk-button--secondary" onClick={() => void loadHistory()}>
            {text.refresh}
          </button>
        </header>

        {historyError ? <div className="sk-banner sk-banner--error">{historyError}</div> : null}
        {historyLoading ? (
          <div className="sk-spinner">…</div>
        ) : receipts.length === 0 ? (
          <div className="sk-card sk-muted">{text.empty}</div>
        ) : (
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="direct-purchase-history">
              <thead>
                <tr>
                  <th>{text.purchase}</th>
                  <th>{text.date}</th>
                  <th>{text.supplier}</th>
                  <th>{text.warehouse}</th>
                  <th>{text.total}</th>
                  <th>{text.status}</th>
                  <th>{text.journal}</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.document_id}>
                    <td><strong>{receipt.document_number}</strong></td>
                    <td>{receipt.posted_at?.slice(0, 10) ?? '—'}</td>
                    <td>{receipt.supplier_name}</td>
                    <td>{receipt.warehouse_name}</td>
                    <td className="sk-num">{receipt.total_amount} DZD</td>
                    <td><span className="sk-badge sk-badge--success">POSTED</span></td>
                    <td>{receipt.journal_document_number ?? receipt.journal_document_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
