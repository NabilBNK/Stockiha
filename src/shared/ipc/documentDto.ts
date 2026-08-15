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

export interface BusinessDocument {
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

export interface BusinessDocumentHeader {
  document_id: number;
  document_type: string;
  document_number: string | null;
  status: string;
  document_date: string;
  fiscal_year: number;
  fiscal_period_id: number;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessDocumentRelationship {
  document_id: number;
  document_type: string;
  document_number: string | null;
  date: string;
  status: string;
}

export interface BusinessDocumentLinkedJournal {
  document_id: number;
  document_number: string | null;
}

export interface BusinessDocumentPrintJobs {
  gen_status: string;
  prt_status: string;
}

export interface BusinessDocumentDetail {
  header: BusinessDocumentHeader;
  subtype_detail: Record<string, unknown>;
  relationships: BusinessDocumentRelationship[];
  journal: BusinessDocumentLinkedJournal | null;
  print_jobs: BusinessDocumentPrintJobs;
}

export interface DocumentReportFilter {
  date_from?: string;
  date_to?: string;
  document_type?: string;
  status?: string;
  search?: string;
  has_journal?: boolean;
  limit?: number;
  offset?: number;
}

export interface DocumentReportTypeCount {
  type: string;
  count: number;
}

export interface DocumentReportTypeAmount {
  type: string;
  total_amount: string;
  semantic_label: string;
}

export interface BusinessDocumentReportSummary {
  total_count: number;
  posted_count: number;
  draft_count: number;
  reversed_count: number;
  linked_journal_count: number;
  unlinked_journal_count: number;
  type_counts: DocumentReportTypeCount[];
  type_amounts: DocumentReportTypeAmount[];
}

export interface BusinessDocumentReportRow {
  document_id: number;
  document_number: string | null;
  document_type: string;
  document_date: string;
  status: string;
  posted_at: string | null;
  party_name: string | null;
  amount: string | null;
  linked_journal_id: number | null;
  linked_journal_number: string | null;
  has_journal: boolean;
}

export interface BusinessDocumentReportResult {
  summary: BusinessDocumentReportSummary;
  rows: BusinessDocumentReportRow[];
}
