import { describe, expect, it } from 'vitest';

import { currentBusinessDate } from '../src/shared/utils/businessDate';

describe('currentBusinessDate', () => {
  it('uses Africa/Algiers instead of workstation UTC date', () => {
    // Algeria is UTC+1: this instant is already July 31 in business time.
    expect(currentBusinessDate(new Date('2026-07-30T23:30:00.000Z'))).toBe('2026-07-31');
  });

  it('keeps the previous business day before Algiers midnight', () => {
    expect(currentBusinessDate(new Date('2026-07-30T22:30:00.000Z'))).toBe('2026-07-30');
  });
}
