/**
 * WS-F-002 — builds thermal receipt formats from a posted sale.
 * WS-M-2 — the A4 receipt is now built by the shared engine (see
 * `printReceipt.ts` + `models/saleInvoiceModel.ts`); this file only builds
 * ESC/POS bytes for a roll printer.
 *
 * Money arrives here as decimal strings and is never converted to a number.
 */
import type { PrintingSettingsDto } from '../../shared/ipc/dto';

export interface ReceiptLineInput {
  name: string;
  qty: number;
  unitPrice: string;
  lineTotal: string;
}

export interface ReceiptInput {
  documentNumber: string;
  documentDate: string;
  documentTime?: string;
  cashierName: string;
  paymentLabel: string;
  customerName: string | null;
  lines: ReceiptLineInput[];
  subtotal?: string;
  discount?: string | null;
  total: string;
  currency: string;
  locale?: string;
}

export interface ReceiptItemNameOptions {
  productName?: string;
  variantName?: string;
  fallbackName: string;
  attributes?: Array<{ name: string; value: string; visible_on_receipt?: boolean }>;
}

/**
 * Formats a product/variant name for receipts (both Thermal and A4).
 * - Filters out attributes marked `visible_on_receipt: false`.
 * - Prevents product name duplication (e.g. "cuette - cuette - M...").
 * - Honors custom variant name overrides (`name_override`).
 */
export function formatReceiptItemName(item: ReceiptItemNameOptions): string {
  const pName = (item.productName ?? '').trim();
  const vName = (item.variantName ?? '').trim();

  // If attributes exist, check visibility
  if (item.attributes && item.attributes.length > 0) {
    // Check if variantName is a custom override (does not start with productName)
    const isCustomOverride = vName && pName && !vName.toLowerCase().startsWith(pName.toLowerCase());
    if (isCustomOverride) {
      return vName;
    }

    const visibleAttrs = item.attributes.filter((a) => a.visible_on_receipt !== false);
    const baseName = pName || item.fallbackName;

    if (visibleAttrs.length > 0) {
      return `${baseName} - ${visibleAttrs.map((a) => a.value.trim()).join(' - ')}`;
    }
    return baseName;
  }

  // Fallback when no attributes metadata is present
  if (vName && pName) {
    if (vName.toLowerCase().startsWith(pName.toLowerCase())) {
      return vName;
    }
    return `${pName} - ${vName}`;
  }

  return vName || pName || item.fallbackName;
}

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Replaces unicode typographical marks, em-dashes, and accented vowels
 * with clean single-byte equivalents so thermal printers never print '?'
 * for everyday characters like '—', '’', 'é', etc.
 */
export function sanitizeForPrinter(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F\u00AB\u00BB]/g, '"')
    .replace(/[\u2022\u2023\u25E6\u2043]/g, '*')
    .replace(/[\u00D7]/g, 'x')
    .replace(/[\u2026]/g, '...')
    .replace(/[\u2116]/g, 'N.')
    .replace(/[éèêëÉÈÊË]/g, (c) => ('éèêë'.includes(c) ? 'e' : 'E'))
    .replace(/[àâäÀÂÄ]/g, (c) => ('àâä'.includes(c) ? 'a' : 'A'))
    .replace(/[îïÎÏ]/g, (c) => ('îï'.includes(c) ? 'i' : 'I'))
    .replace(/[ôöÔÖ]/g, (c) => ('ôö'.includes(c) ? 'o' : 'O'))
    .replace(/[ùûüÙÛÜ]/g, (c) => ('ùûü'.includes(c) ? 'u' : 'U'))
    .replace(/[çÇ]/g, (c) => ('ç'.includes(c) ? 'c' : 'C'));
}

/**
 * Maps a string to single-byte values. Characters above U+00FF that cannot be
 * represented in the printer's single-byte code page become '?'.
 */
export function toPrinterBytes(text: string): number[] {
  const sanitized = sanitizeForPrinter(text);
  const bytes: number[] = [];
  for (const char of sanitized) {
    const code = char.codePointAt(0) ?? 63;
    bytes.push(code <= 0xff ? code : 63);
  }
  return bytes;
}

