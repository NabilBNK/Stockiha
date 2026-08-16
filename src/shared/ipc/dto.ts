/**
 * Slice 1 — TypeScript DTOs mirroring the backend's serialized IPC payloads.
 */

export interface SetupStatus {
  initialized: boolean;
  administrator_exists: boolean;
  warehouse_exists: boolean;
  open_fiscal_period_exists: boolean;
  workstation_configured: boolean;
}

export interface LoginResult {
  session_token: string;
  expires_at: string;
}

export interface CreatedProduct {
  product_id: number;
  variant_id: number;
}

export interface ProductListItem {
  product_id: number;
  variant_id: number;
  sku: string;
  name: string;
  sale_price: string;
  is_active: boolean;
  quantity_on_hand: string;
  last_known_wac: string;
}

export interface InventoryCapabilities {
  can_manage_catalog: boolean;
  can_post_stock_receipt: boolean;
  can_view_inventory: boolean;
  can_manage_inventory: boolean;
}

export interface ProcurementCapabilities {
  can_manage_procurement: boolean;
  can_post_purchase_receipt: boolean;
  can_post_supplier_invoice: boolean;
  can_post_supplier_return: boolean;
  can_post_supplier_payment: boolean;
}

export interface InventorySnapshotItem {
  product_id: number;
  variant_id: number;
  product_name: string;
  sku: string;
  base_unit_code: string;
  product_is_active: boolean;
  variant_is_active: boolean;
  quantity_on_hand: string;
  last_known_wac: string;
  total_value: string;
}

export interface StockReceiptResult {
  document_id: number;
  document_number: string;
  warehouse_id: number;
  variant_id: number;
  received_quantity: string;
  received_value: string;
  resulting_quantity_on_hand: string;
  resulting_total_value: string;
  resulting_wac: string;
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
}

export interface FiscalPeriod {
  id: number;
  period_code: string;
  starts_on: string;
  ends_on: string;
  status: string;
}

export interface OpenFiscalPeriod {
  id: number;
  period_code: string;
  starts_on: string;
  ends_on: string;
}

export interface ActiveCashSession {
  id: number;
  warehouse_id: number;
  opened_by_user_id: number;
  opening_float: string;
  opened_at: string;
}

