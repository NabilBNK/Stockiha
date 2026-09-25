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
  'BACKUP_CREATION_FAILED',
  'BACKUP_VALIDATION_FAILED',
  'IDEMPOTENCY_CONFLICT',
  'IMMUTABLE_RECORD',
  'UNSAFE_ZERO_STOCK_VALUATION',
  'CREDIT_POLICY_BLOCKED',
  'INSUFFICIENT_STOCK',
  'CORRECTIONS_DISABLED',
  'RESTORE_ADMIN_NOT_CONFIGURED',
  'BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY',
  'BACKUP_DESTINATION_CREATE_FAILED',
  'BACKUP_BUNDLE_OUTSIDE_ROOT',
  'RECOVERY_OPERATION_IN_PROGRESS',
  // WS-H-3 (plan §5.7).
  'RECOVERY_UNAVAILABLE',
  'BACKUP_DESTINATION_UNAVAILABLE',
  'BACKUP_NOT_RESTORABLE',
  'RESTORE_TEST_FAILED',
  'FRESH_RESTORE_NOT_ALLOWED',
  'BACKUP_COPY_FAILED',
  'INSUFFICIENT_DISK_SPACE',
  // WS-M-1: logo upload validation.
  'LOGO_TOO_LARGE',
  'LOGO_NOT_A_FILE',
  'LOGO_UNSUPPORTED_TYPE',
  // WS-K-7: licence activation.
  'LICENCE_READ_ONLY',
  'LICENCE_MALFORMED',
  'LICENCE_INVALID',
  'LICENCE_WRONG_MACHINE',
  'LICENCE_EXPIRED',
  'LICENCE_MACHINE_UNAVAILABLE',
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
  BACKUP_CREATION_FAILED: 'errors.preconditionFailed',
  BACKUP_VALIDATION_FAILED: 'errors.preconditionFailed',
  IDEMPOTENCY_CONFLICT: 'errors.idempotencyConflict',
  IMMUTABLE_RECORD: 'errors.immutableRecord',
  UNSAFE_ZERO_STOCK_VALUATION: 'errors.unsafeZeroStockValuation',
  // POS intercepts this code to provide customer-credit specific localized copy.
  // Generic consumers intentionally fall back to the stable precondition message.
  CREDIT_POLICY_BLOCKED: 'errors.preconditionFailed',
  INSUFFICIENT_STOCK: 'adjustment.insufficientStock',
  CORRECTIONS_DISABLED: 'adjustment.disabledPolicy',
  RESTORE_ADMIN_NOT_CONFIGURED: 'errors.restoreAdminNotConfigured',
  BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY: 'errors.backupDestinationInsideDataDirectory',
  BACKUP_DESTINATION_CREATE_FAILED: 'errors.backupDestinationCreateFailed',
  BACKUP_BUNDLE_OUTSIDE_ROOT: 'errors.backupBundleOutsideRoot',
  RECOVERY_OPERATION_IN_PROGRESS: 'errors.recoveryOperationInProgress',
  RECOVERY_UNAVAILABLE: 'errors.recoveryUnavailable',
  BACKUP_DESTINATION_UNAVAILABLE: 'errors.backupDestinationUnavailable',
  BACKUP_NOT_RESTORABLE: 'errors.backupNotRestorable',
  RESTORE_TEST_FAILED: 'errors.restoreTestFailed',
  FRESH_RESTORE_NOT_ALLOWED: 'errors.freshRestoreNotAllowed',
  BACKUP_COPY_FAILED: 'errors.backupCopyFailed',
  INSUFFICIENT_DISK_SPACE: 'errors.insufficientDiskSpace',
  LOGO_TOO_LARGE: 'errors.logoTooLarge',
  LOGO_NOT_A_FILE: 'errors.logoNotAFile',
  LOGO_UNSUPPORTED_TYPE: 'errors.logoUnsupportedType',
  LICENCE_READ_ONLY: 'errors.licenceReadOnly',
  LICENCE_MALFORMED: 'errors.licenceMalformed',
  LICENCE_INVALID: 'errors.licenceInvalid',
  LICENCE_WRONG_MACHINE: 'errors.licenceWrongMachine',
  LICENCE_EXPIRED: 'errors.licenceExpired',
  LICENCE_MACHINE_UNAVAILABLE: 'errors.licenceMachineUnavailable',
  UNKNOWN_ERROR: 'errors.unknown',
} as const satisfies Record<AppErrorCode, string>;

export type ErrorMessageKey = (typeof ERROR_MESSAGE_KEYS)[AppErrorCode];

export function isBackendErrorCode(value: unknown): value is BackendErrorCode {
  return (
    typeof value === 'string' &&
    (BACKEND_ERROR_CODES as readonly string[]).includes(value)
  );
}
