/**
 * Generic High-Precision Vector PDF Generator
 *
 * Produces crisp, official A4 business documents using `pdf-lib` and Amiri font.
 * Includes official headers, metadata cards, itemized tables, financial totals,
 * accounting notes, and signature blocks.
 */

import amiriFontUrl from '../../../src-tauri/src/infrastructure/pdf_proof/fonts/Amiri-Regular.ttf?url';

export interface GenericDocPdfLine {
  col1: string; // Line # or Code
  col2: string; // Description
  col3?: string; // Unit or Category
  col4?: string; // Quantity or Account
  col5?: string; // Unit Price or Debit
  col6?: string; // Total or Credit
}

export interface GenericDocPdfTotal {
  label: string;
  value: string;
  isGrandTotal?: boolean;
}

export interface GenericDocPdfData {
  title: string;
  documentNumber: string;
  documentDate: string;
  statusText: string;
  locale?: 'en' | 'fr' | 'ar';
  partyLabel?: string;
  partyName?: string;
  referenceLabel?: string;
  referenceValue?: string;
  warehouseLabel?: string;
  warehouseValue?: string;
  secondaryInfoLabel?: string;
  secondaryInfoValue?: string;
  tableHeaders: string[];
  lines: GenericDocPdfLine[];
  totals?: GenericDocPdfTotal[];
  accountingNote?: string;
  signatures?: string[];
  footerNote?: string;
}

