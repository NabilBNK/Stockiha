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

export type CashMovementDirection = 'CASH_IN' | 'CASH_OUT';

export type CashMovementReason =
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE'
  | 'CHANGE_FLOAT'
  | 'CORRECTION'
  | 'OTHER';

export interface CashMovement {
  movement_id: number;
  movement_type: 'SALE' | CashMovementDirection;
  amount: string;
  reason_code: CashMovementReason | null;
  note: string | null;
  business_document_id: number | null;
  journal_document_id: number | null;
  created_at: string;
}

export interface RecordCashMovementResult {
  movement_id: number;
  cash_session_id: number;
  movement_type: CashMovementDirection;
  amount: string;
  reason_code: CashMovementReason;
  journal_document_id: number;
  approved_by_user_id: number | null;
}

export interface CashSessionPolicy {
  material_variance_threshold: string;
  updated_at: string;
}

export interface CashCapabilities {
  can_record_cash_movement: boolean;
  can_approve_cash_out: boolean;
}
