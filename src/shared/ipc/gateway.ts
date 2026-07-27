/**
 * Slice 1 — the single typed gateway for every Tauri IPC command.
 */
import { invoke } from '@tauri-apps/api/core';

import { parseTauriError } from '../utils/tauriError';
import type { AppErrorCode } from '../types/errors';
import { COMMANDS, type CommandName } from './commands';
import type {
  ActiveCashSession,
  AttributeDefinition,
  CashSaleLineInput,
  CashSessionDetail,
  CatalogProduct,
  CreatedProduct,
  CreatedProductWithVariants,
  DashboardSummary,
  DocumentJob,
  FiscalPeriod,
  LoginResult,
  OpenFiscalPeriod,
  ProductDetail,
  ProductListItem,
  ResolvedBarcode,
  SaleDocument,
  SaleLine,
  SetupStatus,
  StockAdjustmentReasonCode,
  StockAdjustmentResult,
  StockAdjustmentUnit,
  ConfirmPurchaseReceiptPayload,
  ConfirmPurchaseReceiptResult,
  CreatePurchaseOrderPayload,
  CreateSupplierPayload,
  PurchaseOrderDetailDto,
  PurchaseOrderSummary,
  PurchaseReceiptSummary,
  Supplier,
  UpdatePurchaseOrderPayload,
  UpdateSupplierPayload,
  Unit,
  VariantInput,
  Warehouse,
} from './dto';

export class GatewayError extends Error {
  readonly code: AppErrorCode;
  constructor(code: AppErrorCode) {
    super(code);
    this.name = 'GatewayError';
    this.code = code;
  }
}

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function getSetupStatus(): Promise<SetupStatus> {
  return call<SetupStatus>(COMMANDS.GET_SETUP_STATUS);
}

export interface BootstrapAdminInput {
  username: string;
  password: string;
  displayName: string;
  workstationId: string;
  warehouseCode: string;
  warehouseName: string;
  periodCode: string;
  periodStartsOn: string;
  periodEndsOn: string;
}

export function bootstrapFirstAdmin(input: BootstrapAdminInput): Promise<number> {
  return call<number>(COMMANDS.BOOTSTRAP_FIRST_ADMIN, {
    username: input.username,
    password: input.password,
    displayName: input.displayName,
    workstationId: input.workstationId,
    warehouseCode: input.warehouseCode,
    warehouseName: input.warehouseName,
    periodCode: input.periodCode,
    periodStartsOn: input.periodStartsOn,
    periodEndsOn: input.periodEndsOn,
  });
}

export function login(username: string, password: string, workstationId: string): Promise<LoginResult> {
  return call<LoginResult>(COMMANDS.LOGIN, { username, password, workstationId });
}

export function logout(sessionToken: string): Promise<void> {
  return call<void>(COMMANDS.LOGOUT, { sessionToken });
}

export function createProduct(sessionToken: string, name: string, sku: string, salePrice: string, isActive: boolean): Promise<CreatedProduct> {
  return call<CreatedProduct>(COMMANDS.CREATE_PRODUCT, { sessionToken, name, sku, salePrice, isActive });
}

export function listProducts(sessionToken: string, warehouseId: number, search?: string): Promise<ProductListItem[]> {
  return call<ProductListItem[]>(COMMANDS.LIST_PRODUCTS, { sessionToken, warehouseId, search: search ?? null });
}

export function createWarehouse(sessionToken: string, code: string, name: string): Promise<number> {
  return call<number>(COMMANDS.CREATE_WAREHOUSE, { sessionToken, code, name });
}

export function listWarehouses(sessionToken: string): Promise<Warehouse[]> {
  return call<Warehouse[]>(COMMANDS.LIST_WAREHOUSES, { sessionToken });
}

export function listFiscalPeriods(sessionToken: string): Promise<FiscalPeriod[]> {
  return call<FiscalPeriod[]>(COMMANDS.LIST_FISCAL_PERIODS, { sessionToken });
}

export function getOpenFiscalPeriod(sessionToken: string): Promise<OpenFiscalPeriod | null> {
  return call<OpenFiscalPeriod | null>(COMMANDS.GET_OPEN_FISCAL_PERIOD, { sessionToken });
}

export function getDashboardSummary(sessionToken: string, workstationId: string): Promise<DashboardSummary> {
  return call<DashboardSummary>(COMMANDS.GET_DASHBOARD_SUMMARY, { sessionToken, workstationId });
}

