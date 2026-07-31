export type CashSessionLifecycleStatus =
  | 'OPEN'
  | 'CLOSING'
  | 'PENDING_APPROVAL'
  | 'CLOSED'
  | 'SUSPENDED';

export interface CashDenomination {
  id: number;
  code: string;
  value: string;
  display_order: number;
}

export interface DenominationCountInput {
  denomination_id: number;
  quantity: number;
}

export interface CurrentCashSession {
  id: number;
  warehouse_id: number;
  workstation_id: string;
  opened_by_user_id: number;
  current_cashier_user_id: number;
  current_cashier_display_name: string;
  status: CashSessionLifecycleStatus;
  opening_float: string;
  opened_at: string;
  close_attempt_id: number | null;
  expected_amount: string | null;
  counted_amount: string | null;
  variance_amount: string | null;
  requires_manager_approval: boolean | null;
  suspension_reason: string | null;
}

export interface CashSessionCloseResult {
  cash_session_id: number;
  close_attempt_id: number;
  status: 'PENDING_APPROVAL' | 'CLOSED';
  expected_amount: string;
  counted_amount: string;
  variance_amount: string;
  requires_manager_approval: boolean;
  approved_by_user_id: number | null;
}
