import { describe, it, expect } from 'vitest';
import { MESSAGES } from '../src/shared/i18n/locales';

describe('WS-P-3 Paper Book Localization & Translations', () => {
  const allPaperbookKeys = Object.keys(MESSAGES.fr).filter((k) =>
    k.startsWith('paperbook.')
  ) as Array<keyof typeof MESSAGES.fr>;

  const ISSUE_CODES = [
    'E_FILE_TYPE',
    'E_FILE_UNREADABLE',
    'E_FILE_TOO_BIG',
    'E_FILE_EMPTY',
    'E_FILE_TOO_LARGE',
    'E_FILE_INVALID',
    'E_SEVERAL_MATCHING_SHEETS',
    'E_NO_MATCHING_SHEET',
    'E_LAYOUT',
    'E_NO_TRANSACTIONS',
    'E_TXN_NO_LINES',
    'E_TXN_TOTAL_ZERO',
    'E_TYPE_MISSING',
    'E_TYPE_INVALID',
    'E_DATE_MISSING',
    'E_DATE_IN_FUTURE',
    'E_DATE_AFTER_GO_LIVE',
    'E_DATE_POST_GOLIVE',
    'E_DATE_INVALID',
    'E_PAID_MISSING',
    'E_PAID_INVALID',
    'E_CELL_ERROR',
    'E_BENEFIT_NOT_SELL',
    'E_BENEFIT_NOT_ALLOWED',
    'E_BENEFIT_INVALID',
    'E_ORPHAN_LINE',
    'E_CONTINUATION_DATE_DIFFERS',
    'E_CONTINUATION_PAID_DIFFERS',
    'E_CONTINUATION_PARTY_DIFFERS',
    'E_BENEFIT_NOT_FIRST_ROW',
    'E_QTY_NOT_POSITIVE',
    'E_QTY_INVALID',
    'E_PRICE_INVALID',
    'E_LINE_TOTAL_INVALID',
    'E_LINE_FIELDS_MISSING',
    'E_AMOUNT_NEGATIVE',
    'E_LINE_AMOUNT_MISSING',
    'E_MANUAL_DATE_REQUIRED',
    'E_MANUAL_TYPE_REQUIRED',
    'E_MANUAL_LINES_REQUIRED',
    'E_MANUAL_LINE_TOTAL_ZERO',
    'W_FEWER_THAN_CURRENT',
    'W_DATE_OUT_OF_ORDER',
    'W_PRICE_UNUSUAL',
    'W_LINE_ONLY_AMOUNT',
    'W_TOTAL_OVERRIDDEN',
    'W_BENEFIT_ABOVE_TOTAL',
    'W_DUPLICATE_IN_FILE',
    'W_POSSIBLE_MANUAL_DUPLICATE',
  ];

  it('contains over 100 paperbook keys across all dictionaries', () => {
    expect(allPaperbookKeys.length).toBeGreaterThanOrEqual(100);
  });

  it('all paperbook keys exist and are non-empty across fr, ar, and en', () => {
    for (const locale of ['fr', 'ar', 'en'] as const) {
      const messages = MESSAGES[locale];
      for (const key of allPaperbookKeys) {
        expect(
          messages[key],
          `Missing or empty message for key '${key}' in locale '${locale}'`
        ).toBeTruthy();
      }
    }
  });

  it('every validation and error code has a corresponding translation in fr, ar, en', () => {
    for (const code of ISSUE_CODES) {
      const key = `paperbook.issue.${code}` as keyof typeof MESSAGES.fr;
      for (const locale of ['fr', 'ar', 'en'] as const) {
        expect(
          MESSAGES[locale][key],
          `Missing translation for issue code '${code}' in locale '${locale}'`
        ).toBeDefined();
        expect(
          MESSAGES[locale][key].trim().length,
          `Empty translation for issue code '${code}' in locale '${locale}'`
        ).toBeGreaterThan(0);
      }
    }
  });

  it('Arabic paperbook translations contain authentic Arabic script', () => {
    const ar = MESSAGES.ar;
    const arabicRegex = /[\u0600-\u06FF]/;
    for (const key of allPaperbookKeys) {
      expect(
        ar[key],
        `Arabic key '${key}' must contain Arabic text, found: '${ar[key]}'`
      ).toMatch(arabicRegex);
    }
  });

  it('placeholders match consistently between English and French/Arabic', () => {
    const extractPlaceholders = (text: string): string[] => {
      const matches = text.match(/\{[a-zA-Z0-9_]+\}/g);
      return matches ? Array.from(matches).sort() : [];
    };

    const en = MESSAGES.en;
    for (const locale of ['fr', 'ar'] as const) {
      const messages = MESSAGES[locale];
      for (const key of allPaperbookKeys) {
        const enPlaceholders = extractPlaceholders(en[key]);
        const locPlaceholders = extractPlaceholders(messages[key]);
        expect(
          locPlaceholders,
          `Placeholders for key '${key}' in locale '${locale}' must match English`
        ).toEqual(enPlaceholders);
      }
    }
  });

  it('adheres to key French and Arabic business terminology', () => {
    const fr = MESSAGES.fr;
    const ar = MESSAGES.ar;

    // Strict Historical Isolation
    expect(fr['paperbook.banner.title']).toBe('Isolation Historique Stricte');
    expect(ar['paperbook.banner.title']).toBe('عزل تاريخي صارم');

    // Revenue / Gross Benefit / Expenses / Net Profit
    expect(fr['paperbook.analytics.kpi.revenue']).toBe('Chiffre d’affaires total');
    expect(ar['paperbook.analytics.kpi.revenue']).toBe('إجمالي الإيرادات');
    expect(ar['paperbook.analytics.kpi.gross_benefit']).toBe('إجمالي الهامش / الربح');
    expect(ar['paperbook.analytics.kpi.expenses']).toBe('إجمالي المصاريف التشغيلية');
    expect(ar['paperbook.analytics.kpi.net_profit']).toBe('صافي الأرباح');

    // Unpaid sales and purchases (credit/debt)
    expect(ar['paperbook.analytics.kpi.unpaid_sales']).toContain('ديون العملاء');
    expect(ar['paperbook.analytics.kpi.unpaid_purchases']).toContain('ديون الموردين');

    // Names cleanup
    expect(ar['paperbook.names.title']).toBe('توحيد وتنظيف المسميات');
    expect(ar['paperbook.names.suggestions_title']).toContain('اقتراحات الأسماء المتشابهة');
  });
});
