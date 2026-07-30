export interface Customer {
  id: number;
  code: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_id: string | null;
  is_active: boolean;
  credit_enabled: boolean;
  credit_limit: string;
  payment_terms_days: number;
  max_overdue_days: number | null;
  exposure_amount: string;
  available_credit: string;
  oldest_open_due_date: string | null;
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
  credit_enabled: boolean;
  credit_limit: string;
  payment_terms_days: number;
  max_overdue_days?: number | null;
}

export interface UpdateCustomerPayload extends CreateCustomerPayload {
  customer_id: number;
  is_active: boolean;
}

export interface CustomerCapabilities {
  can_view_customers: boolean;
  can_manage_customers: boolean;
  can_post_credit_sale: boolean;
  can_post_customer_payment: boolean;
  can_override_credit_limit: boolean;
}

export interface CustomerCreditSummary {
  customer_id: number;
  customer_code: string;
  customer_name: string;
  is_active: boolean;
  credit_enabled: boolean;
  credit_limit: string;
  exposure_amount: string;
  available_credit: string;
  payment_terms_days: number;
  max_overdue_days: number | null;
  oldest_open_due_date: string | null;
  overdue_blocked: boolean;
  last_rebuilt_at: string;
}

export interface CustomerLedgerEntry {
  id: number;
  customer_id: number;
  entry_type: 'CREDIT_INVOICE' | 'DEBIT_NOTE' | 'CREDIT_NOTE' | 'PAYMENT' | 'WRITE_OFF' | 'ADJUSTMENT';
  amount_delta: string;
  document_id: number | null;
  related_entry_id: number | null;
  due_date: string | null;
  posted_by_user_id: number;
  workstation_id: string;
  created_at: string;
}
