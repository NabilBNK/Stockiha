export function formatExactDecimal(value: string): string {
  const [integer, fraction = ''] = value.split('.');
  const compactFraction = fraction.replace(/0+$/, '');
  return compactFraction ? `${integer}.${compactFraction}` : integer;
}
