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
  status: string;
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
export interface CatalogProduct { product_id: number; name: string; is_active: boolean; variant_count: number; active_variant_count: number; }
export interface ResolvedBarcode { variant_id: number; product_id: number; sku: string; product_name: string; sale_price: string; base_unit_id: number; variant_is_active: boolean; product_is_active: boolean; }
export interface VariantAttribute { attribute_id: number; attribute_name: string; attribute_value_id: number; value: string; }
export interface VariantAltUnit { id: number; unit_id: number; unit_code: string; conversion_factor: string; }
export interface VariantBarcode { id: number; barcode: string; }
export interface VariantDetail { variant_id: number; sku: string; sale_price: string; is_active: boolean; base_unit_id: number; base_unit_code: string; attribute_signature: string; attributes: VariantAttribute[]; alternate_units: VariantAltUnit[]; barcodes: VariantBarcode[]; }
export interface ProductDetail { product_id: number; name: string; is_active: boolean; variants: VariantDetail[]; }
export interface CreatedProductWithVariants { product_id: number; variant_ids: number[]; }

// Input payloads (sent as JSON; snake_case; string decimals):
export interface AltUnitInput { unit_id: number; conversion_factor: string; }
export interface VariantInput { sku: string; sale_price: string; is_active: boolean; base_unit_id?: number; attribute_value_ids?: number[]; barcodes?: string[]; alternate_units?: AltUnitInput[]; }

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
  posted_at: string;
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

export interface ConfirmSupplierInvoicePayload {
  request_id: string;
  invoice_doc_id: number;
  fiscal_period_id: number;
  document_date: string;
}

export interface SupplierInvoiceSummary {
  document_id: number;
  document_number: string | null;
  supplier_id: number;
  supplier_name: string;
  status: string;
  currency_code: string;
  foreign_total_amount: string;
  base_total_amount: string;
  created_at: string;
}

