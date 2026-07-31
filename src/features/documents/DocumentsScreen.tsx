import { useCallback, useEffect, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import { listPrintableDocuments } from '../../shared/ipc/documentGateway';
import type { PrintableDocument } from '../../shared/ipc/documentDto';
import { useSession } from '../../shared/session/SessionContext';
import { CustomerDocumentView } from './CustomerDocumentView';
import { ReceiptView } from './ReceiptView';

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Documents', refresh: 'Refresh', none: 'No printable documents yet.', number: 'Document', type: 'Type', date: 'Date', generation: 'Generation',
    print: 'Print', action: 'Action', view: 'View', cashSale: 'Cash sale receipt', creditSale: 'Credit sale invoice', payment: 'Customer payment receipt',
  },
  fr: {
    title: 'Documents', refresh: 'Actualiser', none: 'Aucun document imprimable.', number: 'Document', type: 'Type', date: 'Date', generation: 'Génération',
    print: 'Impression', action: 'Action', view: 'Voir', cashSale: 'Ticket de vente comptant', creditSale: 'Facture de vente à crédit', payment: 'Reçu de paiement client',
  },
  ar: {
    title: 'المستندات', refresh: 'تحديث', none: 'لا توجد مستندات قابلة للطباعة.', number: 'المستند', type: 'النوع', date: 'التاريخ', generation: 'الإنشاء',
    print: 'الطباعة', action: 'الإجراء', view: 'عرض', cashSale: 'وصل بيع نقدي', creditSale: 'فاتورة بيع بالآجل', payment: 'وصل دفع العميل',
  },
};

function documentTypeLabel(type: string, text: Record<string, string>) {
  switch (type) {
    case 'CASH_SALE': return text.cashSale;
    case 'CREDIT_SALE': return text.creditSale;
    case 'CUSTOMER_PAYMENT': return text.payment;
    default: return type;
  }
}

function statusBadge(status: string | null) {
  if (!status) return '—';
  const tone = status === 'COMPLETED' ? 'sk-badge--success'
    : status.includes('FAILURE') || status === 'UNKNOWN_DELIVERY' ? 'sk-badge--danger'
      : '';
  return <span className={`sk-badge ${tone}`}>{status}</span>;
}

export function DocumentsScreen() {
  const { locale } = useI18n();
  const text = COPY[locale];
  const { user } = useSession();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [documents, setDocuments] = useState<PrintableDocument[]>([]);
  const [selected, setSelected] = useState<PrintableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listPrintableDocuments(token, 100);
      setDocuments(rows);
      setSelected((current) => {
        if (current) return rows.find((row) => row.document_id === current.document_id) ?? rows[0] ?? null;
        return rows[0] ?? null;
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [token, errorText]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="sk-screen" data-testid="documents-screen">
      <header className="sk-screen__header">
        <div><h1>{text.title}</h1></div>
        <Button variant="secondary" onClick={() => void load()}>{text.refresh}</Button>
      </header>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading ? <Spinner /> : documents.length === 0 ? <Banner tone="info">{text.none}</Banner> : (
        <div className="sk-card">
          <div className="sk-table-wrap sk-table-wrap--flat">
            <table className="sk-table" data-testid="printable-documents-table">
              <thead><tr><th>{text.number}</th><th>{text.type}</th><th>{text.date}</th><th>{text.generation}</th><th>{text.print}</th><th>{text.action}</th></tr></thead>
              <tbody>{documents.map((document) => (
                <tr key={document.document_id}>
                  <td><strong>{document.document_number ?? `#${document.document_id}`}</strong></td>
                  <td>{documentTypeLabel(document.document_type, text)}</td>
                  <td>{document.document_date}</td>
                  <td>{statusBadge(document.generation_status)}</td>
                  <td>{statusBadge(document.print_status)}</td>
                  <td><Button variant="secondary" onClick={() => setSelected(document)}>{text.view}</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {selected?.document_type === 'CASH_SALE' ? <ReceiptView documentId={selected.document_id} /> : null}
      {selected && ['CREDIT_SALE', 'CUSTOMER_PAYMENT'].includes(selected.document_type) ? (
        <CustomerDocumentView document={selected} onChanged={load} />
      ) : null}
    </section>
  );
}
