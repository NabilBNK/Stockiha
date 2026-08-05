import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { OpeningStateScreen } from '../src/features/onboarding/OpeningStateScreen';
import { I18nProvider } from '../src/shared/i18n';

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

function renderScreen(locale: 'en' | 'fr' | 'ar' = 'en') {
  render(
    <I18nProvider initialLocale={locale}>
      <OpeningStateScreen sessionToken="session-token" />
    </I18nProvider>,
  );
}

function fillRequiredBalancedState() {
  fireEvent.change(screen.getByLabelText('Cutover date'), {
    target: { value: '2026-08-05' },
  });
  const amounts = screen.getAllByLabelText('Amount (DZD)');
  fireEvent.change(amounts[0], { target: { value: '10000' } });
  fireEvent.change(amounts[1], { target: { value: '5000' } });
  fireEvent.change(amounts[2], { target: { value: '20000' } });
  fireEvent.change(amounts[3], { target: { value: '35000' } });
}

describe('R5-002 opening-state reconciliation workflow', () => {
  it('stages, reconciles, and approves a balanced current opening state', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === 'get_opening_state_setting') return Promise.resolve({ enabled: true });
      if (command === 'create_opening_state_package') {
        return Promise.resolve({
          packageId: 17,
          status: 'DRAFT',
          isReplay: false,
          sourceType: 'MANUAL',
          originalFilename: null,
          cutoverDate: '2026-08-05',
        });
      }
      if (command === 'replace_opening_state_package_data') {
        return Promise.resolve({ packageId: 17, status: 'DRAFT', lineCount: 4 });
      }
      if (command === 'validate_opening_state_package') {
        return Promise.resolve({
          packageId: 17,
          status: 'VALIDATED',
          rowCount: 4,
          invalidRowCount: 0,
          totalAssetsDzd: 35000,
          totalLiabilitiesDzd: 0,
          totalEquityDzd: 35000,
          reconciliationDifferenceDzd: 0,
          validationErrors: [],
        });
      }
      if (command === 'approve_opening_state_package') {
        return Promise.resolve({
          packageId: 17,
          status: 'APPROVED_FOR_APPLICATION',
          isReplay: false,
          cutoverDate: '2026-08-05',
          totalAssetsDzd: 35000,
          totalLiabilitiesDzd: 0,
          totalEquityDzd: 35000,
          reconciliationDifferenceDzd: 0,
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Opening-state reconciliation' })).toBeInTheDocument();
    expect(screen.getByText(/does not create live cash, stock, receivables/)).toBeInTheDocument();

    fillRequiredBalancedState();
    fireEvent.click(screen.getByRole('button', { name: 'Stage and reconcile' }));

    expect(await screen.findByText('The opening-state package is balanced and ready for approval.')).toBeInTheDocument();
    expect(screen.getByTestId('opening-state-totals')).toHaveTextContent('35,000 DZD');
    expect(screen.getByTestId('opening-state-totals')).toHaveTextContent('0 DZD');

    const createCall = calls.find((call) => call.command === 'create_opening_state_package');
    expect(createCall?.args).toMatchObject({
      sessionToken: 'session-token',
      request: {
        sourceType: 'MANUAL',
        originalFilename: null,
        cutoverDate: '2026-08-05',
      },
    });

    const replaceCall = calls.find((call) => call.command === 'replace_opening_state_package_data');
    const replaceRequest = replaceCall?.args.request as { lines: Array<Record<string, unknown>> };
    expect(replaceRequest.lines).toHaveLength(4);
    expect(replaceRequest.lines[0]).toMatchObject({
      sourceRowNumber: 2,
      lineType: 'CASH',
      amountDzd: 10000,
      reviewStatus: 'READY',
    });
    expect(replaceRequest.lines[3]).toMatchObject({
      lineType: 'OWNER_CAPITAL',
      amountDzd: 35000,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Approve as ready for application' }));
    expect(await screen.findByText('Opening state approved as ready for a later controlled application.')).toBeInTheDocument();
    expect(calls.some((call) => call.command === 'approve_opening_state_package')).toBe(true);
  });

  it('requires supplier identity before staging a supplier payable', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_opening_state_setting') return Promise.resolve({ enabled: true });
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();
    await screen.findByRole('heading', { name: 'Opening-state reconciliation' });
    fillRequiredBalancedState();
    fireEvent.click(screen.getByRole('button', { name: 'Add balance line' }));

    const types = screen.getAllByLabelText('Balance type');
    fireEvent.change(types[4], { target: { value: 'SUPPLIER_PAYABLE' } });
    const descriptions = screen.getAllByLabelText('Description');
    const amounts = screen.getAllByLabelText('Amount (DZD)');
    fireEvent.change(descriptions[4], { target: { value: 'Outstanding supplier balance' } });
    fireEvent.change(amounts[4], { target: { value: '5000' } });

    fireEvent.click(screen.getByRole('button', { name: 'Stage and reconcile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Supplier payables require a supplier name.',
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('turns the feature setting off and disables new reconciliation actions', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_opening_state_setting') return Promise.resolve({ enabled: true });
      if (command === 'update_opening_state_setting') return Promise.resolve({ enabled: false });
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();
    const setting = await screen.findByRole('checkbox', {
      name: 'Opening-state reconciliation enabled',
    });
    expect(setting).toBeChecked();
    fireEvent.click(setting);
    await waitFor(() => expect(setting).not.toBeChecked());
    expect(screen.getByRole('button', { name: 'Stage and reconcile' })).toBeDisabled();
  });

  it('renders Arabic copy under RTL direction', async () => {
    invokeMock.mockResolvedValue({ enabled: true });
    renderScreen('ar');

    expect(await screen.findByRole('heading', { name: 'مطابقة الوضعية الافتتاحية' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حفظ ومطابقة الوضعية' })).toBeEnabled();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});
