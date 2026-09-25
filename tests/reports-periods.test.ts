import { describe, expect, it } from 'vitest';

import {
  comparisonPeriod,
  presetPeriod,
  weekStart,
  type Period,
} from '../src/features/reports/common/periods';

// 2026-09-27 is a Sunday (per the WS-I plan's own fixture date).
const TODAY = new Date('2026-09-27T10:00:00.000Z');

describe('presetPeriod', () => {
  it('TODAY is the current day', () => {
    expect(presetPeriod('TODAY', TODAY)).toEqual({ from: '2026-09-27', to: '2026-09-27', preset: 'TODAY' });
  });

  it('YESTERDAY is the previous day', () => {
    expect(presetPeriod('YESTERDAY', TODAY)).toEqual({ from: '2026-09-26', to: '2026-09-26', preset: 'YESTERDAY' });
  });

  it('THIS_WEEK starts on Saturday', () => {
    expect(presetPeriod('THIS_WEEK', TODAY)).toEqual({ from: '2026-09-26', to: '2026-09-27', preset: 'THIS_WEEK' });
  });

  it('LAST_WEEK is the full Saturday-to-Friday week before', () => {
    expect(presetPeriod('LAST_WEEK', TODAY)).toEqual({ from: '2026-09-19', to: '2026-09-25', preset: 'LAST_WEEK' });
  });

  it('THIS_MONTH runs from day 1 to today', () => {
    expect(presetPeriod('THIS_MONTH', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-27', preset: 'THIS_MONTH' });
  });

  it('LAST_MONTH is the whole previous month', () => {
    expect(presetPeriod('LAST_MONTH', TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-31', preset: 'LAST_MONTH' });
  });

  it('THIS_YEAR runs from 1 January to today', () => {
    expect(presetPeriod('THIS_YEAR', TODAY)).toEqual({ from: '2026-01-01', to: '2026-09-27', preset: 'THIS_YEAR' });
  });

  it('LAST_MONTH crosses the year boundary correctly', () => {
    const jan = new Date('2026-01-05T10:00:00.000Z');
    expect(presetPeriod('LAST_MONTH', jan)).toEqual({ from: '2025-12-01', to: '2025-12-31', preset: 'LAST_MONTH' });
  });
});

describe('weekStart', () => {
  it('finds the Saturday for a Sunday date', () => {
    expect(weekStart('2026-09-27')).toBe('2026-09-26');
  });

  it('a Saturday maps to itself', () => {
    expect(weekStart('2026-09-26')).toBe('2026-09-26');
  });

  it('a Friday maps to the Saturday six days earlier', () => {
    expect(weekStart('2026-10-02')).toBe('2026-09-26');
  });
});

describe('comparisonPeriod', () => {
  it('TODAY compares to the same weekday 7 days earlier', () => {
    const p: Period = { from: '2026-09-27', to: '2026-09-27', preset: 'TODAY' };
    expect(comparisonPeriod(p)).toEqual({ from: '2026-09-20', to: '2026-09-20', preset: 'TODAY' });
  });

  it('THIS_MONTH compares to the same day count, clipped to the month', () => {
    const p: Period = { from: '2026-09-01', to: '2026-09-27', preset: 'THIS_MONTH' };
    expect(comparisonPeriod(p)).toEqual({ from: '2026-08-01', to: '2026-08-27', preset: 'THIS_MONTH' });
  });

  it('CUSTOM compares to the same number of days immediately before', () => {
    const p: Period = { from: '2026-09-18', to: '2026-09-27', preset: 'CUSTOM' };
    expect(comparisonPeriod(p)).toEqual({ from: '2026-09-08', to: '2026-09-17', preset: 'CUSTOM' });
  });
});
