import { invoke } from '@tauri-apps/api/core';

import { COMMANDS, type CommandName } from './commands';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';
import type {
  DashboardAgingRow,
  DashboardBusyCell,
  DashboardCategoryRow,
  DashboardDebtor,
  DashboardLatestSale,
  DashboardMoneySummary,
  DashboardPeriod,
  DashboardPeriodKind,
  DashboardSeriesRow,
  DashboardStockItem,
  DashboardStockSummary,
  DashboardTopCustomer,
  DashboardTopItem,
  DashboardWindow,
  SeriesBucket,
  StockItemKind,
} from './dashboardDto';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function getDashboardPeriod(
  sessionToken: string,
  period: DashboardPeriodKind,
  from?: string | null,
  to?: string | null,
): Promise<DashboardPeriod> {
  return call<DashboardPeriod>(COMMANDS.DASHBOARD_GET_PERIOD, {
    sessionToken,
    period,
    from: from ?? null,
    to: to ?? null,
  });
}

export function getDashboardMoneySummary(
  sessionToken: string,
  window: DashboardWindow,
): Promise<DashboardMoneySummary> {
  return call<DashboardMoneySummary>(COMMANDS.DASHBOARD_GET_MONEY_SUMMARY, {
    sessionToken,
    curFrom: window.curFrom,
    curTo: window.curTo,
    prevFrom: window.prevFrom,
    prevTo: window.prevTo,
    cutTime: window.cutTime ?? null,
  });
}

export function getDashboardStockSummary(
  sessionToken: string,
  deadDays: number,
): Promise<DashboardStockSummary> {
  return call<DashboardStockSummary>(COMMANDS.DASHBOARD_GET_STOCK_SUMMARY, {
    sessionToken,
    deadDays,
  });
}

export function listDashboardStockItems(
  sessionToken: string,
  kind: StockItemKind,
  deadDays: number,
  limit: number,
  offset: number,
): Promise<DashboardStockItem[]> {
  return call<DashboardStockItem[]>(COMMANDS.DASHBOARD_LIST_STOCK_ITEMS, {
    sessionToken,
    kind,
    deadDays,
    limit,
    offset,
  });
}

export function listDashboardTopItems(
  sessionToken: string,
  from: string,
  to: string,
  limit: number,
): Promise<DashboardTopItem[]> {
  return call<DashboardTopItem[]>(COMMANDS.DASHBOARD_LIST_TOP_ITEMS, {
    sessionToken,
    from,
    to,
    limit,
  });
}

export function listDashboardTopCustomers(
  sessionToken: string,
  from: string,
  to: string,
): Promise<DashboardTopCustomer[]> {
  return call<DashboardTopCustomer[]>(COMMANDS.DASHBOARD_LIST_TOP_CUSTOMERS, {
    sessionToken,
    from,
    to,
  });
}

export function listDashboardTopDebtors(sessionToken: string): Promise<DashboardDebtor[]> {
  return call<DashboardDebtor[]>(COMMANDS.DASHBOARD_LIST_TOP_DEBTORS, {
    sessionToken,
  });
}

export function listDashboardLatestSales(sessionToken: string): Promise<DashboardLatestSale[]> {
  return call<DashboardLatestSale[]>(COMMANDS.DASHBOARD_LIST_LATEST_SALES, {
    sessionToken,
  });
}

export function getDashboardSalesSeries(
  sessionToken: string,
  from: string,
  to: string,
  bucket: SeriesBucket,
): Promise<DashboardSeriesRow[]> {
  return call<DashboardSeriesRow[]>(COMMANDS.DASHBOARD_GET_SALES_SERIES, {
    sessionToken,
    from,
    to,
    bucket,
  });
}

export function getDashboardSalesByCategory(
  sessionToken: string,
  from: string,
  to: string,
): Promise<DashboardCategoryRow[]> {
  return call<DashboardCategoryRow[]>(COMMANDS.DASHBOARD_GET_SALES_BY_CATEGORY, {
    sessionToken,
    from,
    to,
  });
}

export function getDashboardBusyHours(
  sessionToken: string,
  from: string,
  to: string,
): Promise<DashboardBusyCell[]> {
  return call<DashboardBusyCell[]>(COMMANDS.DASHBOARD_GET_BUSY_HOURS, {
    sessionToken,
    from,
    to,
  });
}

export function getDashboardReceivablesAging(sessionToken: string): Promise<DashboardAgingRow[]> {
  return call<DashboardAgingRow[]>(COMMANDS.DASHBOARD_GET_RECEIVABLES_AGING, {
    sessionToken,
  });
}
