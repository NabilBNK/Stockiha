import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HistoricalRowPreview } from '../src/features/onboarding/HistoricalRowPreview';
import {
  filterHistoricalRows,
  flattenHistoricalTransactions,
  historicalRowsKpis,
  nextHistoricalSort,
  sortHistoricalRows,
} from '../src/features/onboarding/historicalTableModel';
import type { PaperBookTransaction } from '../src/features/onboarding/xlsxParser';

const transactions: PaperBookTransaction[] = [
  {
    sourceTransactionSequence: 1, sourceFirstExcelRow: 2, sourceExcelTxnRef: 'TX-20',
    transactionDate: '2025-12-20', transactionType: 'SALE', paymentStatus: 'PAID',
    partyCompany: 'زبون ألف', manualBenefitDzd: null, pageNumber: 1,
    lines: [{ sourceRowNumber: 2, lineSequence: 1, productName: 'Item 100', brand: 'B', customDetails: null, partyCompany: null, manualBenefitDzd: 500, quantity: 2, unitPriceDzd: 100, manualLineTotalDzd: 200 }],
  },
  {
    sourceTransactionSequence: 2, sourceFirstExcelRow: 3, sourceExcelTxnRef: 'TX-3',
    transactionDate: '2024-01-05', transactionType: 'PURCHASE', paymentStatus: 'UNPAID',
    partyCompany: null, manualBenefitDzd: null, pageNumber: null,
    lines: [{ sourceRowNumber: 3, lineSequence: 1, productName: 'Item 20', brand: null, customDetails: null, partyCompany: 'Supplier B', manualBenefitDzd: null, quantity: 10, unitPriceDzd: 20, manualLineTotalDzd: null }],
  },
  {
    sourceTransactionSequence: 3, sourceFirstExcelRow: 4, sourceExcelTxnRef: null,
    transactionDate: '2025-01-01', transactionType: 'EXPENSE', paymentStatus: 'PAID',
    partyCompany: null, manualBenefitDzd: null, pageNumber: null,
    lines: [{ sourceRowNumber: 4, lineSequence: 1, productName: null, brand: null, customDetails: 'Delivery', partyCompany: null, manualBenefitDzd: null, quantity: null, unitPriceDzd: null, manualLineTotalDzd: 75 }],
  },
];

describe('historical table model', () => {
  it('starts unsorted and supports ascending, descending, and switching columns', () => {
    const rows = flattenHistoricalTransactions(transactions);
    expect(sortHistoricalRows(rows, null, 'en').map((row) => row.row)).toEqual([2, 3, 4]);
    const ascending = nextHistoricalSort(null, 'quantity');
    expect(sortHistoricalRows(rows, ascending, 'en').map((row) => row.quantity)).toEqual([2, 10, null]);
    const descending = nextHistoricalSort(ascending, 'quantity');
    expect(sortHistoricalRows(rows, descending, 'en').map((row) => row.quantity)).toEqual([10, 2, null]);
    expect(nextHistoricalSort(descending, 'date')).toEqual({ key: 'date', direction: 'ascending' });
  });

  it('sorts currency numerically, dates chronologically, text naturally, and nulls last', () => {
    const rows = flattenHistoricalTransactions(transactions);
    expect(sortHistoricalRows(rows, { key: 'unitPrice', direction: 'ascending' }, 'en').map((row) => row.unitPrice)).toEqual([20, 100, null]);
    expect(sortHistoricalRows(rows, { key: 'date', direction: 'ascending' }, 'en').map((row) => row.date)).toEqual(['2024-01-05', '2025-01-01', '2025-12-20']);
    expect(sortHistoricalRows(rows, { key: 'reference', direction: 'ascending' }, 'en').map((row) => row.reference)).toEqual(['TX-3', 'TX-20', null]);
  });

  it('calculates KPIs from the filtered dataset and handles an empty dataset', () => {
    const rows = flattenHistoricalTransactions(transactions);
    const filtered = filterHistoricalRows(rows, 'SALE', 'item');
    expect(historicalRowsKpis(filtered)).toEqual({ rowCount: 1, transactionCount: 1, totalQuantity: 2, totalValueDzd: 200, totalBenefitDzd: 500 });
    expect(historicalRowsKpis([])).toEqual({ rowCount: 0, transactionCount: 0, totalQuantity: 0, totalValueDzd: 0, totalBenefitDzd: 0 });
  });
});

describe('historical sortable table UI', () => {
  it('exposes sort state, toggles direction, switches columns, and reports export rows', () => {
    const onRowsChange = vi.fn();
    const { container } = render(<HistoricalRowPreview transactions={transactions} locale="en" onRowsChange={onRowsChange} />);
    const quantity = screen.getByRole('button', { name: /Qty/ });
    expect(quantity.closest('th')).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(quantity);
    expect(quantity.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    let bodyRows = Array.from(container.querySelectorAll<HTMLElement>('tbody tr'));
    expect(bodyRows[0].querySelectorAll('td')[7]).toHaveTextContent('2');
    fireEvent.click(quantity);
    expect(quantity.closest('th')).toHaveAttribute('aria-sort', 'descending');
    bodyRows = Array.from(container.querySelectorAll<HTMLElement>('tbody tr'));
    expect(bodyRows[0].querySelectorAll('td')[7]).toHaveTextContent('10');
    fireEvent.click(screen.getByRole('button', { name: /Date/ }));
    expect(screen.getByRole('button', { name: /Date/ }).closest('th')).toHaveAttribute('aria-sort', 'ascending');
    expect(onRowsChange).toHaveBeenCalled();
  });
});
