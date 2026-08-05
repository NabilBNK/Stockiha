import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { OpeningStateApplicationScreen } from '../src/features/onboarding/OpeningStateApplicationScreen';
import { I18nProvider } from '../src/shared/i18n';

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

function context(applied = false) {
  return {
    enabled: true,
    hasApprovedPackage: true,
    applied,
    applicationId: applied ? 44 : null,
    journalDocumentId: applied ? 88 : null,
    package: {
      packageId: 17,
      status: 'APPROVED_FOR_APPLICATION',
      cutoverDate: '2026-08-05',
      totalAssetsDzd: 42000,
      totalLiabilitiesDzd: 13000,
      totalEquityDzd: 29000,
      reconciliationDifferenceDzd: 0,
    },
    lines: [
      {
        lineId: 1,
        sourceRowNumber: 2,
        lineType: 'CASH',
        description: 'Cash on hand',
        amountDzd: 10000,
        counterpartyName: null,
        externalReference: null,
        notes: null,
        accountOptions: [{ accountCode: 'CASH_DESK', normalSide: 'DEBIT', description: 'Cash', isDefault: true }],
      },
      {
        lineId: 2,
        sourceRowNumber: 3,
        lineType: 'CUSTOMER_RECEIVABLE',
        description: 'Customer balance',
        amountDzd: 7000,
        counterpartyName: 'Customer evidence',
        externalReference: null,
        notes: null,
        accountOptions: [{ accountCode: 'ACCOUNTS_RECEIVABLE', normalSide: 'DEBIT', description: 'AR', isDefault: true }],
      },
      {
        lineId: 3,
        sourceRowNumber: 4,
        lineType: 'SUPPLIER_PAYABLE',
        description: 'Supplier balance',
        amountDzd: 8000,
        counterpartyName: 'Supplier evidence',
        externalReference: null,
        notes: null,
        accountOptions: [{ accountCode: 'ACCOUNTS_PAYABLE', normalSide: 'CREDIT', description: 'AP', isDefault: true }],
      },
      {
        lineId: 4,
        sourceRowNumber: 5,
        lineType: 'OWNER_CAPITAL',
        description: 'Owner capital',
        amountDzd: 9000,
        counterpartyName: null,
        externalReference: null,
        notes: null,
        accountOptions: [{ accountCode: 'OWNER_CAPITAL', normalSide: 'CREDIT', description: 'Capital', isDefault: true }],
      },
    ],
  };
}

function renderScreen(onApplied = vi.fn()) {
  render(
    <I18nProvider initialLocale="en">
      <OpeningStateApplicationScreen
        sessionToken="session-token"
        openFiscalPeriodId={3}
        onApplied={onApplied}
        onCancel={vi.fn()}
      />
    </I18nProvider>,
  );
  return onApplied;
}

describe('R5-003 opening-state application workflow', () => {
  it('requires explicit party mappings and confirmation before applying once', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === 'get_opening_state_application_context') return Promise.resolve(context());
      if (command === 'list_customers') {
        return Promise.resolve([{
          id: 101,
          code: 'C-101',
          name: 'Mapped Customer',
          contact_name: null,
          phone: null,
          email: null,
          address: null,
          tax_id: null,
          is_active: true,
          credit_enabled: true,
          credit_limit: '100000',
          payment_terms_days: 30,
          max_overdue_days: null,
          exposure_amount: '0',
          available_credit: '100000',
          oldest_open_due_date: null,
          created_at: '',
        }]);
      }
      if (command === 'list_suppliers') {
        return Promise.resolve([{
          id: 202,
          code: 'S-202',
          name: 'Mapped Supplier',
          contact_name: null,
          phone: null,
          email: null,
          address: null,
          tax_id: null,
          is_active: true,
          created_at: '',
        }]);
      }
      if (command === 'apply_opening_state') {
        return Promise.resolve({
          applicationId: 44,
          packageId: 17,
          journalDocumentId: 88,
          status: 'APPLIED',
          isReplay: false,
          physicalInventoryIncomplete: true,
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Apply opening state' })).toBeInTheDocument();
    expect(screen.getByText(/one-time, immutable cutover operation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply opening state once' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Select the existing customer/), {
      target: { value: '101' },
    });
    fireEvent.change(screen.getByLabelText(/Select the existing supplier/), {
      target: { value: '202' },
    });
    fireEvent.click(screen.getByRole('checkbox'));

    const applyButton = screen.getByRole('button', { name: 'Apply opening state once' });
    expect(applyButton).toBeEnabled();
    fireEvent.click(applyButton);
    expect(screen.getByRole('dialog', { name: 'Confirm one-time opening-state application' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply permanently' }));

    expect(await screen.findByText('Opening state applied successfully.')).toBeInTheDocument();
    expect(screen.getByText(/Opening journal ID/)).toHaveTextContent('88');

    const applyCall = calls.find((call) => call.command === 'apply_opening_state');
    expect(applyCall?.args).toMatchObject({
      sessionToken: 'session-token',
      request: {
        packageId: 17,
        fiscalPeriodId: 3,
        mappings: [
          { lineId: 2, customerId: 101 },
          { lineId: 3, supplierId: 202 },
        ],
      },
    });
  });

  it('blocks application when no open fiscal period exists', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_opening_state_application_context') return Promise.resolve(context());
      if (command === 'list_customers' || command === 'list_suppliers') return Promise.resolve([]);
      throw new Error(`Unexpected command: ${command}`);
    });

    render(
      <I18nProvider initialLocale="en">
        <OpeningStateApplicationScreen
          sessionToken="session-token"
          openFiscalPeriodId={null}
          onApplied={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('An open fiscal period containing the cutover date is required.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply opening state once' })).toBeDisabled();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));
  });
});
