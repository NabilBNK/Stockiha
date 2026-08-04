export type HistoricalFinanceSourceType = 'EXCEL' | 'MANUAL';

export type HistoricalTransactionType =
  | 'SALE'
  | 'PURCHASE'
  | 'EXPENSE'
  | 'OTHER_INCOME'
  | 'CUSTOMER_REFUND'
  | 'SUPPLIER_REFUND'
  | 'LOAN_RECEIVED'
  | 'LOAN_REPAYMENT'
  | 'OWNER_CONTRIBUTION'
  | 'OWNER_WITHDRAWAL'
  | 'TAX_PAYMENT'
  | 'SALARY'
  | 'OTHER';

export type HistoricalPaymentStatus = 'PAID' | 'UNPAID' | 'PARTIAL' | 'UNKNOWN';
export type HistoricalReviewStatus = 'READY' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';

export type HistoricalBalanceType =
  | 'OPENING_CASH'
  | 'CLOSING_CASH'
  | 'OPENING_BANK'
  | 'CLOSING_BANK'
  | 'OPENING_INVENTORY_VALUE'
  | 'CLOSING_INVENTORY_VALUE'
  | 'CUSTOMER_RECEIVABLE'
  | 'SUPPLIER_PAYABLE'
  | 'LOAN_BALANCE'
  | 'TAX_PAYABLE'
  | 'OWNER_CAPITAL'
  | 'OTHER';

export interface HistoricalFinanceSettingResult {
  enabled: boolean;
}

export interface UpdateHistoricalFinanceSettingRequest {
  enabled: boolean;
}

export interface CreateHistoricalFinanceBatchRequest {
  requestId: string;
  sourceType: HistoricalFinanceSourceType;
  originalFilename?: string | null;
}

export interface HistoricalFinanceBatchResult {
  batchId: number;
  status: string;
  isReplay: boolean;
  sourceType: HistoricalFinanceSourceType;
  originalFilename: string | null;
}

export interface HistoricalFinanceRowInput {
  sourceRowNumber: number;
  paperId: string;
  transactionDate: string;
  transactionType: HistoricalTransactionType;
  descriptionOrCategory: string;
  netAmountDzd: number;
  paymentStatus: HistoricalPaymentStatus;
  amountPaidDzd?: number | null;
  expenseCategory?: string | null;
  supplierFournisseur?: string | null;
  customerClient?: string | null;
  notes?: string | null;
  reviewStatus: HistoricalReviewStatus;
}

export interface HistoricalFinanceBalanceInput {
  sourceRowNumber: number;
  balanceDate: string;
  balanceType: HistoricalBalanceType;
  amountDzd: number;
  supplierFournisseur?: string | null;
  customerClient?: string | null;
  notes?: string | null;
  reviewStatus: HistoricalReviewStatus;
}

export interface ReplaceHistoricalFinanceBatchDataRequest {
  batchId: number;
  rows: HistoricalFinanceRowInput[];
  balances: HistoricalFinanceBalanceInput[];
}

export interface HistoricalFinanceBatchDataResult {
  batchId: number;
  status: string;
  transactionRowCount: number;
  balanceRowCount: number;
}

export interface HistoricalFinanceBatchIdRequest {
  batchId: number;
}

export interface HistoricalFinanceValidationResult {
  batchId: number;
  status: 'VALIDATED' | 'NEEDS_REVIEW';
  rowCount: number;
  invalidRowCount: number;
  totalSalesDzd: number;
  totalPurchasesDzd: number;
  totalExpensesDzd: number;
  totalOtherIncomeDzd: number;
  totalCustomerRefundsDzd: number;
  totalSupplierRefundsDzd: number;
  preliminaryResultBeforeInventoryDzd: number;
}

export interface HistoricalFinanceApprovalResult {
  batchId: number;
  status: 'APPROVED_FOR_REPORTING';
  isReplay: boolean;
}

export interface HistoricalFinanceSummaryRequest {
  dateFrom: string;
  dateTo: string;
}

export interface HistoricalFinanceSummaryResult {
  dateFrom: string;
  dateTo: string;
  salesDzd: number;
  purchasesDzd: number;
  expensesDzd: number;
  otherIncomeDzd: number;
  customerRefundsDzd: number;
  supplierRefundsDzd: number;
  preliminaryResultBeforeInventoryDzd: number;
  openingInventoryDzd: number | null;
  closingInventoryDzd: number | null;
  inventoryDataComplete: boolean;
  estimatedProfitLossDzd: number | null;
  profitCalculationStatus:
    | 'INVENTORY_ADJUSTED_ESTIMATE'
    | 'INCOMPLETE_WITHOUT_OPENING_AND_CLOSING_INVENTORY';
}