export interface SupplierLiabilityDto {
  id: number;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  document_id: number | null;
  original_amount: string;
  remaining_amount: string;
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

export interface ConfirmSupplierReturnPayload {
  request_id: string;
  return_document_id: number;
  fiscal_period_id: number;
  document_date: string;
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

export interface SupplierReturnSummary {
  document_id: number;
  document_number: string | null;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number;
  status: string;
  reason_code: string;
  created_at: string;
}

export interface SupplierPaymentDto {
  document_id: number;
  document_number: string | null;
  supplier_id: number;
  supplier_name: string;
  payment_method: string;
  amount: string;
  created_at: string;
}

// ── S4-001: Customer Master & Credit ────────────────────────────────────────

export interface Customer {
  id: number;
  code: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_id: string | null;
  credit_limit_amount: string;
  max_overdue_days: number;
  is_active: boolean;
  exposure_amount: string;
  created_at: string;
}

export interface CreateCustomerPayload {
  code: string;
  name: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tax_id?: string | null;
  credit_limit_amount: string;
  max_overdue_days: number;
}

export interface CustomerLiabilityDto {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_code: string;
  original_amount: string;
  remaining_amount: string;
  due_date: string | null;
  status: string;
  created_at: string;
}

export interface CustomerPaymentDto {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_code: string;
  liability_id: number | null;
  amount: string;
  payment_method: string;
  document_number: string | null;
  document_date: string;
  note: string | null;
  created_at: string;
}

export interface PostCustomerPaymentPayload {
  request_id: string;
  customer_id: number;
  liability_id: number;
  amount: string;
  payment_method: 'CASH' | 'BANK_TRANSFER' | 'CHECK';
  fiscal_period_id: number;
  document_date: string;
  note?: string | null;
}

// ── S4-002: Advanced Cash Sessions & Credit Override Tokens ─────────────────

export interface DenominationInput {
  denomination: number;
  bill_count: number;
}

export interface SubmitClosingPayload {
  cash_session_id: number;
  denominations: DenominationInput[];
}

export interface PendingVarianceSessionDto {
  id: number;
  warehouse_id: number;
  workstation_id: string;
  opened_by_user_id: number;
  opened_by_name: string;
  closed_by_user_id: number | null;
  closed_by_name: string | null;
  status: string;
  opening_float: string;
  expected_amount: string;
  counted_amount: string;
  variance_amount: string;
  opened_at: string;
  closed_at: string | null;
}

export interface GenerateCreditOverridePayload {
  customer_id: number;
  payload_hash: string;
  valid_minutes?: number;
}

export interface CreditOverrideTokenResult {
  token: string;
  customer_id: number;
  expires_at: string;
}

// ── Slice 5: Customer Returns, Warehouse Transfers & Stock Write-Offs ────────

export interface ReturnLinePayload {
  variant_id: number;
  quantity: string;
  unit_price: string;
}

export interface ConfirmCustomerReturnPayload {
  request_id: string;
  customer_id?: number | null;
  cash_session_id?: number | null;
  warehouse_id: number;
  refund_method: 'CASH' | 'CREDIT_NOTE' | 'BANK_TRANSFER';
  fiscal_period_id: number;
  document_date: string;
  lines: ReturnLinePayload[];
  note?: string | null;
}

export interface TransferLinePayload {
  variant_id: number;
  quantity: string;
}

export interface ConfirmWarehouseTransferPayload {
  request_id: string;
  from_warehouse_id: number;
  to_warehouse_id: number;
  fiscal_period_id: number;
  document_date: string;
  lines: TransferLinePayload[];
  note?: string | null;
}

export interface WriteOffLinePayload {
  variant_id: number;
  quantity: string;
  unit_cost: string;
}

export interface ConfirmStockWriteOffPayload {
  request_id: string;
  warehouse_id: number;
  reason_code: 'DAMAGED' | 'EXPIRED' | 'DEFECTIVE' | 'STOLEN' | 'OTHER';
  fiscal_period_id: number;
  document_date: string;
  lines: WriteOffLinePayload[];
  note?: string | null;
}

export interface CustomerReturnDto {
  id: number;
  document_id: number;
  document_number: string;
  customer_name: string;
  refund_method: string;
  total_amount: string;
  note: string | null;
  created_at: string;
}

export interface WarehouseTransferDto {
  id: number;
  document_id: number;
  document_number: string;
  from_warehouse_name: string;
  to_warehouse_name: string;
  note: string | null;
  created_at: string;
}

export interface StockWriteOffDto {
  id: number;
  document_id: number;
  document_number: string;
  warehouse_name: string;
  reason_code: string;
  total_cost: string;
  note: string | null;
  created_at: string;
}

// ── Slice 6: Print Queue & Official Document Templates ────────────────────────

export interface EnqueuePrintJobPayload {
  document_id: number;
  job_type: 'THERMAL_RECEIPT' | 'PDF_INVOICE' | 'DRAWER_PULSE';
  format: 'ESC_POS_80MM' | 'PDF_A4' | 'PDF_A5';
  printer_name?: string | null;
}

export interface UpdatePrintJobStatusPayload {
  job_id: number;
  status: 'COMPLETED' | 'FAILED';
  error_message?: string | null;
}

export interface PrintJobDto {
  id: number;
  document_id: number | null;
  document_number: string | null;
  document_type: string | null;
  job_type: string;
  format: string;
  status: string;
  printer_name: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// ── Slice 7: Sandbox Reconstruction & Historical Importer ────────────────────

export interface ImportBatchDto {
  id: string;
  batch_number: string;
  status: 'STAGING' | 'VALIDATING' | 'NEEDS_REVIEW' | 'VALIDATED' | 'LOCKED';
  file_name: string;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  created_by: string;
  created_at: string;
  validated_at?: string | null;
  locked_at?: string | null;
}

export interface CreateImportBatchPayload {
  file_name: string;
  total_rows: number;
}

export interface StagedRecordDto {
  id: string;
  batch_id: string;
  row_number: number;
  entity_type: 'PRODUCT' | 'STOCK_RECEIPT' | 'CUSTOMER_BALANCE' | 'SUPPLIER_BALANCE';
  raw_json: Record<string, unknown>;
  corrected_json?: Record<string, unknown> | null;
  validation_errors?: Record<string, unknown> | null;
  status: 'PENDING' | 'VALID' | 'ERROR' | 'CORRECTED';
  created_at: string;
}

export interface UpdateStagedRecordPayload {
  record_id: string;
  corrected_json: Record<string, unknown>;
}

export interface ReplayResultDto {
  batch_id: string;
  status: string;
  total_records: number;
  valid_records: number;
  reconstruction_status: string;
  discrepancies_found: number;
  calculated_stock_value: number;
  calculated_receivables: number;
}

export interface CommitBatchResultDto {
  batch_id: string;
  batch_number: string;
  status: string;
  message: string;
}



