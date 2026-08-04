import { describe, expect, it } from 'vitest';

import {
  HISTORICAL_BALANCE_HEADERS,
  HISTORICAL_TRANSACTION_HEADERS,
  parseHistoricalFinanceWorkbook,
} from '../src/features/onboarding/xlsxParser';

const encoder = new TextEncoder();

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function join(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(files: Record<string, string>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = join([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    localParts.push(local);

    centralParts.push(
      join([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(localOffset),
        nameBytes,
      ]),
    );
    localOffset += local.length;
  }

  const local = join(localParts);
  const central = join(centralParts);
  const end = join([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(centralParts.length),
    u16(centralParts.length),
    u32(central.length),
    u32(local.length),
    u16(0),
  ]);
  return join([local, central, end]);
}

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

function stringCell(column: number, row: number, value: string): string {
  return `<c r="${columnName(column)}${row}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function numberCell(column: number, row: number, value: number, formula?: string): string {
  return `<c r="${columnName(column)}${row}">${formula ? `<f>${escapeXml(formula)}</f>` : ''}<v>${value}</v></c>`;
}

function rowXml(row: number, cells: string[]): string {
  return `<row r="${row}">${cells.join('')}</row>`;
}

function worksheet(rows: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rows.join('')}</sheetData>
</worksheet>`;
}

function workbookFile({ formula = false, wrongHeader = false }: { formula?: boolean; wrongHeader?: boolean } = {}): File {
  const transactionHeader = HISTORICAL_TRANSACTION_HEADERS.map((header, index) =>
    stringCell(index, 1, wrongHeader && index === 0 ? 'Wrong_ID' : header),
  );
  const transactionRow = [
    stringCell(0, 2, 'PAPER-000001'),
    stringCell(1, 2, '2025-01-10'),
    stringCell(2, 2, 'SALE'),
    stringCell(3, 2, 'Historical sale'),
    numberCell(4, 2, 100000, formula ? '50000*2' : undefined),
    stringCell(5, 2, 'PAID'),
    stringCell(6, 2, 'READY'),
    numberCell(7, 2, 100000),
    stringCell(9, 2, 'Supplier A'),
    stringCell(10, 2, 'Customer A'),
  ];

  const balanceHeader = HISTORICAL_BALANCE_HEADERS.map((header, index) =>
    stringCell(index, 1, header),
  );
  const balanceRow = [
    stringCell(0, 2, '2025-01-01'),
    stringCell(1, 2, 'OPENING_INVENTORY_VALUE'),
    numberCell(2, 2, 25000),
    stringCell(3, 2, 'READY'),
  ];

  const files = {
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>
          <sheet name="Historical_Transactions" sheetId="1" r:id="rId1"/>
          <sheet name="Balances" sheetId="2" r:id="rId2"/>
        </sheets>
      </workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/>
      </Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <cellXfs count="1"><xf numFmtId="0"/></cellXfs>
      </styleSheet>`,
    'xl/worksheets/sheet1.xml': worksheet([
      rowXml(1, transactionHeader),
      rowXml(2, transactionRow),
    ]),
    'xl/worksheets/sheet2.xml': worksheet([
      rowXml(1, balanceHeader),
      rowXml(2, balanceRow),
    ]),
  };

  const archive = storedZip(files);
  return new File([archive], 'historical.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('R0-001 constrained historical finance xlsx parser', () => {
  it('reads the official two-sheet template and preserves optional supplier data', async () => {
    const parsed = await parseHistoricalFinanceWorkbook(workbookFile());

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        sourceRowNumber: 2,
        paperId: 'PAPER-000001',
        transactionDate: '2025-01-10',
        transactionType: 'SALE',
        netAmountDzd: 100000,
        amountPaidDzd: 100000,
        supplierFournisseur: 'Supplier A',
        customerClient: 'Customer A',
      }),
    ]);
    expect(parsed.balances).toEqual([
      expect.objectContaining({
        sourceRowNumber: 2,
        balanceType: 'OPENING_INVENTORY_VALUE',
        amountDzd: 25000,
      }),
    ]);
  });

  it('rejects formulas so imported finance values must be explicitly entered', async () => {
    await expect(parseHistoricalFinanceWorkbook(workbookFile({ formula: true }))).rejects.toThrow(
      'Formulas are not allowed',
    );
  });

  it('rejects a workbook whose required columns differ from the official template', async () => {
    await expect(parseHistoricalFinanceWorkbook(workbookFile({ wrongHeader: true }))).rejects.toThrow(
      'must be named Paper_ID',
    );
  });
});
