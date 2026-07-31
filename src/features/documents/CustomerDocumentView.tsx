import { useCallback, useEffect, useMemo, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import {
  enqueueCustomerReprint,
  generateCustomerDocumentPdf,
  getCustomerDocumentPayload,
  listCustomerDocumentJobs,
} from '../../shared/ipc/documentGateway';
import type { DocumentJob } from '../../shared/ipc/dto';
import type { CustomerDocumentPayload, PrintableDocument } from '../../shared/ipc/documentDto';
import { useSession } from '../../shared/session/SessionContext';

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    invoice: 'Credit sale invoice', payment: 'Customer payment receipt', number: 'Document', date: 'Date', customer: 'Customer',
    code: 'Customer code', taxId: 'Tax ID', address: 'Address', due: 'Due date', item: 'Item', quantity: 'Quantity', unitPrice: 'Unit price',
    total: 'Total', method: 'Payment method', note: 'Note', allocation: 'Invoice allocation', amount: 'Amount', jobs: 'Document jobs',
    kind: 'Kind', status: 'Status', attempts: 'Attempts', generate: 'Generate PDF', generating: 'Generating…', reprint: 'Queue reprint',
    queued: 'Reprint queued.', generated: 'PDF generated and the original print job is ready.', file: 'Generated file', refresh: 'Refresh',
    printNotice: 'Printing is asynchronous. A queued/reprint job never reposts the financial transaction or opens the cash drawer.',
  },
  fr: {
    invoice: 'Facture de vente à crédit', payment: 'Reçu de paiement client', number: 'Document', date: 'Date', customer: 'Client',
    code: 'Code client', taxId: 'NIF / NIS', address: 'Adresse', due: 'Échéance', item: 'Article', quantity: 'Quantité', unitPrice: 'Prix unitaire',
    total: 'Total', method: 'Mode de paiement', note: 'Note', allocation: 'Affectation facture', amount: 'Montant', jobs: 'Travaux du document',
    kind: 'Type', status: 'Statut', attempts: 'Tentatives', generate: 'Générer le PDF', generating: 'Génération…', reprint: 'Mettre la réimpression en file',
    queued: 'Réimpression mise en file.', generated: "PDF généré et le travail d'impression initial est prêt.", file: 'Fichier généré', refresh: 'Actualiser',
    printNotice: "L'impression est asynchrone. Une réimpression ne republie jamais l'écriture financière et n'ouvre jamais le tiroir-caisse.",
  },
  ar: {
    invoice: 'فاتورة بيع بالآجل', payment: 'وصل دفع العميل', number: 'المستند', date: 'التاريخ', customer: 'العميل',
    code: 'رمز العميل', taxId: 'الرقم الجبائي', address: 'العنوان', due: 'تاريخ الاستحقاق', item: 'الصنف', quantity: 'الكمية', unitPrice: 'سعر الوحدة',
    total: 'الإجمالي', method: 'طريقة الدفع', note: 'ملاحظة', allocation: 'تخصيص الفاتورة', amount: 'المبلغ', jobs: 'مهام المستند',
    kind: 'النوع', status: 'الحالة', attempts: 'المحاولات', generate: 'إنشاء PDF', generating: 'جارٍ الإنشاء…', reprint: 'إضافة إعادة الطباعة للطابور',
    queued: 'تمت إضافة إعادة الطباعة للطابور.', generated: 'تم إنشاء PDF وأصبحت مهمة الطباعة الأصلية جاهزة.', file: 'الملف المنشأ', refresh: 'تحديث',
    printNotice: 'الطباعة غير متزامنة. إعادة الطباعة لا تعيد تسجيل العملية المالية ولا تفتح درج النقد.',
  },
};

function jobTerminal(status: string) {
  return ['COMPLETED', 'PERMANENT_FAILURE', 'UNKNOWN_DELIVERY', 'CANCELLED', 'PULSE_SUBMITTED', 'PULSE_FAILED'].includes(status);
}

