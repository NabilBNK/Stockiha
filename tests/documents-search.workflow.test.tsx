import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { DocumentsScreen } from '../src/features/documents/DocumentsScreen';
import { I18nProvider } from '../src/shared/i18n';
import { SessionContext } from '../src/shared/session/SessionContext';
import * as documentGateway from '../src/shared/ipc/documentGateway';
import type { DocumentSearchResult } from '../src/shared/ipc/documentDto';

vi.mock('../src/shared/ipc/documentGateway', () => ({
  searchBusinessDocuments: vi.fn(),
  getBusinessDocumentReports: vi.fn(),
}));

const emptyResult: DocumentSearchResult = { total_count: 0, rows: [] };

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
        <DocumentsScreen />
      </SessionContext.Provider>
    </I18nProvider>
  );
}

describe('Documents search workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(documentGateway.searchBusinessDocuments).mockResolvedValue(emptyResult);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads with a 30-day range ending today, limit 50 and offset 0', async () => {
    renderComponent();

    await waitFor(() => {
      expect(documentGateway.searchBusinessDocuments).toHaveBeenCalled();
    });

    const [, filter] = vi.mocked(documentGateway.searchBusinessDocuments).mock.calls[0];
    const today = new Date().toISOString().slice(0, 10);
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 29);
    expect(filter?.date_to).toBe(today);
    expect(filter?.date_from).toBe(dateFrom.toISOString().slice(0, 10));
    expect(filter?.limit).toBe(50);
    expect(filter?.offset).toBe(0);
  });

  it('reloads with the chosen type and resets the offset when the type filter changes', async () => {
    renderComponent();
    await waitFor(() => expect(documentGateway.searchBusinessDocuments).toHaveBeenCalled());
    vi.mocked(documentGateway.searchBusinessDocuments).mockClear();

    fireEvent.change(screen.getByTestId('doc-filter-type'), { target: { value: 'CASH_SALE' } });

    await waitFor(() => {
      expect(documentGateway.searchBusinessDocuments).toHaveBeenCalled();
      const [, filter] = vi.mocked(documentGateway.searchBusinessDocuments).mock.calls[vi.mocked(documentGateway.searchBusinessDocuments).mock.calls.length - 1];
      expect(filter?.document_type).toBe('CASH_SALE');
      expect(filter?.offset).toBe(0);
    });
  });

  it('calls the backend once, 400ms after typing stops, not on every keystroke', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderComponent();
    await vi.waitFor(() => expect(documentGateway.searchBusinessDocuments).toHaveBeenCalled());
    vi.mocked(documentGateway.searchBusinessDocuments).mockClear();

    const input = screen.getByTestId('doc-filter-search');
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.change(input, { target: { value: 'AN' } });
    fireEvent.change(input, { target: { value: 'AN-' } });

    expect(documentGateway.searchBusinessDocuments).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);

    await vi.waitFor(() => {
      expect(documentGateway.searchBusinessDocuments).toHaveBeenCalledTimes(1);
    });
    const [, filter] = vi.mocked(documentGateway.searchBusinessDocuments).mock.calls[0];
    expect(filter?.search).toBe('AN-');
  });

  it('shows a warning and makes no call when the start date is after the end date', async () => {
    renderComponent();
    await waitFor(() => expect(documentGateway.searchBusinessDocuments).toHaveBeenCalled());
    vi.mocked(documentGateway.searchBusinessDocuments).mockClear();

    fireEvent.change(screen.getByTestId('doc-filter-date-from'), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByTestId('doc-filter-date-to'), { target: { value: '2026-01-01' } });

    await waitFor(() => {
      expect(screen.getByText('The start date is after the end date.')).toBeInTheDocument();
    });
    expect(documentGateway.searchBusinessDocuments).not.toHaveBeenCalled();
  });

  it('renders party, amount, recorded-by, a cancellation note, and the walk-in fallback', async () => {
    vi.mocked(documentGateway.searchBusinessDocuments).mockResolvedValue({
      total_count: 2,
      rows: [
        {
          document_id: 1,
          document_number: 'AN-2026-000001',
          document_type: 'SALE_VOID',
          document_date: '2026-09-20',
          status: 'POSTED',
          posted_at: '2026-09-20T10:00:00Z',
          party_name: null,
          amount: '900.00',
          linked_journal_id: null,
          linked_journal_number: null,
          created_by_username: 'cashier1',
          created_on_workstation_id: 'WS-1',
          reverses_document_id: 5,
          reverses_document_number: 'VC-2026-000005',
          reversed_by_document_id: null,
          reversed_by_document_number: null,
        },
        {
          document_id: 5,
          document_number: 'VC-2026-000005',
          document_type: 'CASH_SALE',
          document_date: '2026-09-20',
          status: 'REVERSED',
          posted_at: '2026-09-20T09:00:00Z',
          party_name: null,
          amount: '900.00',
          linked_journal_id: null,
          linked_journal_number: null,
          created_by_username: 'cashier1',
          created_on_workstation_id: 'WS-1',
          reverses_document_id: null,
          reverses_document_number: null,
          reversed_by_document_id: 1,
          reversed_by_document_number: 'AN-2026-000001',
        },
      ],
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('AN-2026-000001')).toBeInTheDocument();
    });
    expect(screen.getByText('Walk-in customer')).toBeInTheDocument();
    expect(screen.getAllByText('900.00 DZD').length).toBe(2);
    expect(screen.getAllByText('cashier1').length).toBe(2);
    expect(screen.getByText(/Cancels VC-2026-000005/)).toBeInTheDocument();
    expect(screen.getByText(/Cancelled by AN-2026-000001/)).toBeInTheDocument();
  });

  it('offers no JOURNAL_ENTRY option in the type filter', async () => {
    renderComponent();
    await waitFor(() => expect(documentGateway.searchBusinessDocuments).toHaveBeenCalled());

    const options = Array.from(
      (screen.getByTestId('doc-filter-type') as HTMLSelectElement).options
    ).map((o) => o.value);
    expect(options).not.toContain('JOURNAL_ENTRY');
  });

  it('paginates by 50, disables at the ends, and shows the correct Showing text', async () => {
    vi.mocked(documentGateway.searchBusinessDocuments).mockResolvedValue({
      total_count: 120,
      rows: Array.from({ length: 50 }, (_, i) => ({
        document_id: i + 1,
        document_number: `DOC-${i + 1}`,
        document_type: 'CASH_SALE',
        document_date: '2026-09-20',
        status: 'POSTED',
        posted_at: '2026-09-20T10:00:00Z',
        party_name: null,
        amount: '100.00',
        linked_journal_id: null,
        linked_journal_number: null,
        created_by_username: 'admin',
        created_on_workstation_id: 'WS-1',
        reverses_document_id: null,
        reverses_document_number: null,
        reversed_by_document_id: null,
        reversed_by_document_number: null,
      })),
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Showing 1–50 of 120')).toBeInTheDocument();
    });
    expect(screen.getByTestId('doc-page-prev')).toBeDisabled();
    expect(screen.getByTestId('doc-page-next')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('doc-page-next'));

    await waitFor(() => {
      const [, filter] = vi.mocked(documentGateway.searchBusinessDocuments).mock.calls[vi.mocked(documentGateway.searchBusinessDocuments).mock.calls.length - 1];
      expect(filter?.offset).toBe(50);
    });
  });

  it('resets filters to their defaults', async () => {
    renderComponent();
    await waitFor(() => expect(documentGateway.searchBusinessDocuments).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('doc-filter-type'), { target: { value: 'CASH_SALE' } });
    await waitFor(() => {
      const [, filter] = vi.mocked(documentGateway.searchBusinessDocuments).mock.calls[vi.mocked(documentGateway.searchBusinessDocuments).mock.calls.length - 1];
      expect(filter?.document_type).toBe('CASH_SALE');
    });

    fireEvent.click(screen.getByTestId('doc-filter-reset'));

    await waitFor(() => {
      const [, filter] = vi.mocked(documentGateway.searchBusinessDocuments).mock.calls[vi.mocked(documentGateway.searchBusinessDocuments).mock.calls.length - 1];
      expect(filter?.document_type).toBeNull();
    });
  });

  it('shows the error card on a backend failure, and Retry reloads', async () => {
    const errorText = 'An internal error occurred. Please try again.';
    vi.mocked(documentGateway.searchBusinessDocuments).mockRejectedValueOnce({ code: 'INTERNAL_ERROR' });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(errorText)).toBeInTheDocument();
    });

    vi.mocked(documentGateway.searchBusinessDocuments).mockResolvedValue(emptyResult);
    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.queryByText(errorText)).not.toBeInTheDocument();
    });
  });
});
