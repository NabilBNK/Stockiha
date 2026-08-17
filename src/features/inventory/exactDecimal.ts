export function formatExactDecimal(value: string): string {
  const [integer, fraction = ''] = value.split('.');
  const compactFraction = fraction.replace(/0+$/, '');
  return compactFraction ? `${integer}.${compactFraction}` : integer;
}

const EXACT_DECIMAL = /^\d+(?:\.\d+)?$/;
export function isExactDecimalZero(value: string): boolean { return EXACT_DECIMAL.test(value) && /^0*(?:\.0*)?$/.test(value); }
export function isExactDecimalPositive(value: string): boolean { return EXACT_DECIMAL.test(value) && !isExactDecimalZero(value); }
export function localIsoDate(date = new Date()): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