export interface StockReceiptInput {
  requestId: string;
  warehouseId: number;
  variantId: number;
  quantity: string;
  unitCost: string;
  fiscalPeriodId: number;
  documentDate: string;
}

export function postStockReceipt(sessionToken: string, input: StockReceiptInput): Promise<number> {
  return call<number>(COMMANDS.POST_STOCK_RECEIPT, {
    sessionToken,
    requestId: input.requestId,
    warehouseId: input.warehouseId,
    variantId: input.variantId,
    quantity: input.quantity,
    unitCost: input.unitCost,
    fiscalPeriodId: input.fiscalPeriodId,
    documentDate: input.documentDate,
  });
}

export interface StockAdjustmentInput {
  requestId: string;
  warehouseId: number;
  variantId: number;
  unitId: number;
  quantityDelta: string;
  reasonCode: StockAdjustmentReasonCode;
  note?: string;
  fiscalPeriodId: number;
  documentDate: string;
}

export function confirmStockAdjustment(
  sessionToken: string,
  input: StockAdjustmentInput,
): Promise<StockAdjustmentResult> {
  return call<StockAdjustmentResult>(COMMANDS.CONFIRM_STOCK_ADJUSTMENT, {
    sessionToken,
    requestId: input.requestId,
    warehouseId: input.warehouseId,
    variantId: input.variantId,
    unitId: input.unitId,
    quantityDelta: input.quantityDelta,
    reasonCode: input.reasonCode,
    note: input.note ?? null,
    fiscalPeriodId: input.fiscalPeriodId,
    documentDate: input.documentDate,
  });
}

export function listStockAdjustmentUnits(
  sessionToken: string,
  variantId: number,
): Promise<StockAdjustmentUnit[]> {
  return call<StockAdjustmentUnit[]>(COMMANDS.LIST_STOCK_ADJUSTMENT_UNITS, {
    sessionToken,
    variantId,
  });
}

export function openCashSession(sessionToken: string, warehouseId: number, workstationId: string, openingFloat: string): Promise<number> {
  return call<number>(COMMANDS.OPEN_CASH_SESSION, { sessionToken, warehouseId, workstationId, openingFloat });
}

export function inspectActiveCashSession(sessionToken: string, workstationId: string): Promise<ActiveCashSession | null> {
  return call<ActiveCashSession | null>(COMMANDS.INSPECT_ACTIVE_CASH_SESSION, { sessionToken, workstationId });
}

export function closeCashSession(sessionToken: string, cashSessionId: number, countedAmount: string): Promise<number> {
  return call<number>(COMMANDS.CLOSE_CASH_SESSION, { sessionToken, cashSessionId, countedAmount });
}

export function getCashSession(sessionToken: string, cashSessionId: number): Promise<CashSessionDetail | null> {
  return call<CashSessionDetail | null>(COMMANDS.GET_CASH_SESSION, { sessionToken, cashSessionId });
}

export interface CashSaleInput {
  requestId: string;
  cashSessionId: number;
  warehouseId: number;
  fiscalPeriodId: number;
  documentDate: string;
  lines: CashSaleLineInput[];
}

export function confirmCashSale(sessionToken: string, input: CashSaleInput): Promise<number> {
  return call<number>(COMMANDS.CONFIRM_CASH_SALE, {
    sessionToken,
    requestId: input.requestId,
    cashSessionId: input.cashSessionId,
    warehouseId: input.warehouseId,
    fiscalPeriodId: input.fiscalPeriodId,
    documentDate: input.documentDate,
    lines: input.lines,
  });
}

export function getSaleDocument(sessionToken: string, documentId: number): Promise<SaleDocument | null> {
  return call<SaleDocument | null>(COMMANDS.GET_SALE_DOCUMENT, { sessionToken, documentId });
}

export function listSaleLines(sessionToken: string, documentId: number): Promise<SaleLine[]> {
  return call<SaleLine[]>(COMMANDS.LIST_SALE_LINES, { sessionToken, documentId });
}

export function listDocumentJobs(sessionToken: string, documentId: number): Promise<DocumentJob[]> {
  return call<DocumentJob[]>(COMMANDS.LIST_DOCUMENT_JOBS, { sessionToken, documentId });
}

// Slice 2 — variant catalog gateway wrappers

