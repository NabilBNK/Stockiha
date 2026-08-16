export interface ConfirmDirectPurchaseLinePayload {
  variant_id: number;
  unit_id: number;
  quantity_received: string;
  unit_cost: string;
}

export interface ConfirmDirectPurchasePayload {
  request_id: string;
  supplier_id: number;
  warehouse_id: number;
  fiscal_period_id: number;
  document_date: string;
  note?: string | null;
  lines: ConfirmDirectPurchaseLinePayload[];
}

export interface ConfirmDirectPurchaseResult {
  document_id: number;
  document_number: string;
  receipt_origin: 'DIRECT_PURCHASE';
  purchase_order_id: null;
  purchase_order_number: null;
  supplier_id: number;
  warehouse_id: number;
  total_amount: string;
  journal_document_id: number;
  journal_document_number?: string | null;
  order_status?: null;
  posted_at: string;
}
