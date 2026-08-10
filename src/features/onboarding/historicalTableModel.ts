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
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  benefit: number | null;
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
      lineTotal:
        line.manualLineTotalDzd ??
        (line.quantity !== null && line.unitPriceDzd !== null
          ? line.quantity * line.unitPriceDzd
          : null),
      benefit: line.manualBenefitDzd ?? null,
    })),
  );
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

export function sortHistoricalRows(
  rows: HistoricalTableRow[],
  sort: HistoricalTableSort | null,
  locale: string,
): HistoricalTableRow[] {
  if (!sort) return rows;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
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
      const comparison =
        typeof a === 'number' && typeof b === 'number'
          ? a - b
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

export function historicalRowsKpis(rows: HistoricalTableRow[]) {
  return {
    rowCount: rows.length,
    transactionCount: new Set(rows.map((row) => row.transactionSequence)).size,
    totalQuantity: rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0),
    totalValueDzd: rows.reduce((sum, row) => sum + (row.lineTotal ?? 0), 0),
    totalBenefitDzd: rows.reduce((sum, row) => sum + (row.benefit ?? 0), 0),
  };
}
