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

// --- R0-005 WS-G historical product description mapping ---

/**
 * What the administrator decided about one normalized historical description.
 * `null` means he has not decided yet — nothing is ever decided for him.
 */
export type HistoricalProductMappingDecision =
  | 'CANONICAL'
  | 'MERGED'
  | 'NEW_PRODUCT'
  | 'IGNORED';

export interface HistoricalProductRawVariant {
  productName: string | null;
  brand: string | null;
  customDetails: string | null;
}

/**
 * One distinct normalized description in the staged transcription.
 *
 * Money and quantity are EXACT DECIMAL STRINGS, never JavaScript numbers:
 * PostgreSQL computed them and TypeScript only displays the characters.
 */
export interface HistoricalProductMappingRow {
  normalizedKey: string;
  canonicalKey: string;
  decision: HistoricalProductMappingDecision | null;
  isResolved: boolean;
  displayProductName: string | null;
  displayBrand: string | null;
  displayCustomDetails: string | null;
  /** Every raw spelling that normalizes to this key, as transcribed. */
  rawVariants: HistoricalProductRawVariant[];
  occurrenceCount: number;
  buyLineCount: number;
  sellLineCount: number;
  appearsInBuy: boolean;
  appearsInSell: boolean;
  totalQuantity: string;
  sellQuantity: string;
  totalValueDzd: string;
  buyValueDzd: string;
  sellValueDzd: string;
  /** True when at least one Buy line resolves to this canonical variant. */
  hasCostSource: boolean;
  firstSourceRow: number;
}

export interface HistoricalMappingReadiness {
  batchId: number;
  distinctDescriptionCount: number;
  resolvedDescriptionCount: number;
  /** Descriptions the administrator has not decided about yet. */
  unresolvedDescriptionCount: number;
  sellDescriptionCount: number;
  unresolvedSellDescriptionCount: number;
  distinctCanonicalVariantsSold: number;
  /** Sold variants with no purchase line to take a cost from. */
  sellWithoutCostSourceCount: number;
  sellWithoutCostSourceValueDzd: string;
  isComplete: boolean;
}

export interface HistoricalProductMappingResult {
  batchId: number;
  descriptions: HistoricalProductMappingRow[];
  readiness: HistoricalMappingReadiness;
}

/** A grouping the screen proposes. It has no effect until it is confirmed. */
export interface HistoricalProductMappingSuggestion {
  kind: 'NORMALIZED_IDENTICAL' | 'FUZZY';
  normalizedKey: string;
  suggestedCanonicalKey: string;
  distance: number;
  rawVariants: HistoricalProductRawVariant[];
}

export interface HistoricalProductAliasDecisionInput {
  normalizedKey: string;
  rawSample?: string | null;
  decision: HistoricalProductMappingDecision;
  /** Required for `MERGED`; ignored otherwise. */
  canonicalKey?: string | null;
  note?: string | null;
}

export interface ApplyHistoricalProductAliasDecisionsRequest {
  decisions: HistoricalProductAliasDecisionInput[];
}

export interface HistoricalProductAliasWriteResult {
  appliedCount: number;
  aliasCount: number;
}

export interface ClearHistoricalProductAliasRequest {
  normalizedKey: string;
}

export interface HistoricalProductAliasClearResult {
  removedCount: number;
  aliasCount: number;
}

export interface HistoricalProductMappingRequest {
  batchId: number;
}

/* -------------------------------------------------------------------------- */
/* WS-I — historical financial reports                                        */
/* -------------------------------------------------------------------------- */
/* Every monetary field below is an EXACT DECIMAL STRING produced by
 * PostgreSQL `numeric`, already rounded to 2 decimals for display. Never
 * parse one into a JavaScript number to do arithmetic on it: the figures are
 * computed in the database precisely so that no IEEE-754 double ever touches
 * the customer's money. Format them, compare them, display them — do not add
 * them up here. */

export type HistoricalReportCode =
  | 'PROFIT_AND_LOSS'
  | 'MONTHLY_TREND'
  | 'CUSTOMER_DEBT'
  | 'PURCHASES'
  | 'SALES'
  | 'SELLERS'
  | 'SUPPLIER_DEBT_AND_EXPENSES'
  | 'STOCK_VALUATION';

/**
 * The reports whose figures are derived from a purchase cost. They are refused
 * outright while the product mapping is incomplete, because an unresolved
 * description has no cost source and the report would book a whole sale price
 * as profit. Every other report reads amounts, parties and payment status only,
 * which no mapping decision can change, so it stays available.
 *
 * This list mirrors the gate in `onboarding.get_historical_report`; the
 * database decides, this constant only lets the screen explain.
 */
export const HISTORICAL_COST_DEPENDENT_REPORTS: readonly HistoricalReportCode[] = [
  'PROFIT_AND_LOSS',
  'MONTHLY_TREND',
  'SELLERS',
  'STOCK_VALUATION',
];

