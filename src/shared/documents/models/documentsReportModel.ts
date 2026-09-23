/**
 * WS-M-2 (§M2-02): the Documents screen's Reports-tab A4 layout.
 */
import type { OfficialDocumentModel, OfficialDocumentTotal, PrintLocale } from '../officialDocument';
import { getModelLabels } from './shared';

export interface DocumentsReportRowInput {
  number: string;
  type: string;
  date: string;
  party: string;
  amount: string;
  status: string;
}

export interface DocumentsReportTypeAmountInput {
  label: string;
  value: string;
}

export interface DocumentsReportModelInput {
  /** Already translated, e.g. "Registre des documents" (spec §5.1). */
  title: string;
  documentNumber: string;
  documentDateText: string;
  periodText?: string | null;
  totalCountText?: string | null;
  rows: DocumentsReportRowInput[];
  typeAmounts: DocumentsReportTypeAmountInput[];
  grandTotal?: string | null;
}

export function buildDocumentsReportModel(
  input: DocumentsReportModelInput,
  printLocale: PrintLocale,
): OfficialDocumentModel {
  const labels = getModelLabels(printLocale);

  const metaRows = [];
  if (input.periodText) metaRows.push({ label: labels.period, value: input.periodText });
  if (input.totalCountText) metaRows.push({ label: labels.number, value: input.totalCountText });

  const totals: OfficialDocumentTotal[] = input.typeAmounts.map((typeAmount) => ({
    label: typeAmount.label,
    value: typeAmount.value,
  }));
  if (input.grandTotal) totals.push({ label: labels.total, value: input.grandTotal, emphasis: true });

  return {
    kind: 'DOCUMENTS_REPORT',
    title: input.title,
    documentNumber: input.documentNumber,
    documentDateText: input.documentDateText,
    statusText: input.totalCountText ?? undefined,
    metaBlock: metaRows.length > 0 ? { title: labels.period, rows: metaRows } : undefined,
    columns: [
      { key: 'number', label: labels.number, align: 'start' },
      { key: 'type', label: labels.type, align: 'start' },
      { key: 'date', label: labels.date, align: 'start' },
      { key: 'party', label: labels.party, align: 'start' },
      { key: 'amount', label: labels.amount, align: 'end' },
      { key: 'status', label: labels.status, align: 'start' },
    ],
    rows: input.rows.map((row) => ({
      number: row.number,
      type: row.type,
      date: row.date,
      party: row.party,
      amount: row.amount,
      status: row.status,
    })),
    totals,
  };
}
