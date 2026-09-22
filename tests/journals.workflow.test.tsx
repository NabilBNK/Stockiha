import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { JournalsScreen } from '../src/features/accounting/JournalsScreen';
import { I18nProvider } from '../src/shared/i18n';
import { SessionContext } from '../src/shared/session/SessionContext';

vi.mock('../src/shared/ipc/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/ipc/gateway')>();
  return {
    ...actual,
    searchJournals: vi.fn().mockResolvedValue({
      total_count: 2,
      available_source_types: ['PURCHASE_RECEIPT', 'SUPPLIER_INVOICE'],
      rows: [
        {
          document_id: 101,
          document_number: 'JE-2026-000101',
          document_date: '2026-08-12',
          fiscal_period_id: 1,
          source_type: 'PURCHASE_RECEIPT',
          source_id: 50,
          source_document_number: 'PR-2026-000050',
          description: 'Stock receipt journal entry',
          total_debit: '1000.00',
          total_credit: '1000.00',
          is_balanced: true,
          created_at: '2026-08-12T10:00:00Z',
          created_by_username: 'admin',
          created_on_workstation_id: 'TEST-STATION',
        },
        {
          document_id: 102,
          document_number: 'JE-2026-000102',
          document_date: '2026-08-12',
          fiscal_period_id: 1,
          source_type: 'SUPPLIER_INVOICE',
          source_id: 51,
          source_document_number: 'SI-2026-000051',
          description: 'Supplier invoice journal entry',
          total_debit: '1050.00',
          total_credit: '1050.00',
          is_balanced: true,
          created_at: '2026-08-12T10:05:00Z',
          created_by_username: 'admin',
          created_on_workstation_id: 'TEST-STATION',
        },
      ],
    }),
    getJournalDetail: vi.fn().mockResolvedValue({
      document_id: 101,
      document_number: 'JE-2026-000101',
      document_date: '2026-08-12',
      fiscal_period_id: 1,
      source_type: 'PURCHASE_RECEIPT',
      source_id: 50,
      source_document_number: 'PR-2026-000050',
      description: 'Stock receipt journal entry',
      total_debit: '1000.00',
      total_credit: '1000.00',
      is_balanced: true,
      created_at: '2026-08-12T10:00:00Z',
      created_by_username: 'admin',
      created_on_workstation_id: 'TEST-STATION',
      lines: [
        { line_number: 1, account_code: '3000', scf_code: '300', name_fr: 'Stock', name_en: 'Inventory', name_ar: 'المخزون', debit: '1000.00', credit: '0.00' },
        { line_number: 2, account_code: '3700', scf_code: '408', name_fr: 'Fournisseurs, factures non parvenues', name_en: 'GRNI', name_ar: 'فاتورة غير واردة', debit: '0.00', credit: '1000.00' },
      ],
    }),
  };
});

const mockSession = {
  user: { username: 'admin', display_name: 'Admin', token: 'valid_token' },
  activeCashSession: null,
  workstationId: 'TEST-STATION',
  login: vi.fn().mockResolvedValue('valid_token'),
  logout: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn(),
  refreshActiveCashSession: vi.fn().mockResolvedValue(null),
  setActiveCashSession: vi.fn(),
};

function renderJournalsScreen(initialJournalId?: number | null) {
  return render(
    <I18nProvider>
      <SessionContext.Provider value={mockSession}>
        <JournalsScreen initialJournalId={initialJournalId} />
      </SessionContext.Provider>
    </I18nProvider>
  );
}

describe('JournalsScreen Workflow', () => {
  it('renders list of journals with balanced status badge', async () => {
    renderJournalsScreen();

    await waitFor(() => {
      expect(screen.getByTestId('journals-table')).toBeInTheDocument();
    });

    expect(screen.getByText('JE-2026-000101')).toBeInTheDocument();
    expect(screen.getByText('JE-2026-000102')).toBeInTheDocument();
    expect(screen.getAllByText('Balanced').length).toBeGreaterThanOrEqual(2);
  });

  it('opens journal lines modal on View Lines click', async () => {
    renderJournalsScreen();

    await waitFor(() => {
      expect(screen.getByTestId('view-journal-101')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('view-journal-101'));

    await waitFor(() => {
      expect(screen.getByTestId('journal-detail-modal')).toBeInTheDocument();
    });

    expect(screen.getByTestId('journal-lines-table')).toBeInTheDocument();
    expect(screen.getByText('300 · Inventory')).toBeInTheDocument();
    expect(screen.getByText('408 · GRNI')).toBeInTheDocument();
  });
});
