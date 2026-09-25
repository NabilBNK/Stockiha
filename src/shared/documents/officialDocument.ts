/**
 * WS-M-2 — the one shared A4 template (spec PART 3/5).
 *
 * Every printed A4 page in Stockiha is produced by exactly one of the two
 * pure functions this module exports: `renderOfficialDocumentHtml` (for the
 * print dialog, via `documentPrintService.printDocumentA4`) and
 * `renderOfficialDocumentPdf` (for "Save as PDF"). Both are fed by the same
 * `OfficialDocumentModel` + `OfficialDocumentIdentity` pair built per
 * document kind by `src/shared/documents/models/*`.
 *
 * Design constraints (do not relax without re-reading the specification):
 *  - No colour outside the black/white palette below (§A8).
 *  - No signature block, ever (§O6).
 *  - Column alignment always comes from the model, never guessed from
 *    header text (§A6).
 *  - Renderers never format numbers or dates -- the model builders do.
 */

import amiriFontUrl from '../../../src-tauri/src/infrastructure/pdf_proof/fonts/Amiri-Regular.ttf?url';
import { getPrintStrings } from './printStrings';

export type PrintLocale = 'fr' | 'ar' | 'en';
export type ColumnAlign = 'start' | 'center' | 'end';

export type OfficialDocumentKind =
  | 'SALE_INVOICE'
  | 'PAYMENT_RECEIPT'
  | 'SALE_VOID'
  | 'PURCHASE_RECEIPT'
  | 'SUPPLIER_PAYMENT'
  | 'JOURNAL_ENTRY'
  | 'DOCUMENTS_REPORT'
  | 'JOURNALS_REPORT'
  | 'CASH_SESSION_REPORT'
  // WS-I: reporting print/PDF kinds. All added in WS-I-1 (§4.4) so later
  // sub-plans never touch this union again.
  | 'SALES_SUMMARY'
  | 'SALES_REPORT'
  | 'MARGIN_REPORT'
  | 'PROFIT_LOSS'
  | 'CASH_FLOW'
  | 'MONTHLY_SUMMARY'
  | 'AGING_REPORT'
  | 'CUSTOMER_STATEMENT'
  | 'SUPPLIER_STATEMENT'
  | 'SUPPLIER_BALANCES'
  | 'TRIAL_BALANCE'
  | 'ACCOUNT_LEDGER'
  | 'STOCK_REPORT'
  | 'GENERIC';

export interface OfficialDocumentColumn {
  key: string;
  label: string;
  align: ColumnAlign;
  widthPercent?: number;
}

