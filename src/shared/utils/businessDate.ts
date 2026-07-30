const BUSINESS_TIME_ZONE = 'Africa/Algiers';

/**
 * Return the current Stockiha business date as YYYY-MM-DD using the architecture
 * baseline's authoritative Africa/Algiers timezone, independent of workstation
 * timezone configuration.
 */
export function currentBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Unable to resolve Stockiha business date');
  }
  return `${year}-${month}-${day}`;
}
