import { invoke } from '@tauri-apps/api/core';

import { parseTauriError } from '../utils/tauriError';
import type { AppErrorCode } from '../types/errors';
import { COMMANDS } from './commands';
import type { SaleVoidResult, SessionSale, VoidReason } from './saleVoidDto';

export class SaleVoidGatewayError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode) {
    super(code);
    this.name = 'SaleVoidGatewayError';
    this.code = code;
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new SaleVoidGatewayError(parseTauriError(error));
  }
}

export function voidSale(
  sessionToken: string,
  documentId: number,
  reasonCode: VoidReason,
  note: string | null,
): Promise<SaleVoidResult> {
  return call<SaleVoidResult>(COMMANDS.VOID_SALE, { sessionToken, documentId, reasonCode, note });
}

export function listSessionSales(sessionToken: string, cashSessionId: number): Promise<SessionSale[]> {
  return call<SessionSale[]>(COMMANDS.LIST_SESSION_SALES, { sessionToken, cashSessionId });
}
