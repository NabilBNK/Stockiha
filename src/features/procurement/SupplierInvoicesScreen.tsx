import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '../../shared/i18n';
import {
  confirmSupplierInvoice,
  createSupplierInvoiceDraft,
  listPurchaseOrders,
  listPurchaseReceiptLines,
  listSupplierInvoices,
} from '../../shared/ipc/gateway';
import type {
  ConfirmSupplierInvoiceResult,
  ProcurementCapabilities,
  PurchaseOrderSummary,
  PurchaseReceiptLineDto,
  SupplierInvoiceSummary,
} from '../../shared/ipc/dto';
import { isDecimalLessThanOrEqual, isPositiveDecimal } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';

interface Props {
  sessionToken: string;
  openFiscalPeriodId: number | null;
  capabilities: ProcurementCapabilities | null;
}

export function SupplierInvoicesScreen({ sessionToken, openFiscalPeriodId, capabilities }: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const [invoices, setInvoices] = useState<SupplierInvoiceSummary[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [receiptLines, setReceiptLines] = useState<PurchaseReceiptLineDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [postingResult, setPostingResult] = useState<ConfirmSupplierInvoiceResult | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [purchaseOrderId, setPurchaseOrderId] = useState(0);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [costs, setCosts] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const confirmRequestIds = useRef<Record<number, string>>({});

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [invoiceData, orderData, receiptLineData] = await Promise.all([
        listSupplierInvoices(sessionToken),
        listPurchaseOrders(sessionToken),
        listPurchaseReceiptLines(sessionToken),
      ]);
      setInvoices(invoiceData);
      setOrders(orderData.filter((order) => ['PARTIALLY_RECEIVED', 'RECEIVED'].includes(order.status)));
      setReceiptLines(receiptLineData);
    } catch (caught: unknown) {
      setError((caught as Error)?.message || text.invoiceEmpty);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, text.invoiceEmpty]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedOrder = orders.find((order) => order.document_id === purchaseOrderId) ?? null;
  const availableLines = useMemo(
    () => receiptLines.filter(
      (line) => line.purchase_order_id === purchaseOrderId
        && isPositiveDecimal(line.quantity_available_to_invoice),
    ),
    [purchaseOrderId, receiptLines],
  );

  function selectOrder(nextId: number) {
    setPurchaseOrderId(nextId);
    const nextQuantities: Record<number, string> = {};
    const nextCosts: Record<number, string> = {};
    receiptLines.filter((line) => line.purchase_order_id === nextId).forEach((line) => {
      nextQuantities[line.receipt_line_id] = line.quantity_available_to_invoice;
      nextCosts[line.receipt_line_id] = line.unit_cost;
    });
    setQuantities(nextQuantities);
    setCosts(nextCosts);
  }

  function openCreateForm() {
    setShowCreate(true);
    const firstOrder = orders[0];
    if (firstOrder) selectOrder(firstOrder.document_id);
  }

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedOrder) {
      setError(text.purchaseOrder);
      return;
    }
    const lines = availableLines
      .map((line, index) => ({
        line_number: index + 1,
        po_line_id: line.po_line_id,
        receipt_line_id: line.receipt_line_id,
        variant_id: line.variant_id,
        quantity: quantities[line.receipt_line_id] ?? '0',
        unit_cost: costs[line.receipt_line_id] ?? line.unit_cost,
      }))
      .filter((line) => isPositiveDecimal(line.quantity));
    if (lines.length === 0) {
      setError(text.noInvoiceLines);
      return;
    }
    if (availableLines.some((line) => {
      const requested = quantities[line.receipt_line_id] ?? '0';
      return isPositiveDecimal(requested)
        && !isDecimalLessThanOrEqual(requested, line.quantity_available_to_invoice);
    })) {
      setError(text.quantityExceedsAvailable);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const result = await createSupplierInvoiceDraft(sessionToken, {
        supplier_id: selectedOrder.supplier_id,
        purchase_order_id: selectedOrder.document_id,
        currency_code: 'DZD',
        exchange_rate_to_dzd: '1.000000',
        note: note.trim() || null,
        lines,
      });
      setSuccess(`${text.invoiceDraftCreated} #${result.document_id}`);
      setShowCreate(false);
      setNote('');
      await loadData();
    } catch (caught: unknown) {
      setError((caught as Error)?.message || text.invoiceEmpty);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmInvoice(documentId: number) {
    if (!openFiscalPeriodId) {
      setError(text.openPeriodRequired);
      return;
    }
    confirmRequestIds.current[documentId] ??= crypto.randomUUID();
    try {
      setSubmitting(true);
      setError(null);
      const result = await confirmSupplierInvoice(sessionToken, {
        request_id: confirmRequestIds.current[documentId],
        invoice_doc_id: documentId,
        fiscal_period_id: openFiscalPeriodId,
        document_date: new Date().toISOString().slice(0, 10),
      });
      setPostingResult(result);
      setSuccess(`${text.invoiceConfirmed} ${result.document_number}`);
      await loadData();
    } catch (caught: unknown) {
      setError((caught as Error)?.message || text.requestUncertain);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="sk-screen">
      <header className="sk-screen__header">
        <h1>{text.invoiceTitle}</h1>
        <div className="sk-form-actions">
          <button type="button" className="sk-button sk-button--secondary" onClick={() => void loadData()}>{text.refresh}</button>
          {capabilities?.can_manage_procurement ? (
            <button type="button" className="sk-button sk-button--primary" onClick={openCreateForm} data-testid="create-supplier-invoice">
              {text.createInvoice}
            </button>
          ) : null}
        </div>
      </header>

      {success ? <div className="sk-banner sk-banner--success">{success}</div> : null}
      {error ? <div className="sk-banner sk-banner--error">{error}</div> : null}

      {postingResult ? (
        <section className="sk-card" data-testid="supplier-invoice-result">
          <h2>{text.invoiceConfirmed}</h2>
          <div className="sk-cards">
            <div className="sk-metric"><span className="sk-metric__label">{text.document}</span><strong className="sk-metric__value">{postingResult.document_number}</strong></div>
            <div className="sk-metric"><span className="sk-metric__label">{text.journal}</span><strong className="sk-metric__value">{postingResult.journal_document_id}</strong></div>
            <div className="sk-metric"><span className="sk-metric__label">{text.total}</span><strong className="sk-metric__value">{postingResult.total_amount ?? '—'} DZD</strong></div>
          </div>
        </section>
      ) : null}

      {loading ? <div className="sk-spinner">{text.loading}</div> : invoices.length === 0 ? (
        <div className="sk-card sk-muted">{text.invoiceEmpty}</div>
      ) : (
        <div className="sk-table-wrap">
          <table className="sk-table" data-testid="supplier-invoices-table">
            <thead><tr>
              <th>{text.document}</th><th>{text.supplier}</th><th>{text.purchaseOrder}</th><th>{text.total}</th>
              <th>{text.status}</th><th>{text.journal}</th><th>{text.outstanding}</th><th>{text.actions}</th>
            </tr></thead>
            <tbody>{invoices.map((invoice) => (
              <tr key={invoice.document_id}>
                <td><strong>{invoice.document_number ?? `#${invoice.document_id}`}</strong></td>
                <td>{invoice.supplier_name}</td>
                <td>{invoice.purchase_order_number ?? '—'}</td>
                <td className="sk-num">{invoice.base_total_amount} DZD</td>
                <td><span className={`sk-badge ${invoice.status === 'POSTED' ? 'sk-badge--success' : 'sk-badge--warning'}`}>{invoice.status}</span></td>
                <td>{invoice.journal_document_number ?? invoice.journal_document_id ?? '—'}</td>
                <td className="sk-num">{invoice.outstanding_amount ? `${invoice.outstanding_amount} DZD` : '—'}</td>
                <td>{invoice.status === 'DRAFT' && capabilities?.can_post_supplier_invoice ? (
                  <button type="button" className="sk-button sk-button--small sk-button--success" disabled={submitting} onClick={() => void confirmInvoice(invoice.document_id)} data-testid={`confirm-invoice-${invoice.document_id}`}>
                    {text.confirmInvoice}
                  </button>
                ) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {showCreate ? (
        <div className="sk-modal-overlay" data-testid="supplier-invoice-modal">
          <div className="sk-modal-content sk-modal-content--large">
            <header className="sk-modal-header"><h2>{text.createInvoice}</h2><button type="button" className="sk-modal-close" onClick={() => setShowCreate(false)} aria-label={text.close}>×</button></header>
            <form className="sk-form" onSubmit={createDraft}>
              <label>{text.purchaseOrder}
                <select value={purchaseOrderId} onChange={(event) => selectOrder(Number(event.target.value))} required data-testid="invoice-po-select">
                  {orders.map((order) => <option key={order.document_id} value={order.document_id}>{order.document_number} · {order.supplier_name}</option>)}
                </select>
              </label>
              {availableLines.length === 0 ? <div className="sk-banner sk-banner--warning">{text.noInvoiceLines}</div> : (
                <div className="sk-table-wrap"><table className="sk-table"><thead><tr><th>{text.receiptLine}</th><th>{text.product}</th><th>{text.availableToInvoice}</th><th>{text.quantity}</th><th>{text.unitCost}</th></tr></thead>
                  <tbody>{availableLines.map((line) => <tr key={line.receipt_line_id}>
                    <td>{line.receipt_document_number}</td><td>{line.variant_sku} · {line.variant_name}</td><td>{line.quantity_available_to_invoice} {line.unit_code}</td>
                    <td><input value={quantities[line.receipt_line_id] ?? ''} inputMode="decimal" onChange={(event) => setQuantities({ ...quantities, [line.receipt_line_id]: event.target.value })} aria-label={`${text.quantity} ${line.variant_sku}`} /></td>
                    <td><input value={costs[line.receipt_line_id] ?? line.unit_cost} inputMode="decimal" onChange={(event) => setCosts({ ...costs, [line.receipt_line_id]: event.target.value })} aria-label={`${text.unitCost} ${line.variant_sku}`} /></td>
                  </tr>)}</tbody></table></div>
              )}
              <label>{text.note}<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
              <div className="sk-form-actions"><button type="button" className="sk-button sk-button--secondary" onClick={() => setShowCreate(false)}>{text.cancel}</button><button type="submit" className="sk-button sk-button--primary" disabled={submitting || availableLines.length === 0} data-testid="save-invoice-draft">{submitting ? text.processing : text.createInvoice}</button></div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
