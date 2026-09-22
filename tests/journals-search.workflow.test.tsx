import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { JournalsScreen } from '../src/features/accounting/JournalsScreen';
import { I18nProvider } from '../src/shared/i18n';
import { SessionContext } from '../src/shared/session/SessionContext';
import * as gateway from '../src/shared/ipc/gateway';
import type { JournalSearchResult } from '../src/shared/ipc/dto';

vi.mock('../src/shared/ipc/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/ipc/gateway')>();
  return {
    ...actual,
    searchJournals: vi.fn(),
    getJournalDetail: vi.fn(),
  };
});

const emptyResult: JournalSearchResult = { total_count: 0, rows: [], available_source_types: [] };

const mockSession = {
  user: { username: 'admin', display_name: 'Admin', token: 'test-token' },
  activeCashSession: null,
  workstationId: 'WS-MAIN',
  login: vi.fn(),
  logout: vi.fn(),
  clearSession: vi.fn(),
  refreshActiveCashSession: vi.fn(),
  setActiveCashSession: vi.fn(),
};

function renderComponent() {
  return render(
    <I18nProvider>
      <SessionContext.Provider value={mockSession}>
        <JournalsScreen />
      </SessionContext.Provider>
    </I18nProvider>
  );
}

describe('Journals search workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gateway.searchJournals).mockResolvedValue(emptyResult);
  });

  it('loads with the last-30-days defaults', async () => {
    renderComponent();

    await waitFor(() => expect(gateway.searchJournals).toHaveBeenCalled());

    const [, filter] = vi.mocked(gateway.searchJournals).mock.calls[0];
    const today = new Date().toISOString().slice(0, 10);
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 29);
    expect(filter?.date_to).toBe(today);
    expect(filter?.date_from).toBe(dateFrom.toISOString().slice(0, 10));
    expect(filter?.limit).toBe(50);
    expect(filter?.offset).toBe(0);
  });

  it('lists the available source types with human labels', async () => {
    vi.mocked(gateway.searchJournals).mockResolvedValue({
      ...emptyResult,
      available_source_types: ['CASH_SALE', 'CASH_MOVEMENT'],
    });

    renderComponent();

    await waitFor(() => {
      const options = Array.from(
        (screen.getByTestId('journal-source-filter') as HTMLSelectElement).options
      ).map((o) => o.textContent);
      expect(options).toContain('Cash Sale');
      expect(options).toContain('Cash In / Out');
    });
  });

  it('shows a CASH_MOVEMENT row source as Session #<id>', async () => {
    vi.mocked(gateway.searchJournals).mockResolvedValue({
      total_count: 1,
      available_source_types: ['CASH_MOVEMENT'],
      rows: [
        {
          document_id: 900,
          document_number: 'JE-2026-000900',
          document_date: '2026-09-20',
          fiscal_period_id: 1,
          source_type: 'CASH_MOVEMENT',
          source_id: 42,
          source_document_number: null,
          description: 'Cash out of drawer',
          total_debit: '150.00',
          total_credit: '150.00',
          is_balanced: true,
          created_at: '2026-09-20T10:00:00Z',
          created_by_username: 'admin',
          created_on_workstation_id: 'WS-1',
        },
      ],
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Session #42')).toBeInTheDocument();
    });
  });

  it('formats debit and credit amounts', async () => {
    vi.mocked(gateway.searchJournals).mockResolvedValue({
      total_count: 1,
      available_source_types: ['CASH_SALE'],
      rows: [
        {
          document_id: 901,
          document_number: 'JE-2026-000901',
          document_date: '2026-09-20',
          fiscal_period_id: 1,
          source_type: 'CASH_SALE',
          source_id: 10,
          source_document_number: 'VC-2026-000010',
          description: null,
          total_debit: '900',
          total_credit: '900',
          is_balanced: true,
          created_at: '2026-09-20T10:00:00Z',
          created_by_username: 'admin',
          created_on_workstation_id: 'WS-1',
        },
      ],
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('900.00 DZD').length).toBe(2);
    });
  });

  it('paginates the same way as the Documents screen', async () => {
    vi.mocked(gateway.searchJournals).mockResolvedValue({
      total_count: 120,
      available_source_types: ['CASH_SALE'],
      rows: Array.from({ length: 50 }, (_, i) => ({
        document_id: i + 1,
        document_number: `JE-${i + 1}`,
        document_date: '2026-09-20',
        fiscal_period_id: 1,
        source_type: 'CASH_SALE',
        source_id: null,
        source_document_number: null,
        description: null,
        total_debit: '10.00',
        total_credit: '10.00',
        is_balanced: true,
        created_at: '2026-09-20T10:00:00Z',
        created_by_username: 'admin',
        created_on_workstation_id: 'WS-1',
      })),
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Showing 1–50 of 120')).toBeInTheDocument();
    });
    expect(screen.getByTestId('journal-page-prev')).toBeDisabled();
    expect(screen.getByTestId('journal-page-next')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('journal-page-next'));

    await waitFor(() => {
      const [, filter] = vi.mocked(gateway.searchJournals).mock.calls[vi.mocked(gateway.searchJournals).mock.calls.length - 1];
      expect(filter?.offset).toBe(50);
    });
  });

  it('shows <scf_code> · <name> per line, localized by locale, in the detail modal', async () => {
    vi.mocked(gateway.searchJournals).mockResolvedValue({
      total_count: 1,
      available_source_types: ['CASH_SALE'],
      rows: [
        {
          document_id: 902,
          document_number: 'JE-2026-000902',
          document_date: '2026-09-20',
          fiscal_period_id: 1,
          source_type: 'CASH_SALE',
          source_id: 11,
          source_document_number: 'VC-2026-000011',
          description: null,
          total_debit: '500.00',
          total_credit: '500.00',
          is_balanced: true,
          created_at: '2026-09-20T10:00:00Z',
          created_by_username: 'admin',
          created_on_workstation_id: 'WS-1',
        },
      ],
    });
    vi.mocked(gateway.getJournalDetail).mockResolvedValue({
      document_id: 902,
      document_number: 'JE-2026-000902',
      document_date: '2026-09-20',
      fiscal_period_id: 1,
      source_type: 'CASH_SALE',
      source_id: 11,
      source_document_number: 'VC-2026-000011',
      description: null,
      total_debit: '500.00',
      total_credit: '500.00',
      is_balanced: true,
      created_at: '2026-09-20T10:00:00Z',
      created_by_username: 'admin',
      created_on_workstation_id: 'WS-1',
      lines: [
        {
          line_number: 1,
          account_code: '530',
          account_name: 'Caisse',
          scf_code: '530',
          name_fr: 'Caisse',
          name_en: 'Cash',
          name_ar: 'الصندوق',
          debit: '500.00',
          credit: '0.00',
        },
      ],
    });

    renderComponent();

    await waitFor(() => expect(screen.getByTestId('view-journal-902')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('view-journal-902'));

    await waitFor(() => {
      expect(screen.getByText('530 · Cash')).toBeInTheDocument();
    });
  });
});
