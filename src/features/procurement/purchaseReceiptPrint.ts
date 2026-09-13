import type { Locale } from '../../shared/i18n';
import type { PurchaseReceiptLineDto, PurchaseReceiptSummary } from '../../shared/ipc/dto';
import { formatDisplayDate } from '../../shared/utils/formatters';
import { PROCUREMENT_COPY } from './procurementCopy';
import { saveDocumentFileWithDialog } from '../../shared/documents/documentPrintService';
import amiriFontUrl from '../../../src-tauri/src/infrastructure/pdf_proof/fonts/Amiri-Regular.ttf?url';

interface ReceiptPrintData {
  receipt: PurchaseReceiptSummary;
  lines: PurchaseReceiptLineDto[];
  locale: Locale;
}

/**
 * Builds the complete, standalone HTML for an official A4 Bon de Réception / Purchase Receipt.
 * This HTML is isolated and printed inside a dedicated hidden iframe so that NO application
 * styles, modal backdrops, dialog borders, or scrollbars can ever leak into the print preview.
 */
export function buildReceiptA4Html({ receipt, lines, locale }: ReceiptPrintData): string {
  const text = PROCUREMENT_COPY[locale];
  const isRtl = locale === 'ar';
  const isDirect = receipt.receipt_origin === 'DIRECT_PURCHASE' || !receipt.purchase_order_id;
  const originText = isDirect
    ? text.directPurchase
    : `${text.purchaseOrderOrigin}: ${receipt.purchase_order_number ?? `#${receipt.purchase_order_id}`}`;

  const docTitle =
    locale === 'fr'
      ? 'BON DE RÉCEPTION'
      : locale === 'ar'
        ? 'وصل استلام مشتريات'
        : 'PURCHASE RECEIPT';

  const subTitle =
    locale === 'fr'
      ? 'Système de Gestion Commerciale & Stocks'
      : locale === 'ar'
        ? 'نظام إدارة المخزون والمشتريات'
        : 'Inventory & Commercial Management';

  const storekeeperTitle =
    locale === 'fr'
      ? 'Magasinier / Réceptionnaire'
      : locale === 'ar'
        ? 'أمين المستودع / المستلم'
        : 'Storekeeper / Received by';

  const deliveryTitle =
    locale === 'fr'
      ? 'Livreur / Fournisseur'
      : locale === 'ar'
        ? 'السائق / المورد'
        : 'Supplier Delivery Driver';

  const managementTitle =
    locale === 'fr'
      ? 'Direction / Approbation'
      : locale === 'ar'
        ? 'الإدارة / التأشيرة والختم'
        : 'Management / Authorized Approval';

  const journalDoc =
    receipt.journal_document_number ??
    (receipt.journal_document_id ? `#${receipt.journal_document_id}` : '—');

  const rowsHtml = lines
    .map(
      (l, idx) => `
      <tr>
        <td style="text-align: center; color: #64748b;">${idx + 1}</td>
        <td><strong>${escapeHtml(l.variant_name)}</strong></td>
        <td><code style="font-family: monospace; font-size: 8.5pt;">${escapeHtml(l.variant_sku)}</code></td>
        <td style="text-align: center;">${escapeHtml(l.unit_code)}</td>
        <td class="num"><strong>${l.quantity_received}</strong></td>
        <td class="num">${l.unit_cost}</td>
        <td class="num"><strong>${l.line_total}</strong></td>
      </tr>
    `
    )
    .join('');

  return `<!DOCTYPE html>
<html dir="${isRtl ? 'rtl' : 'ltr'}" lang="${locale}">
<head>
  <meta charset="utf-8">
  <title>${docTitle} — ${escapeHtml(receipt.document_number)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 15mm 12mm 15mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 9.5pt;
      color: #0f172a;
      background: #ffffff;
      line-height: 1.45;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .a4-page {
      width: 100%;
      max-width: 100%;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2.5px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .brand-col h1 {
      font-size: 24pt;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .brand-col p {
      font-size: 8.5pt;
      color: #475569;
    }
    .meta-col {
      text-align: ${isRtl ? 'left' : 'right'};
    }
    .meta-col .doc-type {
      font-size: 15pt;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 3px;
    }
    .meta-col .doc-number {
      font-size: 12pt;
      font-weight: 700;
      font-family: monospace;
      color: #1d4ed8;
      margin-bottom: 3px;
    }
    .meta-col .doc-date {
      font-size: 9pt;
      color: #475569;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      background: #dcfce7;
      color: #166534;
      font-weight: 700;
      font-size: 7.5pt;
      border-radius: 3px;
      margin-top: 4px;
      text-transform: uppercase;
      border: 1px solid #bbf7d0;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 16px;
    }
    .info-card {
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 10px 14px;
      background: #f8fafc;
    }
    .info-card-title {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
      margin-bottom: 6px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      font-size: 9pt;
      margin-bottom: 4px;
    }
    .info-row:last-child {
      margin-bottom: 0;
    }
    .info-row strong {
      color: #0f172a;
    }
    .table-section {
      margin-bottom: 16px;
    }
    .section-heading {
      font-size: 9pt;
      font-weight: 700;
      text-transform: uppercase;
      color: #334155;
      margin-bottom: 6px;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
    }
    .items-table th {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 8px 10px;
      font-weight: 700;
      color: #1e293b;
      text-align: ${isRtl ? 'right' : 'left'};
      text-transform: uppercase;
      font-size: 8pt;
    }
    .items-table td {
      border: 1px solid #cbd5e1;
      padding: 7px 10px;
      color: #0f172a;
      vertical-align: middle;
    }
    .items-table tr:nth-child(even) td {
      background: #fcfcfd;
    }
    .items-table th.num, .items-table td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .items-table tfoot td {
      background: #f8fafc;
      border-top: 2px solid #0f172a;
      font-weight: 800;
      font-size: 10.5pt;
      padding: 10px;
    }
    .accounting-card {
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 10px 14px;
      background: #ffffff;
      margin-bottom: 22px;
    }
    .accounting-title {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      color: #475569;
      margin-bottom: 6px;
    }
    .accounting-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .accounting-item {
      display: flex;
      justify-content: space-between;
      padding: 5px 9px;
      background: #f8fafc;
      border-radius: 3px;
      border-inline-start: 3px solid #1d4ed8;
      font-size: 8.5pt;
    }
    .signatures-block {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 14px;
      margin-top: 24px;
      page-break-inside: avoid;
    }
    .sig-box {
      border: 1px dashed #94a3b8;
      border-radius: 4px;
      height: 96px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      font-size: 8pt;
      color: #64748b;
      background: #ffffff;
    }
    .sig-title {
      font-weight: 700;
      text-transform: uppercase;
      color: #1e293b;
    }
    .doc-footer {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-size: 7.5pt;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="a4-page">
    <header class="doc-header">
      <div class="brand-col">
        <h1>Stockiha</h1>
        <p>${subTitle}</p>
        <span class="status-badge">✓ POSTED / CONFIRMÉ</span>
      </div>
      <div class="meta-col">
        <div class="doc-type">${docTitle}</div>
        <div class="doc-number">${escapeHtml(receipt.document_number)}</div>
        <div class="doc-date">${text.date}: ${formatDisplayDate(receipt.posted_at)}</div>
      </div>
    </header>

    <div class="info-grid">
      <div class="info-card">
        <div class="info-card-title">${text.supplier}</div>
        <div class="info-row">
          <span>${text.supplier}:</span>
          <strong>${escapeHtml(receipt.supplier_name)}</strong>
        </div>
        <div class="info-row">
          <span>${text.origin}:</span>
          <strong>${escapeHtml(originText)}</strong>
        </div>
      </div>
      <div class="info-card">
        <div class="info-card-title">${text.warehouse}</div>
        <div class="info-row">
          <span>${text.warehouse}:</span>
          <strong>${escapeHtml(receipt.warehouse_name)}</strong>
        </div>
        <div class="info-row">
          <span>${text.receiptJournal}:</span>
          <strong>${escapeHtml(journalDoc)}</strong>
        </div>
      </div>
    </div>

    <div class="table-section">
      <table class="items-table">
        <thead>
          <tr>
            <th style="width: 36px; text-align: center;">#</th>
            <th>${text.product}</th>
            <th style="width: 140px;">SKU</th>
            <th style="width: 75px; text-align: center;">${text.unit}</th>
            <th class="num" style="width: 95px;">${text.quantity}</th>
            <th class="num" style="width: 120px;">${text.unitCost} (DZD)</th>
            <th class="num" style="width: 130px;">${text.total} (DZD)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="6" style="text-align: ${isRtl ? 'left' : 'right'}; font-weight: 800;">
              ${text.total}:
            </td>
            <td class="num" style="font-weight: 800; color: #0f172a;">
              ${receipt.total_amount} DZD
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="accounting-card">
      <div class="accounting-title">${text.accountingImpact}</div>
      <div class="accounting-grid">
        <div class="accounting-item">
          <span>${text.inventoryMerchandise}:</span>
          <strong>+${receipt.total_amount} DZD</strong>
        </div>
        <div class="accounting-item">
          <span>${text.grniAccount}:</span>
          <strong>+${receipt.total_amount} DZD</strong>
        </div>
      </div>
    </div>

    <div class="signatures-block">
      <div class="sig-box">
        <span class="sig-title">${storekeeperTitle}</span>
        <span>Date & Visa:</span>
      </div>
      <div class="sig-box">
        <span class="sig-title">${deliveryTitle}</span>
        <span>Date & Visa:</span>
      </div>
      <div class="sig-box">
        <span class="sig-title">${managementTitle}</span>
        <span>Date & Cachet:</span>
      </div>
    </div>

    <footer class="doc-footer">
      <span>Stockiha ERP — ${escapeHtml(receipt.document_number)}</span>
      <span>${formatDisplayDate(receipt.posted_at)}</span>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Triggers the browser/system print dialog using a clean, isolated hidden iframe.
 * This guarantees that only the full-page official A4 document is printed, with ZERO
 * screenshot borders, dialog wrappers, dark overlays, or scrollbars.
 */
export function printReceiptA4(data: ReceiptPrintData): void {
  const htmlContent = buildReceiptA4Html(data);
  const printFrame = document.createElement('iframe');
  printFrame.style.position = 'fixed';
  printFrame.style.top = '-10000px';
  printFrame.style.left = '-10000px';
  printFrame.style.width = '210mm';
  printFrame.style.height = '297mm';
  printFrame.style.border = 'none';
  document.body.appendChild(printFrame);

  const frameDoc = printFrame.contentWindow?.document;
  if (!frameDoc) return;

  frameDoc.open();
  frameDoc.write(htmlContent);
  frameDoc.close();

  setTimeout(() => {
    try {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
    } catch {
      // Fallback in case of print blocker
      window.print();
    } finally {
      setTimeout(() => {
        document.body.removeChild(printFrame);
      }, 1500);
    }
  }, 250);
}

/**
 * Downloads the official Purchase Receipt directly as a high-precision vector PDF file.
 */
export async function downloadReceiptPdf(data: ReceiptPrintData): Promise<void> {
  const { receipt, lines, locale } = data;
  const text = PROCUREMENT_COPY[locale];
  const isDirect = receipt.receipt_origin === 'DIRECT_PURCHASE' || !receipt.purchase_order_id;
  const originText = isDirect
    ? text.directPurchase
    : `${text.purchaseOrderOrigin}: ${receipt.purchase_order_number ?? `#${receipt.purchase_order_id}`}`;

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
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  const fontToUse = locale === 'ar' ? amiriFont : helvetica;
  const boldFontToUse = locale === 'ar' ? amiriFont : helveticaBold;

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 36;

  const page = doc.addPage([pageWidth, pageHeight]);

  const dark = rgb(15 / 255, 23 / 255, 42 / 255);
  const muted = rgb(100 / 255, 116 / 255, 139 / 255);
  const blue = rgb(29 / 255, 78 / 255, 216 / 255);
  const lightBg = rgb(248 / 255, 250 / 255, 252 / 255);
  const borderCol = rgb(203 / 255, 213 / 255, 225 / 255);

  let y = pageHeight - margin - 20;

  // Header Brand
  page.drawText('STOCKIHA', { x: margin, y, size: 22, font: helveticaBold, color: dark });
  y -= 14;
  page.drawText('Commercial & Inventory Management', { x: margin, y, size: 8.5, font: helvetica, color: muted });

  // Document Title & Number (Right aligned)
  const docTitle =
    locale === 'fr'
      ? 'BON DE RECEPTION'
      : locale === 'ar'
        ? 'وصل استلام مشتريات'
        : 'PURCHASE RECEIPT';

  const titleWidth = boldFontToUse.widthOfTextAtSize(docTitle, 15);
  page.drawText(docTitle, { x: pageWidth - margin - titleWidth, y: pageHeight - margin - 16, size: 15, font: boldFontToUse, color: dark });

  const numText = receipt.document_number;
  const numWidth = helveticaBold.widthOfTextAtSize(numText, 12);
  page.drawText(numText, { x: pageWidth - margin - numWidth, y: pageHeight - margin - 32, size: 12, font: helveticaBold, color: blue });

  const dateText = `${text.date}: ${formatDisplayDate(receipt.posted_at)}`;
  const dateWidth = fontToUse.widthOfTextAtSize(dateText, 9);
  page.drawText(dateText, { x: pageWidth - margin - dateWidth, y: pageHeight - margin - 46, size: 9, font: fontToUse, color: muted });

  // Top Divider Line
  y -= 14;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 2,
    color: dark,
  });

  // Info Cards (Supplier & Warehouse)
  y -= 14;
  const colW = (pageWidth - margin * 2 - 14) / 2;
  const cardH = 50;

  // Supplier Card
  page.drawRectangle({ x: margin, y: y - cardH, width: colW, height: cardH, color: lightBg, borderColor: borderCol, borderWidth: 1 });
  page.drawText(text.supplier.toUpperCase(), { x: margin + 10, y: y - 14, size: 7.5, font: boldFontToUse, color: muted });
  page.drawText(`${text.supplier}: ${receipt.supplier_name}`, { x: margin + 10, y: y - 28, size: 9, font: boldFontToUse, color: dark });
  page.drawText(`${text.origin}: ${originText}`, { x: margin + 10, y: y - 42, size: 8, font: fontToUse, color: muted });

  // Warehouse Card
  const col2X = margin + colW + 14;
  page.drawRectangle({ x: col2X, y: y - cardH, width: colW, height: cardH, color: lightBg, borderColor: borderCol, borderWidth: 1 });
  page.drawText(text.warehouse.toUpperCase(), { x: col2X + 10, y: y - 14, size: 7.5, font: boldFontToUse, color: muted });
  page.drawText(`${text.warehouse}: ${receipt.warehouse_name}`, { x: col2X + 10, y: y - 28, size: 9, font: boldFontToUse, color: dark });
  const journalDoc = receipt.journal_document_number ?? (receipt.journal_document_id ? `#${receipt.journal_document_id}` : '—');
  page.drawText(`${text.receiptJournal}: ${journalDoc}`, { x: col2X + 10, y: y - 42, size: 8, font: fontToUse, color: muted });

  y -= cardH + 20;

  // Table Headers
  const tableWidth = pageWidth - margin * 2;
  const rowH = 20;

  page.drawRectangle({ x: margin, y: y - rowH, width: tableWidth, height: rowH, color: rgb(241 / 255, 245 / 255, 249 / 255), borderColor: borderCol, borderWidth: 1 });
  page.drawText('#', { x: margin + 8, y: y - 14, size: 8, font: boldFontToUse, color: dark });
  page.drawText(text.product.toUpperCase(), { x: margin + 34, y: y - 14, size: 8, font: boldFontToUse, color: dark });
  page.drawText('SKU', { x: margin + 220, y: y - 14, size: 8, font: boldFontToUse, color: dark });
  page.drawText(text.unit.toUpperCase(), { x: margin + 320, y: y - 14, size: 8, font: boldFontToUse, color: dark });
  page.drawText(text.quantity.toUpperCase(), { x: margin + 375, y: y - 14, size: 8, font: boldFontToUse, color: dark });
  page.drawText(`${text.unitCost} (DZD)`.toUpperCase(), { x: margin + 425, y: y - 14, size: 8, font: boldFontToUse, color: dark });
  page.drawText(`${text.total} (DZD)`.toUpperCase(), { x: margin + 480, y: y - 14, size: 8, font: boldFontToUse, color: dark });

  y -= rowH;

  // Table Rows
  lines.forEach((line, idx) => {
    page.drawRectangle({ x: margin, y: y - rowH, width: tableWidth, height: rowH, color: idx % 2 === 1 ? lightBg : rgb(1, 1, 1), borderColor: borderCol, borderWidth: 1 });
    page.drawText(`${idx + 1}`, { x: margin + 8, y: y - 14, size: 8.5, font: helvetica, color: muted });
    page.drawText(line.variant_name.substring(0, 32), { x: margin + 34, y: y - 14, size: 8.5, font: boldFontToUse, color: dark });
    page.drawText(line.variant_sku.substring(0, 16), { x: margin + 220, y: y - 14, size: 8, font: helvetica, color: dark });
    page.drawText(line.unit_code, { x: margin + 320, y: y - 14, size: 8.5, font: fontToUse, color: dark });
    page.drawText(line.quantity_received, { x: margin + 375, y: y - 14, size: 8.5, font: boldFontToUse, color: dark });
    page.drawText(line.unit_cost, { x: margin + 425, y: y - 14, size: 8.5, font: helvetica, color: dark });
    page.drawText(line.line_total, { x: margin + 480, y: y - 14, size: 8.5, font: boldFontToUse, color: dark });
    y -= rowH;
  });

  // Table Total Row
  const totalRowH = 24;
  page.drawRectangle({ x: margin, y: y - totalRowH, width: tableWidth, height: totalRowH, color: lightBg, borderColor: dark, borderWidth: 1.5 });
  page.drawText(`${text.total}:`, { x: margin + 375, y: y - 16, size: 10, font: boldFontToUse, color: dark });
  page.drawText(`${receipt.total_amount} DZD`, { x: margin + 440, y: y - 16, size: 10, font: helveticaBold, color: blue });

  y -= totalRowH + 24;

  // Accounting Impact Box
  const accH = 42;
  page.drawRectangle({ x: margin, y: y - accH, width: tableWidth, height: accH, color: rgb(1, 1, 1), borderColor: borderCol, borderWidth: 1 });
  page.drawText(text.accountingImpact.toUpperCase(), { x: margin + 10, y: y - 13, size: 7.5, font: boldFontToUse, color: muted });
  page.drawText(`${text.inventoryMerchandise}: +${receipt.total_amount} DZD`, { x: margin + 10, y: y - 29, size: 8.5, font: fontToUse, color: dark });
  page.drawText(`${text.grniAccount}: +${receipt.total_amount} DZD`, { x: margin + tableWidth / 2 + 10, y: y - 29, size: 8.5, font: fontToUse, color: dark });

  y -= accH + 28;

  // 3 Signatures Boxes
  const sigW = (tableWidth - 24) / 3;
  const sigH = 80;

  const sigLabels = [
    locale === 'fr' ? 'Magasinier / Réception' : locale === 'ar' ? 'أمين المستودع' : 'Storekeeper / Received',
    locale === 'fr' ? 'Livreur / Fournisseur' : locale === 'ar' ? 'السائق / المورد' : 'Supplier Delivery',
    locale === 'fr' ? 'Direction / Visa' : locale === 'ar' ? 'الإدارة / التأشيرة' : 'Management Approval',
  ];

  sigLabels.forEach((label, i) => {
    const x = margin + i * (sigW + 12);
    page.drawRectangle({ x, y: y - sigH, width: sigW, height: sigH, color: rgb(1, 1, 1), borderColor: borderCol, borderWidth: 1 });
    page.drawText(label.toUpperCase(), { x: x + 8, y: y - 14, size: 7.5, font: boldFontToUse, color: dark });
    page.drawText('Date & Signature:', { x: x + 8, y: y - sigH + 12, size: 7.5, font: helvetica, color: muted });
  });

  // Footer line
  page.drawLine({ start: { x: margin, y: 35 }, end: { x: pageWidth - margin, y: 35 }, thickness: 0.5, color: borderCol });
  page.drawText(`Stockiha ERP — ${receipt.document_number}`, { x: margin, y: 22, size: 7.5, font: helvetica, color: muted });
  page.drawText(formatDisplayDate(receipt.posted_at), { x: pageWidth - margin - 60, y: 22, size: 7.5, font: helvetica, color: muted });

  // Download PDF via Windows Native File Save Dialog
  const pdfBytes = await doc.save();
  await saveDocumentFileWithDialog({
    defaultFileName: `Bon_De_Reception_${receipt.document_number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
    bytes: pdfBytes,
    filterName: 'PDF Document',
    extension: 'pdf',
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
