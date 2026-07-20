/**
 * S0-002 — Defensive parsing of unknown Tauri rejection values.
 *
 * Tauri command rejections arrive as `unknown`: they may be a well-formed
 * `IpcError` (`{ code: "INTERNAL_ERROR" }`), but they may also be an arbitrary
 * `Error`, string, number, boolean, `null`/`undefined`, array, malformed object,
 * or an object whose `code` getter throws. This module reduces any such value to
 * a known {@link AppErrorCode} without ever trusting or surfacing its contents.
 *
 * Security posture:
 * - Only an allowlisted backend `code` string is accepted.
 * - Every object inspection — the array check and the `code` read via
 *   `Reflect.get` — happens inside one `try/catch`, so any throwing trap
 *   (e.g. a revoked `Proxy`) or throwing getter is contained.
 * - `message`, `details`, `stack`, and any other property are ignored — never read,
 *   never echoed.
 * - `String(error)` is never used; arbitrary content is never rendered.
 * - Every unrecognized shape returns {@link UNKNOWN_ERROR}.
 */

import {
  UNKNOWN_ERROR,
  ERROR_MESSAGE_KEYS,
  isBackendErrorCode,
  type AppErrorCode,
  type ErrorMessageKey,
} from '../types/errors';

/**
 * Parse an unknown Tauri rejection value into a recognized {@link AppErrorCode}.
 * Returns {@link UNKNOWN_ERROR} for anything that is not an allowlisted backend
 * code carried on an object's `code` property.
 */
export function parseTauriError(error: unknown): AppErrorCode {
  // Only non-null object values can carry a backend `code`. Reject primitives
  // and null with a cheap, non-throwing guard.
  if (typeof error !== 'object' || error === null) {
    return UNKNOWN_ERROR;
  }

  let code: unknown;
  try {
    // Every object inspection is contained: even the array check and the `code`
    // read can throw for exotic values (e.g. a revoked Proxy throws on any trap).
    if (Array.isArray(error)) {
      return UNKNOWN_ERROR;
    }
    // Read ONLY `code`, via Reflect.get so a throwing getter/trap is caught here.
    code = Reflect.get(error, 'code');
  } catch {
    return UNKNOWN_ERROR;
  }

  return isBackendErrorCode(code) ? code : UNKNOWN_ERROR;
}

/**
 * Fixed, safe, user-facing messages for the current technical screen. These are
 * temporary English strings; the localized FR/AR/EN layer will later resolve
 * {@link ERROR_MESSAGE_KEYS} instead. They never contain any part of the input.
 */
const SAFE_MESSAGES: Record<AppErrorCode, string> = {
  INTERNAL_ERROR: 'An internal error occurred. Please try again.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};

/**
 * Resolve an unknown rejection value to a safe, fixed message for display on the
 * current technical screen. Never echoes the input.
 */
export function resolveErrorMessage(error: unknown): string {
  return SAFE_MESSAGES[parseTauriError(error)];
}

/**
 * Resolve an unknown rejection value to its stable i18n message key
 * (for the future localization layer). Never echoes the input.
 */
export function resolveErrorMessageKey(error: unknown): ErrorMessageKey {
  return ERROR_MESSAGE_KEYS[parseTauriError(error)];
}
