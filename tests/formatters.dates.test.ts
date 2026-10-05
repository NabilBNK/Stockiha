import { describe, it, expect } from 'vitest';
import {
  formatDisplayDate,
  formatShortDate,
  formatMonthYear,
  MONTHS_SHORT,
} from '../src/shared/utils/formatters';

describe('formatters.dates (WS-N-3.2)', () => {
  it('preserves formatDisplayDate output for 2026-08-12', () => {
    expect(formatDisplayDate('2026-08-12', 'en')).toBe('12 Aug 2026');
    expect(formatDisplayDate('2026-08-12', 'fr')).toBe('12 août 2026');
    expect(formatDisplayDate('2026-08-12', 'ar')).toBe('12 أغسطس 2026');
  });

  it('formats short dates (day + short month)', () => {
    expect(formatShortDate('2026-09-05', 'en')).toBe('5 Sep');
    expect(formatShortDate('2026-09-05', 'fr')).toBe('5 sept.');
    expect(formatShortDate('2026-09-05', 'ar')).toBe('5 سبتمبر');
  });

  it('formats month + year', () => {
    expect(formatMonthYear('2026-09-05', 'en')).toBe('Sep 2026');
    expect(formatMonthYear('2026-09-05', 'fr')).toBe('sept. 2026');
    expect(formatMonthYear('2026-09-05', 'ar')).toBe('سبتمبر 2026');
  });

  it('handles null, undefined, and empty strings gracefully', () => {
    expect(formatDisplayDate(null)).toBe('—');
    expect(formatShortDate(undefined)).toBe('—');
    expect(formatMonthYear('')).toBe('—');
  });

  it('exports 12 short months for en, fr, and ar', () => {
    expect(MONTHS_SHORT.en).toHaveLength(12);
    expect(MONTHS_SHORT.fr).toHaveLength(12);
    expect(MONTHS_SHORT.ar).toHaveLength(12);
  });
});
