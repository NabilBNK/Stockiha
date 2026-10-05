import type { Locale, MessageKey } from '../../shared/i18n';
import { formatDisplayDate } from '../../shared/utils/formatters';
import type { DeltaKind } from '../../shared/ipc/dashboardDto';

/**
 * Parses a decimal string and groups the integer part with commas.
 * fraction is '.' + exactly 2 digits.
 * No parseFloat/Number() used; pure string operations.
 */
export function splitAmount(value: string | null | undefined): {
  sign: '' | '-';
  integer: string;
  fraction: string;
} {
  if (!value) {
    return { sign: '', integer: '0', fraction: '.00' };
  }
  const trimmed = value.trim();
  let sign: '' | '-' = '';
  let rest = trimmed;

  if (rest.startsWith('-')) {
    sign = '-';
    rest = rest.slice(1).trim();
  }

  const parts = rest.split('.');
  const rawInt = parts[0] || '0';
  const integer = rawInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  let frac = parts.length > 1 ? parts[1] : '00';
  if (frac.length === 0) {
    frac = '00';
  } else if (frac.length === 1) {
    frac = `${frac}0`;
  } else if (frac.length > 2) {
    frac = frac.slice(0, 2);
  }

  return {
    sign,
    integer,
    fraction: `.${frac}`,
  };
}

/**
 * Integer with comma grouping.
 * e.g. 7 -> "7"; 12000 -> "12,000"
 */
export function formatCount(n: number): string {
  const isNegative = n < 0;
  const absInt = Math.floor(Math.abs(n)).toString();
  const grouped = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return isNegative ? `-${grouped}` : grouped;
}

/**
 * Absolute percentage value, one decimal kept as given.
 * e.g. "-76.4" -> "76.4"; "31.3" -> "31.3"
 */
export function formatPct(value: string | null | undefined): string {
  if (!value) return '0.0';
  return value.trim().replace(/^-/, '');
}

/**
 * Text for delta line comparing with previous period.
 */
export function deltaText(
  kind: DeltaKind,
  pct: string | null,
  prevAmountText: string,
  t: (k: MessageKey, params?: Record<string, string | number>) => string,
): string {
  switch (kind) {
    case 'UP':
      return t('dash.delta.up', { pct: formatPct(pct) });
    case 'DOWN':
      return t('dash.delta.down', { pct: formatPct(pct) });
    case 'FLAT':
      return t('dash.delta.flat');
    case 'NO_BASE':
      return t('dash.delta.noBase', { value: prevAmountText });
    case 'NONE':
    default:
      return '';
  }
}

/**
 * Formats a period range.
 * If from === to -> single formatted date.
 * Else -> dash.period.range with both formatted dates.
 */
export function formatRange(
  from: string,
  to: string,
  locale: Locale,
  t: (k: MessageKey, params?: Record<string, string | number>) => string,
): string {
  const fromFormatted = formatDisplayDate(from, locale);
  if (from === to) {
    return fromFormatted;
  }
  const toFormatted = formatDisplayDate(to, locale);
  return t('dash.period.range', { from: fromFormatted, to: toFormatted });
}

/**
 * Cuts seconds from HH:MM:SS format: "12:00:00" -> "12:00", null -> null.
 */
export function formatCutTime(cut: string | null): string | null {
  if (!cut) return null;
  return cut.slice(0, 5);
}

/**
 * Formats the time of sale.
 * If on the same date as today -> "HH:MM".
 * Else -> formatted date + ' ' + "HH:MM".
 */
export function formatTimeOfSale(
  postedLocal: string,
  today: string,
  locale: Locale,
): string {
  if (!postedLocal) return '';
  const datePart = postedLocal.includes('T')
    ? postedLocal.split('T')[0]
    : postedLocal.split(' ')[0];
  const timePart = postedLocal.includes('T')
    ? postedLocal.split('T')[1]?.slice(0, 5) ?? ''
    : postedLocal.split(' ')[1]?.slice(0, 5) ?? '';

  if (datePart === today) {
    return timePart;
  }
  const displayDate = formatDisplayDate(datePart, locale);
  return `${displayDate} ${timePart}`.trim();
}

/**
 * Formats the current time in Africa/Algiers as "HH:MM" (24-hour).
 */
export function nowClockLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Algiers',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
