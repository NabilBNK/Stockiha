// WS-I-1 §5.8 — quantity display with an optional pack figure (A6).
// `conversion_factor` means 1 alternate unit = conversion_factor base units,
// so packs = base_qty ÷ conversion_factor.

import type { Locale } from '../../../shared/i18n';

function formatNumber(value: string | number, locale: Locale): string {
  const n = typeof value === 'number' ? value : Number(value);
  const rounded = Math.round(n * 100) / 100;
  let text = rounded.toFixed(2);
  if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '');
  }
  const decimalSeparator = locale === 'en' ? '.' : ',';
  return text.replace('.', decimalSeparator);
}

export function formatQuantityWithPack(
  base: string,
  baseUnit: string,
  packUnit: string | null,
  packFactor: string | null,
  locale: Locale,
): string {
  const baseText = `${formatNumber(base, locale)} ${baseUnit}`;
  if (!packUnit || packFactor === null || packFactor === undefined) return baseText;
  const factor = Number(packFactor);
  if (!Number.isFinite(factor) || factor === 0) return baseText;
  const packs = Number(base) / factor;
  return `${baseText} (${formatNumber(packs, locale)} ${packUnit})`;
}