export function CustomerDocumentView({
  document,
  onChanged,
}: {
  document: PrintableDocument;
  onChanged: () => void | Promise<void>;
}) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const { user } = useSession();
  const errorText = useErrorText();
  const token = user?.token ?? '';
  const [payload, setPayload] = useState<CustomerDocumentPayload | null>(null);
  const [jobs, setJobs] = useState<DocumentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [nextPayload, nextJobs] = await Promise.all([
        getCustomerDocumentPayload(token, document.document_id),
        listCustomerDocumentJobs(token, document.document_id),
      ]);
      setPayload(nextPayload);
      setJobs(nextJobs);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [token, document.document_id, errorText]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const pending = jobs.some((job) => !jobTerminal(job.status));
    if (!pending) return;
    const timer = window.setInterval(() => {
      void listCustomerDocumentJobs(token, document.document_id).then(setJobs).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [jobs, token, document.document_id]);

  const generationCompleted = useMemo(
    () => jobs.some((job) => job.job_kind === 'GENERATION' && job.status === 'COMPLETED'),
    [jobs],
  );

  async function generatePdf() {
    if (busy) return;
    setBusy(true); setError(null); setFeedback(null);
    try {
      await generateCustomerDocumentPdf(token, document.document_id);
      setFeedback(text.generated);
      await load();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function queueReprint() {
    if (busy || !generationCompleted) return;
    setBusy(true); setError(null); setFeedback(null);
    try {
      await enqueueCustomerReprint(
        token,
        document.document_id,
        `customer_reprint:${document.document_id}:${crypto.randomUUID()}`,
      );
      setFeedback(text.queued);
      await load();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error && !payload) return <Banner tone="error">{error}</Banner>;
  if (!payload) return null;

  return (
    <div className="sk-card" data-testid="customer-document-view">
      <div className="sk-screen__header">
        <div>
          <h2>{payload.document_kind === 'CREDIT_SALE' ? text.invoice : text.payment}</h2>
          <p><strong>{text.number}:</strong> {payload.document_number}</p>
        </div>
        <div className="sk-action-group">
          {!generationCompleted ? (
            <Button onClick={() => void generatePdf()} disabled={busy}>
              {busy ? text.generating : text.generate}
            </Button>
          ) : (
            <Button onClick={() => void queueReprint()} disabled={busy}>{text.reprint}</Button>
          )}
          <Button variant="secondary" onClick={() => void load()} disabled={busy}>{text.refresh}</Button>
        </div>
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {feedback ? <Banner tone="success">{feedback}</Banner> : null}

      <div className="sk-form-grid">
        <p><strong>{text.date}:</strong> {payload.document_date}</p>
        <p><strong>{text.customer}:</strong> {payload.customer.name}</p>
        <p><strong>{text.code}:</strong> {payload.customer.code}</p>
        <p><strong>{text.taxId}:</strong> {payload.customer.tax_id ?? '—'}</p>
        <p className="sk-grid-full"><strong>{text.address}:</strong> {payload.customer.address ?? '—'}</p>
      </div>

      {payload.document_kind === 'CREDIT_SALE' ? (
        <>
          <p><strong>{text.due}:</strong> {payload.due_date}</p>
          <div className="sk-table-wrap sk-table-wrap--flat">
            <table className="sk-table" data-testid="credit-invoice-lines">
              <thead><tr><th>#</th><th>{text.item}</th><th>{text.quantity}</th><th>{text.unitPrice}</th><th>{text.amount}</th></tr></thead>
              <tbody>{payload.lines.map((line) => (
                <tr key={line.line_number}><td>{line.line_number}</td><td>{line.name} ({line.sku})</td><td>{line.quantity}</td><td>{line.unit_price}</td><td>{line.line_total}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p><strong>{text.total}:</strong> {payload.total_amount}</p>
        </>
      ) : (
        <>
          <p><strong>{text.method}:</strong> {payload.payment_method}</p>
          {payload.note ? <p><strong>{text.note}:</strong> {payload.note}</p> : null}
          <div className="sk-table-wrap sk-table-wrap--flat">
            <table className="sk-table" data-testid="customer-payment-allocations">
              <thead><tr><th>{text.allocation}</th><th>{text.date}</th><th>{text.amount}</th></tr></thead>
              <tbody>{payload.allocations.map((allocation) => (
                <tr key={allocation.invoice_ledger_entry_id}>
                  <td>{allocation.invoice_document_number ?? allocation.invoice_document_id ?? '—'}</td>
                  <td>{allocation.invoice_document_date ?? '—'}</td>
                  <td>{allocation.allocated_amount}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p><strong>{text.total}:</strong> {payload.amount}</p>
        </>
      )}

      {document.generated_file_ref || generationCompleted ? (
        <p data-testid="customer-generated-file"><strong>{text.file}:</strong> {document.generated_file_ref ?? 'generated'}</p>
      ) : null}

      <h3>{text.jobs}</h3>
      <table className="sk-table" data-testid="customer-document-jobs">
        <thead><tr><th>{text.kind}</th><th>{text.status}</th><th>{text.attempts}</th></tr></thead>
        <tbody>{jobs.map((job) => <tr key={`${job.job_kind}-${job.id}`}><td>{job.job_kind}</td><td>{job.status}</td><td>{job.attempt_count}</td></tr>)}</tbody>
      </table>
      <Banner tone="info">{text.printNotice}</Banner>
    </div>
  );
}
