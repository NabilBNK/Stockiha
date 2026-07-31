import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function captured(value: Record<string, unknown> | null): Record<string, unknown> {
  if (value === null) throw new Error('expected captured IPC arguments');
  return value;
}

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR' });
    try { return Promise.resolve(handler(args)); } catch (error) { return Promise.reject(error); }
  });
}

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: () => ({ initialized: true, administrator_exists: true, warehouse_exists: true, open_fiscal_period_exists: true, workstation_configured: true }),
    login: () => ({ session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' }),
    logout: () => null,
    inspect_active_cash_session: () => null,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main Warehouse', is_active: true }],
    get_open_fiscal_period: () => ({ id: 9, period_code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    get_dashboard_summary: () => ({ product_count: 0, variant_count: 0, active_cash_session_id: null, latest_document_id: null, latest_document_number: null, pending_generation_jobs: 1, pending_print_jobs: 1 }),
    list_products: () => [],
    list_catalog_products: () => [],
    list_units: () => [],
    ...extra,
  };
}

async function login() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  window.localStorage.setItem('stockiha.locale', 'en');
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('S4-001 customer documents', () => {
  it('lists customer documents, generates immutable PDF, and queues print-only reprint', async () => {
    let generated = false;
    let reprintArgs: Record<string, unknown> | null = null;
    let generationCalls = 0;

    wireInvoke(baseHandlers({
      list_printable_documents: () => [
        {
          document_id: 700,
          document_type: 'CREDIT_SALE',
          document_number: 'CR-2026-000001',
          document_date: '2026-07-31',
          posted_at: '2026-07-31T10:00:00Z',
          generation_status: generated ? 'COMPLETED' : 'PENDING',
          generated_file_ref: generated ? 'generated/customer-documents/customer-700.pdf' : null,
          print_status: generated ? 'PENDING' : 'WAITING_FOR_GENERATION',
        },
        {
          document_id: 701,
          document_type: 'CUSTOMER_PAYMENT',
          document_number: 'CP-2026-000001',
          document_date: '2026-07-31',
          posted_at: '2026-07-31T11:00:00Z',
          generation_status: 'PENDING',
          generated_file_ref: null,
          print_status: 'WAITING_FOR_GENERATION',
        },
      ],
      get_customer_document_payload: (args) => args.documentId === 700 ? ({
        document_kind: 'CREDIT_SALE', document_id: 700, document_number: 'CR-2026-000001', status: 'POSTED', document_date: '2026-07-31', posted_at: '2026-07-31T10:00:00Z',
        customer: { id: 41, code: 'CUS-000041', name: 'Atlas Distribution', tax_id: 'NIF-41', address: 'Blida' }, warehouse_id: 1,
        subtotal: '1500.00', total_amount: '1500.00', due_date: '2026-08-30', journal_document_id: 900,
        lines: [{ line_number: 1, variant_id: 7, sku: 'SKU-7', name: 'Credit Item', quantity: '1.000', unit_price: '1500.00', line_total: '1500.00' }],
      }) : ({
        document_kind: 'CUSTOMER_PAYMENT', document_id: 701, document_number: 'CP-2026-000001', status: 'POSTED', document_date: '2026-07-31', posted_at: '2026-07-31T11:00:00Z',
        customer: { id: 41, code: 'CUS-000041', name: 'Atlas Distribution', tax_id: 'NIF-41', address: 'Blida' }, payment_method: 'CASH', amount: '500.00', cash_session_id: 77, journal_document_id: 901, note: null,
        allocations: [{ invoice_ledger_entry_id: 2, invoice_document_id: 700, invoice_document_number: 'CR-2026-000001', invoice_document_date: '2026-07-31', allocated_amount: '500.00' }],
      }),
      list_document_jobs: (args) => args.documentId === 700 ? [
        { job_kind: 'GENERATION', id: 10, status: generated ? 'COMPLETED' : 'PENDING', attempt_count: generated ? 1 : 0 },
        { job_kind: 'PRINT', id: 11, status: generated ? 'PENDING' : 'WAITING_FOR_GENERATION', attempt_count: 0 },
      ] : [
        { job_kind: 'GENERATION', id: 20, status: 'PENDING', attempt_count: 0 },
        { job_kind: 'PRINT', id: 21, status: 'WAITING_FOR_GENERATION', attempt_count: 0 },
      ],
      generate_customer_document_pdf: () => {
        generationCalls += 1;
        generated = true;
        return { document_id: 700, document_number: 'CR-2026-000001', generated_file_ref: 'generated/customer-documents/customer-700.pdf' };
      },
      enqueue_customer_reprint: (args) => { reprintArgs = args; return 12; },
    }));

    render(<App />);
    await login();
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }));

    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(await screen.findByText('CR-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('Customer payment receipt')).toBeInTheDocument();
    expect(await screen.findByTestId('credit-invoice-lines')).toHaveTextContent('Credit Item');

    fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(generationCalls).toBe(1));
    expect(await screen.findByText('PDF generated and the original print job is ready.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Queue reprint' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Queue reprint' }));
    await waitFor(() => expect(reprintArgs).not.toBeNull());
    const reprint = captured(reprintArgs);
    expect(reprint.documentId).toBe(700);
    expect(String(reprint.idempotencyKey)).toContain('customer_reprint:700:');
    expect(await screen.findByText('Reprint queued.')).toBeInTheDocument();
  });
});
