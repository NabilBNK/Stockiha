export type VoidReason =
  | 'CUSTOMER_CHANGED_MIND'
  | 'WRONG_ITEM'
  | 'WRONG_PRICE'
  | 'CASHIER_MISTAKE'
  | 'OTHER';

export const VOID_REASONS: VoidReason[] = [
  'CUSTOMER_CHANGED_MIND',
  'WRONG_ITEM',
  'WRONG_PRICE',
  'CASHIER_MISTAKE',
  'OTHER',
];

export interface VoidSlipLine {
  name: string;
  quantity: string;
  unit_price: string;
  line_total: string;
}

export interface SaleVoidResult {
  void_document_id: number;
  void_document_number: string;
  original_document_id: number;
  original_document_number: string | null;
  sale_kind: 'CASH' | 'CREDIT';
  customer_name: string | null;
  subtotal: string;
  discount_amount: string;
  total_amount: string;
  reason_code: VoidReason;
  note: string | null;
  cash_session_id: number;
  journal_document_id: number;
  voided_at: string;
  lines: VoidSlipLine[];
}

export interface SessionSale {
  document_id: number;
  document_number: string | null;
  sale_kind: 'CASH' | 'CREDIT';
  customer_name: string | null;
  total_amount: string;
  status: 'POSTED' | 'REVERSED' | string;
  posted_at: string | null;
  void_document_number: string | null;
}
