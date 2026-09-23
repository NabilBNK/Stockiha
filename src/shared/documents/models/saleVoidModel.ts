/**
 * WS-M-2 (§M2-02): the cancellation slip A4 layout (replaces
 * `buildA4VoidSlip`). Same table columns as the sale invoice.
 */
import type { OfficialDocumentModel, PrintLocale } from '../officialDocument';
import type { SaleInvoiceLineInput } from './saleInvoiceModel';
import { getModelLabels } from './shared';

export interface SaleVoidModelInput {
  /** Already translated, e.g. "Annulation de vente" (spec §5.1). */
  title: string;
  documentNumber: string;
  documentDateText: string;
  statusText?: string;
  originalDocumentNumber: string;
  customerName?: string | null;
  reasonText?: string | null;
  note?: string | null;
  lines: SaleInvoiceLineInput[];
  total: string;
  totalNumeric: string;
}

export function buildSaleVoidModel(
  input: SaleVoidModelInput,
  printLocale: PrintLocale,
): OfficialDocumentModel {
  const labels = getModelLabels(printLocale);

  const partyRows = [];
  if (input.customerName) partyRows.push({ label: labels.customer, value: input.customerName });

  const metaRows = [{ label: labels.originalDocument, value: input.originalDocumentNumber }];
  if (input.reasonText) metaRows.push({ label: labels.reason, value: input.reasonText });
  if (input.note) metaRows.push({ label: labels.note, value: input.note });

  return {
    kind: 'SALE_VOID',
    title: input.title,
    documentNumber: input.documentNumber,
    documentDateText: input.documentDateText,
    statusText: input.statusText,
    partyBlock: partyRows.length > 0 ? { title: labels.customer, rows: partyRows } : undefined,
    metaBlock: { title: labels.originalDocument, rows: metaRows },
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
