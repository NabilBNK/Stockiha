import { invoke } from '@tauri-apps/api/core';

import { GatewayError } from './gateway';
import { COMMANDS, type CommandName } from './commands';
import { parseTauriError } from '../utils/tauriError';
import type {
  CreateCustomerPayload,
  Customer,
  CustomerCreditSummary,
  CustomerLedgerEntry,
  UpdateCustomerPayload,
} from './customerDto';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function createCustomer(sessionToken: string, payload: CreateCustomerPayload): Promise<Customer> {
  return call<Customer>(COMMANDS.CREATE_CUSTOMER, { sessionToken, payload });
}

export function updateCustomer(sessionToken: string, payload: UpdateCustomerPayload): Promise<Customer> {
  return call<Customer>(COMMANDS.UPDATE_CUSTOMER, { sessionToken, payload });
}

export function listCustomers(sessionToken: string, includeInactive = false): Promise<Customer[]> {
  return call<Customer[]>(COMMANDS.LIST_CUSTOMERS, { sessionToken, includeInactive });
}

export function getCustomerCreditSummary(
  sessionToken: string,
  customerId: number,
): Promise<CustomerCreditSummary> {
  return call<CustomerCreditSummary>(COMMANDS.GET_CUSTOMER_CREDIT_SUMMARY, {
    sessionToken,
    customerId,
  });
}

export function listCustomerLedger(
  sessionToken: string,
  customerId: number,
  limit = 100,
): Promise<CustomerLedgerEntry[]> {
  return call<CustomerLedgerEntry[]>(COMMANDS.LIST_CUSTOMER_LEDGER, {
    sessionToken,
    customerId,
    limit,
  });
}
