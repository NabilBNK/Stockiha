import { invoke } from '@tauri-apps/api/core';

import { COMMANDS } from './commands';
import type {
  AccountLedger,
  CashFlow,
  CustomerStatement,
  MarginAlerts,
  MonthlySummary,
  ProfitAndLoss,
  ReceivablesAging,
  ReportAccountsList,
  ReportsCapabilities,
  SalesByCashier,
  SalesByCategory,
  SalesByHour,
  SalesByProduct,
  SalesSummary,
  SalesTimeseries,
  SupplierBalances,
  SupplierStatement,
  TrialBalance,
} from './reportsDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

export async function getReportsCapabilities(
  sessionToken: string,
): Promise<ReportsCapabilities> {
  try {
    return await invoke<ReportsCapabilities>(COMMANDS.GET_REPORTS_CAPABILITIES, {
      sessionToken,
    });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function getSalesSummary(
  sessionToken: string,
  dateFrom: string,
  dateTo: string,
): Promise<SalesSummary> {
  return invoke<SalesSummary>(COMMANDS.GET_SALES_SUMMARY, {
    sessionToken,
    dateFrom,
    dateTo,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getSalesTimeseries(
  sessionToken: string,
  dateFrom: string,
  dateTo: string,
  granularity: 'DAY' | 'WEEK' | 'MONTH',
): Promise<SalesTimeseries> {
  return invoke<SalesTimeseries>(COMMANDS.GET_SALES_TIMESERIES, {
    sessionToken,
    dateFrom,
    dateTo,
    granularity,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getSalesByProduct(
  sessionToken: string,
  dateFrom: string,
  dateTo: string,
  sort: 'REVENUE' | 'QUANTITY' | 'PROFIT' | 'MARGIN',
  search: string | null,
  limit: number,
  offset: number,
): Promise<SalesByProduct> {
  return invoke<SalesByProduct>(COMMANDS.GET_SALES_BY_PRODUCT, {
    sessionToken,
    dateFrom,
    dateTo,
    sort,
    search,
    limit,
    offset,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getSalesByCategory(
  sessionToken: string,
  dateFrom: string,
  dateTo: string,
): Promise<SalesByCategory> {
  return invoke<SalesByCategory>(COMMANDS.GET_SALES_BY_CATEGORY, {
    sessionToken,
    dateFrom,
    dateTo,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getSalesByCashier(
  sessionToken: string,
  dateFrom: string,
  dateTo: string,
): Promise<SalesByCashier> {
  return invoke<SalesByCashier>(COMMANDS.GET_SALES_BY_CASHIER, {
    sessionToken,
    dateFrom,
    dateTo,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getSalesByHour(
  sessionToken: string,
  dateFrom: string,
  dateTo: string,
): Promise<SalesByHour> {
  return invoke<SalesByHour>(COMMANDS.GET_SALES_BY_HOUR, {
    sessionToken,
    dateFrom,
    dateTo,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getMarginAlerts(
  sessionToken: string,
  dateFrom: string,
  dateTo: string,
  thresholdPct: number,
): Promise<MarginAlerts> {
  return invoke<MarginAlerts>(COMMANDS.GET_MARGIN_ALERTS, {
    sessionToken,
    dateFrom,
    dateTo,
    thresholdPct,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

// WS-I-2 — finance, money owed and accountant reports.

export function getProfitAndLoss(
  sessionToken: string,
  dateFrom: string,
  dateTo: string,
): Promise<ProfitAndLoss> {
  return invoke<ProfitAndLoss>(COMMANDS.GET_PROFIT_AND_LOSS, {
    sessionToken,
    dateFrom,
    dateTo,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getCashFlow(sessionToken: string, dateFrom: string, dateTo: string): Promise<CashFlow> {
  return invoke<CashFlow>(COMMANDS.GET_CASH_FLOW, {
    sessionToken,
    dateFrom,
    dateTo,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getMonthlySummary(
  sessionToken: string,
  year: number,
  month: number,
): Promise<MonthlySummary> {
  return invoke<MonthlySummary>(COMMANDS.GET_MONTHLY_SUMMARY, {
    sessionToken,
    year,
    month,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getReceivablesAging(
  sessionToken: string,
  search: string | null,
  limit: number,
  offset: number,
): Promise<ReceivablesAging> {
  return invoke<ReceivablesAging>(COMMANDS.GET_RECEIVABLES_AGING, {
    sessionToken,
    search,
    limit,
    offset,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getCustomerStatement(
  sessionToken: string,
  customerId: number,
  dateFrom: string,
  dateTo: string,
): Promise<CustomerStatement> {
  return invoke<CustomerStatement>(COMMANDS.GET_CUSTOMER_STATEMENT, {
    sessionToken,
    customerId,
    dateFrom,
    dateTo,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getSupplierBalances(
  sessionToken: string,
  search: string | null,
  limit: number,
  offset: number,
): Promise<SupplierBalances> {
  return invoke<SupplierBalances>(COMMANDS.GET_SUPPLIER_BALANCES, {
    sessionToken,
    search,
    limit,
    offset,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getSupplierStatement(
  sessionToken: string,
  supplierId: number,
  dateFrom: string,
  dateTo: string,
): Promise<SupplierStatement> {
  return invoke<SupplierStatement>(COMMANDS.GET_SUPPLIER_STATEMENT, {
    sessionToken,
    supplierId,
    dateFrom,
    dateTo,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getTrialBalance(
  sessionToken: string,
  dateFrom: string,
  dateTo: string,
): Promise<TrialBalance> {
  return invoke<TrialBalance>(COMMANDS.GET_TRIAL_BALANCE, {
    sessionToken,
    dateFrom,
    dateTo,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function getAccountLedger(
  sessionToken: string,
  accountId: number,
  dateFrom: string,
  dateTo: string,
  limit: number,
  offset: number,
): Promise<AccountLedger> {
  return invoke<AccountLedger>(COMMANDS.GET_ACCOUNT_LEDGER, {
    sessionToken,
    accountId,
    dateFrom,
    dateTo,
    limit,
    offset,
  }).catch((error: unknown) => {
    throw new GatewayError(parseTauriError(error));
  });
}

export function listReportAccounts(sessionToken: string): Promise<ReportAccountsList> {
  return invoke<ReportAccountsList>(COMMANDS.LIST_REPORT_ACCOUNTS, { sessionToken }).catch(
    (error: unknown) => {
      throw new GatewayError(parseTauriError(error));
    },
  );
}
