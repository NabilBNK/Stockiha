import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
const parseWorkbookMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('../src/features/onboarding/xlsxParser', async () => {
  const actual = await vi.importActual<typeof import('../src/features/onboarding/xlsxParser')>(
    '../src/features/onboarding/xlsxParser',
  );
  return {
    ...actual,
    parseHistoricalFinanceWorkbook: (...args: unknown[]) => parseWorkbookMock(...args),
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
  parseWorkbookMock.mockReset();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

function renderScreen(locale: 'en' | 'fr' | 'ar' = 'en') {
  render(
    <I18nProvider initialLocale={locale}>
      <HistoricalFinanceScreen sessionToken="session-token" />
    </I18nProvider>,
  );
}

describe('R0-001 historical finance onboarding', () => {
  it('parses the official workbook, stages typed rows, validates, and approves', async () => {
    parseWorkbookMock.mockResolvedValue({
      rows: [
        {
          sourceRowNumber: 2,
          paperId: 'PAPER-000001',
          transactionDate: '2025-01-10',
          transactionType: 'SALE',
          descriptionOrCategory: 'Historical sale',
          netAmountDzd: 100000,
          paymentStatus: 'PAID',
          amountPaidDzd: 100000,
          expenseCategory: null,
          supplierFournisseur: null,
          customerClient: 'Customer A',
          notes: null,
          reviewStatus: 'READY',
        },
      ],
      balances: [
        {
          sourceRowNumber: 2,
          balanceDate: '2025-01-01',
          balanceType: 'OPENING_INVENTORY_VALUE',
          amountDzd: 25000,
          supplierFournisseur: null,
          customerClient: null,
          notes: null,
          reviewStatus: 'READY',
        },
      ],
      errors: [],
    });

    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      switch (command) {
        case 'get_historical_finance_setting':
          return Promise.resolve({ enabled: true });
        case 'create_historical_finance_batch':
          return Promise.resolve({
            batchId: 7,
            status: 'DRAFT',
            isReplay: false,
            sourceType: 'EXCEL',
            originalFilename: 'history.xlsx',
          });
        case 'replace_historical_finance_batch_data':
          return Promise.resolve({
            batchId: 7,
            status: 'DRAFT',
            transactionRowCount: 1,
            balanceRowCount: 1,
          });
        case 'validate_historical_finance_batch':
          return Promise.resolve(VALIDATION_RESULT);
        case 'approve_historical_finance_batch':
          return Promise.resolve({ batchId: 7, status: 'APPROVED_FOR_REPORTING', isReplay: false });
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });

    renderScreen();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'get_historical_finance_setting',
      { sessionToken: 'session-token' },
    ));

    const file = new File(['safe-workbook'], 'history.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(screen.getByLabelText('Choose .xlsx workbook'), {
      target: { files: [file] },
    });

    expect(await screen.findByText('Workbook parsed successfully.')).toBeInTheDocument();
    expect(screen.getByTestId('workbook-preview')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Stage and validate workbook' }));
    expect(await screen.findByText('The batch is clean and ready for approval.')).toBeInTheDocument();

    const createCall = calls.find((call) => call.command === 'create_historical_finance_batch');
    expect(createCall?.args).toMatchObject({
      sessionToken: 'session-token',
      request: {
        sourceType: 'EXCEL',
        originalFilename: 'history.xlsx',
      },
    });
    expect(createCall?.args).not.toHaveProperty('filePath');
    expect(createCall?.args).not.toHaveProperty('fileBytes');

    const replaceCall = calls.find((call) => call.command === 'replace_historical_finance_batch_data');
    expect(replaceCall?.args).toMatchObject({
      sessionToken: 'session-token',
      request: {
        batchId: 7,
        rows: [{ paperId: 'PAPER-000001', netAmountDzd: 100000 }],
        balances: [{ balanceType: 'OPENING_INVENTORY_VALUE', amountDzd: 25000 }],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Approve for historical reporting' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Historical batch approved for reporting.')).toBeInTheDocument();
    expect(calls.some((call) => call.command === 'approve_historical_finance_batch')).toBe(true);
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
