import { invoke } from '@tauri-apps/api/core';

import { COMMANDS, type CommandName } from './commands';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';
import type {
  CreditOverrideInput,
  CreditSaleInput,
  CreditSaleResult,
} from './creditSaleDto';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function confirmCreditSale(
  sessionToken: string,
  input: CreditSaleInput,
): Promise<CreditSaleResult> {
  return call<CreditSaleResult>(COMMANDS.CONFIRM_CREDIT_SALE, {
    sessionToken,
    requestId: input.request_id,
    customerId: input.customer_id,
    warehouseId: input.warehouse_id,
    fiscalPeriodId: input.fiscal_period_id,
    documentDate: input.document_date,
    lines: input.lines,
    overrideToken: input.override_token ?? null,
  });
}

export function authorizeCreditOverride(
  sessionToken: string,
  input: CreditOverrideInput,
): Promise<string> {
  return call<string>(COMMANDS.AUTHORIZE_CREDIT_OVERRIDE, {
    sessionToken,
    tokenId: input.token_id,
    customerId: input.customer_id,
    warehouseId: input.warehouse_id,
    fiscalPeriodId: input.fiscal_period_id,
    documentDate: input.document_date,
    lines: input.lines,
    reason: input.reason,
    ttlMinutes: input.ttl_minutes ?? 15,
  });
}
