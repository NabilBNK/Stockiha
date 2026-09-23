import { describe, expect, it } from 'vitest';

import { amountInWords } from '../src/shared/documents/amountInWords';

describe('amountInWords (French, spec §5.6/§M2-05)', () => {
  it.each([
    [0, 'zéro dinars algériens'],
    [1, 'un dinar algérien'],
    [21, 'vingt et un dinars algériens'],
    [80, 'quatre-vingts dinars algériens'],
    [81, 'quatre-vingt-un dinars algériens'],
    [100, 'cent dinars algériens'],
    [200, 'deux cents dinars algériens'],
    [201, 'deux cent un dinars algériens'],
    [1000, 'mille dinars algériens'],
    [1000000, 'un million de dinars algériens'],
  ])('amountInWords(%s, "fr") === %j', (amount, expected) => {
    expect(amountInWords(amount, 'fr')).toBe(expected);
  });

  it('spells out a fractional amount with the centimes clause', () => {
    expect(amountInWords('12345.60', 'fr')).toBe(
      'douze mille trois cent quarante-cinq dinars algériens et soixante centimes',
    );
  });

  it('omits the centimes clause entirely when the fraction is .00', () => {
    expect(amountInWords('99.00', 'fr')).not.toContain('et');
    expect(amountInWords('99.00', 'fr')).toBe('quatre-vingt-dix-neuf dinars algériens');
  });

  it('prefixes negative amounts with "moins"', () => {
    expect(amountInWords(-21, 'fr')).toBe('moins vingt et un dinars algériens');
  });

  it('falls back to the plain formatted number above 999 999 999 999.99', () => {
    const result = amountInWords('1000000000000.00', 'fr');
    expect(result).toBe('1 000 000 000 000,00');
  });

  it('falls back to the plain formatted number for a negative amount above the max, with the moins prefix', () => {
    const result = amountInWords('-1000000000000.00', 'fr');
    expect(result).toBe('moins 1 000 000 000 000,00');
  });
});

describe('amountInWords (English)', () => {
  it('spells out a whole amount', () => {
    expect(amountInWords(1245, 'en')).toBe('one thousand two hundred forty-five Algerian dinars');
  });

  it('uses the singular noun for exactly one dinar', () => {
    expect(amountInWords(1, 'en')).toBe('one Algerian dinar');
  });

  it('includes the centimes clause with "and"', () => {
    expect(amountInWords('10.50', 'en')).toBe('ten Algerian dinars and fifty centimes');
  });
});
