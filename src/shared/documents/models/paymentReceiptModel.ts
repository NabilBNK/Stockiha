/**
 * WS-M-2 (§M2-02): the payment receipt A4 layout. Covers CUSTOMER_PAYMENT,
 * CUSTOMER_REFUND, and SUPPLIER_PAYMENT (same column shape: label/amount).
 */
import type { OfficialDocumentModel, PrintLocale } from '../officialDocument';
import { getModelLabels } from './shared';

export interface PaymentReceiptModelInput {
  /** Already translated, e.g. "Paiement client" (spec §5.1). */
  title: string;
  kind: 'PAYMENT_RECEIPT' | 'SUPPLIER_PAYMENT';
  documentNumber: string;
  documentDateText: string;
  statusText?: string;
  partyLabel: string;
  partyName?: string | null;
  paymentMethod?: string | null;
  /** e.g. "Règlement d'une facture" -- one row per payment line. */
  lines: Array<{ label: string; amount: string }>;
  total: string;
  totalNumeric: string;
}

export function buildPaymentReceiptModel(
  input: PaymentReceiptModelInput,
  printLocale: PrintLocale,
): OfficialDocumentModel {
  const labels = getModelLabels(printLocale);

  const partyRows = [];
  if (input.partyName) partyRows.push({ label: input.partyLabel, value: input.partyName });

  const metaRows = [];
  if (input.paymentMethod) metaRows.push({ label: labels.paymentMethod, value: input.paymentMethod });

  return {
    kind: input.kind,
    title: input.title,
    documentNumber: input.documentNumber,
    documentDateText: input.documentDateText,
    statusText: input.statusText,
    partyBlock: partyRows.length > 0 ? { title: input.partyLabel, rows: partyRows } : undefined,
    metaBlock: metaRows.length > 0 ? { title: labels.date, rows: metaRows } : undefined,
    columns: [
      { key: 'label', label: labels.label, align: 'start' },
      { key: 'amount', label: labels.amount, align: 'end' },
    ],
    rows: input.lines.map((line) => ({ label: line.label, amount: line.amount })),
    totals: [{ label: labels.total, value: input.total, emphasis: true }],
    amountInWordsValue: input.totalNumeric,
  };
}
