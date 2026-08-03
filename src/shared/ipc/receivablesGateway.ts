import { invoke } from '@tauri-apps/api/core';

import { COMMANDS, type CommandName } from './commands';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';
import type {
  AuthorizeCustomerRefundPayload,
  CustomerPaymentResult,
  CustomerRefundResult,
  OpenCustomerInvoice,
  PostCustomerPaymentPayload,
  PostCustomerRefundPayload,
  RefundableCustomerPayment,
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

export function listRefundableCustomerPayments(
  sessionToken: string,
  customerId: number,
): Promise<RefundableCustomerPayment[]> {
  return call<RefundableCustomerPayment[]>(COMMANDS.LIST_REFUNDABLE_CUSTOMER_PAYMENTS, {
    sessionToken,
    customerId,
  });
}

export function authorizeCustomerPaymentRefund(
  sessionToken: string,
  payload: AuthorizeCustomerRefundPayload,
): Promise<string> {
  return call<string>(COMMANDS.AUTHORIZE_CUSTOMER_PAYMENT_REFUND, {
    sessionToken,
    payload,
  });
}

export function postCustomerRefund(
  sessionToken: string,
  payload: PostCustomerRefundPayload,
): Promise<CustomerRefundResult> {
  return call<CustomerRefundResult>(COMMANDS.POST_CUSTOMER_REFUND, {
    sessionToken,
    payload,
  });
}
