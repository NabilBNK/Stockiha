import type { Locale } from '../i18n';
import type { SeriesBucket } from '../ipc/dashboardDto';
import { formatMonthYear, formatShortDate } from '../utils/formatters';

/**
 * Chart geometry only (WS-N D2/7.4). Never display the result.
 */
export function toPlotNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

/**
 * Formats compact tick marks for chart axes.
 * e.g. 58500 -> "58.5K" (en-GB/fr-FR/ar-DZ)
 */
export function compactTick(value: number, locale: Locale): string {
  const tag = locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-FR' : 'en-GB';
  return new Intl.NumberFormat(tag, {
    notation: 'compact',
    maximumFractionDigits: 1,
    numberingSystem: 'latn',
  }).format(value);
}

/**
 * Formats a series point bucket label based on granularity.
 */
export function bucketLabel(
  bucketStart: string,
  bucket: SeriesBucket,
  locale: Locale = 'en',
): string {
  if (!bucketStart) return '';
  if (bucket === 'HOUR') {
    // Expected ISO format e.g. "2026-09-24T09:00:00" -> "09:00"
    const tIndex = bucketStart.indexOf('T');
    if (tIndex >= 0 && bucketStart.length >= tIndex + 3) {
      return `${bucketStart.slice(tIndex + 1, tIndex + 3)}:00`;
    }
    // Fallback if space-separated
    const spaceIndex = bucketStart.indexOf(' ');
    if (spaceIndex >= 0 && bucketStart.length >= spaceIndex + 3) {
      return `${bucketStart.slice(spaceIndex + 1, spaceIndex + 3)}:00`;
    }
    return bucketStart.slice(11, 16) || bucketStart;
  }

  if (bucket === 'DAY') {
    return formatShortDate(bucketStart, locale);
  }

  if (bucket === 'MONTH') {
    return formatMonthYear(bucketStart, locale);
  }

  return bucketStart;
}

/**
 * Maps a count and maximum count to heatmap intensity class 0..5.
 */
export function heatClass(count: number, max: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (count <= 0 || max <= 0) return 0;
  const raw = Math.ceil((count * 5) / max);
  const clamped = Math.min(5, Math.max(1, raw));
  return clamped as 1 | 2 | 3 | 4 | 5;
}
