import { describe, expect, it } from 'vitest';
import {
  buildA4Receipt,
  buildThermalReceipt,
  formatReceiptItemName,
  type ReceiptInput,
} from '../src/features/pos/receiptBuilder';
import type { PrintingSettingsDto } from '../src/shared/ipc/dto';

const sampleSettings: PrintingSettingsDto = {
  receipt_printing_enabled: true,
  receipt_target: 'THERMAL',
  thermal_printer_name: 'POS-80',
  thermal_columns: 48,
  shop_name: 'Test Shop',
  shop_address: '123 Test St',
  shop_phone: '0555000000',
  receipt_footer: 'Thank you for your visit!',
  updated_at: '2026-09-13T09:00:00Z',
  shop_legal_name: null,
  shop_email: null,
  shop_website: null,
  tax_id_nif: null,
  tax_id_nis: null,
  trade_register_rc: null,
  article_imposition_ai: null,
  bank_account_rib: null,
  logo_file_name: null,
  logo_updated_at: null,
  print_language: 'FOLLOW_APP',
  show_logo: true,
  show_email: true,
  show_website: false,
  show_rib: false,
  amount_in_words: true,
  a4_footer_note: null,
};

const sampleReceipt: ReceiptInput = {
  documentNumber: 'DOC-2026-0001',
  documentDate: '2026-09-13',
  cashierName: 'Admin',
  paymentLabel: 'Cash',
  customerName: null,
  lines: [
    {
      name: 'Product 1',
      qty: 2,
      unitPrice: '100.00',
      lineTotal: '200.00',
    },
    {
      name: 'Product 2',
      qty: 1,
      unitPrice: '50.00',
      lineTotal: '50.00',
    },
  ],
  total: '250.00',
  currency: 'DZD',
};

