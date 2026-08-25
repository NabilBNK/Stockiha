import { zipSync, strToU8 } from 'fflate';
import type { Locale } from '../../shared/i18n';
import type { HistoricalTradeAnalyticsResult } from '../../shared/ipc/onboardingDto';
import amiriFontUrl from '../../../src-tauri/src/infrastructure/pdf_proof/fonts/Amiri-Regular.ttf?url';
import type { HistoricalTableRow } from './historicalTableModel';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const EXPORT_COPY: Record<Locale, Record<string, string>> = {
  en: {
    report: 'Historical Trade Analytics Report', period: 'Reporting period', generated: 'Generated',
    sales: 'Total sales', purchases: 'Total purchases', expenses: 'Total expenses', benefit: 'Recorded benefit',
    calcMargin: 'Calculated trade margin (Sales − Purchases)', calcNet: 'Calculated net trade benefit', benefitVariance: 'Benefit variance (Manual − Net)',
    trend: 'Monthly trade trend', products: 'Top products by sales', filtered: 'Approved reporting data for the selected period',
  },
  fr: {
    report: 'Rapport analytique des transactions historiques', period: 'Période du rapport', generated: 'Généré',
    sales: 'Ventes totales', purchases: 'Achats totaux', expenses: 'Dépenses totales', benefit: 'Bénéfice enregistré',
    calcMargin: 'Marge commerciale calculée (Ventes − Achats)', calcNet: 'Bénéfice net commercial calculé', benefitVariance: 'Écart de bénéfice (Manuel − Net)',
    trend: 'Évolution mensuelle', products: 'Produits principaux par ventes', filtered: 'Données approuvées pour la période sélectionnée',
  },
  ar: {
    report: 'تقرير تحليلات المعاملات التاريخية', period: 'فترة التقرير', generated: 'تاريخ الإنشاء',
    sales: 'إجمالي المبيعات', purchases: 'إجمالي المشتريات', expenses: 'إجمالي المصاريف', benefit: 'الفائدة المسجلة',
    calcMargin: 'الهامش التجاري المحسوب (المبيعات − المشتريات)', calcNet: 'الفائدة التجاري الصافية المحسوبة', benefitVariance: 'فارق الفائدة (اليدوي − الصافي)',
    trend: 'التطور الشهري للمعاملات', products: 'أعلى المنتجات حسب المبيعات', filtered: 'البيانات المعتمدة للفترة المحددة',
  },
};

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function columnName(index: number): string {
  let value = index + 1;
  let output = '';
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function excelSerial(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const millis = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(millis) ? null : millis / 86_400_000 + 25569;
}

function cell(ref: string, value: string | number | null, style?: number): string {
  if (value === null) return `<c r="${ref}"${style ? ` s="${style}"` : ''}/>`;
  if (typeof value === 'number') return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t>${escapeXml(value)}</t></is></c>`;
}

/**
 * Writes an exact decimal string straight into the cell's `<v>` element, so the
 * exported workbook holds a real number without the value ever passing through
 * a JavaScript float.
 */
function exactNumericCell(ref: string, value: string | null, style?: number): string {
  if (value === null || !/^-?\d+(\.\d+)?$/.test(value)) {
    return `<c r="${ref}"${style ? ` s="${style}"` : ''}/>`;
  }
  return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
}

export const HISTORICAL_EXPORT_HEADERS = [
  'Source Row', 'Transaction Reference', 'Date', 'Type', 'Payment', 'Party / Company',
  'Product', 'Brand', 'Details', 'Quantity', 'Unit Price (DZD)', 'Line Total (DZD)', 'Benefit (DZD)',
] as const;

export function buildHistoricalTableXlsx(rows: HistoricalTableRow[]): Uint8Array {
  const widths = [12, 22, 13, 13, 13, 24, 24, 18, 32, 12, 18, 18, 18];
  const header = HISTORICAL_EXPORT_HEADERS.map((value, index) => cell(`${columnName(index)}1`, value, 1)).join('');
  const body = rows.map((row, rowIndex) => {
    const number = rowIndex + 2;
    const date = excelSerial(row.date);
    const values: Array<string | number | null> = [
      row.row, row.reference, date ?? row.date, row.type, row.payment, row.party,
      row.product, row.brand, row.details, row.quantity, row.unitPrice, row.lineTotal, row.benefit,
    ];
    return `<row r="${number}">${values.map((value, index) => {
      const style = index === 2 && date !== null ? 2 : index >= 9 ? 3 : undefined;
      // Columns 9..12 are quantity and money: exact decimal strings that must
      // land in the workbook as numbers, not as text.
      if (index >= 9) {
        return exactNumericCell(
          `${columnName(index)}${number}`,
          value === null ? null : String(value),
          style,
        );
      }
      return cell(`${columnName(index)}${number}`, value, style);
    }).join('')}</row>`;
  }).join('');
  const lastRow = Math.max(1, rows.length + 1);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
  <sheetData><row r="1">${header}</row>${body}</sheetData>
  <autoFilter ref="A1:M${lastRow}"/>
</worksheet>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Analytics Data" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2457D6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  return zipSync(files, { level: 6 });
}

export interface HistoricalReportModel {
  title: string;
  period: string;
  generatedAt: string;
  scope: string;
  kpis: Array<{ label: string; value: number }>;
  timeline: HistoricalTradeAnalyticsResult['timeline'];
  topProducts: HistoricalTradeAnalyticsResult['products'];
}

export function buildHistoricalReportModel(
  analytics: HistoricalTradeAnalyticsResult,
  locale: Locale,
  generatedAt = new Date(),
): HistoricalReportModel {
  const copy = EXPORT_COPY[locale];
  const calculatedMargin = analytics.overview.totalSalesDzd - analytics.overview.totalPurchasesDzd;
  const calcNet = analytics.overview.tradeDifferenceDzd ?? (analytics.overview.totalSalesDzd - analytics.overview.totalPurchasesDzd - analytics.overview.totalExpensesDzd);
  const variance = (analytics.overview.totalManualBenefitDzd ?? 0) - calcNet;
  return {
    title: copy.report,
    period: `${copy.period}: ${analytics.overview.dateFrom} — ${analytics.overview.dateTo}`,
    generatedAt: `${copy.generated}: ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(generatedAt)}`,
    scope: copy.filtered,
    kpis: [
      { label: copy.sales, value: analytics.overview.totalSalesDzd },
      { label: copy.purchases, value: analytics.overview.totalPurchasesDzd },
      { label: copy.expenses, value: analytics.overview.totalExpensesDzd },
      { label: copy.benefit, value: analytics.overview.totalManualBenefitDzd },
      { label: copy.calcMargin, value: calculatedMargin },
      { label: copy.calcNet, value: calcNet },
      { label: copy.benefitVariance, value: variance },
    ],
    timeline: analytics.timeline,
    topProducts: analytics.products.slice().sort((a, b) => b.salesDzd - a.salesDzd).slice(0, 8),
  };
}

export async function buildHistoricalAnalyticsPdf(
  analytics: HistoricalTradeAnalyticsResult,
  locale: Locale,
): Promise<Blob> {
  const [{ PDFDocument, rgb }, fontkitModule, fontResponse] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
    fetch(amiriFontUrl),
  ]);
  if (!fontResponse.ok) throw new Error('Arabic report font could not be loaded.');
  const fontBytes = new Uint8Array(await fontResponse.arrayBuffer());
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkitModule.default);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const model = buildHistoricalReportModel(analytics, locale);
  const copy = EXPORT_COPY[locale];
  const money = (value: number) => `${new Intl.NumberFormat(locale).format(value)} DZD`;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  const blue = rgb(36 / 255, 87 / 255, 214 / 255);
  const textColor = rgb(23 / 255, 32 / 255, 51 / 255);
  const muted = rgb(99 / 255, 112 / 255, 131 / 255);
  const surface = rgb(244 / 255, 247 / 255, 251 / 255);
  const pages = [doc.addPage([pageWidth, pageHeight])];
  let page = pages[0];
  const draw = (value: string, x: number, y: number, size: number, color = textColor, rightAligned = locale === 'ar') => {
    const safeX = rightAligned ? x - font.widthOfTextAtSize(value, size) : x;
    page.drawText(value, { x: safeX, y, size, font, color });
  };
  const contentX = locale === 'ar' ? pageWidth - margin : margin;
  page.drawRectangle({ x: 0, y: pageHeight - 92, width: pageWidth, height: 92, color: blue });
  draw(model.title, contentX, pageHeight - 42, 18, rgb(1, 1, 1));
  draw(model.period, contentX, pageHeight - 62, 9, rgb(1, 1, 1));
  draw(model.generatedAt, contentX, pageHeight - 78, 8, rgb(1, 1, 1));
  draw(model.scope, contentX, pageHeight - 112, 8, muted);

  model.kpis.forEach((kpi, index) => {
    const column = index % 2;
    const x = margin + column * 260;
    const y = pageHeight - 175 - Math.floor(index / 2) * 72;
    page.drawRectangle({ x, y, width: 245, height: 57, color: surface });
    draw(kpi.label, locale === 'ar' ? x + 232 : x + 13, y + 37, 8, muted);
    draw(money(kpi.value), locale === 'ar' ? x + 232 : x + 13, y + 15, 12);
  });

  let cursorY = pageHeight - 330;
  draw(copy.trend, contentX, cursorY, 12);
  cursorY -= 18;
  const timeline = model.timeline.slice(0, 12);
  const max = Math.max(1, ...timeline.flatMap((item) => [item.salesDzd, item.purchasesDzd, item.expensesDzd]));
  timeline.forEach((item, index) => {
    const rowY = cursorY - index * 23;
    draw(item.yearMonth ?? item.month, margin, rowY + 5, 7, muted, false);
    const origin = margin + 75;
    const width = pageWidth - origin - margin;
    const series = [
      { value: item.salesDzd, color: rgb(22 / 255, 129 / 255, 93 / 255) },
      { value: item.purchasesDzd, color: blue },
      { value: item.expensesDzd, color: rgb(162 / 255, 99 / 255, 11 / 255) },
    ];
    series.forEach((entry, seriesIndex) => {
      page.drawRectangle({ x: origin, y: rowY + seriesIndex * 4, width: Math.max(1, (entry.value / max) * width), height: 3, color: entry.color });
    });
  });

  cursorY -= timeline.length * 23 + 20;
  if (cursorY < 155) {
    page = doc.addPage([pageWidth, pageHeight]);
    pages.push(page);
    cursorY = pageHeight - margin;
  }
  draw(copy.products, contentX, cursorY, 12);
  cursorY -= 20;
  model.topProducts.forEach((product, index) => {
    draw(`${index + 1}. ${product.productName}`, locale === 'ar' ? pageWidth - margin - 175 : margin, cursorY, 8);
    draw(money(product.salesDzd), locale === 'ar' ? pageWidth - margin : pageWidth - margin - 150, cursorY, 8);
    cursorY -= 18;
  });

  pages.forEach((reportPage, index) => {
    const pageLabel = `${index + 1} / ${pages.length}`;
    reportPage.drawText(pageLabel, { x: (pageWidth - font.widthOfTextAtSize(pageLabel, 8)) / 2, y: 18, size: 8, font, color: muted });
  });
  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}

export function downloadExport(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportHistoricalTable(rows: HistoricalTableRow[], date = new Date()): void {
  const bytes = buildHistoricalTableXlsx(rows);
  downloadExport(new Blob([bytes], { type: XLSX_MIME }), `stockiha-historical-table-${date.toISOString().slice(0, 10)}.xlsx`);
}

export async function exportHistoricalAnalytics(
  analytics: HistoricalTradeAnalyticsResult,
  locale: Locale,
  date = new Date(),
): Promise<void> {
  const blob = await buildHistoricalAnalyticsPdf(analytics, locale);
  downloadExport(blob, `stockiha-historical-analytics-${date.toISOString().slice(0, 10)}.pdf`);
}
