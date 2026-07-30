export interface CreditSaleLineInput {
  variant_id: number;
  quantity: string;
  unit_price: string;
}

export interface CreditSaleInput {
  request_id: string;
  customer_id: number;
  warehouse_id: number;
  fiscal_period_id: number;
  document_date: string;
  lines: CreditSaleLineInput[];
  override_token?: string | null;
}

export interface CreditSaleResult {
  document_id: number;
  document_number: string;
  customer_id: number;
  total_amount: string;
  due_date: string;
  exposure_amount: string;
  available_credit: string;
  journal_document_id: number;
}

export interface CreditOverrideInput {
  token_id: string;
  customer_id: number;
  warehouse_id: number;
  fiscal_period_id: number;
  document_date: string;
  lines: CreditSaleLineInput[];
  reason: string;
  ttl_minutes?: number;
}
