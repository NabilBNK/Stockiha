import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '../../shared/i18n';
import { listSupplierLiabilities, listSupplierPayments } from '../../shared/ipc/gateway';
import type {
  PostSupplierPaymentResult,
  ProcurementCapabilities,
  SupplierLiabilityDto,
  SupplierPaymentDto,
} from '../../shared/ipc/dto';
import { addExactDecimals } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';
import { SupplierPaymentModal } from './SupplierPaymentModal';

interface Props {
  sessionToken: string;
  openFiscalPeriodId: number | null;
  capabilities: ProcurementCapabilities | null;
}

export function SupplierLiabilitiesScreen({ sessionToken, openFiscalPeriodId, capabilities }: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const [liabilities, setLiabilities] = useState<SupplierLiabilityDto[]>([]);
  const [payments, setPayments] = useState<SupplierPaymentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLiability, setSelectedLiability] = useState<SupplierLiabilityDto | null>(null);
  const [result, setResult] = useState<PostSupplierPaymentResult | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [liabilityData, paymentData] = await Promise.all([
        listSupplierLiabilities(sessionToken),
        listSupplierPayments(sessionToken),
      ]);
      setLiabilities(liabilityData);
      setPayments(paymentData);
    } catch (caught: unknown) {
      setError((caught as Error)?.message || text.noPayables);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, text.noPayables]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function paymentPosted(posting: PostSupplierPaymentResult) {
    setResult(posting);
    setSelectedLiability(null);
    await loadData();
  }

  const totalOutstanding = addExactDecimals(liabilities.map((liability) => liability.remaining_amount));

  return (
    <section className="sk-screen">
      <header className="sk-screen__header"><div><h1>{text.payablesTitle}</h1><p className="sk-muted">{text.outstandingTotal}: <strong>{totalOutstanding} DZD</strong></p></div><button type="button" className="sk-button sk-button--secondary" onClick={() => void loadData()}>{text.refresh}</button></header>
      {error ? <div className="sk-banner sk-banner--error">{error}</div> : null}
      {result ? <section className="sk-card" data-testid="supplier-payment-result"><h2>{text.paymentPosted}</h2><div className="sk-cards">
        <div className="sk-metric"><span className="sk-metric__label">{text.document}</span><strong className="sk-metric__value">{result.document_number}</strong></div>
        <div className="sk-metric"><span className="sk-metric__label">{text.amount}</span><strong className="sk-metric__value">{result.amount ?? '—'} DZD</strong></div>
        <div className="sk-metric"><span className="sk-metric__label">{text.paymentMethod}</span><strong className="sk-metric__value">{result.funding_role ?? '—'}</strong></div>
        <div className="sk-metric"><span className="sk-metric__label">{text.journal}</span><strong className="sk-metric__value">{result.journal_document_id}</strong></div>
      </div></section> : null}

      {loading ? <div className="sk-spinner">{text.loading}</div> : liabilities.length === 0 ? <div className="sk-card sk-muted">{text.noPayables}</div> : (
        <div className="sk-table-wrap"><table className="sk-table" data-testid="supplier-liabilities-table"><thead><tr><th>{text.supplier}</th><th>{text.document}</th><th>{text.originalAmount}</th><th>{text.outstanding}</th><th>{text.dueDate}</th><th>{text.journal}</th><th>{text.actions}</th></tr></thead>
          <tbody>{liabilities.map((liability) => <tr key={liability.id}><td><strong>{liability.supplier_code}</strong> · {liability.supplier_name}</td><td>{liability.document_number ?? liability.document_id ?? '—'}</td><td className="sk-num">{liability.original_amount} DZD</td><td className="sk-num"><strong>{liability.remaining_amount} DZD</strong></td><td>{liability.due_date ?? '—'}</td><td>{liability.journal_document_number ?? liability.journal_document_id}</td><td>{capabilities?.can_post_supplier_payment && openFiscalPeriodId ? <button type="button" className="sk-button sk-button--small sk-button--primary" onClick={() => setSelectedLiability(liability)} data-testid={`pay-liability-${liability.id}`}>{text.paySupplier}</button> : '—'}</td></tr>)}</tbody>
        </table></div>
      )}

      <section className="sk-card"><h2>{text.paymentHistory}</h2>{payments.length === 0 ? <p className="sk-muted">{text.noPayments}</p> : <div className="sk-table-wrap"><table className="sk-table" data-testid="supplier-payments-table"><thead><tr><th>{text.document}</th><th>{text.supplier}</th><th>{text.paymentMethod}</th><th>{text.amount}</th><th>{text.journal}</th><th>{text.date}</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.document_id}><td><strong>{payment.document_number ?? `#${payment.document_id}`}</strong></td><td>{payment.supplier_name}</td><td>{payment.payment_method}</td><td className="sk-num">{payment.amount} DZD</td><td>{payment.journal_document_number ?? payment.journal_document_id ?? '—'}</td><td>{new Date(payment.created_at).toLocaleDateString(locale)}</td></tr>)}</tbody></table></div>}</section>

      {selectedLiability && openFiscalPeriodId ? <SupplierPaymentModal liability={selectedLiability} sessionToken={sessionToken} fiscalPeriodId={openFiscalPeriodId} onClose={() => setSelectedLiability(null)} onPaymentPosted={(posting) => void paymentPosted(posting)} /> : null}
    </section>
  );
}
