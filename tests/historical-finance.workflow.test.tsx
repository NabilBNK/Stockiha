import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
const parsePaperBookMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('../src/features/onboarding/xlsxParser', async () => {
  const actual = await vi.importActual<typeof import('../src/features/onboarding/xlsxParser')>(
    '../src/features/onboarding/xlsxParser',
  );
  return {
    ...actual,
    parsePaperBookWorkbook: (...args: unknown[]) => parsePaperBookMock(...args),
  };
});

import { HistoricalFinanceScreen } from '../src/features/onboarding/HistoricalFinanceScreen';
import { I18nProvider } from '../src/shared/i18n';

const VALIDATION_RESULT = {
  batchId: 7,
  status: 'VALIDATED',
  rowCount: 1,
  invalidRowCount: 0,
  totalSalesDzd: 100000,
  totalPurchasesDzd: 0,
  totalExpensesDzd: 0,
  totalOtherIncomeDzd: 0,
  totalCustomerRefundsDzd: 0,
  totalSupplierRefundsDzd: 0,
  preliminaryResultBeforeInventoryDzd: 100000,
};

beforeEach(() => {
  cleanup();
  invokeMock.mockReset();
  parsePaperBookMock.mockReset();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

function renderScreen(locale: 'en' | 'fr' | 'ar' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <HistoricalFinanceScreen sessionToken="session-token" />
    </I18nProvider>,
  );
}

describe('historical finance onboarding', () => {
  it('parses the primary paper book, stages typed rows, validates, and approves', async () => {
    parsePaperBookMock.mockResolvedValue({
      transactions: [{
        sourceTransactionSequence: 1, sourceFirstExcelRow: 2, sourceExcelTxnRef: 'TX-1',
        transactionDate: '2025-01-10', transactionType: 'SALE', paymentStatus: 'PAID',
        partyCompany: 'Customer A', manualBenefitDzd: null, pageNumber: 1,
        lines: [{ sourceRowNumber: 2, lineSequence: 1, productName: 'Desk', brand: 'Stockiha', customDetails: null, partyCompany: null, manualBenefitDzd: 20000, quantity: 1, unitPriceDzd: 100000, manualLineTotalDzd: 100000 }],
      }],
      errors: [],
      warnings: [],
      contentHash: 'hash',
      summary: { transactionCount: 1, totalLines: 1, lineCount: 1, totalSalesDzd: 100000, totalPurchasesDzd: 0, totalExpensesDzd: 0, paidSalesDzd: 100000, unpaidSalesDzd: 0, paidPurchasesDzd: 0, unpaidPurchasesDzd: 0, paidExpensesDzd: 0, unpaidExpensesDzd: 0, totalManualBenefitDzd: 20000, isPartial: false, contentHash: 'hash' },
    });

    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      switch (command) {
        case 'get_historical_finance_setting':
          return Promise.resolve({ enabled: true });
        case 'create_historical_trade_batch':
          return Promise.resolve({ batchId: 7, status: 'DRAFT', isReplay: false, importProfile: 'PAPER_BOOK_V2', originalFilename: 'history.xlsx' });
        case 'replace_historical_trade_batch_data':
          return Promise.resolve({ batchId: 7, status: 'DRAFT', transactionCount: 1, lineCount: 1, unmatchedProductCount: 0, overrideCount: 0, missingQtyCount: 0 });
        case 'validate_historical_trade_batch':
          return Promise.resolve({ ...VALIDATION_RESULT, transactionCount: 1, lineCount: 1, paidSalesDzd: 100000, unpaidSalesDzd: 0, paidPurchasesDzd: 0, unpaidPurchasesDzd: 0, paidExpensesDzd: 0, unpaidExpensesDzd: 0, manualBenefitCount: 1, totalManualBenefitDzd: 20000, unmatchedProductCount: 0, overrideCount: 0, missingQtyCount: 0 });
        case 'approve_historical_trade_batch':
          return Promise.resolve({ batchId: 7, status: 'APPROVED_FOR_REPORTING', isReplay: false });
        case 'get_historical_trade_analytics':
          return Promise.resolve({ overview: { dateFrom: '2024-01-01', dateTo: '2026-12-31', transactionCount: 0 }, payment: { sales: {}, purchases: {}, expenses: {} }, timeline: [], products: [], brands: [], parties: [], expenses: {}, benefits: {}, dataQuality: {}, manualOverrides: {} });
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });

    const { container } = renderScreen();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'get_historical_finance_setting',
      { sessionToken: 'session-token' },
    ));

    const file = new File(['safe-workbook'], 'history.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    expect(await screen.findByText('Paper-book workbook parsed successfully.')).toBeInTheDocument();
    expect(screen.getByTestId('paperbook-preview')).toHaveTextContent('Desk');

    fireEvent.click(screen.getByRole('button', { name: 'Stage and validate paper book' }));
    expect(await screen.findByText('The batch is clean and ready for approval.')).toBeInTheDocument();

    const createCall = calls.find((call) => call.command === 'create_historical_trade_batch');
    expect(createCall?.args).toMatchObject({
      sessionToken: 'session-token',
      request: {
        originalFilename: 'history.xlsx',
        importProfile: 'PAPER_BOOK_V2',
      },
    });
    expect(createCall?.args).not.toHaveProperty('filePath');
    expect(createCall?.args).not.toHaveProperty('fileBytes');

    const replaceCall = calls.find((call) => call.command === 'replace_historical_trade_batch_data');
    expect(replaceCall?.args).toMatchObject({
      sessionToken: 'session-token',
      request: {
        batchId: 7,
        transactions: [{ sourceExcelTxnRef: 'TX-1', lines: [{ productName: 'Desk', manualBenefitDzd: 20000 }] }],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Approve paper book for reporting' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Historical batch approved for reporting.')).toBeInTheDocument();
    expect(calls.some((call) => call.command === 'approve_historical_trade_batch')).toBe(true);
  });

  it('uses the same typed staging path for direct manual entry including supplier', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      switch (command) {
        case 'get_historical_finance_setting':
          return Promise.resolve({ enabled: true });
        case 'create_historical_finance_batch':
          return Promise.resolve({
            batchId: 9,
            status: 'DRAFT',
            isReplay: false,
            sourceType: 'MANUAL',
            originalFilename: null,
          });
        case 'replace_historical_finance_batch_data':
          return Promise.resolve({ batchId: 9, status: 'DRAFT', transactionRowCount: 1, balanceRowCount: 0 });
        case 'validate_historical_finance_batch':
          return Promise.resolve({
            ...VALIDATION_RESULT,
            batchId: 9,
            totalSalesDzd: 0,
            totalPurchasesDzd: 60000,
            preliminaryResultBeforeInventoryDzd: -60000,
          });
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });

    renderScreen();
    await screen.findByLabelText('Paper ID');
    fireEvent.change(screen.getByLabelText('Paper ID'), { target: { value: 'PAPER-000009' } });
    fireEvent.change(screen.getByLabelText('Transaction date'), { target: { value: '2025-02-12' } });
    fireEvent.change(screen.getByLabelText('Transaction type'), { target: { value: 'PURCHASE' } });
    fireEvent.change(screen.getByLabelText('Description or category'), {
      target: { value: 'Historical merchandise purchase' },
    });
    fireEvent.change(screen.getByLabelText('Net amount (DZD)'), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText('Supplier / Fournisseur (optional)'), {
      target: { value: 'Supplier A' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stage and validate manual row' }));

    expect(await screen.findByText('Manual row staged and validated.')).toBeInTheDocument();
    const createCall = calls.find((call) => call.command === 'create_historical_finance_batch');
    expect(createCall?.args).toMatchObject({
      request: { sourceType: 'MANUAL', originalFilename: null },
    });
    const replaceCall = calls.find((call) => call.command === 'replace_historical_finance_batch_data');
    expect(replaceCall?.args).toMatchObject({
      request: {
        rows: [
          {
            paperId: 'PAPER-000009',
            transactionType: 'PURCHASE',
            supplierFournisseur: 'Supplier A',
            netAmountDzd: 60000,
          },
        ],
      },
    });
  });

  it('labels finance results as incomplete when inventory balances are missing', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_historical_finance_setting') return Promise.resolve({ enabled: true });
      if (command === 'get_historical_finance_summary') {
        return Promise.resolve({
          dateFrom: '2025-01-01',
          dateTo: '2026-06-30',
          salesDzd: 1000000,
          purchasesDzd: 700000,
          expensesDzd: 150000,
          otherIncomeDzd: 10000,
          customerRefundsDzd: 5000,
          supplierRefundsDzd: 2000,
          preliminaryResultBeforeInventoryDzd: 157000,
          openingInventoryDzd: null,
          closingInventoryDzd: null,
          inventoryDataComplete: false,
          estimatedProfitLossDzd: null,
          profitCalculationStatus: 'INCOMPLETE_WITHOUT_OPENING_AND_CLOSING_INVENTORY',
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();
    await screen.findByLabelText('From date');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2025-01-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-06-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate summary' }));

    const summary = await screen.findByTestId('historical-finance-summary');
    expect(summary).toHaveTextContent('Opening and closing inventory values are missing');
    expect(summary).toHaveTextContent('157,000 DZD');
    expect(summary).not.toHaveTextContent('Estimated profit / loss— DZD');
  });

  it('provides Arabic RTL copy and keeps historical data reporting-only', async () => {
    invokeMock.mockResolvedValue({ enabled: true });
    renderScreen('ar');

    expect(await screen.findByRole('heading', { name: 'إدخال البيانات المالية التاريخية' })).toBeInTheDocument();
    expect(screen.getByText(/للمراجعة والتقارير فقط/)).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});
