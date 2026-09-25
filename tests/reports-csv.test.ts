import { describe, expect, it } from 'vitest';

import { csvBytes, toCsv } from '../src/features/reports/common/csv';

describe('toCsv', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'amount', label: 'Amount', numeric: true },
  ];

  it('uses ; and a decimal comma for fr', () => {
    const text = toCsv(columns, [{ name: 'Pillow', amount: '1234.50' }], 'fr');
    expect(text).toBe('Name;Amount\r\nPillow;1234,50\r\n');
  });

  it('uses , and a decimal point for en', () => {
    const text = toCsv(columns, [{ name: 'Pillow', amount: '1234.50' }], 'en');
    expect(text).toBe('Name,Amount\r\nPillow,1234.50\r\n');
  });

  it('quotes a cell containing the separator, doubling inner quotes', () => {
    const text = toCsv(columns, [{ name: 'Sheets, 200x200 "king"', amount: '10.00' }], 'en');
    expect(text).toContain('"Sheets, 200x200 ""king"""');
  });

  it('quotes a cell containing a newline', () => {
    const text = toCsv(columns, [{ name: 'Line1\nLine2', amount: '1.00' }], 'en');
    expect(text).toContain('"Line1\nLine2"');
  });

  it('ends every line with \\r\\n', () => {
    const text = toCsv(columns, [{ name: 'A', amount: '1.00' }, { name: 'B', amount: '2.00' }], 'en');
    expect(text.split('\r\n')).toEqual(['Name,Amount', 'A,1.00', 'B,2.00', '']);
  });
});

describe('csvBytes', () => {
  it('starts with the UTF-8 BOM', () => {
    const bytes = csvBytes('a,b\r\n');
    // `ignoreBOM: true` is required here because TextDecoder otherwise
    // strips a leading BOM itself — the point of this assertion is to prove
    // the BOM is actually in the bytes, not to exercise the decoder's own
    // BOM handling.
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).charAt(0)).toBe('﻿');
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });
});
