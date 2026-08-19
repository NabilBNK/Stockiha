import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { I18nProvider } from '../src/shared/i18n';
import { DirectPurchaseScreen } from '../src/features/procurement/DirectPurchaseScreen';
import * as ipc from '../src/shared/ipc/gateway';
import * as directPurchaseGateway from '../src/shared/ipc/directPurchaseGateway';

vi.mock('../src/shared/ipc/gateway');
vi.mock('../src/shared/ipc/directPurchaseGateway');

describe('Direct Purchase entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(ipc.listSuppliers).mockResolvedValue([
      {
        id: 7,
        code: 'SUP-TEST',
        name: 'Test Textile Supplier',
        contact_name: null,
        phone: null,
        email: null,
        address: null,
        tax_id: null,
        is_active: true,
        created_at: '2026-08-16T00:00:00Z',
      },
    ]);
    vi.mocked(ipc.listWarehouses).mockResolvedValue([
      { id: 3, code: 'MAIN', name: 'Main Warehouse', is_active: true },
    ]);
    vi.mocked(ipc.getOpenFiscalPeriod).mockResolvedValue({
      id: 5,
      period_code: 'FY-2026',
      starts_on: '2026-01-01',
      ends_on: '2026-12-31',
    });
    vi.mocked(ipc.listPurchaseProductOptions).mockResolvedValue([
      {
        product_id: 10,
        variant_id: 11,
        sku: 'BED-TEST',
        product_name: 'Bed',
        variant_name: '200 × 200',
        primary_barcode: null,
        brand: null,
        default_unit_id: 2,
        default_unit_code: 'UNIT',
        default_unit_name: 'Unit',
        alternate_units: [],
        attributes: [],
        is_active: true,
        last_purchase_cost: '100.00',
      },
    ]);
    vi.mocked(directPurchaseGateway.confirmDirectPurchase).mockResolvedValue({
      document_id: 100,
      document_number: 'PR-2026-000001',
      receipt_origin: 'DIRECT_PURCHASE',
      purchase_order_id: null,
      purchase_order_number: null,
      supplier_id: 7,
      warehouse_id: 3,
      total_amount: '1000.00',
      journal_document_id: 200,
      journal_document_number: 'JE-2026-000001',
      order_status: null,
      posted_at: '2026-08-16T12:00:00Z',
    });
  });

  it('posts received goods once without payment, invoice, PO or Receive Goods steps', async () => {
    const onPosted = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <DirectPurchaseScreen sessionToken="tok" onPosted={onPosted} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'New Purchase' })).toBeInTheDocument();
    expect(screen.queryByText(/payment status/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/supplier invoice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/receive goods/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/purchase order/i)).not.toBeInTheDocument();

    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes).toHaveLength(3);
    fireEvent.change(comboboxes[0], { target: { value: '7' } });
    fireEvent.change(comboboxes[2], { target: { value: '11' } });

    const numericInputs = screen.getAllByRole('spinbutton');
    expect(numericInputs).toHaveLength(2);
    fireEvent.change(numericInputs[0], { target: { value: '10' } });

    const confirmButton = screen.getByRole('button', { name: 'Confirm Purchase' });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    expect(await screen.findByRole('dialog', { name: 'Confirm Direct Purchase' })).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole('button', { name: 'Confirm Purchase' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(directPurchaseGateway.confirmDirectPurchase).toHaveBeenCalledTimes(1));
    const [, payload] = vi.mocked(directPurchaseGateway.confirmDirectPurchase).mock.calls[0];
    expect(payload).toMatchObject({
      supplier_id: 7,
      warehouse_id: 3,
      fiscal_period_id: 5,
      lines: [
        {
          variant_id: 11,
          unit_id: 2,
          quantity_received: '10',
          unit_cost: '100.00',
        },
      ],
    });
    expect(payload).not.toHaveProperty('payment_status');
    expect(payload).not.toHaveProperty('paid_amount');
    expect(payload).not.toHaveProperty('additional_costs');

    expect(await screen.findByText(/PR-2026-000001/)).toBeInTheDocument();
    expect(screen.getByText(/JE-2026-000001/)).toBeInTheDocument();
    expect(onPosted).toHaveBeenCalledTimes(1);
  });
});