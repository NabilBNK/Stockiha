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

// --- R0-002 & R0-003 Paper-Book XLSX Import & Analytics DTOs ---

export type PaperBookTransactionType = 'SALE' | 'PURCHASE' | 'EXPENSE';
export type PaperBookPaymentStatus = 'PAID' | 'UNPAID';
export type PaperBookImportProfile = 'PAPER_BOOK_V1' | 'PAPER_BOOK_V2';

/**
 * Money and quantity cross the IPC boundary as EXACT DECIMAL STRINGS, never as
 * JavaScript numbers. TypeScript reads the characters the workbook stores and
 * hands them straight to PostgreSQL, which does every calculation in exact
 * decimal arithmetic. `null` means the paper ledger left the cell blank, which
 * is "unknown" — it is never a zero.
 */
export interface HistoricalTradeLineInput {
  sourceRowNumber: number;
  lineSequence: number;
  productName: string | null;
  brand: string | null;
  customDetails: string | null;
  partyCompany?: string | null;
  /** Exact decimal string, signed. `null` = not recorded on the paper. */
  manualBenefitDzd?: string | null;
  /** Exact decimal string. `null` = quantity not recorded. */
  quantity: string | null;
  /** Exact decimal string. `null` = unit price not recorded. */
  unitPriceDzd: string | null;
  /** Exact decimal string taken from column K. `null` = no amount in column K. */
  manualLineTotalDzd: string | null;
}

export interface HistoricalTradeTransactionInput {
  sourceTransactionSequence: number;
  sourceFirstExcelRow: number;
  sourceExcelTxnRef: string | null;
  transactionDate: string;
  transactionType: PaperBookTransactionType;
  paymentStatus: PaperBookPaymentStatus;
  partyCompany: string | null;
  /** Exact decimal string, signed. `null` = benefit unknown (not zero). */
  manualBenefitDzd: string | null;
  /** Exact whole-number string. `null` = no page number written. */
  pageNumber: string | null;
  lines: HistoricalTradeLineInput[];
}

export interface CreateHistoricalTradeBatchRequest {
  requestId: string;
  originalFilename: string;
  contentHash?: string | null;
  importProfile?: PaperBookImportProfile;
}

export interface HistoricalTradeBatchResult {
  batchId: number;
  status: string;
  isReplay: boolean;
  importProfile: PaperBookImportProfile;
  originalFilename: string;
  contentHash?: string | null;
}

export interface ReplaceHistoricalTradeBatchDataRequest {
  batchId: number;
  transactions: HistoricalTradeTransactionInput[];
}

export interface HistoricalTradeBatchDataResult {
  batchId: number;
  status: string;
  transactionCount: number;
  lineCount: number;
  unmatchedProductCount: number;
  overrideCount: number;
  missingQtyCount: number;
}

export interface HistoricalTradeValidationResult {
  batchId: number;
  status: 'VALIDATED' | 'NEEDS_REVIEW' | 'APPROVED_FOR_REPORTING';
  transactionCount?: number;
  rowCount?: number;
  lineCount?: number;
  totalLines?: number;
  invalidRowCount: number;
  totalSalesDzd: number;
  totalPurchasesDzd: number;
  totalExpensesDzd: number;
  paidSalesDzd: number;
  unpaidSalesDzd: number;
  paidPurchasesDzd: number;
  unpaidPurchasesDzd: number;
  paidExpensesDzd: number;
  unpaidExpensesDzd: number;
  manualBenefitCount: number;
  totalManualBenefitDzd: number;
  unmatchedProductCount: number;
  overrideCount: number;
  missingQtyCount: number;
  contentHash?: string | null;
}

export interface PaperBookSummary {
  transactionCount: number;
  lineCount: number;
  salesCount: number;
  purchaseCount: number;
  expenseCount: number;
  totalSalesDzd: number;
  totalPurchasesDzd: number;
  totalExpensesDzd: number;
  paidSalesDzd: number;
  unpaidSalesDzd: number;
  paidPurchasesDzd: number;
  unpaidPurchasesDzd: number;
  paidExpensesDzd: number;
  unpaidExpensesDzd: number;
  manualBenefitCount: number;
  totalManualBenefitDzd: number;
  salesWithManualBenefitCount: number;
  salesWithoutManualBenefitCount: number;
  minDate: string | null;
  maxDate: string | null;
  unmatchedProductCount: number;
  manualOverrideCount: number;
  missingQtyCount: number;
  errorCount: number;
  warningCount: number;
  isPartial: boolean;
}

export interface HistoricalTradeAnalyticsRequest {
  dateFrom: string;
  dateTo: string;
}

