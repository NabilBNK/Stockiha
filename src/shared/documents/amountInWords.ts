/**
 * WS-M-2 (spec §5.6): the grand total spelled out, for A4 documents whose
 * identity has `amount_in_words: true`. French rules per the specification;
 * a plain English cardinal reading is offered for the `en` print locale.
 * Arabic is a deliberate limitation (spec §A5): callers pass `'fr'` when the
 * print locale is `ar` so the sentence still reads correctly, under an
 * Arabic label.
 */

const MAX_SUPPORTED = 999_999_999_999.99;

const FR_UNITS = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
];
const FR_TEENS: Record<number, string> = {
  10: 'dix', 11: 'onze', 12: 'douze', 13: 'treize', 14: 'quatorze',
  15: 'quinze', 16: 'seize', 17: 'dix-sept', 18: 'dix-huit', 19: 'dix-neuf',
};
const FR_TENS: Record<number, string> = {
  2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante',
};

function frTwoDigits(n: number, terminal: boolean): string {
  if (n <= 16) return FR_UNITS[n];
  if (n <= 19) return FR_TEENS[n];

  const tens = Math.floor(n / 10);
  const units = n % 10;

  if (tens === 7) {
    const sub = n - 60;
    if (sub === 10) return 'soixante-dix';
    if (sub === 11) return 'soixante et onze';
    return `soixante-${FR_TEENS[sub]}`;
  }
  if (tens === 8) {
    const base = `quatre-vingt${units === 0 && terminal ? 's' : ''}`;
    return units === 0 ? base : `${base}-${FR_UNITS[units]}`;
  }
  if (tens === 9) {
    const sub = n - 80;
    if (sub === 10) return 'quatre-vingt-dix';
    return `quatre-vingt-${FR_TEENS[sub]}`;
  }

  const base = FR_TENS[tens];
  if (units === 0) return base;
  if (units === 1) return `${base} et un`;
  return `${base}-${FR_UNITS[units]}`;
}

function frThreeDigits(n: number, terminal: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];

  if (hundreds > 0) {
    const plural = hundreds >= 2 && rest === 0 && terminal ? 's' : '';
    parts.push(hundreds === 1 ? 'cent' : `${FR_UNITS[hundreds]} cent${plural}`);
  }
  if (rest > 0) {
    parts.push(frTwoDigits(rest, terminal));
  }
  return parts.join(' ');
}

/** Big-endian groups of 3 digits: [milliards, millions, mille, unités]. */
function toGroups(n: number): number[] {
  const groups: number[] = [];
  let remaining = Math.trunc(n);
  for (let i = 0; i < 4; i += 1) {
    groups.unshift(remaining % 1000);
    remaining = Math.trunc(remaining / 1000);
  }
  return groups;
}

function frInteger(n: number): string {
  if (n === 0) return 'zéro';

  const [milliards, millions, mille, unites] = toGroups(n);
  const words: string[] = [];
  let takesDe = false;

  if (milliards > 0) {
    words.push(milliards === 1 ? 'un milliard' : `${frThreeDigits(milliards, false)} milliards`);
    if (millions === 0 && mille === 0 && unites === 0) takesDe = true;
  }
  if (millions > 0) {
    words.push(millions === 1 ? 'un million' : `${frThreeDigits(millions, false)} millions`);
    takesDe = mille === 0 && unites === 0;
  }
  if (mille > 0) {
    words.push(mille === 1 ? 'mille' : `${frThreeDigits(mille, false)} mille`);
    takesDe = false;
  }
  if (unites > 0 || words.length === 0) {
    words.push(frThreeDigits(unites, true));
  }

  return words.join(' ') + (takesDe ? ' de' : '');
}

const EN_UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
];
const EN_TENS: Record<number, string> = {
  2: 'twenty', 3: 'thirty', 4: 'forty', 5: 'fifty', 6: 'sixty', 7: 'seventy', 8: 'eighty', 9: 'ninety',
};

function enTwoDigits(n: number): string {
  if (n <= 19) return EN_UNITS[n];
  const tens = Math.floor(n / 10);
  const units = n % 10;
  return units === 0 ? EN_TENS[tens] : `${EN_TENS[tens]}-${EN_UNITS[units]}`;
}

function enThreeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${EN_UNITS[hundreds]} hundred`);
  if (rest > 0) parts.push(enTwoDigits(rest));
  return parts.join(' ');
}

function enInteger(n: number): string {
  if (n === 0) return 'zero';

  const [milliards, millions, mille, unites] = toGroups(n);
  const words: string[] = [];
  if (milliards > 0) words.push(`${enThreeDigits(milliards)} billion`);
  if (millions > 0) words.push(`${enThreeDigits(millions)} million`);
  if (mille > 0) words.push(`${enThreeDigits(mille)} thousand`);
  if (unites > 0 || words.length === 0) words.push(enThreeDigits(unites));

  return words.join(' ');
}

function plainNumber(amount: number, locale: 'fr' | 'en'): string {
  const sign = amount < 0 ? '-' : '';
  const fixed = Math.abs(amount).toFixed(2);
  const [intPart, fracPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'fr' ? ' ' : ',');
  return `${sign}${grouped}${locale === 'fr' ? ',' : '.'}${fracPart}`;
}

/**
 * Spells out `amount` (a decimal string or number, at most 2 fraction
 * digits) in `locale`. Negative amounts are prefixed ("moins " / "minus ").
 * The centimes clause is omitted entirely when the fraction is `.00`.
 * Amounts above 999 999 999 999.99 fall back to the plain formatted number
 * (spec §5.6).
 */
export function amountInWords(amount: string | number, locale: 'fr' | 'en'): string {
  const numeric = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(numeric)) return locale === 'fr' ? 'zéro dinars algériens' : 'zero Algerian dinars';

  const isNegative = numeric < 0;
  const absolute = Math.abs(numeric);

  if (absolute > MAX_SUPPORTED) {
    return `${isNegative ? (locale === 'fr' ? 'moins ' : 'minus ') : ''}${plainNumber(absolute, locale)}`;
  }

  // Round to 2 decimals via integer cents to avoid binary float drift.
  const totalCents = Math.round(absolute * 100);
  const integerPart = Math.trunc(totalCents / 100);
  const fractionPart = totalCents % 100;

  const prefix = isNegative ? (locale === 'fr' ? 'moins ' : 'minus ') : '';

  if (locale === 'fr') {
    const dinarsWord = integerPart === 1 ? 'un dinar algérien' : `${frInteger(integerPart)} dinars algériens`;
    let sentence = `${prefix}${dinarsWord}`;
    if (fractionPart > 0) {
      const centimesWord = fractionPart === 1 ? 'un centime' : `${frInteger(fractionPart)} centimes`;
      sentence += ` et ${centimesWord}`;
    }
    return sentence;
  }

  const dinarsWord = integerPart === 1 ? 'one Algerian dinar' : `${enInteger(integerPart)} Algerian dinars`;
  let sentence = `${prefix}${dinarsWord}`;
  if (fractionPart > 0) {
    const centimesWord = fractionPart === 1 ? 'one centime' : `${enInteger(fractionPart)} centimes`;
    sentence += ` and ${centimesWord}`;
  }
  return sentence;
}
