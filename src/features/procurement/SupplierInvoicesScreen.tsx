import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { currentBusinessDate } from '../../shared/utils/businessDate';
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

type InvoiceSource = {
  key: string;
  supplierId: number;
  purchaseOrderId: number | null;
  receiptDocumentId: number | null;
  label: string;
};

const SOURCE_COPY = {
  en: {
    source: 'Purchase source',
    direct: 'Direct purchase receipt',
    po: 'Purchase order receipt',
    none: 'No invoiceable purchase receipts are available.',
  },
  fr: {
    source: 'Source d’achat',
    direct: 'Réception d’achat direct',
    po: 'Réception de commande fournisseur',
    none: 'Aucune réception d’achat facturable n’est disponible.',
  },
  ar: {
    source: 'مصدر الشراء',
    direct: 'وصل شراء مباشر',
    po: 'وصل طلب شراء',
    none: 'لا توجد وصولات شراء قابلة للفوترة.',
  },
} as const;

export function SupplierInvoicesScreen({ sessionToken, openFiscalPeriodId, capabilities }: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const sourceText = SOURCE_COPY[locale];
  const errorText = useErrorText();
  const [invoices, setInvoices] = useState<SupplierInvoiceSummary[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [receiptLines, setReceiptLines] = useState<PurchaseReceiptLineDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [postingResult, setPostingResult] = useState<ConfirmSupplierInvoiceResult | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [sourceKey, setSourceKey] = useState('');
  const [receiptLineId, setReceiptLineId] = useState(0);
  const [quantity, setQuantity] = useState('1.000');
  const [unitCost, setUnitCost] = useState('0.00');
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
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, errorText]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const invoiceSources = useMemo<InvoiceSource[]>(() => {
    const sources: InvoiceSource[] = [];

    for (const order of orders) {
      const hasInvoiceableReceipt = receiptLines.some(
        (line) => line.purchase_order_id === order.document_id && isPositiveDecimal(line.quantity_available_to_invoice),
      );
      if (!hasInvoiceableReceipt) continue;
      sources.push({
        key: `PO:${order.document_id}`,
        supplierId: order.supplier_id,
        purchaseOrderId: order.document_id,
        receiptDocumentId: null,
        label: `${sourceText.po} · ${order.document_number ?? `#${order.document_id}`} · ${order.supplier_name}`,
      });
    }

    const seenDirectReceipts = new Set<number>();
    for (const line of receiptLines) {
      if (
        line.receipt_origin !== 'DIRECT_PURCHASE'
        || line.purchase_order_id !== null
        || !isPositiveDecimal(line.quantity_available_to_invoice)
        || seenDirectReceipts.has(line.receipt_document_id)
      ) {
        continue;
      }
      seenDirectReceipts.add(line.receipt_document_id);
      sources.push({
        key: `PR:${line.receipt_document_id}`,
        supplierId: line.supplier_id,
        purchaseOrderId: null,
        receiptDocumentId: line.receipt_document_id,
        label: `${sourceText.direct} · ${line.receipt_document_number} · ${line.supplier_name}`,
      });
    }

    return sources;
  }, [orders, receiptLines, sourceText.direct, sourceText.po]);

  const selectedSource = invoiceSources.find((source) => source.key === sourceKey) ?? null;
  const invoiceableLines = useMemo(() => {
    if (!selectedSource) return [];
    return receiptLines.filter((line) => {
      if (!isPositiveDecimal(line.quantity_available_to_invoice)) return false;
      if (selectedSource.purchaseOrderId !== null) {
        return line.purchase_order_id === selectedSource.purchaseOrderId;
      }
      return line.receipt_origin === 'DIRECT_PURCHASE'
        && line.purchase_order_id === null
        && line.receipt_document_id === selectedSource.receiptDocumentId;
    });
  }, [receiptLines, selectedSource]);
  const selectedLine = invoiceableLines.find((line) => line.receipt_line_id === receiptLineId) ?? null;

  function selectSource(nextKey: string) {
    setSourceKey(nextKey);
    const source = invoiceSources.find((item) => item.key === nextKey) ?? null;
    const first = source
      ? receiptLines.find((line) => {
          if (!isPositiveDecimal(line.quantity_available_to_invoice)) return false;
          if (source.purchaseOrderId !== null) return line.purchase_order_id === source.purchaseOrderId;
          return line.receipt_origin === 'DIRECT_PURCHASE'
            && line.purchase_order_id === null
            && line.receipt_document_id === source.receiptDocumentId;
        })
      : null;
    setReceiptLineId(first?.receipt_line_id ?? 0);
    setQuantity(first?.quantity_available_to_invoice ?? '1.000');
    setUnitCost(first?.unit_cost ?? '0.00');
  }

  function selectLine(nextId: number) {
    setReceiptLineId(nextId);
    const line = invoiceableLines.find((item) => item.receipt_line_id === nextId);
    setQuantity(line?.quantity_available_to_invoice ?? '1.000');
    setUnitCost(line?.unit_cost ?? '0.00');
  }

  function openCreateForm() {
    setShowCreate(true);
    if (invoiceSources[0]) selectSource(invoiceSources[0].key);
  }

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSource || !selectedLine || !isPositiveDecimal(quantity) || !isPositiveDecimal(unitCost)) {
      setError(text.noInvoiceLines);
      return;
    }
    if (!isDecimalLessThanOrEqual(quantity, selectedLine.quantity_available_to_invoice)) {
      setError(text.quantityExceedsAvailable);
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const draft = await createSupplierInvoiceDraft(sessionToken, {
        supplier_id: selectedLine.supplier_id,
        purchase_order_id: selectedSource.purchaseOrderId,
        currency_code: 'DZD',
        exchange_rate_to_dzd: '1.000000',
        note: note.trim() || null,
        lines: [{
          line_number: 1,
          po_line_id: selectedLine.po_line_id,
          receipt_line_id: selectedLine.receipt_line_id,
          variant_id: selectedLine.variant_id,
          quantity,
          unit_cost: unitCost,
        }],
      });
      setSuccess(`${text.invoiceDraftCreated} #${draft.document_id}`);
      setShowCreate(false);
      setNote('');
      setSourceKey('');
      setReceiptLineId(0);
      await loadData();
    } catch (caught: unknown) {
      setError(errorText(caught));
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
        document_date: currentBusinessDate(),
      });
      setPostingResult(result);
      setSuccess(`${text.invoiceConfirmed} ${result.document_number}`);
      await loadData();
    } catch (caught: unknown) {
      setError(errorText(caught));
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
              <th>{text.document}</th><th>{text.supplier}</th><th>{sourceText.source}</th><th>{text.total}</th>
              <th>{text.status}</th><th>{text.journal}</th><th>{text.outstanding}</th><th>{text.actions}</th>
            </tr></thead>
            <tbody>{invoices.map((invoice) => (
              <tr key={invoice.document_id}>
                <td><strong>{invoice.document_number ?? `#${invoice.document_id}`}</strong></td>
                <td>{invoice.supplier_name}</td>
                <td>{invoice.purchase_order_number ?? sourceText.direct}</td>
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
              {invoiceSources.length === 0 ? <div className="sk-banner sk-banner--warning">{sourceText.none}</div> : (
                <label>{sourceText.source}
                  <select value={sourceKey} onChange={(event) => selectSource(event.target.value)} required data-testid="invoice-source-select">
                    {invoiceSources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
                  </select>
                </label>
              )}
              {invoiceSources.length > 0 && invoiceableLines.length === 0 ? <div className="sk-banner sk-banner--warning">{text.noInvoiceLines}</div> : null}
              {invoiceableLines.length > 0 ? (
                <>
                  <label>{text.product}
                    <select value={receiptLineId} onChange={(event) => selectLine(Number(event.target.value))} required data-testid="invoice-receipt-line">
                      {invoiceableLines.map((line) => <option key={line.receipt_line_id} value={line.receipt_line_id}>{line.receipt_document_number} · {line.variant_sku} · {line.variant_name} ({line.quantity_available_to_invoice} {line.unit_code})</option>)}
                    </select>
                  </label>
                  {selectedLine ? <p className="sk-muted">{text.availableToInvoice}: {selectedLine.quantity_available_to_invoice} {selectedLine.unit_code}</p> : null}
                  <label>{text.quantity}<input value={quantity} inputMode="decimal" onChange={(event) => setQuantity(event.target.value)} required data-testid="invoice-quantity" /></label>
                  <label>{text.unitCost}<input value={unitCost} inputMode="decimal" onChange={(event) => setUnitCost(event.target.value)} required data-testid="invoice-unit-cost" /></label>
                </>
              ) : null}
              <label>{text.note}<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
              <div className="sk-form-actions"><button type="button" className="sk-button sk-button--secondary" onClick={() => setShowCreate(false)}>{text.cancel}</button><button type="submit" className="sk-button sk-button--primary" disabled={submitting || !selectedSource || invoiceableLines.length === 0} data-testid="save-invoice-draft">{submitting ? text.processing : text.createInvoice}</button></div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
