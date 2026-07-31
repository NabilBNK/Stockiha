import { invoke } from '@tauri-apps/api/core';

import { parseTauriError } from '../utils/tauriError';
import type { AppErrorCode } from '../types/errors';
import { COMMANDS } from './commands';
import type {
  CashDenomination,
  CashSessionCloseResult,
  CurrentCashSession,
  DenominationCountInput,
} from './cashSessionDto';

export class CashSessionGatewayError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode) {
    super(code);
    this.name = 'CashSessionGatewayError';
    this.code = code;
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new CashSessionGatewayError(parseTauriError(error));
  }
}

export function inspectCurrentCashSession(
  sessionToken: string,
  workstationId: string,
): Promise<CurrentCashSession | null> {
  return call<CurrentCashSession | null>(COMMANDS.INSPECT_CURRENT_CASH_SESSION, {
    sessionToken,
    workstationId,
  });
}

export function listCashDenominations(sessionToken: string): Promise<CashDenomination[]> {
  return call<CashDenomination[]>(COMMANDS.LIST_CASH_DENOMINATIONS, { sessionToken });
}

export function beginCashSessionClose(sessionToken: string, cashSessionId: number): Promise<number> {
  return call<number>(COMMANDS.BEGIN_CASH_SESSION_CLOSE, { sessionToken, cashSessionId });
}

export function cancelCashSessionClose(sessionToken: string, cashSessionId: number): Promise<number> {
  return call<number>(COMMANDS.CANCEL_CASH_SESSION_CLOSE, { sessionToken, cashSessionId });
}

export function submitCashSessionCount(
  sessionToken: string,
  cashSessionId: number,
  counts: DenominationCountInput[],
): Promise<CashSessionCloseResult> {
  return call<CashSessionCloseResult>(COMMANDS.SUBMIT_CASH_SESSION_COUNT, {
    sessionToken,
    cashSessionId,
    counts,
  });
}

export function approveCashSessionVariance(
  sessionToken: string,
  cashSessionId: number,
  closeAttemptId: number,
  reason: string,
): Promise<CashSessionCloseResult> {
  return call<CashSessionCloseResult>(COMMANDS.APPROVE_CASH_SESSION_VARIANCE, {
    sessionToken,
    cashSessionId,
    closeAttemptId,
    reason,
  });
}

export function suspendCashSession(
  sessionToken: string,
  cashSessionId: number,
  reason: string,
): Promise<number> {
  return call<number>(COMMANDS.SUSPEND_CASH_SESSION, { sessionToken, cashSessionId, reason });
}

export function resumeCashSession(sessionToken: string, cashSessionId: number): Promise<number> {
  return call<number>(COMMANDS.RESUME_CASH_SESSION, { sessionToken, cashSessionId });
}

export function handoverCashSession(
  sessionToken: string,
  cashSessionId: number,
  targetUsername: string,
  reason: string,
): Promise<number> {
  return call<number>(COMMANDS.HANDOVER_CASH_SESSION, {
    sessionToken,
    cashSessionId,
    targetUsername,
    reason,
  });
}
