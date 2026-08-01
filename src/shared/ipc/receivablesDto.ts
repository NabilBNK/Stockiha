export interface OpenCustomerInvoice {
  invoice_ledger_entry_id: number;
  document_id: number | null;
  document_number: string | null;
  document_date: string | null;
  due_date: string | null;
  original_amount: string;
  allocated_amount: string;
  remaining_amount: string;
}

export interface CustomerPaymentAllocationInput {
  invoice_ledger_entry_id: number;
  amount: string;
}

export interface PostCustomerPaymentPayload {
  request_id: string;
  customer_id: number;
  amount: string;
  payment_method: 'CASH' | 'BANK_TRANSFER';
  cash_session_id: number | null;
  fiscal_period_id: number;
  document_date: string;
  allocations: CustomerPaymentAllocationInput[];
  note?: string | null;
}

export interface CustomerPaymentResult {
  document_id: number;
  document_number: string;
  customer_id: number;
  payment_method: string;
  amount: string;
  exposure_amount: string;
  available_credit: string;
  journal_document_id: number;
  payment_ledger_entry_id: number;
}

export interface RefundableCustomerPayment {
  payment_document_id: number;
  document_number: string;
  document_date: string;
  payment_method: 'CASH' | 'BANK_TRANSFER';
  amount: string;
  note: string | null;
}

export interface AuthorizeCustomerRefundPayload {
  authorization_id: string;
  source_payment_document_id: number;
  refund_method: 'CASH' | 'BANK_TRANSFER';
  cash_session_id: number | null;
  reason: string;
  ttl_minutes: number;
}

export interface PostCustomerRefundPayload {
  request_id: string;
  authorization_id: string;
  fiscal_period_id: number;
  document_date: string;
  note?: string | null;
}

export interface CustomerRefundResult {
  document_id: number;
  document_number: string;
  source_payment_document_id: number;
  customer_id: number;
  refund_method: 'CASH' | 'BANK_TRANSFER';
  amount: string;
  exposure_amount: string;
  available_credit: string;
  journal_document_id: number;
  refund_ledger_entry_id: number;
}
