/**
 * S0-002 — Defensive parsing of unknown Tauri rejection values.
 *
 * Tauri command rejections arrive as `unknown`. Only an allowlisted public
 * backend code is accepted; raw messages/details/stacks are never rendered.
 */

import {
  UNKNOWN_ERROR,
  ERROR_MESSAGE_KEYS,
  isBackendErrorCode,
  type AppErrorCode,
  type ErrorMessageKey,
} from '../types/errors';

export function parseTauriError(error: unknown): AppErrorCode {
  if (typeof error !== 'object' || error === null) {
    return UNKNOWN_ERROR;
  }

  let code: unknown;
  try {
    if (Array.isArray(error)) {
      return UNKNOWN_ERROR;
    }
    code = Reflect.get(error, 'code');
  } catch {
    return UNKNOWN_ERROR;
  }

  return isBackendErrorCode(code) ? code : UNKNOWN_ERROR;
}

const SAFE_MESSAGES: Record<AppErrorCode, string> = {
  INTERNAL_ERROR: 'An internal error occurred. Please try again.',
  CONFIGURATION_ERROR: 'The application configuration is missing or invalid.',
  DATABASE_UNAVAILABLE: 'The database is currently unavailable.',
  SESSION_INVALID: 'Your session has expired. Please sign in again.',
  PERMISSION_DENIED: 'You do not have permission to perform this action.',
  VALIDATION_ERROR: 'Some of the entered values are invalid.',
  PRECONDITION_FAILED: 'This action is not allowed in the current state.',
  BACKUP_CREATION_FAILED: 'The backup could not be created.',
  BACKUP_VALIDATION_FAILED: 'The backup could not be validated.',
  IDEMPOTENCY_CONFLICT: 'This request conflicts with a previous one. Start over.',
  IMMUTABLE_RECORD: 'This record has been finalized and cannot be changed.',
  UNSAFE_ZERO_STOCK_VALUATION: 'This increase cannot be valued because the item has no usable WAC.',
  CREDIT_POLICY_BLOCKED: 'Customer credit policy blocks this sale.',
  INSUFFICIENT_STOCK: 'There is not enough stock on hand for this operation.',
  CORRECTIONS_DISABLED: 'Inventory corrections are disabled by the current policy.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};

export function resolveErrorMessage(error: unknown): string {
  return SAFE_MESSAGES[parseTauriError(error)];
}

export function resolveErrorMessageKey(error: unknown): ErrorMessageKey {
  return ERROR_MESSAGE_KEYS[parseTauriError(error)];
}