export function createProductWithVariants(sessionToken: string, name: string, isActive: boolean, variants: VariantInput[]): Promise<CreatedProductWithVariants> {
  return call<CreatedProductWithVariants>(COMMANDS.CREATE_PRODUCT_WITH_VARIANTS, { sessionToken, name, isActive, variants });
}

export function addVariant(sessionToken: string, productId: number, variant: VariantInput): Promise<number> {
  return call<number>(COMMANDS.ADD_VARIANT, { sessionToken, productId, variant });
}

export function updateVariant(sessionToken: string, variantId: number, sku: string, salePrice: string, isActive: boolean): Promise<void> {
  return call<void>(COMMANDS.UPDATE_VARIANT, { sessionToken, variantId, sku, salePrice, isActive });
}

export function setVariantActive(sessionToken: string, variantId: number, isActive: boolean): Promise<void> {
  return call<void>(COMMANDS.SET_VARIANT_ACTIVE, { sessionToken, variantId, isActive });
}

export function updateProduct(sessionToken: string, productId: number, name: string, isActive: boolean): Promise<void> {
  return call<void>(COMMANDS.UPDATE_PRODUCT, { sessionToken, productId, name, isActive });
}

export function createAttribute(sessionToken: string, name: string): Promise<number> {
  return call<number>(COMMANDS.CREATE_ATTRIBUTE, { sessionToken, name });
}

export function addAttributeValue(sessionToken: string, attributeId: number, value: string): Promise<number> {
  return call<number>(COMMANDS.ADD_ATTRIBUTE_VALUE, { sessionToken, attributeId, value });
}

export function listAttributes(sessionToken: string): Promise<AttributeDefinition[]> {
  return call<AttributeDefinition[]>(COMMANDS.LIST_ATTRIBUTES, { sessionToken });
}

export function createUnit(sessionToken: string, code: string, name: string): Promise<number> {
  return call<number>(COMMANDS.CREATE_UNIT, { sessionToken, code, name });
}

export function listUnits(sessionToken: string): Promise<Unit[]> {
  return call<Unit[]>(COMMANDS.LIST_UNITS, { sessionToken });
}

export function setVariantAttributes(sessionToken: string, variantId: number, attributeValueIds: number[]): Promise<void> {
  return call<void>(COMMANDS.SET_VARIANT_ATTRIBUTES, { sessionToken, variantId, attributeValueIds });
}

export function addVariantBarcode(sessionToken: string, variantId: number, barcode: string): Promise<number> {
  return call<number>(COMMANDS.ADD_VARIANT_BARCODE, { sessionToken, variantId, barcode });
}

export function removeVariantBarcode(sessionToken: string, barcodeId: number): Promise<void> {
  return call<void>(COMMANDS.REMOVE_VARIANT_BARCODE, { sessionToken, barcodeId });
}

export function addVariantAltUnit(sessionToken: string, variantId: number, unitId: number, conversionFactor: string): Promise<number> {
  return call<number>(COMMANDS.ADD_VARIANT_ALT_UNIT, { sessionToken, variantId, unitId, conversionFactor });
}

export function removeVariantAltUnit(sessionToken: string, variantUnitId: number): Promise<void> {
  return call<void>(COMMANDS.REMOVE_VARIANT_ALT_UNIT, { sessionToken, variantUnitId });
}

export function setVariantBaseUnit(sessionToken: string, variantId: number, unitId: number): Promise<void> {
  return call<void>(COMMANDS.SET_VARIANT_BASE_UNIT, { sessionToken, variantId, unitId });
}

export async function resolveBarcode(sessionToken: string, barcode: string): Promise<ResolvedBarcode | null> {
  return call<ResolvedBarcode | null>(COMMANDS.RESOLVE_BARCODE, { sessionToken, barcode });
}

export function listCatalogProducts(sessionToken: string, search?: string): Promise<CatalogProduct[]> {
  return call<CatalogProduct[]>(COMMANDS.LIST_CATALOG_PRODUCTS, { sessionToken, search: search ?? null });
}

export function getProductDetail(sessionToken: string, productId: number): Promise<ProductDetail> {
  return call<ProductDetail>(COMMANDS.GET_PRODUCT_DETAIL, { sessionToken, productId });
}

// Slice 3 — Procurement Gateway Methods
export function createSupplier(sessionToken: string, payload: CreateSupplierPayload): Promise<Supplier> {
  return call<Supplier>(COMMANDS.CREATE_SUPPLIER, { sessionToken, payload });
}

