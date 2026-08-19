import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { I18nProvider } from '../src/shared/i18n';
import { SupplierInvoicesScreen } from '../src/features/procurement/SupplierInvoicesScreen';
import * as ipc from '../src/shared/ipc/gateway';
import type {
  CreateSupplierInvoiceResult,
  ProcurementCapabilities,
  PurchaseReceiptLineDto,
} from '../src/shared/ipc/dto';

vi.mock('../src/shared/ipc/gateway');

const capabilities: ProcurementCapabilities = {
  can_manage_procurement: true,
  can_post_purchase_receipt: true,
  can_post_supplier_invoice: true,
  can_post_supplier_return: true,
  can_post_supplier_payment: true,
};

const directLine: PurchaseReceiptLineDto = {
  receipt_line_id: 501,
  receipt_document_id: 200,
  receipt_document_number: 'PR-2026-000123',
  receipt_origin: 'DIRECT_PURCHASE',
  purchase_order_id: null,
  purchase_order_number: null,
  po_line_id: null,
  supplier_id: 1,
  supplier_name: 'Direct Supplier',
  warehouse_id: 1,
  warehouse_name: 'Main Warehouse',
  variant_id: 7,
  variant_sku: 'SKU-7',
  variant_name: 'Direct Item',
  unit_id: 1,
  unit_code: 'UNIT',
  quantity_received: '10.000',
  quantity_invoiced: '0.000',
  quantity_available_to_invoice: '10.000',
  quantity_returned_for_variant: '0.000',
  quantity_returnable_for_variant: '10.000',
  unit_cost: '100.00',
  line_total: '1000.00',
};

describe('Direct Purchase supplier invoice source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipc.listSupplierInvoices).mockResolvedValue([]);
    vi.mocked(ipc.listPurchaseOrders).mockResolvedValue([]);
    vi.mocked(ipc.listPurchaseReceiptLines).mockResolvedValue([directLine]);
  });

  it('creates a supplier invoice draft from a direct receipt with null PO references', async () => {
    const directDraftResult = {
      document_id: 301,
      supplier_id: 1,
      purchase_order_id: null,
      status: 'DRAFT',
      subtotal: '1000.00',
      total_amount: '1000.00',
    } as unknown as CreateSupplierInvoiceResult;
    vi.mocked(ipc.createSupplierInvoiceDraft).mockResolvedValue(directDraftResult);

    render(
      <I18nProvider initialLocale="en">
        <SupplierInvoicesScreen
          sessionToken="tok"
          openFiscalPeriodId={9}
          capabilities={capabilities}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(ipc.listPurchaseReceiptLines).toHaveBeenCalledWith('tok'));
    fireEvent.click(screen.getByTestId('create-supplier-invoice'));

    expect(await screen.findByTestId('supplier-invoice-modal')).toBeInTheDocument();
    expect(screen.getByTestId('invoice-source-select')).toHaveValue('PR:200');
    expect(screen.getByText(/Direct purchase receipt · PR-2026-000123 · Direct Supplier/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('save-invoice-draft'));

    await waitFor(() => {
      expect(ipc.createSupplierInvoiceDraft).toHaveBeenCalledWith('tok', {
        supplier_id: 1,
        purchase_order_id: null,
        currency_code: 'DZD',
        exchange_rate_to_dzd: '1.000000',
        note: null,
        lines: [{
          line_number: 1,
          po_line_id: null,
          receipt_line_id: 501,
          variant_id: 7,
          quantity: '10.000',
          unit_cost: '100.00',
        }],
      });
    });
  });
});
