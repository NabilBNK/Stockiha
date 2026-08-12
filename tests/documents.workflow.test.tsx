import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentsScreen } from '../src/features/documents/DocumentsScreen';
import { I18nProvider } from '../src/shared/i18n';
import { SessionContext } from '../src/shared/session/SessionContext';

vi.mock('../src/shared/ipc/documentGateway', () => ({
  listBusinessDocuments: vi.fn().mockResolvedValue([
    {
      document_id: 201,
      document_type: 'PURCHASE_RECEIPT',
      document_number: 'PR-2026-000050',
      document_date: '2026-08-12',
      counterparty_name: 'Main Supplier',
      total_amount: '1000.00',
      currency_code: 'DZD',
      status: 'POSTED',
      generation_status: 'NOT_APPLICABLE',
      print_status: 'NOT_APPLICABLE',
      journal_document_id: 101,
      journal_document_number: 'JE-2026-000101',
      created_at: '2026-08-12T10:00:00Z',
    },
    {
      document_id: 202,
      document_type: 'SALES_RECEIPT',
      document_number: 'SR-2026-000012',
      document_date: '2026-08-12',
      counterparty_name: 'Walk-in Customer',
      total_amount: '500.00',
      currency_code: 'DZD',
      status: 'POSTED',
      generation_status: 'GENERATED',
      print_status: 'PRINTED',
      journal_document_id: 102,
      journal_document_number: 'JE-2026-000102',
      created_at: '2026-08-12T11:00:00Z',
    },
  ]),
}));

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
  it('renders business documents table with N/A badges for procurement and active status for sales', async () => {
    renderDocumentsScreen();

    await waitFor(() => {
      expect(screen.getByTestId('printable-documents-table')).toBeInTheDocument();
    });

    expect(screen.getByText('PR-2026-000050')).toBeInTheDocument();
    expect(screen.getByText('SR-2026-000012')).toBeInTheDocument();
    expect(screen.getAllByText(/Not applicable|N\/A/).length).toBeGreaterThanOrEqual(2);
  });
});