export function updateSupplier(sessionToken: string, payload: UpdateSupplierPayload): Promise<Supplier> {
  return call<Supplier>(COMMANDS.UPDATE_SUPPLIER, { sessionToken, payload });
}

export function listSuppliers(sessionToken: string, includeInactive?: boolean): Promise<Supplier[]> {
  return call<Supplier[]>(COMMANDS.LIST_SUPPLIERS, { sessionToken, includeInactive: includeInactive ?? false });
}

export function createPurchaseOrderDraft(sessionToken: string, payload: CreatePurchaseOrderPayload): Promise<unknown> {
  return call(COMMANDS.CREATE_PURCHASE_ORDER_DRAFT, { sessionToken, payload });
}

export function updatePurchaseOrderDraft(sessionToken: string, payload: UpdatePurchaseOrderPayload): Promise<unknown> {
  return call(COMMANDS.UPDATE_PURCHASE_ORDER_DRAFT, { sessionToken, payload });
}

export function confirmPurchaseOrder(sessionToken: string, purchaseOrderId: number): Promise<unknown> {
  return call(COMMANDS.CONFIRM_PURCHASE_ORDER, { sessionToken, purchaseOrderId });
}

export function cancelPurchaseOrder(sessionToken: string, purchaseOrderId: number): Promise<unknown> {
  return call(COMMANDS.CANCEL_PURCHASE_ORDER, { sessionToken, purchaseOrderId });
}

export function listPurchaseOrders(
  sessionToken: string,
  supplierId?: number | null,
  status?: string | null
): Promise<PurchaseOrderSummary[]> {
  return call<PurchaseOrderSummary[]>(COMMANDS.LIST_PURCHASE_ORDERS, {
    sessionToken,
    supplierId: supplierId ?? null,
    status: status ?? null,
  });
}

export function getPurchaseOrderDetail(sessionToken: string, purchaseOrderId: number): Promise<PurchaseOrderDetailDto> {
  return call<PurchaseOrderDetailDto>(COMMANDS.GET_PURCHASE_ORDER_DETAIL, { sessionToken, purchaseOrderId });
}

export function confirmPurchaseReceipt(
  sessionToken: string,
  payload: ConfirmPurchaseReceiptPayload
): Promise<ConfirmPurchaseReceiptResult> {
  return call<ConfirmPurchaseReceiptResult>(COMMANDS.CONFIRM_PURCHASE_RECEIPT, { sessionToken, payload });
}

export function listPurchaseReceipts(
  sessionToken: string,
  supplierId?: number | null,
  purchaseOrderId?: number | null
): Promise<PurchaseReceiptSummary[]> {
  return call<PurchaseReceiptSummary[]>(COMMANDS.LIST_PURCHASE_RECEIPTS, {
    sessionToken,
    supplierId: supplierId ?? null,
    purchaseOrderId: purchaseOrderId ?? null,
  });
}

export function allocateLandedCost(
  sessionToken: string,
  payload: import('./dto').AllocateLandedCostPayload
): Promise<unknown> {
  return call(COMMANDS.ALLOCATE_LANDED_COST, { sessionToken, payload });
}

export function createSupplierInvoiceDraft(
  sessionToken: string,
  payload: import('./dto').CreateSupplierInvoicePayload
): Promise<unknown> {
  return call(COMMANDS.CREATE_SUPPLIER_INVOICE_DRAFT, { sessionToken, payload });
}

export function confirmSupplierInvoice(
  sessionToken: string,
  payload: import('./dto').ConfirmSupplierInvoicePayload
): Promise<unknown> {
  return call(COMMANDS.CONFIRM_SUPPLIER_INVOICE, { sessionToken, payload });
}

export function listSupplierInvoices(
  sessionToken: string,
  supplierId?: number | null
): Promise<import('./dto').SupplierInvoiceSummary[]> {
  return call<import('./dto').SupplierInvoiceSummary[]>(COMMANDS.LIST_SUPPLIER_INVOICES, {
    sessionToken,
    supplierId: supplierId ?? null,
  });
}

export function listSupplierLiabilities(
  sessionToken: string,
  supplierId?: number | null
): Promise<import('./dto').SupplierLiabilityDto[]> {
  return call<import('./dto').SupplierLiabilityDto[]>(COMMANDS.LIST_SUPPLIER_LIABILITIES, {
    sessionToken,
    supplierId: supplierId ?? null,
  });
}