export interface HistoricalReportRequest {
  reportCode: HistoricalReportCode;
  /** `null` means "the most recent import". */
  batchId?: number | null;
  /** Inclusive `YYYY-MM-DD`; `null` means unbounded. */
  dateFrom?: string | null;
  dateTo?: string | null;
}

/** Report 1 — profit and loss over the selected period. */
export interface HistoricalProfitAndLossReport {
  revenueDzd: string;
  purchasesDzd: string;
  cogsDzd: string;
  grossProfitDzd: string;
  expensesDzd: string;
  netProfitDzd: string;
  /** The figure written by hand in the paper ledger's Benefit column. */
  recordedBenefitDzd: string;
  /** recordedBenefit − computed gross profit. Negative means the paper
   *  under-recorded relative to the computed figure. */
  gapVsGrossDzd: string;
  gapVsNetDzd: string;
  customerDebtDzd: string;
  supplierDebtDzd: string;
  unpaidExpensesDzd: string;
  saleLineCount: number;
  monthCount: number;
  salesWithRecordedBenefitCount: number;
  salesWithoutRecordedBenefitCount: number;

  /* ---- the cost-free sales split ------------------------------------------
   * The customer held stock before his paper records began, so some sales have
   * no purchase to price them against. That is permanent, not a fixture quirk.
   * `revenueWithCostDzd + revenueWithoutCostDzd === revenueDzd`, exactly, and
   * `grossProfitOnCostedSalesDzd` applies ONLY to the first of the two. */
  revenueWithCostDzd: string;
  revenueWithoutCostDzd: string;
  grossProfitOnCostedSalesDzd: string;
  saleLinesWithCostCount: number;
  saleLinesWithoutCostCount: number;
  /** No purchase of that variant was recorded before the sale. */
  costFreeNoPurchaseCount: number;
  costFreeNoPurchaseValueDzd: string;
  /** The quantity column was left blank, so no cost can be attributed either. */
  costFreeNoQuantityCount: number;
  costFreeNoQuantityValueDzd: string;

  /** Same figures as `costFreeNoPurchase*`, under the names the first cut of
   *  this screen used. */
  saleLinesWithoutCostAtDateCount: number;
  saleLinesWithoutCostAtDateValueDzd: string;
  saleLinesWithoutQuantityCount: number;
}

/** Report 2 — one row per calendar month. */
export interface HistoricalMonthlyTrendRow {
  /** `YYYY-MM`. */
  month: string;
  purchasesDzd: string;
  salesDzd: string;
  cogsDzd: string;
  grossProfitDzd: string;
  expensesDzd: string;
  netProfitDzd: string;
  recordedBenefitDzd: string;
  gapVsGrossDzd: string;
  revenueWithCostDzd: string;
  revenueWithoutCostDzd: string;
  saleLinesWithoutCostAtDateCount: number;
}

/** Report 6 — customer debt. One lifetime balance per customer. */
export interface HistoricalCustomerDebtRow {
  /** `null` when the paper left the customer blank. */
  party: string | null;
  balanceDzd: string;
  transactionCount: number;
  oldestDate: string;
  newestDate: string;
}

export interface HistoricalCustomerDebtReport {
  rows: HistoricalCustomerDebtRow[];
  totalDzd: string;
  partyCount: number;
  unspecifiedPartyBalanceDzd: string;
  transactionCount: number;
  /** Both always false: the paper ledger has no partial-payment concept and no
   *  invoice ageing, so the report must not imply either exists. */
  hasPartialPayments: boolean;
  hasAgeing: boolean;
}

/* -------------------------------------------------------------------------- */
/* Reports 3 and 4 — purchases and sales, grouped two ways                    */
/* -------------------------------------------------------------------------- */
/* `quantity` is an exact integer string, like every money field: it is summed
 * in PostgreSQL and formatted here, never added up in JavaScript. */

export interface HistoricalPartyGroupRow {
  /** `null` when the paper left the supplier or customer blank. */
  party: string | null;
  totalDzd: string;
  quantity: string;
  lineCount: number;
  transactionCount: number;
}

/** Every product row names the CANONICAL variant from the alias system, never
 *  the raw transcribed text, so one product can never appear as two rows. */
export interface HistoricalProductGroupRow {
  canonicalKey: string;
  /** The canonical key rendered for a human: `produit · marque · détail`. */
  label: string;
  totalDzd: string;
  quantity: string;
  lineCount: number;
  transactionCount: number;
}

/** Report 3 — purchases by supplier and by product. */
export interface HistoricalPurchasesReport {
  bySupplier: HistoricalPartyGroupRow[];
  byProduct: HistoricalProductGroupRow[];
  totalDzd: string;
  totalQuantity: string;
  lineCount: number;
  transactionCount: number;
  supplierCount: number;
  productCount: number;
  unspecifiedSupplierTotalDzd: string;
}

/** Report 4 — sales by customer and by product. */
export interface HistoricalSalesCustomerRow extends HistoricalPartyGroupRow {
  unpaidDzd: string;
}

