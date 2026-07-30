/**
 * Resolves thrown values to safe localized text. Raw backend diagnostics never
 * reach the UI; only an allowlisted public code selects fixed copy.
 */
import { useCallback } from 'react';

import { useI18n, type Locale } from '../i18n';
import { GatewayError } from '../ipc/gateway';
import { parseTauriError } from '../utils/tauriError';
import { ERROR_MESSAGE_KEYS, type AppErrorCode } from '../types/errors';

const CREDIT_POLICY_TEXT: Record<Locale, string> = {
  en: 'Customer credit policy blocks this sale. Check credit limit, overdue status, or manager override.',
  fr: 'La politique de crédit du client bloque cette vente. Vérifiez le plafond, le retard ou l’autorisation du responsable.',
  ar: 'سياسة ائتمان العميل تمنع هذه العملية. تحقق من حد الائتمان أو التأخر أو موافقة المسؤول.',
};

export function codeForError(error: unknown): AppErrorCode {
  return error instanceof GatewayError ? error.code : parseTauriError(error);
}

export function isSessionInvalid(error: unknown): boolean {
  return codeForError(error) === 'SESSION_INVALID';
}

export function useErrorText(): (error: unknown) => string {
  const { t, locale } = useI18n();
  return useCallback((error: unknown) => {
    const code = codeForError(error);
    if (code === 'CREDIT_POLICY_BLOCKED') return CREDIT_POLICY_TEXT[locale];
    return t(ERROR_MESSAGE_KEYS[code]);
  }, [locale, t]);
}
