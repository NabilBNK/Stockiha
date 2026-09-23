import { describe, expect, it } from 'vitest';

import { buildThermalSessionReport } from '../src/features/cash-session/sessionReportBuilder';
import { buildSessionReportModel } from '../src/shared/documents/models/sessionReportModel';
import type { PrintingSettingsDto } from '../src/shared/ipc/dto';
import type { SessionReport } from '../src/shared/ipc/cashSessionDto';

const SETTINGS: PrintingSettingsDto = {
  receipt_printing_enabled: true,
  receipt_target: 'THERMAL',
  thermal_printer_name: 'EPSON-TM88',
  thermal_columns: 42,
  shop_name: 'Stockiha Shop',
  shop_address: '12 Rue Didouche',
  shop_phone: '021000000',
  receipt_footer: null,
  updated_at: '2026-09-25T00:00:00Z',
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

const REPORT: SessionReport = {
  session: {
    id: 42,
    status: 'CLOSED',
    workstation_id: 'POS-1',
    opened_at: '2026-09-25T08:00:00Z',
    closed_at: '2026-09-25T18:00:00Z',
    opened_by: 'admin',
    closed_by: 'admin',
    opening_float: '2000.00',
  },
  sales: {
    cash_count: 12,
    cash_total: '45000.00',
    credit_count: 2,
    credit_total: '8000.00',
    void_count: 1,
    void_total: '500.00',
  },
  movements: {
    cash_in_total: '300.00',
    cash_out_total: '700.00',
    rows: [
      { type: 'CASH_OUT', reason_code: 'EXPENSE', note: 'Delivery', amount: '700.00', recorded_at: '2026-09-25T12:00:00Z' },
      { type: 'CASH_IN', reason_code: 'CHANGE_FLOAT', note: null, amount: '300.00', recorded_at: '2026-09-25T09:00:00Z' },
    ],
  },
  customer: {
    payments_total: '1200.00',
    refunds_total: '0.00',
  },
  cash: {
    expected: '47300.00',
    counted: '47250.00',
    variance: '-50.00',
    variance_approved_by: 'manager1',
    tolerance: '50.00',
  },
};

const OPEN_REPORT: SessionReport = {
  ...REPORT,
  session: { ...REPORT.session, status: 'OPEN', closed_at: null, closed_by: null },
  cash: { ...REPORT.cash, counted: null, variance: null, variance_approved_by: null },
};

describe('buildThermalSessionReport', () => {
  it('contains the shop identity, expected/counted/variance, and the approver', () => {
    const bytes = buildThermalSessionReport(REPORT, SETTINGS);
    const text = new TextDecoder('latin1').decode(new Uint8Array(bytes));

    expect(text).toContain('Stockiha Shop');
    expect(text).toContain('RAPPORT DE CAISSE');
    expect(text).toContain('47300.00');
    expect(text).toContain('47250.00');
    expect(text).toContain('-50.00');
    expect(text).toContain('manager1');
  });

  it('ends with the partial-cut bytes', () => {
    const bytes = buildThermalSessionReport(REPORT, SETTINGS);
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it('prints "-" for counted/variance on an open session', () => {
    const bytes = buildThermalSessionReport(OPEN_REPORT, SETTINGS);
    const text = new TextDecoder('latin1').decode(new Uint8Array(bytes));
    expect(text).toContain('47300.00');
    expect(text).not.toContain('47250.00');
  });

  it('renders English labels when locale is en', () => {
    const bytes = buildThermalSessionReport(REPORT, SETTINGS, 'en');
    const text = new TextDecoder('latin1').decode(new Uint8Array(bytes));
    expect(text).toContain('END-OF-DAY CASH REPORT');
    expect(text).toContain('Expected');
    expect(text).toContain('Variance');
  });
});

describe('buildSessionReportModel', () => {
  it('has no amount-in-words value and emphasises the variance total', () => {
    const model = buildSessionReportModel(REPORT, '25/09/2026', 'fr');
    expect(model.kind).toBe('CASH_SESSION_REPORT');
    expect(model.amountInWordsValue).toBeUndefined();

    const emphasised = model.totals?.filter((total) => total.emphasis);
    expect(emphasised).toHaveLength(1);
    expect(emphasised?.[0].value).toBe('-50.00');
  });

  it('includes every reported figure among the totals', () => {
    const model = buildSessionReportModel(REPORT, '25/09/2026', 'fr');
    const values = model.totals?.map((total) => total.value) ?? [];
    expect(values).toContain('2000.00');
    expect(values).toContain('45000.00');
    expect(values).toContain('8000.00');
    expect(values).toContain('500.00');
    expect(values).toContain('1200.00');
    expect(values).toContain('0.00');
    expect(values).toContain('300.00');
    expect(values).toContain('700.00');
    expect(values).toContain('47300.00');
    expect(values).toContain('47250.00');
    expect(values).toContain('-50.00');
  });

  it('the table has one row per manual cash movement, with time/type/reason/amount columns', () => {
    const model = buildSessionReportModel(REPORT, '25/09/2026', 'fr');
    expect(model.columns.map((c) => c.key)).toEqual(['time', 'type', 'reason', 'amount']);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0].amount).toBe('700.00');
  });

  it('shows an em dash for counted/variance on an open session', () => {
    const model = buildSessionReportModel(OPEN_REPORT, '25/09/2026', 'fr');
    const counted = model.totals?.find((t) => t.value === '—');
    expect(counted).toBeDefined();
  });
});
