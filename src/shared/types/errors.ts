/**
 * S0-002 — Frontend error-code contract.
 *
 * Mirrors the backend public `IpcError` wire shape `{ code: <ErrorCode> }`
 * (see `src-tauri/src/error.rs`). Only codes in {@link BACKEND_ERROR_CODES} are
 * recognized; every other value collapses to the frontend-only
 * {@link UNKNOWN_ERROR}.
 *
 * Message keys are owned by the frontend and are placeholders for future
 * i18n (French / Arabic / English). Full localization is out of scope for
 * S0-002 — only the key ownership and the mapping shape are established here.
 */

/**
 * Allowlist of backend error codes that may cross the Tauri IPC boundary.
 * Must stay in sync with the Rust `ErrorCode` enum. Add a code here only when a
 * matching Rust variant and its `From<AppError>` mapping are added.
 */
export const BACKEND_ERROR_CODES = ['INTERNAL_ERROR'] as const;

/** A code known to originate from the backend contract. */
export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];

/** Frontend-only sentinel for any value that is not an allowlisted backend code. */
export const UNKNOWN_ERROR = 'UNKNOWN_ERROR';

/** The full set of codes the frontend may resolve to. */
export type AppErrorCode = BackendErrorCode | typeof UNKNOWN_ERROR;

/**
 * Stable i18n message keys, keyed by error code. Consumed by the future
 * localization layer; not resolved to localized strings within S0-002.
 */
export const ERROR_MESSAGE_KEYS = {
  INTERNAL_ERROR: 'errors.internal',
  UNKNOWN_ERROR: 'errors.unknown',
} as const satisfies Record<AppErrorCode, string>;

/** A message key owned by the frontend error contract. */
export type ErrorMessageKey = (typeof ERROR_MESSAGE_KEYS)[AppErrorCode];

/**
 * Type guard: is `value` one of the allowlisted backend error codes?
 * Accepts only strings; rejects everything else.
 */
export function isBackendErrorCode(value: unknown): value is BackendErrorCode {
  return (
    typeof value === 'string' &&
    (BACKEND_ERROR_CODES as readonly string[]).includes(value)
  );
}
