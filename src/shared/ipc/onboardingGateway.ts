import { invoke } from '@tauri-apps/api/core';

import { COMMANDS, type CommandName } from './commands';
import type {
  CreateHistoricalFinanceBatchRequest,
  HistoricalFinanceApprovalResult,
  HistoricalFinanceBatchDataResult,
  HistoricalFinanceBatchIdRequest,
  HistoricalFinanceBatchResult,
  HistoricalFinanceSettingResult,
  HistoricalFinanceSummaryRequest,
  HistoricalFinanceSummaryResult,
  HistoricalFinanceValidationResult,
  ReplaceHistoricalFinanceBatchDataRequest,
  UpdateHistoricalFinanceSettingRequest,
} from './onboardingDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function getHistoricalFinanceSetting(
  sessionToken: string,
): Promise<HistoricalFinanceSettingResult> {
  return call<HistoricalFinanceSettingResult>(COMMANDS.GET_HISTORICAL_FINANCE_SETTING, {
    sessionToken,
  });
}

export function updateHistoricalFinanceSetting(
  sessionToken: string,
  request: UpdateHistoricalFinanceSettingRequest,
): Promise<HistoricalFinanceSettingResult> {
  return call<HistoricalFinanceSettingResult>(COMMANDS.UPDATE_HISTORICAL_FINANCE_SETTING, {
    sessionToken,
    request,
  });
}

export function createHistoricalFinanceBatch(
  sessionToken: string,
  request: CreateHistoricalFinanceBatchRequest,
): Promise<HistoricalFinanceBatchResult> {
  return call<HistoricalFinanceBatchResult>(COMMANDS.CREATE_HISTORICAL_FINANCE_BATCH, {
    sessionToken,
    request,
  });
}

export function replaceHistoricalFinanceBatchData(
  sessionToken: string,
  request: ReplaceHistoricalFinanceBatchDataRequest,
): Promise<HistoricalFinanceBatchDataResult> {
  return call<HistoricalFinanceBatchDataResult>(COMMANDS.REPLACE_HISTORICAL_FINANCE_BATCH_DATA, {
    sessionToken,
    request,
  });
}

export function validateHistoricalFinanceBatch(
  sessionToken: string,
  request: HistoricalFinanceBatchIdRequest,
): Promise<HistoricalFinanceValidationResult> {
  return call<HistoricalFinanceValidationResult>(COMMANDS.VALIDATE_HISTORICAL_FINANCE_BATCH, {
    sessionToken,
    request,
  });
}

export function approveHistoricalFinanceBatch(
  sessionToken: string,
  request: HistoricalFinanceBatchIdRequest,
): Promise<HistoricalFinanceApprovalResult> {
  return call<HistoricalFinanceApprovalResult>(COMMANDS.APPROVE_HISTORICAL_FINANCE_BATCH, {
    sessionToken,
    request,
  });
}

export function getHistoricalFinanceSummary(
  sessionToken: string,
  request: HistoricalFinanceSummaryRequest,
): Promise<HistoricalFinanceSummaryResult> {
  return call<HistoricalFinanceSummaryResult>(COMMANDS.GET_HISTORICAL_FINANCE_SUMMARY, {
    sessionToken,
    request,
  });
}
