import { invoke } from '@tauri-apps/api/core';

import { COMMANDS, type CommandName } from './commands';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';
import type {
  CustomerPaymentResult,
  OpenCustomerInvoice,
  PostCustomerPaymentPayload,
} from './receivablesDto';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function listOpenCustomerInvoices(
  sessionToken: string,
  customerId: number,
): Promise<OpenCustomerInvoice[]> {
  return call<OpenCustomerInvoice[]>(COMMANDS.LIST_OPEN_CUSTOMER_INVOICES, {
    sessionToken,
    customerId,
  });
}

export function postCustomerPayment(
  sessionToken: string,
  payload: PostCustomerPaymentPayload,
): Promise<CustomerPaymentResult> {
  return call<CustomerPaymentResult>(COMMANDS.POST_CUSTOMER_PAYMENT, {
    sessionToken,
    payload,
  });
}