export function createSupplierReturnDraft(
  sessionToken: string,
  payload: import('./dto').CreateSupplierReturnPayload
): Promise<unknown> {
  return call(COMMANDS.CREATE_SUPPLIER_RETURN_DRAFT, { sessionToken, payload });
}

export function confirmSupplierReturn(
  sessionToken: string,
  payload: import('./dto').ConfirmSupplierReturnPayload
): Promise<unknown> {
  return call(COMMANDS.CONFIRM_SUPPLIER_RETURN, { sessionToken, payload });
}

export function postSupplierPayment(
  sessionToken: string,
  payload: import('./dto').PostSupplierPaymentPayload
): Promise<unknown> {
  return call(COMMANDS.POST_SUPPLIER_PAYMENT, { sessionToken, payload });
}

export function listSupplierReturns(
  sessionToken: string,
  supplierId?: number | null
): Promise<import('./dto').SupplierReturnSummary[]> {
  return call<import('./dto').SupplierReturnSummary[]>(COMMANDS.LIST_SUPPLIER_RETURNS, {
    sessionToken,
    supplierId: supplierId ?? null,
  });
}

export function listSupplierPayments(
  sessionToken: string,
  supplierId?: number | null
): Promise<import('./dto').SupplierPaymentDto[]> {
  return call<import('./dto').SupplierPaymentDto[]>(COMMANDS.LIST_SUPPLIER_PAYMENTS, {
    sessionToken,
    supplierId: supplierId ?? null,
  });
}

export function createCustomer(
  sessionToken: string,
  payload: import('./dto').CreateCustomerPayload
): Promise<import('./dto').Customer> {
  return call<import('./dto').Customer>(COMMANDS.CREATE_CUSTOMER, { sessionToken, payload });
}

export function listCustomers(
  sessionToken: string,
  includeInactive?: boolean
): Promise<import('./dto').Customer[]> {
  return call<import('./dto').Customer[]>(COMMANDS.LIST_CUSTOMERS, {
    sessionToken,
    includeInactive: includeInactive ?? false,
  });
}

export function listCustomerLiabilities(
  sessionToken: string,
  customerId?: number | null
): Promise<import('./dto').CustomerLiabilityDto[]> {
  return call<import('./dto').CustomerLiabilityDto[]>(COMMANDS.LIST_CUSTOMER_LIABILITIES, {
    sessionToken,
    customerId: customerId ?? null,
  });
}

export function listCustomerPayments(
  sessionToken: string,
  customerId?: number | null
): Promise<import('./dto').CustomerPaymentDto[]> {
  return call<import('./dto').CustomerPaymentDto[]>(COMMANDS.LIST_CUSTOMER_PAYMENTS, {
    sessionToken,
    customerId: customerId ?? null,
  });
}

export function postCustomerPayment(
  sessionToken: string,
  payload: import('./dto').PostCustomerPaymentPayload
): Promise<unknown> {
  return call(COMMANDS.POST_CUSTOMER_PAYMENT, { sessionToken, payload });
}

export function suspendCashSession(
  sessionToken: string,
  cashSessionId: number
): Promise<unknown> {
  return call(COMMANDS.SUSPEND_CASH_SESSION, { sessionToken, cashSessionId });
}

export function resumeCashSession(
  sessionToken: string,
  cashSessionId: number
): Promise<unknown> {
  return call(COMMANDS.RESUME_CASH_SESSION, { sessionToken, cashSessionId });
}

export function submitSessionClosing(
  sessionToken: string,
  payload: import('./dto').SubmitClosingPayload
): Promise<unknown> {
  return call(COMMANDS.SUBMIT_SESSION_CLOSING, { sessionToken, payload });
}

export function approveSessionVariance(
  sessionToken: string,
  cashSessionId: number,
  managerNote?: string | null
): Promise<unknown> {
  return call(COMMANDS.APPROVE_CASH_VARIANCE, { sessionToken, cashSessionId, managerNote });
}

export function listPendingVarianceSessions(
  sessionToken: string
): Promise<import('./dto').PendingVarianceSessionDto[]> {
  return call<import('./dto').PendingVarianceSessionDto[]>(COMMANDS.LIST_PENDING_VARIANCE_SESSIONS, {
    sessionToken,
  });
}

