/**
 * WS-M-2 (§M2-02): the journal (accounting entry) detail A4 layout. No
 * amount-in-words -- a journal entry is not a customer-facing money claim.
 */
import type { OfficialDocumentModel, PrintLocale } from '../officialDocument';
import { getModelLabels } from './shared';

export interface JournalEntryLineInput {
  account: string;
  label: string;
  debit: string;
  credit: string;
}

export interface JournalEntryModelInput {
  /** Already translated, e.g. "Écriture comptable" (spec §5.1). */
  title: string;
  documentNumber: string;
  documentDateText: string;
  statusText?: string;
  sourceLabel?: string | null;
  sourceValue?: string | null;
  description?: string | null;
  lines: JournalEntryLineInput[];
  totalDebit: string;
  totalCredit: string;
}

export function buildJournalEntryModel(
  input: JournalEntryModelInput,
  printLocale: PrintLocale,
): OfficialDocumentModel {
  const labels = getModelLabels(printLocale);

  const metaRows = [];
  if (input.sourceValue) metaRows.push({ label: input.sourceLabel ?? labels.source, value: input.sourceValue });

  return {
    kind: 'JOURNAL_ENTRY',
    title: input.title,
    documentNumber: input.documentNumber,
    documentDateText: input.documentDateText,
    statusText: input.statusText,
    metaBlock: metaRows.length > 0 ? { title: labels.source, rows: metaRows } : undefined,
    columns: [
      { key: 'account', label: labels.account, align: 'start' },
      { key: 'label', label: labels.label, align: 'start' },
      { key: 'debit', label: labels.debit, align: 'end' },
      { key: 'credit', label: labels.credit, align: 'end' },
    ],
    rows: input.lines.map((line) => ({
      account: line.account,
      label: line.label,
      debit: line.debit,
      credit: line.credit,
    })),
    totals: [
      { label: labels.totalDebit, value: input.totalDebit },
      { label: labels.totalCredit, value: input.totalCredit, emphasis: true },
    ],
    notes: input.description ? [input.description] : undefined,
  };
}
