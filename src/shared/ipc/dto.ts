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