export function generateCreditOverrideToken(
  sessionToken: string,
  payload: import('./dto').GenerateCreditOverridePayload
): Promise<import('./dto').CreditOverrideTokenResult> {
  return call<import('./dto').CreditOverrideTokenResult>(COMMANDS.GENERATE_CREDIT_OVERRIDE_TOKEN, {
    sessionToken,
    payload,
  });
}

export function confirmCustomerReturn(
  sessionToken: string,
  payload: import('./dto').ConfirmCustomerReturnPayload
): Promise<unknown> {
  return call(COMMANDS.CONFIRM_CUSTOMER_RETURN, { sessionToken, payload });
}

export function confirmWarehouseTransfer(
  sessionToken: string,
  payload: import('./dto').ConfirmWarehouseTransferPayload
): Promise<unknown> {
  return call(COMMANDS.CONFIRM_WAREHOUSE_TRANSFER, { sessionToken, payload });
}

export function confirmStockWriteOff(
  sessionToken: string,
  payload: import('./dto').ConfirmStockWriteOffPayload
): Promise<unknown> {
  return call(COMMANDS.CONFIRM_STOCK_WRITEOFF, { sessionToken, payload });
}

export function listCustomerReturns(
  sessionToken: string
): Promise<import('./dto').CustomerReturnDto[]> {
  return call<import('./dto').CustomerReturnDto[]>(COMMANDS.LIST_CUSTOMER_RETURNS, {
    sessionToken,
  });
}

export function listWarehouseTransfers(
  sessionToken: string
): Promise<import('./dto').WarehouseTransferDto[]> {
  return call<import('./dto').WarehouseTransferDto[]>(COMMANDS.LIST_WAREHOUSE_TRANSFERS, {
    sessionToken,
  });
}

export function listStockWriteOffs(
  sessionToken: string
): Promise<import('./dto').StockWriteOffDto[]> {
  return call<import('./dto').StockWriteOffDto[]>(COMMANDS.LIST_STOCK_WRITEOFFS, {
    sessionToken,
  });
}

export function enqueuePrintJob(
  sessionToken: string,
  payload: import('./dto').EnqueuePrintJobPayload
): Promise<number> {
  return call<number>(COMMANDS.ENQUEUE_PRINT_JOB, { sessionToken, payload });
}

export function listPrintJobs(
  sessionToken: string
): Promise<import('./dto').PrintJobDto[]> {
  return call<import('./dto').PrintJobDto[]>(COMMANDS.LIST_PRINT_JOBS, {
    sessionToken,
  });
}

export function updatePrintJobStatus(
  sessionToken: string,
  payload: import('./dto').UpdatePrintJobStatusPayload
): Promise<void> {
  return call<void>(COMMANDS.UPDATE_PRINT_JOB_STATUS, { sessionToken, payload });
}

export function createImportBatch(
  sessionToken: string,
  payload: import('./dto').CreateImportBatchPayload
): Promise<unknown> {
  return call(COMMANDS.CREATE_IMPORT_BATCH, { sessionToken, payload });
}

export function listImportBatches(
  sessionToken: string
): Promise<import('./dto').ImportBatchDto[]> {
  return call<import('./dto').ImportBatchDto[]>(COMMANDS.LIST_IMPORT_BATCHES, {
    sessionToken,
  });
}

export function getStagedRecords(
  sessionToken: string,
  batchId: string
): Promise<import('./dto').StagedRecordDto[]> {
  return call<import('./dto').StagedRecordDto[]>(COMMANDS.GET_STAGED_RECORDS, {
    sessionToken,
    batchId,
  });
}

export function updateStagedRecord(
  sessionToken: string,
  payload: import('./dto').UpdateStagedRecordPayload
): Promise<unknown> {
  return call(COMMANDS.UPDATE_STAGED_RECORD, { sessionToken, payload });
}

export function replayHistoricalBatch(
  sessionToken: string,
  batchId: string
): Promise<import('./dto').ReplayResultDto> {
  return call<import('./dto').ReplayResultDto>(COMMANDS.REPLAY_HISTORICAL_BATCH, {
    sessionToken,
    batchId,
  });
}

export function commitHistoricalBatch(
  sessionToken: string,
  batchId: string
): Promise<import('./dto').CommitBatchResultDto> {
  return call<import('./dto').CommitBatchResultDto>(COMMANDS.COMMIT_HISTORICAL_BATCH, {
    sessionToken,
    batchId,
  });
}



