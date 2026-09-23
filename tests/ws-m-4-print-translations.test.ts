/**
 * WS-M-4 — every Arabic print/printing-settings string that WS-M-1/WS-M-2
 * left as an English placeholder (marked `// TODO(WS-M-4)`) has been
 * reviewed and translated. This test protects that from silently
 * regressing to English again.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MESSAGES } from '../src/shared/i18n/locales';

const LOCALES_SOURCE = readFileSync('src/shared/i18n/locales.ts', 'utf8');

describe('WS-M-4 print translations', () => {
  it('leaves no WS-M-4 TODO markers in the locale source', () => {
    expect(LOCALES_SOURCE).not.toContain('TODO(WS-M-4)');
  });

  it('the Arabic printing.* strings are Arabic, not the English placeholder text', () => {
    const en = MESSAGES.en;
    const ar = MESSAGES.ar;
    const keysToCheck: Array<keyof typeof en> = [
      'printing.identityTitle',
      'printing.identityFieldsHint',
      'printing.logo',
      'printing.logoNone',
      'printing.logoChoose',
      'printing.logoRemove',
      'printing.legalName',
      'printing.email',
      'printing.website',
      'printing.footerNote',
      'printing.showLogo',
      'printing.showEmail',
      'printing.showWebsite',
      'printing.showRib',
      'printing.amountInWords',
      'printing.printLanguage',
      'printing.printLanguageFollowApp',
      'printing.invalidEmail',
      'printing.tooLong',
      'printing.preview',
    ];
    for (const key of keysToCheck) {
      expect(ar[key], `ar['${String(key)}'] must not equal the English placeholder`).not.toBe(en[key]);
      expect(ar[key]).toMatch(/[؀-ۿ]/);
    }
  });

  it('keeps NIF/NIS/RC/AI/RIB and the print-language native names untranslated in every locale', () => {
    for (const locale of ['fr', 'ar', 'en'] as const) {
      const messages = MESSAGES[locale];
      expect(messages['printing.nif']).toBe('NIF');
      expect(messages['printing.nis']).toBe('NIS');
      expect(messages['printing.rc']).toBe('RC');
      expect(messages['printing.ai']).toBe('AI');
      expect(messages['printing.rib']).toBe('RIB');
      expect(messages['printing.printLanguageFr']).toBe('Français');
      expect(messages['printing.printLanguageAr']).toBe('العربية');
      expect(messages['printing.printLanguageEn']).toBe('English');
    }
  });

  it('the Arabic logo error strings are Arabic, not the English placeholder text', () => {
    const en = MESSAGES.en;
    const ar = MESSAGES.ar;
    const keys: Array<keyof typeof en> = ['errors.logoTooLarge', 'errors.logoNotAFile', 'errors.logoUnsupportedType'];
    for (const key of keys) {
      expect(ar[key]).not.toBe(en[key]);
      expect(ar[key]).toMatch(/[؀-ۿ]/);
    }
  });

  it('matches the project glossary for cash-session-report and cancellation titles', () => {
    // sessionReportModel.ts: "تقرير الصندوق" (cash report).
    // printReceipt.ts VOID_TITLE: contains "إلغاء" (cancellation).
    // purchaseReceiptPrint.ts DOC_TITLE: contains "وصل استلام" (goods receipt).
    const sessionReportModelSource = readFileSync(
      'src/shared/documents/models/sessionReportModel.ts',
      'utf8',
    );
    const printReceiptSource = readFileSync('src/features/pos/printReceipt.ts', 'utf8');
    const purchaseReceiptPrintSource = readFileSync(
      'src/features/procurement/purchaseReceiptPrint.ts',
      'utf8',
    );

    expect(sessionReportModelSource).toContain('تقرير الصندوق');
    expect(printReceiptSource).toContain('إلغاء');
    expect(purchaseReceiptPrintSource).toContain('وصل استلام');
  });
});
