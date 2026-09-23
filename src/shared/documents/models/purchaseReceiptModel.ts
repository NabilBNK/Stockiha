/**
 * WS-M-2 (§M2-02): the purchase receipt (goods received) A4 layout
 * (replaces `buildReceiptA4Html`). Same table columns as the sale invoice.
 */
import type { OfficialDocumentModel, PrintLocale } from '../officialDocument';
import { getModelLabels } from './shared';

export interface PurchaseReceiptLineInput {
  designation: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface PurchaseReceiptModelInput {
  /** Already translated, e.g. "Bon de réception" (spec §5.1). */
  title: string;
  documentNumber: string;
  documentDateText: string;
  statusText?: string;
  supplierName?: string | null;
  warehouseName?: string | null;
  purchaseOrderNumber?: string | null;
  lines: PurchaseReceiptLineInput[];
  total: string;
  totalNumeric: string;
}

export function buildPurchaseReceiptModel(
  input: PurchaseReceiptModelInput,
  printLocale: PrintLocale,
): OfficialDocumentModel {
  const labels = getModelLabels(printLocale);

  const partyRows = [];
  if (input.supplierName) partyRows.push({ label: labels.supplier, value: input.supplierName });

  const metaRows = [];
  if (input.warehouseName) metaRows.push({ label: labels.warehouse, value: input.warehouseName });
  if (input.purchaseOrderNumber) metaRows.push({ label: labels.originalDocument, value: input.purchaseOrderNumber });

  return {
    kind: 'PURCHASE_RECEIPT',
    title: input.title,
    documentNumber: input.documentNumber,
    documentDateText: input.documentDateText,
    statusText: input.statusText,
    partyBlock: partyRows.length > 0 ? { title: labels.supplier, rows: partyRows } : undefined,
    metaBlock: metaRows.length > 0 ? { title: labels.date, rows: metaRows } : undefined,
    columns: [
      { key: 'designation', label: labels.designation, align: 'start' },
      { key: 'quantity', label: labels.quantity, align: 'end' },
      { key: 'unitPrice', label: labels.unitPrice, align: 'end' },
      { key: 'lineTotal', label: labels.lineTotal, align: 'end' },
    ],
    rows: input.lines.map((line) => ({
      designation: line.designation,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    })),
    totals: [{ label: labels.total, value: input.total, emphasis: true }],
    amountInWordsValue: input.totalNumeric,
  };
}