export interface HistoricalSalesReport {
  byCustomer: HistoricalSalesCustomerRow[];
  byProduct: HistoricalProductGroupRow[];
  totalDzd: string;
  totalQuantity: string;
  lineCount: number;
  transactionCount: number;
  customerCount: number;
  productCount: number;
  unspecifiedCustomerTotalDzd: string;
}

/* -------------------------------------------------------------------------- */
/* Report 5 — best and worst sellers                                          */
/* -------------------------------------------------------------------------- */

export interface HistoricalSellerRow {
  canonicalKey: string;
  label: string;
  quantitySold: string;
  revenueDzd: string;
  /** `null` — NOT zero — whenever the margin is unknown. A missing purchase
   *  cost treated as zero would display the whole sale price as margin. */
  cogsDzd: string | null;
  marginDzd: string | null;
  marginKnown: boolean;
  saleLineCount: number;
  linesWithoutCostCount: number;
}

export interface HistoricalSellersReport {
  variantCount: number;
  marginKnownCount: number;
  marginUnknownCount: number;
  rankingSize: number;
  bestByQuantity: HistoricalSellerRow[];
  worstByQuantity: HistoricalSellerRow[];
  /** Only variants whose margin is known. The others are never ranked here. */
  bestByMargin: HistoricalSellerRow[];
  worstByMargin: HistoricalSellerRow[];
  unknownMargin: HistoricalSellerRow[];
}

/* -------------------------------------------------------------------------- */
/* Report 7 — supplier debt and expenses                                      */
/* -------------------------------------------------------------------------- */

export interface HistoricalSupplierDebtReport {
  rows: HistoricalCustomerDebtRow[];
  totalDzd: string;
  partyCount: number;
  unspecifiedPartyBalanceDzd: string;
  transactionCount: number;
  hasPartialPayments: boolean;
  hasAgeing: boolean;
}

export interface HistoricalExpenseCategoryRow {
  /** The free text the customer actually wrote; `null` when he wrote nothing. */
  category: string | null;
  totalDzd: string;
  unpaidDzd: string;
  lineCount: number;
  transactionCount: number;
}

export interface HistoricalExpensesReport {
  rows: HistoricalExpenseCategoryRow[];
  totalDzd: string;
  unpaidTotalDzd: string;
  categoryCount: number;
  lineCount: number;
  uncategorizedTotalDzd: string;
  /** Always false: there is no expense taxonomy, only the customer's own words. */
  hasCategoryTaxonomy: boolean;
}

export interface HistoricalSupplierDebtAndExpensesReport {
  supplier: HistoricalSupplierDebtReport;
  expenses: HistoricalExpensesReport;
}

/* -------------------------------------------------------------------------- */
/* Report 8 — stock on hand and valuation                                     */
/* -------------------------------------------------------------------------- */

export interface HistoricalStockRow {
  canonicalKey: string;
  label: string;
  quantity: string;
  valueDzd: string;
  /** `null` when the pool holds value but no counted units. */
  unitCostDzd: string | null;
}

export interface HistoricalStockValuationReport {
  /** The last transaction date in the batch. A stock level is a position, not
   *  a flow, so the date range deliberately does not apply. */
  asOfDate: string | null;
  dateRangeApplies: boolean;
  rows: HistoricalStockRow[];
  variantCount: number;
  totalQuantity: string;
  totalValueDzd: string;
  /** The self-proof: purchases − cost of goods sold − closing stock = 0, from
   *  the UNROUNDED walk. This is an internal-consistency check, not a displayed
   *  total, which is why it does not use the rounded monthly figures the
   *  profit-and-loss headline sums. */
  totalPurchasedDzd: string;
  totalCogsDzd: string;
  balanceResidualDzd: string;
  balances: boolean;
}

export type HistoricalReportBody =
  | HistoricalProfitAndLossReport
  | HistoricalMonthlyTrendRow[]
  | HistoricalCustomerDebtReport
  | HistoricalPurchasesReport
  | HistoricalSalesReport
  | HistoricalSellersReport
  | HistoricalSupplierDebtAndExpensesReport
  | HistoricalStockValuationReport;

export interface HistoricalReportEnvelope {
  batchId: number | null;
  reportCode: HistoricalReportCode;
  dateFrom: string | null;
  dateTo: string | null;
  readiness: HistoricalMappingReadiness | null;
  /** False whenever a COST-DEPENDENT report — see
   *  `HISTORICAL_COST_DEPENDENT_REPORTS` — was asked for while the product
   *  mapping is incomplete. `report` is then null and the caller MUST show the
   *  readiness message instead of a number. The other reports read only
   *  amounts, parties and payment status, so they stay renderable —
   *  `readiness` still reports the unfinished mapping. */
  canRender: boolean;
  refusalReason: 'MAPPING_INCOMPLETE' | 'NO_BATCH' | null;
  report: HistoricalReportBody | null;
}

export interface HistoricalReportScope {
  batchId: number | null;
  status: string | null;
  minDate: string | null;
  maxDate: string | null;
  transactionCount: number;
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

