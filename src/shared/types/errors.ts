/**
 * Frontend allowlist for the backend's redacted `{ code }` IPC error contract.
 * Keep this in lockstep with Rust `ErrorCode`.
 */
export const BACKEND_ERROR_CODES = [
  'INTERNAL_ERROR',
  'CONFIGURATION_ERROR',
  'DATABASE_UNAVAILABLE',
  'SESSION_INVALID',
  'PERMISSION_DENIED',
  'VALIDATION_ERROR',
  'PRECONDITION_FAILED',
  'BACKUP_VALIDATION_FAILED',
  'IDEMPOTENCY_CONFLICT',
  'IMMUTABLE_RECORD',
  'UNSAFE_ZERO_STOCK_VALUATION',
  'CREDIT_POLICY_BLOCKED',
] as const;

export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];
export const UNKNOWN_ERROR = 'UNKNOWN_ERROR';
export type AppErrorCode = BackendErrorCode | typeof UNKNOWN_ERROR;

export const ERROR_MESSAGE_KEYS = {
  INTERNAL_ERROR: 'errors.internal',
  CONFIGURATION_ERROR: 'errors.configuration',
  DATABASE_UNAVAILABLE: 'errors.databaseUnavailable',
  SESSION_INVALID: 'errors.sessionInvalid',
  PERMISSION_DENIED: 'errors.permissionDenied',
  VALIDATION_ERROR: 'errors.validation',
  PRECONDITION_FAILED: 'errors.preconditionFailed',
  BACKUP_VALIDATION_FAILED: 'errors.preconditionFailed',
  IDEMPOTENCY_CONFLICT: 'errors.idempotencyConflict',
  IMMUTABLE_RECORD: 'errors.immutableRecord',
  UNSAFE_ZERO_STOCK_VALUATION: 'errors.unsafeZeroStockValuation',
  // POS intercepts this code to provide customer-credit specific localized copy.
  // Generic consumers intentionally fall back to the stable precondition message.
  CREDIT_POLICY_BLOCKED: 'errors.preconditionFailed',
  UNKNOWN_ERROR: 'errors.unknown',
} as const satisfies Record<AppErrorCode, string>;

export type ErrorMessageKey = (typeof ERROR_MESSAGE_KEYS)[AppErrorCode];

export function isBackendErrorCode(value: unknown): value is BackendErrorCode {
  return (
    typeof value === 'string' &&
    (BACKEND_ERROR_CODES as readonly string[]).includes(value)
  );
}
