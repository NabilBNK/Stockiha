/**
 * Slice 1 — resolves any thrown value (a {@link GatewayError} or otherwise)
 * to a safe, localized message via the error-code contract. Raw backend
 * diagnostics never reach the UI: only the normalized code selects a fixed
 * localized string.
 */
import { useCallback } from 'react';

import { useI18n } from '../i18n';
import { GatewayError } from '../ipc/gateway';
import { parseTauriError } from '../utils/tauriError';
import { ERROR_MESSAGE_KEYS, type AppErrorCode } from '../types/errors';

export function codeForError(error: unknown): AppErrorCode {
  return error instanceof GatewayError ? error.code : parseTauriError(error);
}

export function isSessionInvalid(error: unknown): boolean {
  return codeForError(error) === 'SESSION_INVALID';
}

export function useErrorText(): (error: unknown) => string {
  const { t } = useI18n();
  return useCallback((error: unknown) => t(ERROR_MESSAGE_KEYS[codeForError(error)]), [t]);
}
