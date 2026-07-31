export interface PrintableDocument {
  document_id: number;
  document_type: string;
  document_number: string | null;
  document_date: string;
  posted_at: string | null;
  generation_status: string | null;
  generated_file_ref: string | null;
  print_status: string | null;
}

export interface GeneratedCustomerDocument {
  document_id: number;
  document_number: string;
  generated_file_ref: string;
}

export interface CustomerDocumentCustomerSnapshot {
  id: number;
  code: string;
  name: string;
  tax_id: string | null;
  address: string | null;
}

export interface CreditSaleDocumentLine {
  line_number: number;
  variant_id: number;
  sku: string;
  name: string;
  quantity: string;
  unit_price: string;
  line_total: string;
}

export interface CreditSaleDocumentPayload {
  document_kind: 'CREDIT_SALE';
  document_id: number;
  document_number: string;
  status: string;
  document_date: string;
  posted_at: string | null;
  customer: CustomerDocumentCustomerSnapshot;
  warehouse_id: number;
  subtotal: string;
  total_amount: string;
  due_date: string;
  journal_document_id: number;
  lines: CreditSaleDocumentLine[];
}

export interface CustomerPaymentDocumentAllocation {
  invoice_ledger_entry_id: number;
  invoice_document_id: number | null;
  invoice_document_number: string | null;
  invoice_document_date: string | null;
  allocated_amount: string;
}

export interface CustomerPaymentDocumentPayload {
  document_kind: 'CUSTOMER_PAYMENT';
  document_id: number;
  document_number: string;
  status: string;
  document_date: string;
  posted_at: string | null;
  customer: CustomerDocumentCustomerSnapshot;
  payment_method: 'CASH' | 'BANK_TRANSFER';
  amount: string;
  cash_session_id: number | null;
  journal_document_id: number;
  note: string | null;
  allocations: CustomerPaymentDocumentAllocation[];
}

export type CustomerDocumentPayload = CreditSaleDocumentPayload | CustomerPaymentDocumentPayload;