export interface OfficialDocumentTotal {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface OfficialDocumentInfoRow {
  label: string;
  value: string;
}

export interface OfficialDocumentModel {
  kind: OfficialDocumentKind;
  title: string;
  documentNumber: string;
  documentDateText: string;
  statusText?: string;
  partyBlock?: { title: string; rows: OfficialDocumentInfoRow[] };
  metaBlock?: { title: string; rows: OfficialDocumentInfoRow[] };
  columns: OfficialDocumentColumn[];
  rows: Array<Record<string, string>>;
  totals?: OfficialDocumentTotal[];
  amountInWordsValue?: string;
  notes?: string[];
  footerNote?: string;
}

export interface OfficialDocumentIdentity {
  shopName: string | null;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  nif: string | null;
  nis: string | null;
  rc: string | null;
  ai: string | null;
  rib: string | null;
  logoDataUrl: string | null;
  showEmail: boolean;
  showWebsite: boolean;
  showRib: boolean;
  showLogo: boolean;
  amountInWords: boolean;
  a4FooterNote: string | null;
  printLocale: PrintLocale;
}

/** Escapes HTML characters to prevent XSS. Re-exported by documentPrintService. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function resolveAlign(align: ColumnAlign, isRtl: boolean): 'left' | 'right' | 'center' {
  if (align === 'center') return 'center';
  if (align === 'start') return isRtl ? 'right' : 'left';
  return isRtl ? 'left' : 'right';
}

function now(): Date {
  return new Date();
}

function formatPrintedOnTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// HTML renderer
// ---------------------------------------------------------------------------

function identityBandHtml(identity: OfficialDocumentIdentity, isRtl: boolean): string {
  const lines: string[] = [];
  if (identity.shopName) lines.push(`<div class="shop-name">${escapeHtml(identity.shopName)}</div>`);
  if (identity.legalName) lines.push(`<div class="legal-name">${escapeHtml(identity.legalName)}</div>`);
  if (identity.address) lines.push(`<div class="identity-line">${escapeHtml(identity.address)}</div>`);
  if (identity.phone) lines.push(`<div class="identity-line">${escapeHtml(identity.phone)}</div>`);
  if (identity.showEmail && identity.email) lines.push(`<div class="identity-line">${escapeHtml(identity.email)}</div>`);
  if (identity.showWebsite && identity.website) lines.push(`<div class="identity-line">${escapeHtml(identity.website)}</div>`);

  const logoHtml =
    identity.showLogo && identity.logoDataUrl
      ? `<img class="logo" src="${identity.logoDataUrl}" alt="" />`
      : '';

  return `<div class="identity-band">${isRtl ? '' : logoHtml}<div class="identity-text">${lines.join('')}</div>${isRtl ? logoHtml : ''}</div>`;
}

function documentBandHtml(model: OfficialDocumentModel): string {
  const statusHtml = model.statusText
    ? `<div class="status-box">${escapeHtml(model.statusText)}</div>`
    : '';
  return `<div class="document-band">
    <div class="doc-title">${escapeHtml(model.title)}</div>
    <div class="doc-number">${escapeHtml(model.documentNumber)}</div>
    <div class="doc-date">${escapeHtml(model.documentDateText)}</div>
    ${statusHtml}
  </div>`;
}

function legalLineHtml(identity: OfficialDocumentIdentity, strings: ReturnType<typeof getPrintStrings>): string {
  const parts: string[] = [];
  if (identity.nif) parts.push(`${strings.nif}: ${escapeHtml(identity.nif)}`);
  if (identity.nis) parts.push(`${strings.nis}: ${escapeHtml(identity.nis)}`);
  if (identity.rc) parts.push(`${strings.rc}: ${escapeHtml(identity.rc)}`);
  if (identity.ai) parts.push(`${strings.ai}: ${escapeHtml(identity.ai)}`);
  if (identity.showRib && identity.rib) parts.push(`${strings.rib}: ${escapeHtml(identity.rib)}`);
  if (parts.length === 0) return '';
  return `<div class="legal-line">${parts.join(' &middot; ')}</div>`;
}

function infoBlockHtml(block: { title: string; rows: OfficialDocumentInfoRow[] } | undefined): string {
  if (!block) return '';
  const rowsHtml = block.rows
    .map(
      (row) =>
        `<div class="info-row"><span class="info-label">${escapeHtml(row.label)}</span><span class="info-value">${escapeHtml(row.value)}</span></div>`,
    )
    .join('');
  return `<div class="box info-block"><div class="info-block-title">${escapeHtml(block.title)}</div>${rowsHtml}</div>`;
}

function tableHtml(
  model: OfficialDocumentModel,
  strings: ReturnType<typeof getPrintStrings>,
  isRtl: boolean,
): string {
  const hasWidths = model.columns.some((col) => col.widthPercent !== undefined);
  const headHtml = model.columns
    .map((col) => `<th style="text-align:${resolveAlign(col.align, isRtl)};${col.widthPercent ? `width:${col.widthPercent}%;` : ''}">${escapeHtml(col.label)}</th>`)
    .join('');

  let bodyHtml: string;
  if (model.rows.length === 0) {
    bodyHtml = `<tr><td colspan="${model.columns.length}" class="no-lines">${escapeHtml(strings.noLines)}</td></tr>`;
  } else {
    bodyHtml = model.rows
      .map((row) => {
        const cells = model.columns
          .map((col) => {
            const value = row[col.key] ?? '—';
            return `<td style="text-align:${resolveAlign(col.align, isRtl)}">${escapeHtml(value)}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
  }

  return `<table class="data-table${hasWidths ? ' fixed' : ''}">
    <thead><tr>${headHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>`;
}

function totalsHtml(model: OfficialDocumentModel, isRtl: boolean): string {
  if (!model.totals || model.totals.length === 0) return '';
  const rows = model.totals
    .map(
      (total) =>
        `<tr class="${total.emphasis ? 'grand-total' : ''}"><td class="total-label">${escapeHtml(total.label)}</td><td class="total-value">${escapeHtml(total.value)}</td></tr>`,
    )
    .join('');
  return `<div class="totals-wrapper" style="justify-content:${isRtl ? 'flex-start' : 'flex-end'};"><table class="totals-table">${rows}</table></div>`;
}

function amountInWordsHtml(model: OfficialDocumentModel, identity: OfficialDocumentIdentity, strings: ReturnType<typeof getPrintStrings>): string {
  if (!identity.amountInWords || !model.amountInWordsValue) return '';
  return `<div class="amount-in-words">${escapeHtml(strings.amountInWords)} ${escapeHtml(model.amountInWordsValue)}</div>`;
}

function notesHtml(model: OfficialDocumentModel): string {
  if (!model.notes || model.notes.length === 0) return '';
  return `<div class="notes">${model.notes.map((note) => `<div>${escapeHtml(note)}</div>`).join('')}</div>`;
}

function footerHtml(identity: OfficialDocumentIdentity, strings: ReturnType<typeof getPrintStrings>): string {
  const left = identity.a4FooterNote ? escapeHtml(identity.a4FooterNote) : '';
  const center = `${escapeHtml(strings.printedOn)} ${escapeHtml(formatPrintedOnTimestamp(now()))}`;
  const right = `<span class="footer-made-with">${escapeHtml(strings.madeWith)}</span>`;
  return `<div class="doc-footer"><span>${left}</span><span>${center}</span>${right}</div>`;
}

const HTML_STYLE = `
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    font-size: 9pt;
    color: #000;
    background: #fff;
  }
  .identity-band { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
  .logo { max-width: 28mm; max-height: 18mm; object-fit: contain; }
  .identity-text { flex: 1; }
  .shop-name { font-size: 13pt; font-weight: 700; text-transform: uppercase; }
  .legal-name { font-size: 8pt; }
  .identity-line { font-size: 8pt; color: #444; }
  .document-band { text-align: right; }
  .doc-title { font-size: 16pt; font-weight: 700; text-transform: uppercase; }
  .doc-number { font-size: 11pt; font-family: 'Consolas', 'Courier New', monospace; }
  .doc-date { font-size: 8.5pt; color: #444; }
  .status-box { display: inline-block; margin-top: 4px; padding: 1px 6px; border: 1px solid #000; font-size: 7.5pt; text-transform: uppercase; }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .legal-line { font-size: 7pt; border-top: 1px solid #888; border-bottom: 1px solid #888; padding: 3px 0; margin-bottom: 8px; }
  .blocks-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .box { border: 1px solid #888; padding: 4px 6px; flex: 1; page-break-inside: avoid; }
  .info-block-title { font-size: 8pt; font-weight: 700; text-transform: uppercase; margin-bottom: 3px; }
  .info-row { display: flex; justify-content: space-between; font-size: 8.5pt; }
  table.data-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 8px; }
  table.data-table.fixed { table-layout: fixed; }
  table.data-table thead { display: table-header-group; }
  table.data-table th { background: #f2f2f2; border: 1px solid #888; padding: 3pt 4pt; }
  table.data-table td { border: 1px solid #888; padding: 3pt 4pt; word-wrap: break-word; }
  table.data-table tr { page-break-inside: avoid; }
  .no-lines { text-align: center; color: #444; }
  .totals-wrapper { display: flex; margin-bottom: 8px; }
  .totals-table { width: 60mm; border-collapse: collapse; font-size: 8.5pt; }
  .totals-table td { padding: 2px 4px; }
  .totals-table tr.grand-total { border-top: 1px solid #000; border-bottom: 1px solid #000; font-size: 10pt; font-weight: 700; }
  .amount-in-words { font-style: italic; font-size: 8pt; margin-bottom: 8px; }
  .notes { font-size: 8pt; margin-bottom: 8px; }
  .doc-footer { display: flex; justify-content: space-between; border-top: 1px solid #888; padding-top: 4px; font-size: 6.5pt; }
  .footer-made-with { color: #888; }
`;

/**
 * Builds the printable HTML for one A4 page (spec §5.7). Pure function of
 * its inputs -- never reads settings, never formats numbers/dates itself.
 */
export function renderOfficialDocumentHtml(
  model: OfficialDocumentModel,
  identity: OfficialDocumentIdentity,
): string {
  const isRtl = identity.printLocale === 'ar';
  const strings = getPrintStrings(identity.printLocale);

  return `<!DOCTYPE html>
<html lang="${identity.printLocale}" dir="${isRtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(model.documentNumber)}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
<div class="header-row">
  ${isRtl ? documentBandHtml(model) : identityBandHtml(identity, isRtl)}
  ${isRtl ? identityBandHtml(identity, isRtl) : documentBandHtml(model)}
</div>
${legalLineHtml(identity, strings)}
<div class="blocks-row">
  ${infoBlockHtml(model.partyBlock)}
  ${infoBlockHtml(model.metaBlock)}
</div>
${tableHtml(model, strings, isRtl)}
${totalsHtml(model, isRtl)}
${amountInWordsHtml(model, identity, strings)}
${notesHtml(model)}
${footerHtml(identity, strings)}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// PDF renderer
// ---------------------------------------------------------------------------

const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;
const PDF_MARGIN = 34;

/**
 * Builds the "Save as PDF" bytes for the same model/identity (spec §5.7,
 * §A7). A paginator repeats the identity band and table header on every
 * page and prints "Page X / Y" in the footer -- the HTML path cannot do
 * page numbers (Chromium/WebView2 can't render @page margin boxes), so this
 * is the one place they exist.
 *
 * Arabic text is drawn with the bundled Amiri font; Latin with Helvetica.
 * pdf-lib cannot shape Arabic text (letters may render unjoined) -- a known
 * limitation, not solved here (spec §M2-01 pitfalls). The HTML path prints
 * Arabic correctly; the PDF is for sharing/archival.
 *
 * A `webp` logo cannot be embedded by pdf-lib and is skipped in the PDF
 * (the shop name still prints); the HTML keeps it (spec E-04).
 */
export async function renderOfficialDocumentPdf(
  model: OfficialDocumentModel,
  identity: OfficialDocumentIdentity,
): Promise<Uint8Array> {
  const strings = getPrintStrings(identity.printLocale);
  const isRtl = identity.printLocale === 'ar';

  const [{ PDFDocument, rgb, StandardFonts }, fontkitModule, fontResponse] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
    fetch(amiriFontUrl),
  ]);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkitModule.default);

  const fontBytes = new Uint8Array(await fontResponse.arrayBuffer());
  const amiriFont = await doc.embedFont(fontBytes, { subset: true });
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helveticaItalic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  const regularFont = isRtl ? amiriFont : helvetica;
  const boldFont = isRtl ? amiriFont : helveticaBold;

  const black = rgb(0, 0, 0);
  const secondary = rgb(0x44 / 255, 0x44 / 255, 0x44 / 255);
  const hairline = rgb(0x88 / 255, 0x88 / 255, 0x88 / 255);
  const headerFill = rgb(0xf2 / 255, 0xf2 / 255, 0xf2 / 255);
  const contentWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;

  let logoImage: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  if (identity.showLogo && identity.logoDataUrl) {
    const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(identity.logoDataUrl);
    if (match) {
      const mime = match[1].toLowerCase();
      const bytes = base64ToBytes(match[2]);
      try {
        if (mime === 'png') logoImage = await doc.embedPng(bytes);
        else if (mime === 'jpg' || mime === 'jpeg') logoImage = await doc.embedJpg(bytes);
        // webp: pdf-lib cannot embed it; logoImage stays null (spec E-04).
      } catch {
        logoImage = null;
      }
    }
  }

  const pages: Array<ReturnType<typeof doc.addPage>> = [];
  let page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  pages.push(page);
  let y = PDF_PAGE_HEIGHT - PDF_MARGIN;

  const drawIdentityBand = (): number => {
    const top = PDF_PAGE_HEIGHT - PDF_MARGIN;
    const textX = logoImage ? PDF_MARGIN + 28 * 2.8346 + 6 : PDF_MARGIN;
    if (logoImage) {
      const maxW = 28 * 2.8346;
      const maxH = 18 * 2.8346;
      const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height, 1);
      page.drawImage(logoImage, {
        x: PDF_MARGIN,
        y: top - maxH,
        width: logoImage.width * scale,
        height: logoImage.height * scale,
      });
    }
    let textY = top - 10;
    if (identity.shopName) {
      page.drawText(identity.shopName, { x: textX, y: textY, size: 13, font: boldFont, color: black });
      textY -= 14;
    }
    if (identity.legalName) {
      page.drawText(identity.legalName, { x: textX, y: textY, size: 8, font: regularFont, color: black });
      textY -= 10;
    }
    if (identity.address) {
      page.drawText(identity.address, { x: textX, y: textY, size: 8, font: regularFont, color: secondary });
      textY -= 10;
    }
    if (identity.phone) {
      page.drawText(identity.phone, { x: textX, y: textY, size: 8, font: regularFont, color: secondary });
      textY -= 10;
    }
    if (identity.showEmail && identity.email) {
      page.drawText(identity.email, { x: textX, y: textY, size: 8, font: regularFont, color: secondary });
      textY -= 10;
    }
    if (identity.showWebsite && identity.website) {
      page.drawText(identity.website, { x: textX, y: textY, size: 8, font: regularFont, color: secondary });
      textY -= 10;
    }

    // Document band on the opposite side.
    const rightEdge = PDF_PAGE_WIDTH - PDF_MARGIN;
    const titleWidth = boldFont.widthOfTextAtSize(model.title, 16);
    page.drawText(model.title, { x: rightEdge - titleWidth, y: top - 12, size: 16, font: boldFont, color: black });
    const numberWidth = regularFont.widthOfTextAtSize(model.documentNumber, 11);
    page.drawText(model.documentNumber, { x: rightEdge - numberWidth, y: top - 28, size: 11, font: regularFont, color: black });
    const dateWidth = regularFont.widthOfTextAtSize(model.documentDateText, 8.5);
    page.drawText(model.documentDateText, { x: rightEdge - dateWidth, y: top - 40, size: 8.5, font: regularFont, color: secondary });
    if (model.statusText) {
      const statusWidth = boldFont.widthOfTextAtSize(model.statusText, 7.5);
      page.drawText(model.statusText, { x: rightEdge - statusWidth, y: top - 52, size: 7.5, font: boldFont, color: black });
    }

    let bottom = textY - 4;
    if (model.statusText) bottom = Math.min(bottom, top - 58);

    const legalParts: string[] = [];
    if (identity.nif) legalParts.push(`${strings.nif}: ${identity.nif}`);
    if (identity.nis) legalParts.push(`${strings.nis}: ${identity.nis}`);
    if (identity.rc) legalParts.push(`${strings.rc}: ${identity.rc}`);
    if (identity.ai) legalParts.push(`${strings.ai}: ${identity.ai}`);
    if (identity.showRib && identity.rib) legalParts.push(`${strings.rib}: ${identity.rib}`);
    if (legalParts.length > 0) {
      bottom -= 4;
      page.drawLine({ start: { x: PDF_MARGIN, y: bottom }, end: { x: rightEdge, y: bottom }, thickness: 0.5, color: hairline });
      bottom -= 10;
      page.drawText(legalParts.join('  |  '), { x: PDF_MARGIN, y: bottom, size: 7, font: regularFont, color: secondary });
      bottom -= 4;
      page.drawLine({ start: { x: PDF_MARGIN, y: bottom }, end: { x: rightEdge, y: bottom }, thickness: 0.5, color: hairline });
    }

    return bottom - 12;
  };

  y = drawIdentityBand();

  const colWidths = computeColumnWidths(model.columns, contentWidth);
  const rowHeight = 14;
  const headerHeight = 16;

  const drawTableHeader = (): number => {
    let x = PDF_MARGIN;
    page.drawRectangle({ x: PDF_MARGIN, y: y - headerHeight, width: contentWidth, height: headerHeight, color: headerFill });
    model.columns.forEach((col, index) => {
      const width = colWidths[index];
      const text = col.label;
      const textWidth = boldFont.widthOfTextAtSize(text, 8);
      const textX = alignedX(x, width, textWidth, col.align, isRtl);
      page.drawText(text, { x: textX, y: y - headerHeight + 5, size: 8, font: boldFont, color: black });
      x += width;
    });
    page.drawRectangle({ x: PDF_MARGIN, y: y - headerHeight, width: contentWidth, height: headerHeight, borderColor: hairline, borderWidth: 0.5 });
    return y - headerHeight;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < PDF_MARGIN + 30) {
      page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
      pages.push(page);
      y = drawIdentityBand();
      y = drawTableHeader();
    }
  };

  y = drawTableHeader();

  if (model.rows.length === 0) {
    page.drawText(strings.noLines, { x: PDF_MARGIN, y: y - rowHeight + 4, size: 8.5, font: regularFont, color: secondary });
    y -= rowHeight;
  } else {
    for (const row of model.rows) {
      ensureSpace(rowHeight);
      let x = PDF_MARGIN;
      model.columns.forEach((col, index) => {
        const width = colWidths[index];
        const text = row[col.key] ?? '—';
        const textWidth = regularFont.widthOfTextAtSize(text, 8.5);
        const textX = alignedX(x, width, textWidth, col.align, isRtl);
        page.drawText(text, { x: textX, y: y - rowHeight + 4, size: 8.5, font: regularFont, color: black });
        x += width;
      });
      page.drawLine({ start: { x: PDF_MARGIN, y: y - rowHeight }, end: { x: PDF_MARGIN + contentWidth, y: y - rowHeight }, thickness: 0.5, color: hairline });
      y -= rowHeight;
    }
  }

  y -= 10;

  if (model.totals && model.totals.length > 0) {
    const totalsWidth = 60 * 2.8346;
    const totalsX = isRtl ? PDF_MARGIN : PDF_MARGIN + contentWidth - totalsWidth;
    ensureSpace(model.totals.length * 12 + 10);
    for (const total of model.totals) {
      const size = total.emphasis ? 10 : 8.5;
      const font = total.emphasis ? boldFont : regularFont;
      if (total.emphasis) {
        page.drawLine({ start: { x: totalsX, y: y + 2 }, end: { x: totalsX + totalsWidth, y: y + 2 }, thickness: 1, color: black });
      }
      page.drawText(total.label, { x: totalsX, y: y - 8, size, font, color: black });
      const valueWidth = font.widthOfTextAtSize(total.value, size);
      page.drawText(total.value, { x: totalsX + totalsWidth - valueWidth, y: y - 8, size, font, color: black });
      y -= total.emphasis ? 16 : 12;
      if (total.emphasis) {
        page.drawLine({ start: { x: totalsX, y: y + 4 }, end: { x: totalsX + totalsWidth, y: y + 4 }, thickness: 1, color: black });
      }
    }
  }

  if (identity.amountInWords && model.amountInWordsValue) {
    y -= 8;
    ensureSpace(12);
    const italicFont = isRtl ? regularFont : helveticaItalic;
    page.drawText(`${strings.amountInWords} ${model.amountInWordsValue}`, { x: PDF_MARGIN, y, size: 8, font: italicFont, color: black });
    y -= 12;
  }

  if (model.notes && model.notes.length > 0) {
    for (const note of model.notes) {
      ensureSpace(10);
      page.drawText(note, { x: PDF_MARGIN, y, size: 8, font: regularFont, color: black });
      y -= 10;
    }
  }

  const totalPages = pages.length;
  pages.forEach((p, index) => {
    const footerY = PDF_MARGIN - 10;
    p.drawLine({ start: { x: PDF_MARGIN, y: footerY + 10 }, end: { x: PDF_PAGE_WIDTH - PDF_MARGIN, y: footerY + 10 }, thickness: 0.5, color: hairline });
    if (identity.a4FooterNote) {
      p.drawText(identity.a4FooterNote, { x: PDF_MARGIN, y: footerY, size: 6.5, font: regularFont, color: black });
    }
    const madeWith = strings.madeWith;
    const madeWithWidth = regularFont.widthOfTextAtSize(madeWith, 6.5);
    p.drawText(madeWith, {
      x: PDF_MARGIN + contentWidth / 2 - madeWithWidth / 2,
      y: footerY,
      size: 6.5,
      font: regularFont,
      color: hairline,
    });
    const pageLabel = `${strings.page} ${index + 1} ${strings.of} ${totalPages}`;
    const pageLabelWidth = regularFont.widthOfTextAtSize(pageLabel, 6.5);
    p.drawText(pageLabel, { x: PDF_PAGE_WIDTH - PDF_MARGIN - pageLabelWidth, y: footerY, size: 6.5, font: regularFont, color: secondary });
  });

  return doc.save();
}

function computeColumnWidths(columns: OfficialDocumentColumn[], contentWidth: number): number[] {
  const declared = columns.filter((col) => col.widthPercent !== undefined);
  if (declared.length === columns.length) {
    return columns.map((col) => (contentWidth * (col.widthPercent ?? 0)) / 100);
  }
  return columns.map(() => contentWidth / columns.length);
}

function alignedX(colX: number, colWidth: number, textWidth: number, align: ColumnAlign, isRtl: boolean): number {
  const resolved = resolveAlign(align, isRtl);
  const padding = 4;
  if (resolved === 'left') return colX + padding;
  if (resolved === 'right') return colX + colWidth - textWidth - padding;
  return colX + (colWidth - textWidth) / 2;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
