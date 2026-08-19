/**
 * Vitest Frontend Automated Test Suite for PurchaseTransactionScreen
 * Verifies all UI interactions, validation rules, multi-language/RTL, and payment scenarios.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PurchaseTransactionScreen } from '../src/features/procurement/PurchaseTransactionScreen';
import * as ipc from '../src/shared/ipc/gateway';
import { I18nProvider } from '../src/shared/i18n';
import type { PurchaseProductOption, Supplier } from '../src/shared/ipc/dto';

vi.mock('../src/shared/ipc/gateway');

const mockSuppliers: Supplier[] = [
  {
    id: 1,
    code: 'SUP-001',
    name: 'SARL Import Export',
    contact_name: null,
    tax_id: '123456789',
    address: 'Algiers, Algeria',
    phone: '021000000',
    email: 'contact@sarlimport.dz',
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
  },
];

const mockProducts: PurchaseProductOption[] = [
  {
    product_id: 101,
    variant_id: 201,
    sku: 'SKU-TEX-WHITE',
    product_name: 'Tissu Coton Luxe',
    variant_name: 'Tissu Coton Luxe · White',
    primary_barcode: '613000111222',
    brand: { id: 10, name: 'MaisonTex' },
    default_unit_id: 1,
    default_unit_code: 'PCS',
    default_unit_name: 'Pieces',
    attributes: [{ name: 'Color', value: 'White' }],
    alternate_units: [{ unit_id: 2, unit_code: 'BOX10', conversion_factor: '10' }],
    is_active: true,
  },
  {
    product_id: 102,
    variant_id: 301,
    sku: 'SKU-BED-90',
    product_name: 'Bed',
    variant_name: 'Bed · 90x190',
    primary_barcode: '613000333444',
    brand: null,
    default_unit_id: 1,
    default_unit_code: 'PCS',
    default_unit_name: 'Pieces',
    attributes: [{ name: 'Size', value: '90x190' }],
    alternate_units: [],
    is_active: true,
  },
];

describe('PurchaseTransactionScreen UI Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipc.listSuppliers).mockResolvedValue(mockSuppliers);
    vi.mocked(ipc.listPurchaseProductOptions).mockResolvedValue(mockProducts);
    vi.mocked(ipc.newRequestId).mockReturnValue('test-request-id-123');
  });

  const renderComponent = (locale: 'en' | 'fr' | 'ar' = 'en') =>
    render(
      <I18nProvider key={locale} initialLocale={locale}>
        <PurchaseTransactionScreen sessionToken="mock-token" />
      </I18nProvider>
    );

  it('renders title, supplier picker, optional supplier doc reference, and hides warehouse', async () => {
    renderComponent('en');

    await waitFor(() => {
      expect(screen.getByText(/New Purchase/i)).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/Supplier \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Supplier document reference/i)).toBeInTheDocument();
    expect(screen.getByText(/(Optional)/i)).toBeInTheDocument();

    // Warehouse should NOT be visible to normal workers
    expect(screen.queryByLabelText(/Warehouse/i)).not.toBeInTheDocument();
  });

  it('validates supplier selection but accepts empty supplier doc reference', async () => {
    vi.mocked(ipc.postPurchaseTransaction).mockResolvedValue({
      document_id: 501,
      document_number: 'PUR-2026-000001',
      status: 'POSTED',
      supplier_id: 1,
      warehouse_id: 1,
      gross_subtotal: '1500.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '1500.00',
      payment_status: 'PAID',
      payment_method: 'CASH',
      paid_amount: '1500.00',
      outstanding_amount: '0.00',
      due_date: '2026-09-11',
      generation_status: 'COMPLETED',
      print_status: 'COMPLETED',
      child_documents: {
        purchase_order_id: null,
        goods_receipt_id: 602,
        supplier_invoice_id: 603,
        supplier_payment_id: 604,
      },
    });

    renderComponent('en');

    await waitFor(() => {
      expect(screen.getByText(/New Purchase/i)).toBeInTheDocument();
    });

    // Click confirm without selecting supplier
    fireEvent.click(screen.getByText('Confirm Purchase'));
    expect(screen.getByText('Please select a supplier.')).toBeInTheDocument();

    // Select supplier
    fireEvent.change(screen.getByLabelText(/Supplier \*/i), { target: { value: '1' } });

    // Add Product line via product picker modal
    fireEvent.click(screen.getAllByText('+ Add Product')[0]);
    fireEvent.click(screen.getAllByText('+ Select')[0]);
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '1500' } });

    // Click confirm without supplier document ID (should succeed!)
    fireEvent.click(screen.getByText('Confirm Purchase'));
    expect(screen.getByText('Confirm Purchase Transaction')).toBeInTheDocument();

    // Confirm inside modal
    const confirmButtons = screen.getAllByText('Confirm Purchase');
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText('✓ Purchase Completed Successfully')).toBeInTheDocument();
    });

    expect(ipc.postPurchaseTransaction).toHaveBeenCalledWith(
      'mock-token',
      expect.objectContaining({
        supplier_id: 1,
        external_supplier_document_number: null,
      })
    );
  });

  it('adds product line, displays brand/attributes, and calculates line/grand totals without discount field', async () => {
    renderComponent('en');

    await waitFor(() => {
      expect(screen.getByText(/New Purchase/i)).toBeInTheDocument();
    });

    // Fill header
    fireEvent.change(screen.getByLabelText(/Supplier \*/i), { target: { value: '1' } });

    // Add Product line via product picker modal
    fireEvent.click(screen.getAllByText('+ Add Product')[0]);

    // Check product option displaying Brand, Attributes, and SKU in picker modal
    expect(screen.getByText(/Tissu Coton Luxe/i)).toBeInTheDocument();
    expect(screen.getByText(/MaisonTex/i)).toBeInTheDocument();
    expect(screen.getByText(/SKU-TEX-WHITE/i)).toBeInTheDocument();
    expect(screen.getByText(/Color:\s*White/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('+ Select')[0]);

    // Check discount column does NOT exist in table header or summary
    expect(screen.queryByText(/^Discount$/i)).not.toBeInTheDocument();

    // Check selected product line item details
    expect(screen.getAllByText(/Tissu Coton Luxe/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MaisonTex/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SKU-TEX-WHITE/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/White/i).length).toBeGreaterThan(0);

    // Enter unit cost
    const costInput = screen.getByPlaceholderText('0.00');
    fireEvent.change(costInput, { target: { value: '1500' } });

    // Verify summary grand total
    expect(screen.getAllByText('1500.00 DZD').length).toBeGreaterThan(0);
  });

  it('supports additional costs, payment status toggle, and remaining calculation', async () => {
    renderComponent('en');

    await waitFor(() => {
      expect(screen.getByText(/New Purchase/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Supplier \*/i), { target: { value: '1' } });

    // Add Product line via product picker modal
    fireEvent.click(screen.getAllByText('+ Add Product')[0]);
    fireEvent.click(screen.getAllByText('+ Select')[0]);
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '1000' } });

    // Toggle Partially Paid
    fireEvent.click(screen.getByText('Partially Paid'));

    // Enter paid amount 400
    const paidInput = screen.getByLabelText(/Paid now/i);
    fireEvent.change(paidInput, { target: { value: '400' } });

    // Remaining should be 600.00 DZD
    expect(screen.getAllByText('600.00 DZD').length).toBeGreaterThan(0);
  });

  it('submits purchase transaction through confirmation modal and shows success page', async () => {
    vi.mocked(ipc.postPurchaseTransaction).mockResolvedValue({
      document_id: 501,
      document_number: 'PUR-2026-000001',
      status: 'POSTED',
      supplier_id: 1,
      warehouse_id: 1,
      gross_subtotal: '1000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '1000.00',
      payment_status: 'PAID',
      payment_method: 'CASH',
      paid_amount: '1000.00',
      outstanding_amount: '0.00',
      due_date: '2026-09-11',
      generation_status: 'QUEUED',
      print_status: 'QUEUED',
      child_documents: {
        purchase_order_id: null,
        goods_receipt_id: 602,
        supplier_invoice_id: 603,
        supplier_payment_id: 604,
      },
    });

    renderComponent('en');

    await waitFor(() => {
      expect(screen.getByText(/New Purchase/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Supplier \*/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Supplier document reference/i), { target: { value: 'FA-2026-77' } });
    fireEvent.click(screen.getAllByText('+ Add Product')[0]);
    fireEvent.click(screen.getAllByText('+ Select')[0]);
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '1000' } });

    // Click Confirm Purchase to open modal
    fireEvent.click(screen.getByText('Confirm Purchase'));

    // Modal dialog should appear
    expect(screen.getByText('Confirm Purchase Transaction')).toBeInTheDocument();

    // Confirm inside modal
    const confirmButtons = screen.getAllByText('Confirm Purchase');
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText('✓ Purchase Completed Successfully')).toBeInTheDocument();
      expect(screen.getByText('PUR-2026-000001')).toBeInTheDocument();
    });

    expect(ipc.postPurchaseTransaction).toHaveBeenCalledWith(
      'mock-token',
      expect.objectContaining({ request_id: 'test-request-id-123' })
    );
  });

  it('renders in French and Arabic (RTL)', async () => {
    const { unmount } = render(
      <I18nProvider initialLocale="fr">
        <PurchaseTransactionScreen sessionToken="mock-token" />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Nouveau Reçu d’Achat')).toBeInTheDocument();
    });

    unmount();

    render(
      <I18nProvider initialLocale="ar">
        <PurchaseTransactionScreen sessionToken="mock-token" />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('وصل شراء جديد')).toBeInTheDocument();
    });
  });

  it('handles user reproduction case with partially paid cash 20000/30000 and supplier ref 343754896', async () => {
    vi.mocked(ipc.postPurchaseTransaction).mockResolvedValue({
      document_id: 502,
      document_number: 'PUR-2026-000002',
      status: 'POSTED',
      supplier_id: 1,
      warehouse_id: 1,
      gross_subtotal: '30000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '30000.00',
      payment_status: 'PARTIALLY_PAID',
      payment_method: 'CASH',
      paid_amount: '20000.00',
      outstanding_amount: '10000.00',
      due_date: '2026-09-13',
      generation_status: 'QUEUED',
      print_status: 'QUEUED',
      child_documents: {
        purchase_order_id: null,
        goods_receipt_id: 602,
        supplier_invoice_id: 603,
        supplier_payment_id: 604,
      },
    });

    renderComponent('en');

    await waitFor(() => {
      expect(screen.getByText(/New Purchase/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Supplier \*/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Supplier document reference/i), { target: { value: '343754896' } });
    fireEvent.click(screen.getAllByText('+ Add Product')[0]);
    fireEvent.click(screen.getAllByText('+ Select')[0]);
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '30000' } });

    fireEvent.click(screen.getByText('Partially Paid'));
    fireEvent.change(screen.getByLabelText(/Paid now \*/i), { target: { value: '20000' } });

    fireEvent.click(screen.getByText('Confirm Purchase'));
    expect(screen.getByText('Confirm Purchase Transaction')).toBeInTheDocument();

    const confirmButtons = screen.getAllByText('Confirm Purchase');
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(ipc.postPurchaseTransaction).toHaveBeenCalledWith(
        'mock-token',
        expect.objectContaining({
          supplier_id: 1,
          external_supplier_document_number: '343754896',
          payment_status: 'PARTIALLY_PAID',
          payment_method: 'CASH',
          paid_amount: '20000',
        })
      );
      expect(screen.getByText('✓ Purchase Completed Successfully')).toBeInTheDocument();
    });
  });
});
