/**
 * WS-D-10 — the active locale's decimal display formatter.
 *
 * Display only. The stored exact-decimal string is what gets edited and what
 * gets sent; this is purely what the operator reads. The separators come from
 * the active locale rather than hardcoded ','/'.', and the formatting itself
 * is string manipulation — see formatDecimalDisplay in exactDecimal.ts.
 */
import { useCallback } from 'react';

import { useI18n } from '../../shared/i18n';
import { formatDecimalDisplay } from '../inventory/exactDecimal';

export function useDecimalFormat(): (value: string) => string {
  const { locale } = useI18n();
  return useCallback((value: string) => formatDecimalDisplay(value, locale), [locale]);
}
