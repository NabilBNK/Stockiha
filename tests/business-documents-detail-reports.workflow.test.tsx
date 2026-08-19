import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DocumentsScreen } from '../src/features/documents/DocumentsScreen';
import { SessionContext } from '../src/shared/session/SessionContext';
import { I18nProvider } from '../src/shared/i18n';
import * as documentGateway from '../src/shared/ipc/documentGateway';

import type {
  BusinessDocument,
  BusinessDocumentDetail,
  BusinessDocumentReportResult,
} from '../src/shared/ipc/documentDto';

vi.mock('../src/shared/ipc/documentGateway', () => ({
  listBusinessDocuments: vi.fn(),
  getBusinessDocumentDetail: vi.fn(),
  getBusinessDocumentReports: vi.fn(),
}));

describe('Business Documents Detail & Reports Workflow', () => {
  const mockUser = {
    username: 'admin',
    token: 'test-token',
  };

  const mockDocs: BusinessDocument[] = [
    {
      document_id: 101,
      document_number: 'PO-2026-000001',
      document_type: 'PURCHASE_ORDER',
      document_date: '2026-08-12',
      status: 'POSTED',
      posted_at: '2026-08-12T10:00:00Z',
      generation_status: 'NOT_APPLICABLE',
      print_status: 'NOT_APPLICABLE',
      linked_journal_id: null,
      linked_journal_number: null,
      detail_summary: 'Supplier A',
    },
    {
      document_id: 102,
      document_number: 'PR-2026-000001',
      document_type: 'PURCHASE_RECEIPT',
      document_date: '2026-08-12',
      status: 'POSTED',
      posted_at: '2026-08-12T10:15:00Z',
      generation_status: 'NOT_APPLICABLE',
      print_status: 'NOT_APPLICABLE',
      linked_journal_id: 201,
      linked_journal_number: 'JE-2026-000001',
      detail_summary: 'Receipt for PO-2026-000001',
    },
  ];

  const mockDetail: BusinessDocumentDetail = {
    header: {
      document_id: 101,
      document_type: 'PURCHASE_ORDER',
      document_number: 'PO-2026-000001',
      status: 'POSTED',
      document_date: '2026-08-12',
      fiscal_year: 2026,
      fiscal_period_id: 1,
      posted_at: '2026-08-12T10:00:00Z',
      created_at: '2026-08-12T10:00:00Z',
      updated_at: '2026-08-12T10:00:00Z',
    },
    subtype_detail: {
      supplier_name: 'Test Supplier SARL',
      supplier_code: 'SUP-001',
      warehouse_name: 'Main Central Warehouse',
      total_amount: '15000.00',
      lines: [
        {
          line_number: 1,
          sku: 'SKU-001',
          product_name: 'Widget A',
          ordered_quantity: '10.000',
          unit_cost: '1500.00',
          line_total: '15000.00',
        },
      ],
    },
    relationships: [],
    journal: null,
    print_jobs: {
      gen_status: 'NOT_APPLICABLE',
      prt_status: 'NOT_APPLICABLE',
    },
  };

  const mockReportsResult: BusinessDocumentReportResult = {
    summary: {
      total_count: 2,
      posted_count: 2,
      draft_count: 0,
      reversed_count: 0,
      linked_journal_count: 1,
      unlinked_journal_count: 1,
      type_counts: [
        { type: 'PURCHASE_ORDER', count: 1 },
        { type: 'PURCHASE_RECEIPT', count: 1 },
      ],
      type_amounts: [
        { type: 'PURCHASE_ORDER', total_amount: '15000.00', semantic_label: 'Ordered Value' },
        { type: 'PURCHASE_RECEIPT', total_amount: '15000.00', semantic_label: 'Received Goods Value' },
      ],
    },
    rows: [
      {
        document_id: 101,
        document_number: 'PO-2026-000001',
        document_type: 'PURCHASE_ORDER',
        document_date: '2026-08-12',
        status: 'POSTED',
        posted_at: '2026-08-12T10:00:00Z',
        party_name: 'Test Supplier SARL',
        amount: '15000.00',
        linked_journal_id: null,
        linked_journal_number: null,
        has_journal: false,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(documentGateway.listBusinessDocuments).mockResolvedValue(mockDocs);
    vi.mocked(documentGateway.getBusinessDocumentDetail).mockResolvedValue(mockDetail);
    vi.mocked(documentGateway.getBusinessDocumentReports).mockResolvedValue(mockReportsResult);
  });

  const renderComponent = () =>
    render(
      <I18nProvider>
        <SessionContext.Provider
          value={{
            user: mockUser,
            activeCashSession: null,
            workstationId: 'WS-MAIN',
            login: vi.fn(),
            logout: vi.fn(),
            clearSession: vi.fn(),
            refreshActiveCashSession: vi.fn(),
            setActiveCashSession: vi.fn(),
          }}
        >
          <DocumentsScreen />
        </SessionContext.Provider>
      </I18nProvider>
    );

  it('renders View Switcher and toggles between Documents and Reports tabs cleanly', async () => {
    renderComponent();

    const docTab = screen.getByTestId('tab-documents-registry');
    const reportsTab = screen.getByTestId('tab-documents-reports');

    expect(docTab).toHaveAttribute('aria-selected', 'true');
    expect(reportsTab).toHaveAttribute('aria-selected', 'false');

    await waitFor(() => {
      expect(screen.getByText('PO-2026-000001')).toBeInTheDocument();
    });

    // Switch to Reports
    fireEvent.click(reportsTab);

    expect(reportsTab).toHaveAttribute('aria-selected', 'true');
    expect(docTab).toHaveAttribute('aria-selected', 'false');

    await waitFor(() => {
      expect(documentGateway.getBusinessDocumentReports).toHaveBeenCalled();
      expect(screen.getByTestId('report-filter-type')).toBeInTheDocument();
      expect(screen.getByText('Total Documents')).toBeInTheDocument();
      expect(screen.getByText('Document Type Breakdown')).toBeInTheDocument();
    });

    // Switch back to Documents
    fireEvent.click(docTab);
    expect(docTab).toHaveAttribute('aria-selected', 'true');
  });

  it('opens detail modal on clicking View Details without regression', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('PO-2026-000001')).toBeInTheDocument();
    });

    const inspectBtn = screen.getByTestId('view-doc-101');
    fireEvent.click(inspectBtn);

    await waitFor(() => {
      expect(screen.getByTestId('business-document-detail-dialog')).toBeInTheDocument();
      expect(screen.getAllByText('Purchase Order').length).toBeGreaterThan(0);
      expect(screen.getByText('Test Supplier SARL')).toBeInTheDocument();
      expect(screen.getByText(/SUP-001/)).toBeInTheDocument();
    });

    const closeBtn = screen.getAllByRole('button', { name: 'Close' })[0];
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('business-document-detail-dialog')).not.toBeInTheDocument();
    });
  });

  it('enforces mutually exclusive state machine: displays error state ONLY on failure without empty card', async () => {
    vi.mocked(documentGateway.getBusinessDocumentReports).mockRejectedValue(
      new Error('Database timeout')
    );

    renderComponent();

    // Switch to Reports tab
    fireEvent.click(screen.getByTestId('tab-documents-reports'));

    await waitFor(() => {
      expect(screen.getByText('Unable to load business documents report.')).toBeInTheDocument();
      expect(screen.queryByTestId('report-empty-state')).not.toBeInTheDocument();
      expect(screen.queryByText('No business documents match these filters.')).not.toBeInTheDocument();
    });
  });

  it('enforces mutually exclusive state machine: displays empty state ONLY when query returns zero rows without error banner', async () => {
    vi.mocked(documentGateway.getBusinessDocumentReports).mockResolvedValue({
      summary: {
        total_count: 0,
        posted_count: 0,
        draft_count: 0,
        reversed_count: 0,
        linked_journal_count: 0,
        unlinked_journal_count: 0,
        type_counts: [],
        type_amounts: [],
      },
      rows: [],
    });

    renderComponent();

    // Switch to Reports tab
    fireEvent.click(screen.getByTestId('tab-documents-reports'));

    await waitFor(() => {
      expect(screen.getByTestId('report-empty-state')).toBeInTheDocument();
      expect(screen.getByText('No business documents match these filters.')).toBeInTheDocument();
      expect(screen.queryByText('Unable to load business documents report.')).not.toBeInTheDocument();
    });
  });

  it('updates report filters and passes parameters to backend query', async () => {
    renderComponent();

    fireEvent.click(screen.getByTestId('tab-documents-reports'));

    await waitFor(() => {
      expect(screen.getByTestId('report-filter-type')).toBeInTheDocument();
    });

    const typeSelect = screen.getByTestId('report-filter-type');
    fireEvent.change(typeSelect, { target: { value: 'PURCHASE_ORDER' } });

    await waitFor(() => {
      expect(documentGateway.getBusinessDocumentReports).toHaveBeenCalledWith('test-token', {
        document_type: 'PURCHASE_ORDER',
      });
    });

    const resetBtn = screen.getByTestId('report-filter-reset');
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(documentGateway.getBusinessDocumentReports).toHaveBeenCalledWith('test-token', {});
    });
  });
});
