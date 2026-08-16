import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { I18nProvider } from '../src/shared/i18n';
import PurchasesScreen from '../src/features/procurement/PurchasesScreen';
import * as ipc from '../src/shared/ipc/gateway';

vi.mock('../src/shared/ipc/gateway');
vi.mock('../src/features/procurement/PurchaseTransactionScreen', () => ({
  PurchaseTransactionScreen: () => <div data-testid="direct-purchase-form-stub">Direct purchase form</div>,
}));

describe('Direct Purchase history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipc.listPurchaseReceipts).mockResolvedValue([
      {
        document_id: 200,
        document_number: 'PR-2026-000123',
        receipt_origin: 'DIRECT_PURCHASE',
        purchase_order_id: null,
        purchase_order_number: null,
        supplier_id: 1,
        supplier_name: 'Direct Supplier',
        warehouse_id: 1,
        warehouse_name: 'Main Warehouse',
        total_amount: '1000.00',
        journal_document_id: 300,
        journal_document_number: 'JE-2026-000123',
        landed_cost_amount: null,
        landed_cost_journal_id: null,
        landed_cost_journal_number: null,
        posted_at: '2026-08-16T12:00:00Z',
      },
      {
        document_id: 201,
        document_number: 'PR-2026-000124',
        receipt_origin: 'PURCHASE_ORDER',
        purchase_order_id: 100,
        purchase_order_number: 'PO-2026-000001',
        supplier_id: 1,
        supplier_name: 'Legacy Supplier',
        warehouse_id: 1,
        warehouse_name: 'Main Warehouse',
        total_amount: '500.00',
        journal_document_id: 301,
        journal_document_number: 'JE-2026-000124',
        landed_cost_amount: null,
        landed_cost_journal_id: null,
        landed_cost_journal_number: null,
        posted_at: '2026-08-15T12:00:00Z',
      },
    ]);
  });

  it('shows posted Direct Purchase receipts and excludes advanced PO receipts from the MVP list', async () => {
    render(
      <I18nProvider initialLocale="en">
        <PurchasesScreen sessionToken="tok" />
      </I18nProvider>,
    );

    await waitFor(() => expect(ipc.listPurchaseReceipts).toHaveBeenCalledWith('tok'));
    expect(await screen.findByTestId('direct-purchase-history')).toHaveTextContent('PR-2026-000123');
    expect(screen.getByTestId('direct-purchase-history')).toHaveTextContent('Direct Supplier');
    expect(screen.getByTestId('direct-purchase-history')).toHaveTextContent('JE-2026-000123');
    expect(screen.queryByText('PR-2026-000124')).not.toBeInTheDocument();
  });
});
