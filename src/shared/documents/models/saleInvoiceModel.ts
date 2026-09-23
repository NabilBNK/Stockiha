/**
 * WS-M-2 (§M2-02): the sale invoice / cash-sale receipt A4 layout. Feeds
 * from `BusinessDocumentDetail` (CASH_SALE / CREDIT_SALE) and from the POS
 * `ReceiptInput` when the receipt target is A4.
 */
import type { OfficialDocumentModel, PrintLocale } from '../officialDocument';
import { getModelLabels } from './shared';

export interface SaleInvoiceLineInput {
  designation: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface SaleInvoiceModelInput {
  /** Already translated, e.g. "Vente au comptant" (spec §5.1). */
  title: string;
  documentNumber: string;
  documentDateText: string;
  statusText?: string;
  customerName?: string | null;
  cashierName?: string | null;
  paymentLabel?: string | null;
  lines: SaleInvoiceLineInput[];
  subtotal?: string | null;
  /** Present and non-zero to show the discount line. */
  discount?: string | null;
  total: string;
  /** The raw numeric grand total, e.g. "12345.60" -- for amount-in-words. */
  totalNumeric: string;
}

export function buildSaleInvoiceModel(
  input: SaleInvoiceModelInput,
  printLocale: PrintLocale,
): OfficialDocumentModel {
  const labels = getModelLabels(printLocale);

  const partyRows = [];
  if (input.customerName) partyRows.push({ label: labels.customer, value: input.customerName });

  const metaRows = [];
  if (input.cashierName) metaRows.push({ label: labels.cashier, value: input.cashierName });
  if (input.paymentLabel) metaRows.push({ label: labels.paymentMethod, value: input.paymentLabel });

  const totals = [];
  if (input.subtotal) totals.push({ label: labels.subtotal, value: input.subtotal });
  const discountIsNonZero = input.discount != null && Number(input.discount) !== 0;
  if (discountIsNonZero) totals.push({ label: labels.discount, value: input.discount as string });
  totals.push({ label: labels.total, value: input.total, emphasis: true });

  return {
    kind: 'SALE_INVOICE',
    title: input.title,
    documentNumber: input.documentNumber,
    documentDateText: input.documentDateText,
    statusText: input.statusText,
    partyBlock: partyRows.length > 0 ? { title: labels.customer, rows: partyRows } : undefined,
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
    totals,
    amountInWordsValue: input.totalNumeric,
  };
}
