import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentsScreen } from '../src/features/documents/DocumentsScreen';
import { I18nProvider } from '../src/shared/i18n';
import { SessionContext } from '../src/shared/session/SessionContext';

vi.mock('../src/shared/ipc/documentGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/ipc/documentGateway')>();
  return {
    ...actual,
    searchBusinessDocuments: vi.fn().mockResolvedValue({
      total_count: 2,
      rows: [
        {
          document_id: 201,
          document_type: 'PURCHASE_RECEIPT',
          document_number: 'PR-2026-000050',
          document_date: '2026-08-12',
          status: 'POSTED',
          posted_at: '2026-08-12T10:00:00Z',
          party_name: 'Main Supplier',
          amount: '1000.00',
          linked_journal_id: 101,
          linked_journal_number: 'JE-2026-000101',
          created_by_username: 'admin',
          created_on_workstation_id: 'TEST-STATION',
          reverses_document_id: null,
          reverses_document_number: null,
          reversed_by_document_id: null,
          reversed_by_document_number: null,
        },
        {
          document_id: 202,
          document_type: 'CASH_SALE',
          document_number: 'VC-2026-000012',
          document_date: '2026-08-12',
          status: 'POSTED',
          posted_at: '2026-08-12T11:00:00Z',
          party_name: null,
          amount: '500.00',
          linked_journal_id: 102,
          linked_journal_number: 'JE-2026-000102',
          created_by_username: 'cashier1',
          created_on_workstation_id: 'TEST-STATION',
          reverses_document_id: null,
          reverses_document_number: null,
          reversed_by_document_id: null,
          reversed_by_document_number: null,
        },
      ],
    }),
    getBusinessDocumentReports: vi.fn(),
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

function renderDocumentsScreen() {
  return render(
    <I18nProvider>
      <SessionContext.Provider value={mockSession}>
        <DocumentsScreen />
      </SessionContext.Provider>
    </I18nProvider>
  );
}

describe('DocumentsScreen Workflow', () => {
  it('renders business documents with party, amount, recorded-by and walk-in fallback, and no generation/print columns', async () => {
    renderDocumentsScreen();

    await waitFor(() => {
      expect(screen.getByTestId('printable-documents-table')).toBeInTheDocument();
    });

    expect(screen.getByText('PR-2026-000050')).toBeInTheDocument();
    expect(screen.getByText('VC-2026-000012')).toBeInTheDocument();
    expect(screen.getByText('Main Supplier')).toBeInTheDocument();
    expect(screen.getByText('Walk-in customer')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('cashier1')).toBeInTheDocument();
    expect(screen.queryByText('Generation')).not.toBeInTheDocument();
    expect(screen.queryByText('Print')).not.toBeInTheDocument();
  });
});
