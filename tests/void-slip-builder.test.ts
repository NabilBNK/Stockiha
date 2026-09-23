import { describe, expect, it } from 'vitest';

import { buildThermalVoidSlip, type VoidSlipInput } from '../src/features/pos/voidSlipBuilder';
import type { PrintingSettingsDto } from '../src/shared/ipc/dto';

const SETTINGS: PrintingSettingsDto = {
  receipt_printing_enabled: true,
  receipt_target: 'THERMAL',
  thermal_printer_name: 'EPSON-TM88',
  thermal_columns: 42,
  shop_name: 'Stockiha Shop',
  shop_address: '12 Rue Didouche',
  shop_phone: '021000000',
  receipt_footer: null,
  updated_at: '2026-09-22T00:00:00Z',
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

const BASE_INPUT: VoidSlipInput = {
  voidNumber: 'AN-2026-000001',
  originalNumber: 'VC-2026-000010',
  dateText: '22/09/2026 14:05',
  reasonText: 'Wrong item',
  customerName: null,
  lines: [{ name: 'Cahier 100 pages', qty: '2', lineTotal: '1000,00' }],
  total: '1000,00',
  currency: 'DA',
};

function bytesToText(bytes: number[]): string {
  return bytes
    .filter((b) => b >= 0x20 && b <= 0x7e)
    .map((b) => String.fromCharCode(b))
    .join('');
}

describe('void slip builder', () => {
  it('the thermal slip decodes to text containing every required field', () => {
    const bytes = buildThermalVoidSlip(BASE_INPUT, SETTINGS);
    const text = bytesToText(bytes);

    expect(text).toContain('ANNULATION DE VENTE');
    expect(text).toContain(BASE_INPUT.voidNumber);
    expect(text).toContain(BASE_INPUT.originalNumber);
    expect(text).toContain(BASE_INPUT.reasonText);
    expect(text).toContain('Cahier 100 pages');
    expect(text).toContain('TOTAL ANNULE');
  });

  it("locale: 'en' produces English labels", () => {
    const bytes = buildThermalVoidSlip({ ...BASE_INPUT, locale: 'en' }, SETTINGS);
    const text = bytesToText(bytes);

    expect(text).toContain('SALE CANCELLED');
    expect(text).toContain('TOTAL CANCELLED');
  });

  it('ends with the partial-cut bytes', () => {
    const bytes = buildThermalVoidSlip(BASE_INPUT, SETTINGS);
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it('a customer line appears only when customerName is set', () => {
    const withoutCustomer = bytesToText(buildThermalVoidSlip(BASE_INPUT, SETTINGS));
    expect(withoutCustomer).not.toContain('Client :');

    const withCustomer = bytesToText(
      buildThermalVoidSlip({ ...BASE_INPUT, customerName: 'Amine Client' }, SETTINGS),
    );
    expect(withCustomer).toContain('Client :');
    expect(withCustomer).toContain('Amine Client');
  });
});
