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
