/**
 * Slice 1 — dependency-free i18n provider for French (default), Arabic (RTL),
 * and English. Holds the active locale, exposes a `t(key, vars)` translator
 * with `{var}` interpolation, and applies `dir`/`lang` at the document root
 * so Arabic renders right-to-left across the whole app.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_LOCALE,
  MESSAGES,
  RTL_LOCALES,
  type Locale,
  type MessageKey,
} from './locales';
import type { ErrorMessageKey } from '../types/errors';

type TranslateVars = Record<string, string | number>;

interface I18nContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey | ErrorMessageKey, vars?: TranslateVars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function dirFor(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const dir = dirFor(locale);

  useEffect(() => {
    // Apply direction + language at the document root so the entire tree,
    // including native inputs and scrollbars, flips for Arabic.
    const root = document.documentElement;
    root.setAttribute('lang', locale);
    root.setAttribute('dir', dir);
  }, [locale, dir]);

  const t = useCallback(
    (key: MessageKey | ErrorMessageKey, vars?: TranslateVars): string => {
      const table = MESSAGES[locale] as Record<string, string>;
      const fallback = MESSAGES[DEFAULT_LOCALE] as Record<string, string>;
      let text = table[key] ?? fallback[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        }
      }
      return text;
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir, setLocale, t }),
    [locale, dir, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}

export { LOCALES } from './locales';
export type { Locale, MessageKey } from './locales';