export interface CashSessionDetail {
  id: number;
  warehouse_id: number;
  status: string;
  opening_float: string;
  expected_amount: string | null;
  counted_amount: string | null;
  variance_amount: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface DashboardSummary {
  product_count: number;
  variant_count: number;
  active_cash_session_id: number | null;
  latest_document_id: number | null;
  latest_document_number: string | null;
  pending_generation_jobs: number;
  pending_print_jobs: number;
}

export interface SaleDocument {
  document_id: number;
  document_type: string;
  status: string;
  document_number: string | null;
  document_date: string;
  posted_at: string | null;
  subtotal: string;
  total_amount: string;
}

export interface SaleLine {
  line_number: number;
  variant_sku_snapshot: string;
  variant_name_snapshot: string;
  quantity: string;
  unit_price: string;
  line_total: string;
}

export type DocumentJobKind = 'GENERATION' | 'PRINT' | 'DRAWER';

export interface DocumentJob {
  job_kind: DocumentJobKind;
  id: number;
  status: string;
  attempt_count: number;
}

export interface CashSaleLineInput {
  variant_id: number;
  quantity: string;
  unit_price: string;
}

// Slice 2 — variant catalog DTOs (snake_case, decimals as strings)

export interface AttributeValue { id: number; value: string; }
export interface AttributeDefinition { attribute_id: number; name: string; attribute_values: AttributeValue[]; }
export interface Unit { id: number; code: string; name: string; }
export interface CatalogProduct { product_id: number; name: string; unit_id: number; unit_code: string; unit_name: string; is_active: boolean; variant_count: number; active_variant_count: number; }

export interface ResolvedBarcode { variant_id: number; product_id: number; sku: string; name_override: string | null; effective_variant_name: string; primary_barcode: string | null; operational_identifier: string; identifier_type: 'BARCODE' | 'SKU'; product_name: string; sale_price: string; unit_id: number; unit_code: string; unit_name: string; variant_is_active: boolean; product_is_active: boolean; }
export interface VariantAttribute { attribute_id: number; attribute_name: string; attribute_value_id: number; value: string; }
export interface VariantBarcode { id: number; barcode: string; is_primary: boolean; }
export interface VariantDetail { variant_id: number; sku: string; name_override: string | null; effective_variant_name: string; primary_barcode: string | null; operational_identifier: string; identifier_type: 'BARCODE' | 'SKU'; sale_price: string; is_active: boolean; attribute_signature: string; attributes: VariantAttribute[]; barcodes: VariantBarcode[]; }
export interface ProductDetail { product_id: number; name: string; unit_id: number; unit_code: string; unit_name: string; is_active: boolean; variants: VariantDetail[]; }
export interface CreatedProductWithVariants { product_id: number; variant_ids: number[]; }

export interface VariantAltUnit { id: number; variant_id: number; unit_id: number; conversion_factor: string; unit_code: string; unit_name: string; }

// Input payloads (sent as JSON; snake_case; string decimals):
export interface AltUnitInput { unit_id: number; conversion_factor: string; }
export interface VariantInput { name_override?: string; sale_price: string; is_active: boolean; attribute_value_ids?: number[]; barcodes?: string[]; }

// S2-002 — stock adjustment DTOs. Every decimal remains a string.
export type StockAdjustmentReasonCode =
  | 'DAMAGE'
  | 'SHRINKAGE'
  | 'EXPIRED'
  | 'FOUND_STOCK'
  | 'RECORDING_ERROR'
  | 'OTHER';

export interface StockAdjustmentUnit {
  unit_id: number;
  unit_code: string;
  unit_name: string;
  conversion_factor: string;
  is_base: boolean;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CreateSupplierPayload {
  code: string;
  name: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tax_id?: string | null;
}

export interface UpdateSupplierPayload {
  supplier_id: number;
  code: string;
  name: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tax_id?: string | null;
  is_active: boolean;
}

export interface PurchaseOrderSummary {
  document_id: number;
  document_number: string | null;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  status: string;
  subtotal: string;
  total_amount: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface PurchaseOrderLineDto {
  id: number;
  line_number: number;
  variant_id: number;
  variant_sku: string;
  variant_name: string;
  unit_id: number;
  unit_code: string;
  unit_name: string;
  quantity_ordered: string;
  quantity_received: string;
  remaining_quantity: string;
  unit_cost: string;
  line_total: string;
}

export interface PurchaseOrderDetailDto {
  document_id: number;
  document_number: string | null;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  status: string;
  subtotal: string;
  total_amount: string;
  note: string | null;
  created_at: string;
  confirmed_at: string | null;
  lines: PurchaseOrderLineDto[];
}

export interface CreatePoLinePayload {
  variant_id: number;
  unit_id: number;
  quantity_ordered: string;
  unit_cost: string;
}

export interface CreatePurchaseOrderPayload {
  supplier_id: number;
  warehouse_id: number;
  note?: string | null;
  lines: CreatePoLinePayload[];
}

export interface UpdatePurchaseOrderPayload {
  purchase_order_id: number;
  supplier_id: number;
  warehouse_id: number;
  note?: string | null;
  lines: CreatePoLinePayload[];
}

export interface ConfirmPurchaseReceiptLinePayload {
  po_line_id: number;
  quantity_received: string;
}

export interface ConfirmPurchaseReceiptPayload {
  request_id: string;
  purchase_order_id: number;
  fiscal_period_id: number;
  document_date: string;
  lines: ConfirmPurchaseReceiptLinePayload[];
}

export interface PurchaseReceiptSummary {
  document_id: number;
  document_number: string;
  purchase_order_id: number;
  purchase_order_number: string;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number;
  warehouse_name: string;
  total_amount: string;
  journal_document_id: number | null;
  journal_document_number: string | null;
  landed_cost_amount: string | null;
  landed_cost_journal_id: number | null;
  landed_cost_journal_number: string | null;
  posted_at: string;
}

export interface PurchaseReceiptLineDto {
  receipt_line_id: number;
  receipt_document_id: number;
  receipt_document_number: string;
  purchase_order_id: number;
  purchase_order_number: string;
  po_line_id: number;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number;
  warehouse_name: string;
  variant_id: number;
  variant_sku: string;
  variant_name: string;
  unit_id: number;
  unit_code: string;
  quantity_received: string;
  quantity_invoiced: string;
  quantity_available_to_invoice: string;
  quantity_returned_for_variant: string;
  quantity_returnable_for_variant: string;
  unit_cost: string;
  line_total: string;
}

export interface ConfirmPurchaseReceiptResult {
  document_id: number;
  document_number: string;
  purchase_order_id: number;
  purchase_order_number: string;
  supplier_id: number;
  warehouse_id: number;
  total_amount: string;
  journal_document_id: number | null;
  journal_document_number: string | null;
  order_status: string;
  posted_at: string;
}

export interface StockAdjustmentResult {
  document_id: number;
  document_number: string;
  movement_id: number;
  journal_document_id: number | null;
  journal_document_number: string | null;
  warehouse_id: number;
  variant_id: number;
  quantity_delta: string;
  inventory_value_delta: string;
  resulting_quantity_on_hand: string;
  resulting_total_value: string;
  reason_code: StockAdjustmentReasonCode;
}

export interface AllocateLandedCostPayload {
  request_id: string;
  receipt_id: number;
  landed_cost_amount: string;
  allocation_method: 'BY_QTY' | 'BY_VALUE' | 'EQUAL_PER_LINE';
  fiscal_period_id: number;
  document_date: string;
  note?: string | null;
}

export interface AllocateLandedCostResult {
  receipt_id: number;
  landed_cost_amount: string;
  inventory_debit?: string | null;
  variance_debit?: string | null;
  journal_document_id: number;
  status: 'POSTED';
}

export interface CreateSupplierInvoiceLinePayload {
  line_number: number;
  po_line_id?: number | null;
  receipt_line_id?: number | null;
  variant_id: number;
  quantity: string;
  unit_cost: string;
}

export interface CreateSupplierInvoicePayload {
  supplier_id: number;
  purchase_order_id?: number | null;
  currency_code?: string | null;
  exchange_rate_to_dzd?: string | null;
  note?: string | null;
  lines: CreateSupplierInvoiceLinePayload[];
}

export interface CreateSupplierInvoiceResult {
  document_id: number;
  supplier_id: number;
  purchase_order_id: number;
  status: 'DRAFT';
  subtotal: string;
  total_amount: string;
}

export interface ConfirmSupplierInvoicePayload {
  request_id: string;
  invoice_doc_id: number;
  fiscal_period_id: number;
  document_date: string;
}

export interface ConfirmSupplierInvoiceResult {
  document_id: number;
  document_number: string;
  supplier_id?: number | null;
  total_amount?: string | null;
  grni_amount?: string | null;
  variance_amount?: string | null;
  journal_document_id: number;
  status: 'POSTED';
}

export interface SupplierInvoiceSummary {
  document_id: number;
  document_number: string | null;
  supplier_id: number;
  supplier_name: string;
  purchase_order_id: number | null;
  purchase_order_number: string | null;
  status: string;
  currency_code: string;
  foreign_total_amount: string;
  base_total_amount: string;
  journal_document_id: number | null;
  journal_document_number: string | null;
  liability_id: number | null;
  outstanding_amount: string | null;
  created_at: string;
}

export interface SupplierLiabilityDto {
  id: number;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  document_id: number | null;
  document_number: string | null;
  source_type: 'SUPPLIER_INVOICE' | 'LANDED_COST';
  journal_document_id: number;
  journal_document_number: string | null;
  original_amount: string;
  remaining_amount: string;
  status: string;
  due_date: string | null;
  created_at: string;
}

export interface CreateSupplierReturnLinePayload {
  variant_id: number;
  quantity: string;
  unit_cost: string;
}

export interface CreateSupplierReturnPayload {
  supplier_id: number;
  warehouse_id: number;
  purchase_order_id?: number | null;
  reason_code?: string | null;
  note?: string | null;
  lines: CreateSupplierReturnLinePayload[];
}

export interface CreateSupplierReturnResult {
  document_id: number;
  supplier_id: number;
  purchase_order_id: number;
  status: 'DRAFT';
}

export interface ConfirmSupplierReturnPayload {
  request_id: string;
  return_document_id: number;
  fiscal_period_id: number;
  document_date: string;
}

export interface ConfirmSupplierReturnResult {
  document_id: number;
  document_number: string;
  status: 'POSTED';
  clearing_role?: 'GRNI' | 'ACCOUNTS_PAYABLE' | null;
  clearing_amount?: string | null;
  inventory_value?: string | null;
  variance_amount?: string | null;
  journal_document_id: number;
}

export interface PostSupplierPaymentPayload {
  request_id: string;
  supplier_id: number;
  liability_id?: number | null;
  amount: string;
  payment_method: string;
  fiscal_period_id: number;
  document_date: string;
  note?: string | null;
}

export interface PostSupplierPaymentResult {
  document_id: number;
  document_number: string;
  status: 'POSTED';
  journal_document_id: number;
  amount?: string | null;
  funding_role?: 'CASH' | 'BANK' | null;
}

export interface SupplierReturnSummary {
  document_id: number;
  document_number: string | null;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number;
  warehouse_name: string;
  purchase_order_id: number | null;
  purchase_order_number: string | null;
  status: string;
  reason_code: string;
  journal_document_id: number | null;
  journal_document_number: string | null;
  created_at: string;
}

export interface SupplierPaymentDto {
  document_id: number;
  document_number: string | null;
  supplier_id: number;
  supplier_name: string;
  liability_id: number;
  payment_method: string;
  amount: string;
  journal_document_id: number | null;
  journal_document_number: string | null;
  created_at: string;
}

export type PurchasePaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CREDIT';
export type PurchasePaymentStatus = 'PAID' | 'PARTIALLY_PAID' | 'UNPAID';

export interface BrandDto {
  id: number;
  name: string;
}

export interface VariantAttributeDto {
  name: string;
  value: string;
}

export interface AlternateUnitOptionDto {
  unit_id: number;
  unit_code: string;
  conversion_factor: string;
}

export interface PurchaseProductOption {
  product_id: number;
  variant_id: number;
  sku: string;
  product_name: string;
  variant_name?: string | null;
  primary_barcode?: string | null;
  brand?: BrandDto | null;
  default_unit_id: number;
  default_unit_code: string;
  default_unit_name?: string | null;
  alternate_units: AlternateUnitOptionDto[];
  attributes: VariantAttributeDto[];
  is_active: boolean;
  default_unit_cost?: string;
  last_purchase_cost?: string;
}

export interface PurchaseAdditionalCostInput {
  cost_type: string;
  amount: string;
}

export interface PurchaseTransactionLineInput {
  variant_id: number;
  unit_id: number;
  quantity: string;
  unit_cost: string;
  tax_amount?: string | null;
}

export interface PostPurchaseTransactionPayload {
  request_id: string;
  supplier_id: number;
  document_date: string;
  external_supplier_document_number?: string | null;
  payment_status: string;
  payment_method?: string | null;
  paid_amount?: string | null;
  print_after_confirmation: boolean;
  note?: string | null;
  notes?: string;
  lines: PurchaseTransactionLineInput[];
  additional_costs?: PurchaseAdditionalCostInput[] | null;
}

export interface PurchaseTransactionChildDocuments {
  purchase_order_id: number;
  goods_receipt_id: number;
  supplier_invoice_id: number;
  supplier_payment_id?: number | null;
  landed_cost_document_ids?: number[] | null;
}

export interface PostPurchaseTransactionResult {
  document_id: number;
  document_number: string;
  status: string;
  supplier_id: number;
  warehouse_id: number;
  gross_subtotal: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  payment_status: string;
  payment_method?: string | null;
  paid_amount: string;
  outstanding_amount: string;
  due_date?: string | null;
  child_documents: PurchaseTransactionChildDocuments;
  generation_status: string;
  print_status?: string | null;
}

export interface JournalSummary {
  document_id: number;
  document_number: string | null;
  document_date: string;
  fiscal_period_id: number;
  source_type: string;
  source_id: number | null;
  source_document_number: string | null;
  description: string | null;
  total_debit: string;
  total_credit: string;
  is_balanced: boolean;
  created_at: string;
}

export interface JournalLineDto {
  line_number: number;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
}

export interface JournalDetail extends JournalSummary {
  lines: JournalLineDto[];
}

export interface BusinessDocumentDto {
  document_id: number;
  document_number: string | null;
  document_type: string;
  document_date: string;
  status: string;
  posted_at: string | null;
  generation_status: string;
  print_status: string | null;
  linked_journal_id: number | null;
  linked_journal_number: string | null;
  detail_summary: string | null;
}
