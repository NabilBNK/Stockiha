/**
 * WS-F-002 — builds professional receipt formats from a posted sale.
 *
 * THERMAL: ESC/POS bytes for a roll printer, laid out with high visual hierarchy,
 * clear column headers, bold/enlarged store identity, prominent grand totals,
 * and typographical character cleaning.
 * A4: a beautifully styled HTML invoice document handed to the shared A4 print service.
 *
 * Money arrives here as decimal strings and is never converted to a number.
 */
import type { PrintingSettingsDto } from '../../shared/ipc/dto';
import { escapeHtml } from '../../shared/documents/documentPrintService';

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

/** Builds the professional A4 HTML for one receipt. */
export function buildA4Receipt(input: ReceiptInput, settings: PrintingSettingsDto): string {
  const fullDate = input.documentTime
    ? `${input.documentDate} ${input.documentTime}`
    : input.documentDate;

  const totalItems = input.lines.reduce((sum, l) => sum + l.qty, 0);
  const hasDiscount = Boolean(
    input.discount && input.discount.trim() !== '' && input.discount !== '0' && input.discount !== '0.00',
  );

  const rows = input.lines
    .map(
      (l) => `<tr>
        <td style="font-weight: 500;">${escapeHtml(l.name)}</td>
        <td style="text-align: center; color: #475569;">${escapeHtml(String(l.qty))}</td>
        <td style="text-align: right; color: #475569;">${escapeHtml(l.unitPrice)}</td>
        <td style="text-align: right; font-weight: 600;">${escapeHtml(l.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8" />
    <title>Ticket ${escapeHtml(input.documentNumber)}</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        margin: 0;
        padding: 32px;
        color: #0f172a;
        background: #ffffff;
        font-size: 13px;
        line-height: 1.5;
      }
      .receipt-box {
        max-width: 600px;
        margin: 0 auto;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 28px;
      }
      .header-section {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        border-bottom: 2px solid #0f172a;
        padding-bottom: 16px;
        margin-bottom: 20px;
      }
      .shop-name {
        font-size: 20px;
        font-weight: 700;
        color: #0f172a;
        margin: 0 0 4px 0;
      }
      .shop-details {
        color: #64748b;
        font-size: 12px;
      }
      .doc-badge {
        text-align: right;
      }
      .doc-title {
        font-size: 16px;
        font-weight: 700;
        color: #0f172a;
        margin: 0;
      }
      .doc-number {
        font-size: 14px;
        font-weight: 600;
        color: #2563eb;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 12px 16px;
        margin-bottom: 20px;
      }
      .meta-item {
        font-size: 12px;
      }
      .meta-item strong {
        color: #475569;
        font-weight: 600;
      }
      table.items {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
      }
      table.items th {
        background: #f1f5f9;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 8px 10px;
        border-top: 1px solid #cbd5e1;
        border-bottom: 1px solid #cbd5e1;
      }
      table.items td {
        padding: 10px;
        border-bottom: 1px solid #f1f5f9;
      }
      .total-section {
        background: #f8fafc;
        border: 2px solid #0f172a;
        border-radius: 6px;
        padding: 14px 18px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 12px;
      }
      .total-label {
        font-size: 14px;
        font-weight: 700;
        text-transform: uppercase;
        color: #0f172a;
      }
      .total-val {
        font-size: 20px;
        font-weight: 800;
        color: #0f172a;
      }
      .footer {
        margin-top: 28px;
        text-align: center;
        border-top: 1px dashed #cbd5e1;
        padding-top: 16px;
        color: #64748b;
        font-size: 12px;
      }
    </style></head><body>
    <div class="receipt-box">
      <div class="header-section">
        <div>
          <h1 class="shop-name">${escapeHtml(settings.shop_name || 'TICKET DE CAISSE')}</h1>
          <div class="shop-details">
            ${settings.shop_address ? `<div>${escapeHtml(settings.shop_address)}</div>` : ''}
            ${settings.shop_phone ? `<div>Tel: ${escapeHtml(settings.shop_phone)}</div>` : ''}
          </div>
        </div>
        <div class="doc-badge">
          <div class="doc-title">TICKET DE CAISSE</div>
          <div class="doc-number">N° ${escapeHtml(input.documentNumber)}</div>
        </div>
      </div>

      <div class="meta-grid">
        <div class="meta-item"><strong>Date :</strong> ${escapeHtml(fullDate)}</div>
        <div class="meta-item"><strong>Caissier :</strong> ${escapeHtml(input.cashierName || '—')}</div>
        <div class="meta-item"><strong>Mode de paiement :</strong> ${escapeHtml(input.paymentLabel)}</div>
        ${input.customerName ? `<div class="meta-item"><strong>Client :</strong> ${escapeHtml(input.customerName)}</div>` : ''}
      </div>

      <table class="items">
        <thead>
          <tr>
            <th style="text-align: left;">Article</th>
            <th style="text-align: center; width: 60px;">Qté</th>
            <th style="text-align: right; width: 90px;">P.U.</th>
            <th style="text-align: right; width: 100px;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="font-size: 12px; color: #64748b; margin-bottom: 8px;">
        Nombre d'articles : <strong>${totalItems}</strong>
      </div>

      ${hasDiscount ? `
      <div style="margin-top: 8px; margin-bottom: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px;">
        <div style="display: flex; justify-content: space-between; font-size: 13px; color: #475569; margin-bottom: 4px;">
          <span>${input.locale === 'ar' ? 'المجموع الفرعي :' : input.locale === 'en' ? 'Subtotal :' : 'Sous-total :'}</span>
          <span style="font-weight: 600;">${escapeHtml(input.subtotal ?? input.total)} ${escapeHtml(input.currency)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px; color: #dc2626; font-weight: 600;">
          <span>${input.locale === 'ar' ? 'التخفيض الممنوح :' : input.locale === 'en' ? 'Discount :' : 'Remise accordée :'}</span>
          <span>-${escapeHtml(input.discount || '')} ${escapeHtml(input.currency)}</span>
        </div>
      </div>
      ` : ''}

      <div class="total-section">
        <div class="total-label">${input.locale === 'ar' ? 'الصافي للدفع' : input.locale === 'en' ? 'Total Net to Pay' : 'Total Net à Payer'}</div>
        <div class="total-val">${escapeHtml(input.total)} ${escapeHtml(input.currency)}</div>
      </div>

      <div class="footer">
        <div style="font-weight: 600; margin-bottom: 4px;">*** MERCI DE VOTRE VISITE ***</div>
        ${settings.receipt_footer ? `<div>${escapeHtml(settings.receipt_footer)}</div>` : ''}
      </div>
    </div>
    </body></html>`;
}
