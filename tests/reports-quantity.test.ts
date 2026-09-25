import { describe, expect, it } from 'vitest';

import { formatQuantityWithPack } from '../src/features/reports/common/quantity';

describe('formatQuantityWithPack', () => {
  it('shows the pack figure alongside the base quantity', () => {
    expect(formatQuantityWithPack('200', 'pièce', 'carton', '10', 'fr')).toBe('200 pièce (20 carton)');
  });

  it('shows only the base quantity when there is no pack unit', () => {
    expect(formatQuantityWithPack('200', 'pièce', null, null, 'fr')).toBe('200 pièce');
  });

  it('uses a decimal comma for fr', () => {
    expect(formatQuantityWithPack('25', 'pièce', 'carton', '10', 'fr')).toBe('25 pièce (2,5 carton)');
  });

  it('uses a decimal point for en', () => {
    expect(formatQuantityWithPack('25', 'pièce', 'carton', '10', 'en')).toBe('25 pièce (2.5 carton)');
  });

  it('handles a base unit that is itself the larger pack (e.g. boxes)', () => {
    expect(formatQuantityWithPack('20', 'carton', 'pièce', '0.1', 'en')).toBe('20 carton (200 pièce)');
  });
});
