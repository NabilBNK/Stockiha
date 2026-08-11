export function addExactDecimals(values: string[]): string {
  if (values.length === 0) return '0';
  const parsed = values.map((value) => {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (!match) return { units: 0n, scale: 0 };
    const fraction = match[3] ?? '';
    const sign = match[1] === '-' ? -1n : 1n;
    return {
      units: sign * BigInt(`${match[2]}${fraction}`),
      scale: fraction.length,
    };
  });
  const scale = Math.max(...parsed.map((item) => item.scale));
  const total = parsed.reduce(
    (sum, item) => sum + item.units * 10n ** BigInt(scale - item.scale),
    0n,
  );
  const sign = total < 0n ? '-' : '';
  const absolute = total < 0n ? -total : total;
  if (scale === 0) return `${sign}${absolute}`;
  const padded = absolute.toString().padStart(scale + 1, '0');
  const integer = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, '');
  return fraction ? `${sign}${integer}.${fraction}` : `${sign}${integer}`;
}

export function isPositiveDecimal(value: string): boolean {
  return /^(?:0*[1-9]\d*)(?:\.\d+)?$|^0*\.\d*[1-9]\d*$/.test(value.trim());
}

function decimalUnits(value: string): { units: bigint; scale: number } | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = match[2] ?? '';
  return {
    units: BigInt(`${match[1]}${fraction}`),
    scale: fraction.length,
  };
}

export function isDecimalLessThanOrEqual(value: string, limit: string): boolean {
  const left = decimalUnits(value);
  const right = decimalUnits(limit);
  if (!left || !right) return false;
  const scale = Math.max(left.scale, right.scale);
  return left.units * 10n ** BigInt(scale - left.scale)
    <= right.units * 10n ** BigInt(scale - right.scale);
}