export function padEnd(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

export function padStart(text: string, width: number): string {
  return text.length >= width ? text.slice(text.length - width) : ' '.repeat(width - text.length) + text;
}

/** Builds the ESC/POS byte payload for one receipt. */
export function buildThermalReceipt(
  input: ReceiptInput,
  settings: PrintingSettingsDto,
): number[] {
  const width = settings.thermal_columns;
  const bytes: number[] = [];

  bytes.push(ESC, 0x40); // Initialise printer

  const line = (text: string) => {
    bytes.push(...toPrinterBytes(text), 0x0a);
  };

  // 1. Header (Store Identity)
  bytes.push(ESC, 0x61, 0x01); // Center alignment

  if (settings.shop_name) {
    bytes.push(ESC, 0x45, 0x01); // Bold ON
    if (settings.shop_name.length <= Math.floor(width / 2)) {
      bytes.push(GS, 0x21, 0x11); // Double width + double height
    } else {
      bytes.push(GS, 0x21, 0x01); // Double height
    }
    line(settings.shop_name);
    bytes.push(GS, 0x21, 0x00); // Normal size
    bytes.push(ESC, 0x45, 0x00); // Bold OFF
  }

  if (settings.shop_address) {
    line(settings.shop_address);
  }

  if (settings.shop_phone) {
    const phone = settings.shop_phone.toLowerCase().startsWith('tel')
      ? settings.shop_phone
      : `Tel: ${settings.shop_phone}`;
    line(phone);
  }

  bytes.push(ESC, 0x61, 0x00); // Left alignment
  line('='.repeat(width));

  // 2. Metadata (Ticket, Date, Cashier, Customer)
  const fullDate = input.documentTime
    ? `${input.documentDate}  ${input.documentTime}`
    : input.documentDate;

  if (width >= 42) {
    const half = Math.floor(width / 2);
    const tktStr = `Ticket: ${input.documentNumber}`;
    const dateStr = `Date: ${fullDate}`;
    line(padEnd(tktStr, half) + padStart(dateStr, width - half));

    const cashStr = `Caissier: ${input.cashierName || '-'}`;
    const modeStr = `Mode: ${input.paymentLabel}`;
    line(padEnd(cashStr, half) + padStart(modeStr, width - half));

    if (input.customerName) {
      line(`Client: ${input.customerName}`);
    }
  } else {
    line(`Ticket   : ${input.documentNumber}`);
    line(`Date     : ${fullDate}`);
    line(`Caissier : ${input.cashierName || '-'}`);
    line(`Mode     : ${input.paymentLabel}`);
    if (input.customerName) {
      line(`Client   : ${input.customerName}`);
    }
  }

  line('-'.repeat(width));

  // 3. Items Table
  if (width >= 42) {
    const qteW = 4;
    const puW = 9;
    const totW = 10;
    const nameW = width - (qteW + puW + totW + 3);
    line(
      padEnd('ARTICLE', nameW) +
        ' ' +
        padStart('QTE', qteW) +
        ' ' +
        padStart('P.U.', puW) +
        ' ' +
        padStart('TOTAL', totW),
    );
    line('-'.repeat(width));

    input.lines.forEach((l) => {
      line(padEnd(l.name, width));
      const calcLeft = `   ${l.qty} x ${l.unitPrice}`;
      const calcRight = l.lineTotal;
      const gap = Math.max(1, width - calcLeft.length - calcRight.length);
      line(calcLeft + ' '.repeat(gap) + calcRight);
    });
  } else {
    const qteW = 4;
    const totW = 10;
    const nameW = width - (qteW + totW + 2);
    line(padEnd('ARTICLE', nameW) + ' ' + padStart('QTE', qteW) + ' ' + padStart('TOTAL', totW));
    line('-'.repeat(width));

    input.lines.forEach((l) => {
      line(padEnd(l.name, width));
      const calcLeft = `  ${l.qty} x ${l.unitPrice}`;
      const calcRight = l.lineTotal;
      const gap = Math.max(1, width - calcLeft.length - calcRight.length);
      line(calcLeft + ' '.repeat(gap) + calcRight);
    });
  }

  // 4. Summary & High-Visibility Total
  line('-'.repeat(width));
  const totalItems = input.lines.reduce((sum, l) => sum + l.qty, 0);
  line(`Nombre d articles : ${totalItems}`);

  const hasDiscount = Boolean(
    input.discount && input.discount.trim() !== '' && input.discount !== '0' && input.discount !== '0.00',
  );
  if (hasDiscount) {
    line('-'.repeat(width));
    const isEn = input.locale === 'en';
    const subLabel = isEn ? 'SUBTOTAL :' : 'SOUS-TOTAL :';
    const subVal = `${input.subtotal ?? input.total} ${input.currency}`;
    const subGap = Math.max(1, width - subLabel.length - subVal.length);
    line(subLabel + ' '.repeat(subGap) + subVal);

    const discLabel = isEn ? 'DISCOUNT :' : 'REMISE :';
    const discVal = `-${input.discount} ${input.currency}`;
    const discGap = Math.max(1, width - discLabel.length - discVal.length);
    line(discLabel + ' '.repeat(discGap) + discVal);
  }

  line('='.repeat(width));

  // Prominent Grand Total in BOLD + DOUBLE-HEIGHT
  bytes.push(ESC, 0x45, 0x01); // Bold ON
  bytes.push(GS, 0x21, 0x01);  // Double-height ON

  const totalStr = `${input.total} ${input.currency}`;
  const totalLabel = input.locale === 'en' ? 'TOTAL TO PAY :' : 'TOTAL A PAYER :';
  const totalGap = Math.max(1, width - totalLabel.length - totalStr.length);
  line(totalLabel + ' '.repeat(totalGap) + totalStr);

  bytes.push(GS, 0x21, 0x00);  // Normal font
  bytes.push(ESC, 0x45, 0x00); // Bold OFF

  line('='.repeat(width));
  line(`Mode de reglement : ${input.paymentLabel}`);

  // 5. Footer
  bytes.push(ESC, 0x61, 0x01); // Center alignment
  line('');
  bytes.push(ESC, 0x45, 0x01); // Bold ON
  line('*** MERCI DE VOTRE VISITE ***');
  bytes.push(ESC, 0x45, 0x00); // Bold OFF

  if (settings.receipt_footer) {
    line(settings.receipt_footer);
  }

  line('-'.repeat(width));
  bytes.push(ESC, 0x61, 0x00); // Reset to left alignment

  bytes.push(0x0a, 0x0a, 0x0a, 0x0a);
  bytes.push(GS, 0x56, 0x42, 0x00); // Feed & partial cut

  return bytes;
}

