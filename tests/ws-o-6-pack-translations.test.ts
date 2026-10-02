import { describe, it, expect } from 'vitest';
import { MESSAGES } from '../src/shared/i18n/locales';

describe('WS-O-6 Pack Translations', () => {
  const PACK_KEYS: Array<keyof typeof MESSAGES.en> = [
    'pack.title',
    'pack.help',
    'pack.empty',
    'pack.add',
    'pack.edit',
    'pack.main',
    'pack.unit',
    'pack.holds',
    'pack.salePrice',
    'pack.perBase',
    'pack.barcodes',
    'pack.status',
    'pack.actions',
    'pack.active',
    'pack.inactive',
    'pack.notSold',
    'pack.confirmRemoveBarcode',
    'pack.addBarcode',
    'pack.confirmDelete',
    'pack.delete',
    'pack.activate',
    'pack.deactivate',
    'pack.holdsLabel',
    'pack.priceLabel',
    'pack.suggestedMaxPrice',
    'pack.useSuggestedPrice',
    'pack.barcodeLabel',
    'pack.mainCheckbox',
    'pack.perPiece',
    'pack.warn.ratehigher',
    'pack.saved',
    'pack.savedBarcodeFailed',
    'pack.inUse',
    'pack.smallerUnits',
    'pack.barcodesElsewhere',
    'pack.quick.title',
    'pack.quick.productSavedPackFailed',
    'pack.error.unitRequired',
    'pack.error.unitIsBase',
    'pack.error.unitAlreadyUsed',
    'pack.error.factorRequired',
    'pack.error.factorInvalid',
    'pack.error.factorTooSmall',
    'pack.error.factorTooLarge',
    'pack.error.factorDecimals',
    'pack.error.factorWhole',
    'pack.error.priceInvalid',
    'pack.error.barcodeBlank',
    'pack.error.barcodeUsed',
    'pack.applyToOthers',
    'pack.applyDialogTitle',
    'pack.applyDialogDesc',
    'pack.applySelectAll',
    'pack.applyDeselectAll',
    'pack.applyPrimaryCheckbox',
    'pack.applyBtn',
    'pack.applyingProgress',
    'pack.applySuccess',
    'pack.applySkipped',
    'pack.copyFromVariant',
    'pack.copyDialogTitle',
    'pack.copySelectSource',
    'pack.copyNoPacksOnSource',
    'pack.copyCountPacks',
    'pack.copySuccess',
    'pack.noSiblingVariants',
    'catalog2.bulkPackFailed',
    'catalog2.bulkDefaultPackTitle',
    'catalog2.bulkDefaultPackEnable',
    'catalog2.bulkDefaultPackUnit',
    'catalog2.bulkDefaultPackFactor',
    'catalog2.bulkDefaultPackPrice',
    'catalog2.bulkDefaultPackPrimary',
    'pack.filterVariants',
    'pack.selectAllMatching',
    'pack.deselectAllMatching',
    'pack.noMatchingVariants',
    'pack.searchPlaceholder',
    'sale.pack.loadFailed',
    'sale.pack.error.notSold',
    'sale.pack.edited',
    'sale.pack.error.price',
    'sale.pack.warn.belowCost',
    'sale.pack.error.noLongerSold',
    'sale.pack.reset',
    'sale.pack.extra',
    'sale.pack.perUnit',
    'sale.pack.piece',
    'pack.display.tooltip',
    'pack.display.equals',
  ];

  it('all pack keys exist and are non-empty across fr, ar, and en', () => {
    for (const locale of ['fr', 'ar', 'en'] as const) {
      const messages = MESSAGES[locale];
      for (const key of PACK_KEYS) {
        expect(messages[key], `Missing or empty message for key '${key}' in locale '${locale}'`).toBeTruthy();
      }
    }
  });

  it('Arabic pack translations contain Arabic characters', () => {
    const ar = MESSAGES.ar;
    const arabicRegex = /[\u0600-\u06FF]/;
    for (const key of PACK_KEYS) {
      // pack.display.tooltip and pack.display.equals are formulas like "= {baseQuantity} {base}"
      if (key === 'pack.display.tooltip' || key === 'pack.display.equals') continue;
      expect(ar[key], `Arabic key '${key}' must contain Arabic text`).toMatch(arabicRegex);
    }
  });

  it('placeholders match between English and translated locales', () => {
    const extractPlaceholders = (text: string): string[] => {
      const matches = text.match(/\{[a-zA-Z0-9_]+\}/g);
      return matches ? Array.from(matches).sort() : [];
    };

    const en = MESSAGES.en;
    for (const locale of ['fr', 'ar'] as const) {
      const messages = MESSAGES[locale];
      for (const key of PACK_KEYS) {
        const enPlaceholders = extractPlaceholders(en[key]);
        const locPlaceholders = extractPlaceholders(messages[key]);
        expect(
          locPlaceholders,
          `Placeholders for key '${key}' in locale '${locale}' must match English`
        ).toEqual(enPlaceholders);
      }
    }
  });

  it('strictly adheres to the Section 13 glossary', () => {
    const fr = MESSAGES.fr;
    const ar = MESSAGES.ar;

    // Main pack
    expect(fr['pack.mainCheckbox']).toBe('Conditionnement principal');
    expect(ar['pack.mainCheckbox']).toBe('التعبئة الرئيسية');

    // Unit / Piece
    expect(fr['sale.pack.piece']).toBe('Pièce');
    expect(ar['sale.pack.piece']).toBe('قطعة');

    // Extra {base}
    expect(fr['sale.pack.extra']).toBe('{base} en plus');
    expect(ar['sale.pack.extra']).toBe('{base} إضافية');

    // Not sold (buy only)
    expect(fr['pack.notSold']).toBe('Non vendu (achat uniquement)');
    expect(ar['pack.notSold']).toBe('غير مباع (للشراء فقط)');

    // edited
    expect(fr['sale.pack.edited']).toBe('modifié');
    expect(ar['sale.pack.edited']).toBe('معدّل');

    // Below cost
    expect(fr['sale.pack.warn.belowCost']).toContain('Sous le coût');
    expect(ar['sale.pack.warn.belowCost']).toContain('أقل من التكلفة');
  });
});