describe('receiptBuilder', () => {
  it('buildThermalReceipt output starts with 0x1b, 0x40 and ends with 0x1d, 0x56, 0x42, 0x00', () => {
    const bytes = buildThermalReceipt(sampleReceipt, sampleSettings);
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);

    const len = bytes.length;
    expect(bytes.slice(len - 4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it('every value in the returned array is between 0 and 255 inclusive', () => {
    const bytes = buildThermalReceipt(sampleReceipt, sampleSettings);
    expect(bytes.length).toBeGreaterThan(0);
    for (const byte of bytes) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }
  });

  it('a line name containing an Arabic character produces the byte 63 for that character and does not throw', () => {
    const receiptWithArabic: ReceiptInput = {
      ...sampleReceipt,
      lines: [
        {
          name: 'حليب',
          qty: 1,
          unitPrice: '120.00',
          lineTotal: '120.00',
        },
      ],
    };

    expect(() => {
      const bytes = buildThermalReceipt(receiptWithArabic, sampleSettings);
      expect(bytes).toContain(63);
    }).not.toThrow();
  });

  it('buildA4Receipt output contains the document number and total, and a product name containing <script> appears escaped', () => {
    const receiptWithScript: ReceiptInput = {
      ...sampleReceipt,
      documentNumber: 'DOC-TEST-999',
      total: '999.00',
      lines: [
        {
          name: '<script>alert("xss")</script>',
          qty: 1,
          unitPrice: '999.00',
          lineTotal: '999.00',
        },
      ],
    };

    const html = buildA4Receipt(receiptWithScript, sampleSettings);
    expect(html).toContain('DOC-TEST-999');
    expect(html).toContain('999.00');
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('sanitizes typographical characters like em-dash and accents so they do not become question marks', () => {
    const receiptWithEmDash: ReceiptInput = {
      ...sampleReceipt,
      lines: [
        {
          name: 'Bed — Bed - M - Red - Dolz',
          qty: 1,
          unitPrice: '1000.00',
          lineTotal: '1000.00',
        },
      ],
    };

    const bytes = buildThermalReceipt(receiptWithEmDash, sampleSettings);
    // Em dash 0x2014 should be converted to '-' (ASCII 45), not '?' (ASCII 63)
    const textOutput = String.fromCharCode(...bytes);
    expect(textOutput).toContain('Bed - Bed - M - Red - Dolz');
    expect(textOutput).not.toContain('Bed ? Bed');
  });

  describe('formatReceiptItemName', () => {
    it('filters out attributes where visible_on_receipt is false', () => {
      const formatted = formatReceiptItemName({
        productName: 'cuette',
        variantName: 'cuette - M - Burgendy - Dolz',
        fallbackName: 'cuette',
        attributes: [
          { name: 'Taille', value: 'M', visible_on_receipt: true },
          { name: 'Couleur', value: 'Burgendy', visible_on_receipt: true },
          { name: 'Marque', value: 'Dolz', visible_on_receipt: false },
        ],
      });
      expect(formatted).toBe('cuette - M - Burgendy');
    });

    it('includes all attributes when all are visible, without duplicating product name', () => {
      const formatted = formatReceiptItemName({
        productName: 'cuette',
        variantName: 'cuette - M - Burgendy - Dolz',
        fallbackName: 'cuette',
        attributes: [
          { name: 'Taille', value: 'M', visible_on_receipt: true },
          { name: 'Couleur', value: 'Burgendy', visible_on_receipt: true },
          { name: 'Marque', value: 'Dolz', visible_on_receipt: true },
        ],
      });
      expect(formatted).toBe('cuette - M - Burgendy - Dolz');
    });

    it('returns only product name if all attributes are toggled off', () => {
      const formatted = formatReceiptItemName({
        productName: 'cuette',
        variantName: 'cuette - M - Burgendy - Dolz',
        fallbackName: 'cuette',
        attributes: [
          { name: 'Taille', value: 'M', visible_on_receipt: false },
          { name: 'Couleur', value: 'Burgendy', visible_on_receipt: false },
        ],
      });
      expect(formatted).toBe('cuette');
    });

    it('honors custom variant name override without appending attributes', () => {
      const formatted = formatReceiptItemName({
        productName: 'cuette',
        variantName: 'Couette Luxe Hiver',
        fallbackName: 'cuette',
        attributes: [
          { name: 'Taille', value: 'M', visible_on_receipt: true },
          { name: 'Couleur', value: 'Burgendy', visible_on_receipt: true },
        ],
      });
      expect(formatted).toBe('Couette Luxe Hiver');
    });

    it('handles simple product without variants or attributes', () => {
      const formatted = formatReceiptItemName({
        productName: 'Savon Liquide',
        variantName: '',
        fallbackName: 'Savon Liquide',
        attributes: [],
      });
      expect(formatted).toBe('Savon Liquide');
    });

    it('avoids product name duplication in fallback when variantName starts with productName', () => {
      const formatted = formatReceiptItemName({
        productName: 'cuette',
        variantName: 'cuette - M',
        fallbackName: 'cuette',
      });
      expect(formatted).toBe('cuette - M');
    });
  });

  describe('sale discount breakdown (WS-F-003)', () => {
    it('buildThermalReceipt prints SOUS-TOTAL and REMISE lines when discount is present', () => {
      const discountedReceipt: ReceiptInput = {
        ...sampleReceipt,
        subtotal: '250.00',
        discount: '50.00',
        total: '200.00',
      };
      const bytes = buildThermalReceipt(discountedReceipt, sampleSettings);
      const text = String.fromCharCode(...bytes);
      expect(text).toContain('SOUS-TOTAL :');
      expect(text).toContain('250.00 DZD');
      expect(text).toContain('REMISE :');
      expect(text).toContain('-50.00 DZD');
      expect(text).toContain('TOTAL A PAYER :');
      expect(text).toContain('200.00 DZD');
    });

    it('buildThermalReceipt adapts to English locale', () => {
      const discountedReceipt: ReceiptInput = {
        ...sampleReceipt,
        subtotal: '250.00',
        discount: '50.00',
        total: '200.00',
        locale: 'en',
      };
      const bytes = buildThermalReceipt(discountedReceipt, sampleSettings);
      const text = String.fromCharCode(...bytes);
      expect(text).toContain('SUBTOTAL :');
      expect(text).toContain('DISCOUNT :');
      expect(text).toContain('TOTAL TO PAY :');
    });

    it('buildA4Receipt renders subtotal and discount rows in French by default', () => {
      const discountedReceipt: ReceiptInput = {
        ...sampleReceipt,
        subtotal: '250.00',
        discount: '50.00',
        total: '200.00',
      };
      const html = buildA4Receipt(discountedReceipt, sampleSettings);
      expect(html).toContain('Sous-total :');
      expect(html).toContain('250.00 DZD');
      expect(html).toContain('Remise accordée :');
      expect(html).toContain('-50.00 DZD');
      expect(html).toContain('Total Net à Payer');
      expect(html).toContain('200.00 DZD');
    });

    it('buildA4Receipt renders subtotal and discount in Arabic when locale is ar', () => {
      const discountedReceipt: ReceiptInput = {
        ...sampleReceipt,
        subtotal: '250.00',
        discount: '50.00',
        total: '200.00',
        locale: 'ar',
      };
      const html = buildA4Receipt(discountedReceipt, sampleSettings);
      expect(html).toContain('المجموع الفرعي :');
      expect(html).toContain('التخفيض الممنوح :');
      expect(html).toContain('الصافي للدفع');
    });
  });
});


