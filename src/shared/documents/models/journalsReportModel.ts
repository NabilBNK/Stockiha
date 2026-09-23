/**
 * WS-M-2 (§M2-02): the journals report A4 layout (new: JournalsScreen had no
 * report-level print/PDF before WS-M-2, only the per-entry detail).
 */
import type { OfficialDocumentModel, PrintLocale } from '../officialDocument';
import { getModelLabels } from './shared';

export interface JournalsReportRowInput {
  number: string;
  date: string;
  source: string;
  debit: string;
  credit: string;
}

export interface JournalsReportModelInput {
  /** Already translated, e.g. "Registre des journaux" (spec §5.1). */
  title: string;
  documentNumber: string;
  documentDateText: string;
  periodText?: string | null;
  totalCountText?: string | null;
  rows: JournalsReportRowInput[];
  totalDebit: string;
  totalCredit: string;
}

export function buildJournalsReportModel(
  input: JournalsReportModelInput,
  printLocale: PrintLocale,
): OfficialDocumentModel {
  const labels = getModelLabels(printLocale);

  const metaRows = [];
  if (input.periodText) metaRows.push({ label: labels.period, value: input.periodText });
  if (input.totalCountText) metaRows.push({ label: labels.number, value: input.totalCountText });

  return {
    kind: 'JOURNALS_REPORT',
    title: input.title,
    documentNumber: input.documentNumber,
    documentDateText: input.documentDateText,
    statusText: input.totalCountText ?? undefined,
    metaBlock: metaRows.length > 0 ? { title: labels.period, rows: metaRows } : undefined,
    columns: [
      { key: 'number', label: labels.number, align: 'start' },
      { key: 'date', label: labels.date, align: 'start' },
      { key: 'source', label: labels.source, align: 'start' },
      { key: 'debit', label: labels.debit, align: 'end' },
      { key: 'credit', label: labels.credit, align: 'end' },
    ],
    rows: input.rows.map((row) => ({
      number: row.number,
      date: row.date,
      source: row.source,
      debit: row.debit,
      credit: row.credit,
    })),
    totals: [
      { label: labels.totalDebit, value: input.totalDebit },
      { label: labels.totalCredit, value: input.totalCredit, emphasis: true },
    ],
  };
}
