import { invoke } from '@tauri-apps/api/core';

import { COMMANDS } from './commands';
import type {
  MarginAlerts,
  ReportsCapabilities,
  SalesByCashier,
  SalesByCategory,
  SalesByHour,
  SalesByProduct,
  SalesSummary,
  SalesTimeseries,
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
