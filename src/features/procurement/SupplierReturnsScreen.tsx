import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { currentBusinessDate } from '../../shared/utils/businessDate';
import {
  confirmSupplierReturn,
  createSupplierReturnDraft,
  listPurchaseOrders,
  listPurchaseReceiptLines,
  listSupplierReturns,
} from '../../shared/ipc/gateway';
import type {
  ConfirmSupplierReturnResult,
  ProcurementCapabilities,
  PurchaseOrderSummary,
  PurchaseReceiptLineDto,
  SupplierReturnSummary,
} from '../../shared/ipc/dto';
import { isDecimalLessThanOrEqual, isPositiveDecimal } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';

interface Props {
  sessionToken: string;
  openFiscalPeriodId: number | null;
  capabilities: ProcurementCapabilities | null;
}

export function SupplierReturnsScreen({ sessionToken, openFiscalPeriodId, capabilities }: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const errorText = useErrorText();
  const [returns, setReturns] = useState<SupplierReturnSummary[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [receiptLines, setReceiptLines] = useState<PurchaseReceiptLineDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmSupplierReturnResult | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [purchaseOrderId, setPurchaseOrderId] = useState(0);
  const [receiptLineId, setReceiptLineId] = useState(0);
  const [reasonCode, setReasonCode] = useState('DEFECTIVE_GOODS');
  const [quantity, setQuantity] = useState('1.000');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const confirmRequestIds = useRef<Record<number, string>>({});

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [returnData, orderData, receiptLineData] = await Promise.all([
        listSupplierReturns(sessionToken),
        listPurchaseOrders(sessionToken),
        listPurchaseReceiptLines(sessionToken),
      ]);
      setReturns(returnData);
      setOrders(orderData.filter((order) => ['PARTIALLY_RECEIVED', 'RECEIVED'].includes(order.status)));
      setReceiptLines(receiptLineData);
    } catch (caught: unknown) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, errorText]);

  useEffect(() => { void loadData(); }, [loadData]);

  const selectedOrder = orders.find((order) => order.document_id === purchaseOrderId) ?? null;
  const returnableLines = useMemo(() => {
    const seen = new Set<number>();
    return receiptLines.filter((line) => {
      if (
        (purchaseOrderId !== 0 && line.purchase_order_id !== purchaseOrderId) ||
        !isPositiveDecimal(line.quantity_returnable_for_variant) ||
        seen.has(line.variant_id)
      )
        return false;
      seen.add(line.variant_id);
      return true;
    });
  }, [purchaseOrderId, receiptLines]);
  const selectedLine = returnableLines.find((line) => line.receipt_line_id === receiptLineId) ?? null;

  function selectOrder(nextId: number) {
    setPurchaseOrderId(nextId);
    const first = receiptLines.find(
      (line) =>
        (nextId === 0 || line.purchase_order_id === nextId) &&
        isPositiveDecimal(line.quantity_returnable_for_variant),
    );
    setReceiptLineId(first?.receipt_line_id ?? 0);
    setQuantity(first ? '1.000' : '');
  }

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showCreate) {
        setShowCreate(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCreate]);

  function openCreateForm() {
    setShowCreate(true);
    if (orders[0]) {
      selectOrder(orders[0].document_id);
    } else if (receiptLines[0]) {
      selectOrder(0);
    }
  }

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLine || !isPositiveDecimal(quantity)) {
      setError(text.returnable);
      return;
    }
    if (!isDecimalLessThanOrEqual(quantity, selectedLine.quantity_returnable_for_variant)) {
      setError(text.quantityExceedsReturnable);
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const draft = await createSupplierReturnDraft(sessionToken, {
        supplier_id: selectedLine.supplier_id,
        warehouse_id: selectedLine.warehouse_id,
        purchase_order_id: selectedLine.purchase_order_id ?? (selectedOrder?.document_id || null),
        reason_code: reasonCode,
        note: note.trim() || null,
        lines: [{
          variant_id: selectedLine.variant_id,
          quantity,
          unit_cost: selectedLine.unit_cost,
        }],
      });
      setSuccess(`${text.returnDraftCreated} #${draft.document_id}`);
      setShowCreate(false);
      setNote('');
      await loadData();
    } catch (caught: unknown) {
      setError(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmReturn(documentId: number) {
    if (!openFiscalPeriodId) {
      setError(text.openPeriodRequired);
      return;
    }
    confirmRequestIds.current[documentId] ??= crypto.randomUUID();
    try {
      setSubmitting(true);
      setError(null);
      const posting = await confirmSupplierReturn(sessionToken, {
        request_id: confirmRequestIds.current[documentId],
        return_document_id: documentId,
        fiscal_period_id: openFiscalPeriodId,
        document_date: currentBusinessDate(),
      });
      setResult(posting);
      setSuccess(`${text.returnConfirmed} ${posting.document_number}`);
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
        <div><h1>{text.returnTitle}</h1><p className="sk-muted">{text.returnSubtitle}</p></div>
        <div className="sk-form-actions">
          <button type="button" className="sk-button sk-button--secondary" onClick={() => void loadData()}>{text.refresh}</button>
          {capabilities?.can_manage_procurement ? <button type="button" className="sk-button sk-button--primary" onClick={openCreateForm} data-testid="create-supplier-return">{text.newReturn}</button> : null}
        </div>
      </header>
      {success ? <div className="sk-banner sk-banner--success">{success}</div> : null}
      {error ? <div className="sk-banner sk-banner--error">{error}</div> : null}

      {result ? <section className="sk-card" data-testid="supplier-return-result">
        <h2>{text.returnConfirmed}</h2><div className="sk-cards">
          <div className="sk-metric"><span className="sk-metric__label">{text.document}</span><strong className="sk-metric__value">{result.document_number}</strong></div>
          <div className="sk-metric"><span className="sk-metric__label">{text.inventoryValue}</span><strong className="sk-metric__value">{result.inventory_value ?? '—'} DZD</strong></div>
          <div className="sk-metric"><span className="sk-metric__label">{text.clearing}</span><strong className="sk-metric__value">{result.clearing_amount ?? '—'} DZD</strong></div>
          <div className="sk-metric"><span className="sk-metric__label">{text.journal}</span><strong className="sk-metric__value">{result.journal_document_id}</strong></div>
        </div>
      </section> : null}

      {loading ? <div>{text.loading}</div> : returns.length === 0 ? <div className="sk-card sk-muted">{text.returnEmpty}</div> : (
        <div className="sk-table-wrap"><table className="sk-table" data-testid="supplier-returns-table"><thead><tr>
          <th>{text.document}</th><th>{text.supplier}</th><th>{text.purchaseOrder}</th><th>{text.warehouse}</th><th>{text.reason}</th><th>{text.status}</th><th>{text.journal}</th><th>{text.actions}</th>
        </tr></thead><tbody>{returns.map((item) => <tr key={item.document_id}>
          <td><strong>{item.document_number ?? `#${item.document_id}`}</strong></td><td>{item.supplier_name}</td><td>{item.purchase_order_number ?? '—'}</td><td>{item.warehouse_name}</td><td>{item.reason_code}</td>
          <td><span className={`sk-badge ${item.status === 'POSTED' ? 'sk-badge--success' : 'sk-badge--warning'}`}>{item.status}</span></td><td>{item.journal_document_number ?? item.journal_document_id ?? '—'}</td>
          <td>{item.status === 'DRAFT' && capabilities?.can_post_supplier_return ? <button type="button" className="sk-button sk-button--small sk-button--success" disabled={submitting} onClick={() => void confirmReturn(item.document_id)} data-testid={`confirm-return-${item.document_id}`}>{text.confirmReturn}</button> : '—'}</td>
        </tr>)}</tbody></table></div>
      )}

      {showCreate ? (
        <div
          className="sk-modal-overlay"
          data-testid="supplier-return-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false);
          }}
        >
          <div className="sk-modal-content">
            <header className="sk-modal-header">
              <h2>{text.newReturn}</h2>
              <button type="button" className="sk-modal-close" onClick={() => setShowCreate(false)} aria-label={text.close}>
                ×
              </button>
            </header>
            <form className="sk-form" onSubmit={createDraft}>
              <label>
                {text.purchaseOrder}
                <select value={purchaseOrderId} onChange={(event) => selectOrder(Number(event.target.value))} required data-testid="return-po-select">
                  {orders.map((order) => <option key={order.document_id} value={order.document_id}>{order.document_number} · {order.supplier_name}</option>)}
                </select>
              </label>
              <label>
                {text.product}
                <select value={receiptLineId} onChange={(event) => setReceiptLineId(Number(event.target.value))} required data-testid="return-receipt-line">
                  {returnableLines.map((line) => <option key={line.receipt_line_id} value={line.receipt_line_id}>{line.variant_sku} · {line.variant_name} ({line.quantity_returnable_for_variant} {line.unit_code})</option>)}
                </select>
              </label>
              {selectedLine ? <p className="sk-muted">{text.returnable}: {selectedLine.quantity_returnable_for_variant} {selectedLine.unit_code}</p> : null}
              <label>
                {text.quantity}
                <input value={quantity} inputMode="decimal" onChange={(event) => setQuantity(event.target.value)} required data-testid="return-quantity" />
              </label>
              <label>
                {text.reason}
                <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
                  <option value="DEFECTIVE_GOODS">{text.defective}</option>
                  <option value="EXCESS_DELIVERY">{text.excess}</option>
                  <option value="WRONG_ITEM">{text.wrongItem}</option>
                </select>
              </label>
              <label>
                {text.note}
                <input value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <div className="sk-form-actions">
                <button type="button" className="sk-button sk-button--secondary" onClick={() => setShowCreate(false)}>
                  {text.cancel}
                </button>
                <button type="submit" className="sk-button sk-button--primary" disabled={submitting || !selectedLine} data-testid="save-return-draft">
                  {submitting ? text.processing : text.newReturn}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
