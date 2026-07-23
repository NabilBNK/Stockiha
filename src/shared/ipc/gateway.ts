/**
 * Slice 1 — the single typed gateway for every Tauri IPC command.
 *
 * Design rules (enforced by keeping ALL `invoke` calls here):
 * - No `invoke()` anywhere else in the UI; components call these functions.
 * - Every rejection is normalized to a stable {@link AppErrorCode} via
 *   {@link parseTauriError} and re-thrown as {@link GatewayError} — raw
 *   backend diagnostics, SQL, paths, and stack traces never reach the UI.
 * - Exact-decimal arguments (price, quantity, cost, float, counted amount)
 *   are sent as STRINGS, never JS numbers, so no authoritative value passes
 *   through IEEE-754. `rust_decimal` deserializes these strings exactly.
 * - Client request UUIDs for idempotent posting are generated here.
 *
 * Casing note (requires Windows/Tauri verification): Tauri v2 maps
 * camelCase JS command-argument keys to snake_case Rust parameters, so the
 * top-level arg objects below use camelCase. Nested payload objects (the
 * cash-sale `lines`) are deserialized by serde directly and therefore use
 * snake_case field names. Response payloads are snake_case (serde default),
 * matching the DTOs in `./dto`.
 */
import { invoke } from '@tauri-apps/api/core';

import { parseTauriError } from '../utils/tauriError';
import type { AppErrorCode } from '../types/errors';
import { COMMANDS, type CommandName } from './commands';
import type {
  ActiveCashSession,
  CashSaleLineInput,
  CashSessionDetail,
  CreatedProduct,
  DashboardSummary,
  DocumentJob,
  FiscalPeriod,
  LoginResult,
  OpenFiscalPeriod,
  ProductListItem,
  SaleDocument,
  SaleLine,
  SetupStatus,
  Warehouse,
} from './dto';

/** A safe, UI-facing error carrying only a normalized code (never raw text). */
export class GatewayError extends Error {
  readonly code: AppErrorCode;
  constructor(code: AppErrorCode) {
    super(code);
    this.name = 'GatewayError';
    this.code = code;
  }
}

/** Invoke a command, normalizing any rejection to a {@link GatewayError}. */
async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

/** Generates a client request UUID for idempotent posting commands. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

// ---- Setup (unauthenticated) ---------------------------------------------

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

// ---- Auth ----------------------------------------------------------------

export function login(
  username: string,
  password: string,
  workstationId: string,
): Promise<LoginResult> {
  return call<LoginResult>(COMMANDS.LOGIN, { username, password, workstationId });
}

export function logout(sessionToken: string): Promise<void> {
  return call<void>(COMMANDS.LOGOUT, { sessionToken });
}

// ---- Catalog -------------------------------------------------------------

export function createProduct(
  sessionToken: string,
  name: string,
  sku: string,
  salePrice: string,
  isActive: boolean,
): Promise<CreatedProduct> {
  return call<CreatedProduct>(COMMANDS.CREATE_PRODUCT, {
    sessionToken,
    name,
    sku,
    salePrice,
    isActive,
  });
}

export function listProducts(
  sessionToken: string,
  warehouseId: number,
  search?: string,
): Promise<ProductListItem[]> {
  return call<ProductListItem[]>(COMMANDS.LIST_PRODUCTS, {
    sessionToken,
    warehouseId,
    search: search ?? null,
  });
}

// ---- Warehouses ----------------------------------------------------------

export function createWarehouse(
  sessionToken: string,
  code: string,
  name: string,
): Promise<number> {
  return call<number>(COMMANDS.CREATE_WAREHOUSE, { sessionToken, code, name });
}

export function listWarehouses(sessionToken: string): Promise<Warehouse[]> {
  return call<Warehouse[]>(COMMANDS.LIST_WAREHOUSES, { sessionToken });
}

// ---- Reference data + dashboard ------------------------------------------

export function listFiscalPeriods(sessionToken: string): Promise<FiscalPeriod[]> {
  return call<FiscalPeriod[]>(COMMANDS.LIST_FISCAL_PERIODS, { sessionToken });
}

export function getOpenFiscalPeriod(sessionToken: string): Promise<OpenFiscalPeriod | null> {
  return call<OpenFiscalPeriod | null>(COMMANDS.GET_OPEN_FISCAL_PERIOD, { sessionToken });
}

export function getDashboardSummary(
  sessionToken: string,
  workstationId: string,
): Promise<DashboardSummary> {
  return call<DashboardSummary>(COMMANDS.GET_DASHBOARD_SUMMARY, { sessionToken, workstationId });
}

// ---- Posting: stock receipt ----------------------------------------------

export interface StockReceiptInput {
  requestId: string;
  warehouseId: number;
  variantId: number;
  quantity: string;
  unitCost: string;
  fiscalPeriodId: number;
  documentDate: string;
}

export function postStockReceipt(
  sessionToken: string,
  input: StockReceiptInput,
): Promise<number> {
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

// ---- Cash session --------------------------------------------------------

export function openCashSession(
  sessionToken: string,
  warehouseId: number,
  workstationId: string,
  openingFloat: string,
): Promise<number> {
  return call<number>(COMMANDS.OPEN_CASH_SESSION, {
    sessionToken,
    warehouseId,
    workstationId,
    openingFloat,
  });
}

export function inspectActiveCashSession(
  sessionToken: string,
  workstationId: string,
): Promise<ActiveCashSession | null> {
  return call<ActiveCashSession | null>(COMMANDS.INSPECT_ACTIVE_CASH_SESSION, {
    sessionToken,
    workstationId,
  });
}

export function closeCashSession(
  sessionToken: string,
  cashSessionId: number,
  countedAmount: string,
): Promise<number> {
  return call<number>(COMMANDS.CLOSE_CASH_SESSION, {
    sessionToken,
    cashSessionId,
    countedAmount,
  });
}

export function getCashSession(
  sessionToken: string,
  cashSessionId: number,
): Promise<CashSessionDetail | null> {
  return call<CashSessionDetail | null>(COMMANDS.GET_CASH_SESSION, {
    sessionToken,
    cashSessionId,
  });
}

// ---- Posting: cash sale --------------------------------------------------

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
    // Nested payload: serde deserializes these by snake_case field name.
    lines: input.lines,
  });
}

// ---- Posted documents / jobs ---------------------------------------------

export function getSaleDocument(
  sessionToken: string,
  documentId: number,
): Promise<SaleDocument | null> {
  return call<SaleDocument | null>(COMMANDS.GET_SALE_DOCUMENT, { sessionToken, documentId });
}

export function listSaleLines(sessionToken: string, documentId: number): Promise<SaleLine[]> {
  return call<SaleLine[]>(COMMANDS.LIST_SALE_LINES, { sessionToken, documentId });
}

export function listDocumentJobs(
  sessionToken: string,
  documentId: number,
): Promise<DocumentJob[]> {
  return call<DocumentJob[]>(COMMANDS.LIST_DOCUMENT_JOBS, { sessionToken, documentId });
}