export interface HistoricalTradeAnalyticsOverview {
  dateFrom: string;
  dateTo: string;
  transactionCount: number;
  lineCount: number;
  totalSalesDzd: number;
  totalPurchasesDzd: number;
  totalExpensesDzd: number;
  paidSalesDzd: number;
  unpaidSalesDzd: number;
  paidPurchasesDzd: number;
  unpaidPurchasesDzd: number;
  paidExpensesDzd: number;
  unpaidExpensesDzd: number;
  avgSaleValueDzd: number;
  avgPurchaseValueDzd: number;
  tradeDifferenceDzd: number;
  totalManualBenefitDzd: number;
  salesWithManualBenefitCount: number;
  salesWithoutManualBenefitCount: number;
}

export interface HistoricalTradeAnalyticsPayment {
  sales: { total: number; paid: number; unpaid: number };
  purchases: { total: number; paid: number; unpaid: number };
  expenses: { total: number; paid: number; unpaid: number };
}

export interface HistoricalTradeAnalyticsTimelineMonth {
  month: string;
  yearMonth?: string;
  salesDzd: number;
  purchasesDzd: number;
  expensesDzd: number;
  manualBenefitDzd?: number;
  netTradeDifferenceDzd?: number;
  saleCount?: number;
  purchaseCount?: number;
  expenseCount?: number;
  paidSalesDzd?: number;
  unpaidSalesDzd?: number;
}

export interface HistoricalTradeAnalyticsProduct {
  productName: string;
  matchedProductId: number | null;
  qtySold: number;
  salesDzd: number;
  qtyPurchased: number;
  purchasesDzd: number;
  recordedBenefitDzd?: number;
  avgSaleUnitPriceDzd?: number;
  avgPurchaseUnitPriceDzd?: number;
  transactionCount?: number;
}

export interface HistoricalTradeAnalyticsBrand {
  brand: string;
  salesDzd: number;
  purchasesDzd: number;
  qtySold: number;
  qtyPurchased?: number;
  qtyBought?: number;
  recordedBenefitDzd?: number;
  lineCount?: number;
  transactionCount?: number;
}

export interface HistoricalTradeAnalyticsParty {
  partyCompany: string;
  salesDzd: number;
  purchasesDzd: number;
  expensesDzd: number;
  totalVolumeDzd: number;
  recordedBenefitDzd?: number;
  paidSalesDzd?: number;
  unpaidSalesDzd?: number;
  paidPurchasesDzd?: number;
  unpaidPurchasesDzd?: number;
  transactionCount?: number;
}

export interface HistoricalTradeAnalyticsExpenseItem {
  sourceRowNumber?: number;
  transactionDate: string;
  partyCompany: string | null;
  customDetails: string | null;
  effectiveLineTotalDzd: number;
  paymentStatus: HistoricalPaymentStatus;
}

export interface HistoricalTradeAnalyticsExpenses {
  expenseCount: number;
  totalExpensesDzd: number;
  paidExpensesDzd: number;
  unpaidExpensesDzd: number;
  expensesByMonth?: Array<{ month: string; expensesDzd: number; count: number }>;
  expensesByParty?: Array<{ partyCompany: string; expensesDzd: number; count: number }>;
  expenseItems: HistoricalTradeAnalyticsExpenseItem[];
}

export interface HistoricalTradeAnalyticsBenefits {
  salesTransactionCount: number;
  salesWithManualBenefitCount: number;
  salesWithoutManualBenefitCount: number;
  totalManualBenefitDzd: number;
  averageManualBenefitDzd: number | null;
  manualBenefitToSalesRatioPct?: number | null;
  benefitCoveragePct?: number | null;
  recordedBenefitToSalesPct?: number | null;
  recordedBenefitAfterExpensesDzd?: number | null;
  positiveBenefitLineCount?: number;
  zeroBenefitLineCount?: number;
  negativeBenefitLineCount?: number;
  missingBenefitLineCount?: number;
}

export interface HistoricalTradeDataQuality {
  totalLines: number;
  productNameCoveragePct: number;
  brandCoveragePct: number;
  partyCoveragePct: number;
  pageNumberCoveragePct: number;
  quantityCoveragePct: number;
  benefitCoveragePct?: number;
  unmatchedProductCount: number;
  matchedProductCount?: number;
  manualOverrideCount: number;
  missingQtyCount: number;
}

export interface HistoricalTradeManualOverrides {
  totalLines: number;
  calculatedLineCount: number;
  manualOverrideCount: number;
  calculatedMathematicalTotalDzd: number;
  finalEffectiveTotalDzd: number;
  totalOverrideDifferenceDzd: number;
}

export interface HistoricalTradeAnalyticsResult {
  overview: HistoricalTradeAnalyticsOverview;
  payment: HistoricalTradeAnalyticsPayment;
  timeline: HistoricalTradeAnalyticsTimelineMonth[];
  products: HistoricalTradeAnalyticsProduct[];
  brands: HistoricalTradeAnalyticsBrand[];
  parties: HistoricalTradeAnalyticsParty[];
  expenses: HistoricalTradeAnalyticsExpenses;
  benefits: HistoricalTradeAnalyticsBenefits;
  dataQuality: HistoricalTradeDataQuality;
  manualOverrides: HistoricalTradeManualOverrides;
}

