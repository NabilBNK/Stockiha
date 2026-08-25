import type { PaperBookTransaction } from './xlsxParser';

export type HistoricalTableSortKey =
  | 'row'
  | 'reference'
  | 'date'
  | 'type'
  | 'payment'
  | 'party'
  | 'product'
  | 'quantity'
  | 'unitPrice'
  | 'lineTotal'
  | 'benefit';

export type SortDirection = 'ascending' | 'descending';

export interface HistoricalTableSort {
  key: HistoricalTableSortKey;
  direction: SortDirection;
}

export interface HistoricalTableRow {
  transactionSequence: number;
  lineSequence: number;
  row: number;
  reference: string | null;
  date: string;
  type: PaperBookTransaction['transactionType'];
  payment: PaperBookTransaction['paymentStatus'];
  party: string | null;
  product: string | null;
  brand: string | null;
  details: string | null;
  // Exact decimal strings straight from the workbook. The preview never does
  // arithmetic on them: every total shown to the user comes from PostgreSQL.
  quantity: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
  benefit: string | null;
}

export function flattenHistoricalTransactions(
  transactions: PaperBookTransaction[],
): HistoricalTableRow[] {
  return transactions.flatMap((transaction) =>
    transaction.lines.map((line) => ({
      transactionSequence: transaction.sourceTransactionSequence,
      lineSequence: line.lineSequence,
      row: line.sourceRowNumber,
      reference: transaction.sourceExcelTxnRef,
      date: transaction.transactionDate,
      type: transaction.transactionType,
      payment: transaction.paymentStatus,
      party: line.partyCompany ?? transaction.partyCompany,
      product: line.productName,
      brand: line.brand,
      details: line.customDetails,
      quantity: line.quantity,
      unitPrice: line.unitPriceDzd,
      // Column K only. When it is blank the total is computed by PostgreSQL
      // after staging, so the preview shows it as not-yet-known rather than
      // multiplying two numbers in the browser.
      lineTotal: line.manualLineTotalDzd,
      benefit: line.manualBenefitDzd ?? null,
    })),
  );
}

/**
 * Renders an exact decimal string with the locale's digit grouping, purely by
 * manipulating characters. The value itself is never converted to a JavaScript
 * number, so an amount is displayed exactly as the workbook stored it.
 */
export function formatExactAmount(value: string | null, locale: string): string | null {
  if (value === null) return null;
  // Probe the locale for its separators. These literals are formatting
  // samples, not monetary values.
  const probe = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  const groupSeparator = probe.find((part) => part.type === 'group')?.value ?? ' ';
  const decimalSeparator = probe.find((part) => part.type === 'decimal')?.value ?? '.';

  const negative = value.startsWith('-');
  const [integerPart, fractionPart] = value.replace(/^-/, '').split('.');
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
  const body = fractionPart ? `${grouped}${decimalSeparator}${fractionPart}` : grouped;
  return negative ? `-${body}` : body;
}

export function filterHistoricalRows(
  rows: HistoricalTableRow[],
  filterType: 'ALL' | PaperBookTransaction['transactionType'],
  query: string,
): HistoricalTableRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filterType !== 'ALL' && row.type !== filterType) return false;
    if (!normalizedQuery) return true;
    return [row.reference, row.party, row.product, row.brand, row.details]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
}

function sortValue(row: HistoricalTableRow, key: HistoricalTableSortKey): string | number | null {
  return row[key];
}

const NUMERIC_SORT_KEYS = new Set<HistoricalTableSortKey>([
  'row',
  'quantity',
  'unitPrice',
  'lineTotal',
  'benefit',
]);

export function sortHistoricalRows(
  rows: HistoricalTableRow[],
  sort: HistoricalTableSort | null,
  locale: string,
): HistoricalTableRow[] {
  if (!sort) return rows;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  // Amount and quantity columns are exact decimal strings. `Intl.Collator` with
  // `numeric: true` orders them by magnitude without converting them to
  // floating-point numbers.
  const numericCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const direction = sort.direction === 'ascending' ? 1 : -1;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = sortValue(left.row, sort.key);
      const b = sortValue(right.row, sort.key);
      // Missing values are always placed last so reversing a sort does not
      // make incomplete records dominate the table.
      if (a === null && b === null) return left.index - right.index;
      if (a === null) return 1;
      if (b === null) return -1;
      const comparison = NUMERIC_SORT_KEYS.has(sort.key)
        ? numericCollator.compare(String(a), String(b))
        : collator.compare(String(a), String(b));
      return comparison === 0 ? left.index - right.index : comparison * direction;
    })
    .map(({ row }) => row);
}

export function nextHistoricalSort(
  current: HistoricalTableSort | null,
  key: HistoricalTableSortKey,
): HistoricalTableSort {
  if (current?.key === key) {
    return {
      key,
      direction: current.direction === 'ascending' ? 'descending' : 'ascending',
    };
  }
  return { key, direction: 'ascending' };
}

/**
 * Counts only. Money and quantity totals are deliberately absent: summing them
 * here would mean floating-point arithmetic on money and would treat a blank
 * cell as a zero. Every total the user sees comes from PostgreSQL.
 */
export function historicalRowsKpis(rows: HistoricalTableRow[]) {
  return {
    rowCount: rows.length,
    transactionCount: new Set(rows.map((row) => row.transactionSequence)).size,
    linesWithoutQuantity: rows.filter((row) => row.quantity === null).length,
    linesWithoutAmount: rows.filter((row) => row.lineTotal === null).length,
    linesWithoutBenefit: rows.filter((row) => row.benefit === null).length,
  };
}