export async function generateGenericDocumentPdf(data: GenericDocPdfData): Promise<Uint8Array> {
  const {
    title,
    documentNumber,
    documentDate,
    statusText,
    locale = 'fr',
    partyLabel,
    partyName,
    referenceLabel,
    referenceValue,
    warehouseLabel,
    warehouseValue,
    secondaryInfoLabel,
    secondaryInfoValue,
    tableHeaders,
    lines,
    totals = [],
    accountingNote,
    signatures,
    footerNote,
  } = data;

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
  const contentWidth = pageWidth - margin * 2;

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
  page.drawText('Gestion Commerciale & Comptable', { x: margin, y, size: 8.5, font: helvetica, color: muted });

  // Document Title & Number (Right aligned)
  const titleWidth = boldFontToUse.widthOfTextAtSize(title, 14);
  page.drawText(title, {
    x: pageWidth - margin - titleWidth,
    y: pageHeight - margin - 16,
    size: 14,
    font: boldFontToUse,
    color: dark,
  });

  const numText = documentNumber;
  const numWidth = helveticaBold.widthOfTextAtSize(numText, 12);
  page.drawText(numText, {
    x: pageWidth - margin - numWidth,
    y: pageHeight - margin - 32,
    size: 12,
    font: helveticaBold,
    color: blue,
  });

  const dateText = documentDate;
  const dateWidth = fontToUse.widthOfTextAtSize(dateText, 9);
  page.drawText(dateText, {
    x: pageWidth - margin - dateWidth,
    y: pageHeight - margin - 46,
    size: 9,
    font: fontToUse,
    color: muted,
  });

  // Header Divider
  y -= 22;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 2,
    color: dark,
  });

  // Metadata Info Cards
  y -= 12;
  const hasParty = Boolean(partyName);
  const cardW = hasParty ? (contentWidth - 14) / 2 : contentWidth;
  const cardH = 48;

  if (hasParty) {
    page.drawRectangle({
      x: margin,
      y: y - cardH,
      width: cardW,
      height: cardH,
      color: lightBg,
      borderColor: borderCol,
      borderWidth: 1,
    });
    page.drawText((partyLabel || 'Tiers / Partenaire').toUpperCase(), {
      x: margin + 10,
      y: y - 13,
      size: 7.5,
      font: boldFontToUse,
      color: muted,
    });
    page.drawText(partyName || '—', {
      x: margin + 10,
      y: y - 29,
      size: 10,
      font: boldFontToUse,
      color: dark,
    });
    if (referenceValue) {
      page.drawText(`${referenceLabel || 'Réf'}: ${referenceValue}`, {
        x: margin + 10,
        y: y - 41,
        size: 8,
        font: fontToUse,
        color: muted,
      });
    }

    // Right Card (Warehouse / Secondary Info)
    const rightX = margin + cardW + 14;
    page.drawRectangle({
      x: rightX,
      y: y - cardH,
      width: cardW,
      height: cardH,
      color: lightBg,
      borderColor: borderCol,
      borderWidth: 1,
    });
    page.drawText((warehouseLabel || 'Statut & Référence').toUpperCase(), {
      x: rightX + 10,
      y: y - 13,
      size: 7.5,
      font: boldFontToUse,
      color: muted,
    });
    page.drawText(warehouseValue || statusText, {
      x: rightX + 10,
      y: y - 29,
      size: 9.5,
      font: boldFontToUse,
      color: dark,
    });
    if (secondaryInfoValue) {
      page.drawText(`${secondaryInfoLabel || 'Info'}: ${secondaryInfoValue}`, {
        x: rightX + 10,
        y: y - 41,
        size: 8,
        font: fontToUse,
        color: muted,
      });
    }

    y -= cardH + 16;
  }

  // Items Table
  const tableTop = y;
  const colCount = tableHeaders.length;
  const rowH = 20;

  // Draw Table Header Bar
  page.drawRectangle({
    x: margin,
    y: tableTop - rowH,
    width: contentWidth,
    height: rowH,
    color: dark,
  });

  const getColX = (index: number) => {
    if (colCount <= 3) {
      const step = contentWidth / colCount;
      return margin + index * step + 8;
    }
    // Standard 5-6 column document layout:
    // Col 0: Line # (35pt)
    // Col 1: Description (remaining width)
    // Col 2: Unit (45pt)
    // Col 3: Qty (55pt)
    // Col 4: Price (65pt)
    // Col 5: Total (70pt)
    switch (index) {
      case 0:
        return margin + 8;
      case 1:
        return margin + 45;
      case 2:
        return margin + contentWidth - 235;
      case 3:
        return margin + contentWidth - 190;
      case 4:
        return margin + contentWidth - 135;
      case 5:
        return margin + contentWidth - 70;
      default:
        return margin + (index * contentWidth) / colCount;
    }
  };

  tableHeaders.forEach((header, i) => {
    page.drawText(header.toUpperCase(), {
      x: getColX(i),
      y: tableTop - 14,
      size: 7.5,
      font: helveticaBold,
      color: rgb(1, 1, 1),
    });
  });

  y = tableTop - rowH;

  // Render Table Rows (up to max visible rows on page)
  const displayLines = lines.slice(0, 18);
  displayLines.forEach((line, idx) => {
    const isEven = idx % 2 === 0;
    if (isEven) {
      page.drawRectangle({
        x: margin,
        y: y - rowH,
        width: contentWidth,
        height: rowH,
        color: lightBg,
      });
    }

    // Border bottom for each row
    page.drawLine({
      start: { x: margin, y: y - rowH },
      end: { x: margin + contentWidth, y: y - rowH },
      thickness: 0.5,
      color: borderCol,
    });

    const values = [line.col1, line.col2, line.col3, line.col4, line.col5, line.col6].filter(
      (v): v is string => typeof v === 'string',
    );

    values.forEach((val, cIdx) => {
      if (cIdx >= colCount) return;
      page.drawText(val, {
        x: getColX(cIdx),
        y: y - 14,
        size: 8,
        font: cIdx === 1 ? boldFontToUse : fontToUse,
        color: dark,
      });
    });

    y -= rowH;
  });

  y -= 14;

  // Totals Box (Right aligned)
  if (totals.length > 0) {
    const totalBoxW = 220;
    const totalBoxX = pageWidth - margin - totalBoxW;
    const totalRowH = 16;

    totals.forEach((t) => {
      const isGrand = t.isGrandTotal;
      if (isGrand) {
        page.drawRectangle({
          x: totalBoxX,
          y: y - totalRowH - 4,
          width: totalBoxW,
          height: totalRowH + 6,
          color: lightBg,
          borderColor: dark,
          borderWidth: 1.5,
        });
        page.drawText(t.label.toUpperCase(), {
          x: totalBoxX + 8,
          y: y - totalRowH + 2,
          size: 9,
          font: helveticaBold,
          color: dark,
        });
        const valW = helveticaBold.widthOfTextAtSize(t.value, 9.5);
        page.drawText(t.value, {
          x: totalBoxX + totalBoxW - valW - 8,
          y: y - totalRowH + 2,
          size: 9.5,
          font: helveticaBold,
          color: blue,
        });
        y -= totalRowH + 8;
      } else {
        page.drawText(t.label, {
          x: totalBoxX + 8,
          y: y - totalRowH + 4,
          size: 8,
          font: fontToUse,
          color: muted,
        });
        const valW = fontToUse.widthOfTextAtSize(t.value, 8.5);
        page.drawText(t.value, {
          x: totalBoxX + totalBoxW - valW - 8,
          y: y - totalRowH + 4,
          size: 8.5,
          font: boldFontToUse,
          color: dark,
        });
        y -= totalRowH;
      }
    });
  }

  y -= 14;

  // Accounting Note Box
  if (accountingNote) {
    const accH = 32;
    page.drawRectangle({
      x: margin,
      y: y - accH,
      width: contentWidth,
      height: accH,
      color: lightBg,
      borderColor: borderCol,
      borderWidth: 1,
    });
    page.drawText('IMPACT COMPTABLE / NOTE', {
      x: margin + 10,
      y: y - 12,
      size: 7.5,
      font: boldFontToUse,
      color: muted,
    });
    page.drawText(accountingNote, {
      x: margin + 10,
      y: y - 24,
      size: 8.5,
      font: fontToUse,
      color: dark,
    });
    y -= accH + 16;
  }

  // Signatures Section
  const sigList = signatures && signatures.length > 0
    ? signatures
    : locale === 'ar'
    ? ['المحرر / المسؤول', 'المستلم / الطرف المعني', 'الإدارة / التأشيرة']
    : locale === 'fr'
    ? ['Responsable / Émetteur', 'Client / Fournisseur', 'Direction / Visa']
    : ['Prepared By', 'Recipient / Party', 'Authorized By'];

  const sigW = (contentWidth - (sigList.length - 1) * 12) / sigList.length;
  const sigH = 75;

  sigList.forEach((label, i) => {
    const x = margin + i * (sigW + 12);
    page.drawRectangle({
      x,
      y: y - sigH,
      width: sigW,
      height: sigH,
      color: rgb(1, 1, 1),
      borderColor: borderCol,
      borderWidth: 1,
    });
    page.drawText(label.toUpperCase(), {
      x: x + 8,
      y: y - 14,
      size: 7.5,
      font: boldFontToUse,
      color: dark,
    });
    page.drawText('Date & Signature:', {
      x: x + 8,
      y: y - sigH + 10,
      size: 7.5,
      font: helvetica,
      color: muted,
    });
  });

  // Footer Line
  page.drawLine({
    start: { x: margin, y: 35 },
    end: { x: pageWidth - margin, y: 35 },
    thickness: 0.5,
    color: borderCol,
  });
  page.drawText(`Stockiha ERP — ${documentNumber}`, {
    x: margin,
    y: 22,
    size: 7.5,
    font: helvetica,
    color: muted,
  });
  page.drawText(footerNote || documentDate, {
    x: pageWidth - margin - 100,
    y: 22,
    size: 7.5,
    font: helvetica,
    color: muted,
  });

  return await doc.save();
}
