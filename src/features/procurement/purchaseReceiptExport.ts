import { zipSync, strToU8 } from 'fflate';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function cell(ref: string, value: string | number | null, style?: number): string {
  if (value === null || value === undefined) return `<c r="${ref}"${style ? ` s="${style}"` : ''}/>`;
  if (typeof value === 'number') return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t>${escapeXml(String(value))}</t></is></c>`;
}

export interface PurchaseReceiptExportData {
  documentNumber: string;
  documentDate: string;
  supplierName: string;
  supplierDocRef: string;
  paymentStatus: string;
  paymentMethod: string;
  subtotal: string;
  additionalCosts: string;
  grandTotal: string;
  paidAmount: string;
  remainingAmount: string;
  lines: Array<{
    lineNumber: number;
    sku: string;
    productName: string;
    variantName?: string;
    barcode?: string;
    unitCode: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
  }>;
}

export function buildPurchaseReceiptXlsx(data: PurchaseReceiptExportData): Uint8Array {
  const widths = [8, 18, 30, 20, 15, 10, 14, 16, 18];
  
  // Row 1: Title
  // Row 2: Metadata (Doc #, Date, Supplier, Supplier Ref)
  // Row 4: Table Headers
  const headers = [
    'Line',
    'SKU',
    'Product / Variant',
    'Barcode',
    'Unit',
    'Qty',
    'Unit Cost (DZD)',
    'Line Total (DZD)',
  ];

  const headerXml = headers.map((val, idx) => cell(`${columnName(idx)}4`, val, 1)).join('');

  const bodyXml = data.lines
    .map((line, rIdx) => {
      const rowNum = rIdx + 5;
      const displayName = line.variantName && line.variantName !== line.productName
        ? `${line.productName} - ${line.variantName}`
        : line.productName;
      const cleanName = displayName.replace(/Â·/g, '-').replace(/·/g, '-');

      const cells = [
        cell(`A${rowNum}`, line.lineNumber),
        cell(`B${rowNum}`, line.sku),
        cell(`C${rowNum}`, cleanName),
        cell(`D${rowNum}`, line.barcode || '—'),
        cell(`E${rowNum}`, line.unitCode),
        cell(`F${rowNum}`, line.quantity, 3),
        cell(`G${rowNum}`, line.unitCost, 4),
        cell(`H${rowNum}`, line.lineTotal, 4),
      ];

      return `<row r="${rowNum}">${cells.join('')}</row>`;
    })
    .join('');

  const summaryStartRow = data.lines.length + 6;
  const summaryRows = [
    `<row r="${summaryStartRow}"><c r="G${summaryStartRow}" t="inlineStr" s="1"><is><t>Subtotal</t></is></c><c r="H${summaryStartRow}" s="4"><v>${parseFloat(data.subtotal) || 0}</v></c></row>`,
    `<row r="${summaryStartRow + 1}"><c r="G${summaryStartRow + 1}" t="inlineStr" s="1"><is><t>Additional Costs</t></is></c><c r="H${summaryStartRow + 1}" s="4"><v>${parseFloat(data.additionalCosts) || 0}</v></c></row>`,
    `<row r="${summaryStartRow + 2}"><c r="G${summaryStartRow + 2}" t="inlineStr" s="1"><is><t>GRAND TOTAL</t></is></c><c r="H${summaryStartRow + 2}" s="4"><v>${parseFloat(data.grandTotal) || 0}</v></c></row>`,
  ].join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>STOCKIHA PURCHASE RECEIPT</t></is></c><c r="C1" t="inlineStr" s="1"><is><t>${escapeXml(data.documentNumber)}</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Supplier: ${escapeXml(data.supplierName)}</t></is></c><c r="C2" t="inlineStr"><is><t>Date: ${escapeXml(data.documentDate)}</t></is></c><c r="E2" t="inlineStr"><is><t>Supplier Ref: ${escapeXml(data.supplierDocRef || 'N/A')}</t></is></c></row>
    <row r="3"/>
    <row r="4">${headerXml}</row>
    ${bodyXml}
    ${summaryRows}
  </sheetData>
</worksheet>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Purchase Receipt" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };

  return zipSync(files, { level: 6 });
}

export function downloadPurchaseReceiptXlsx(data: PurchaseReceiptExportData) {
  const bytes = buildPurchaseReceiptXlsx(data);
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.documentNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
