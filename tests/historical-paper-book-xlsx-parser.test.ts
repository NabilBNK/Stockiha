import { describe, expect, it } from 'vitest';

import {
  PAPER_BOOK_HEADERS,
  computeContentHash,
  parsePaperBookWorkbook,
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

function createPaperBookFile(rowSpecs: Array<Record<number, { val: string | number; formula?: string }>>): File {
  const headerCells = PAPER_BOOK_HEADERS.map((h, idx) => stringCell(idx, 1, h));
  const rowsXml: string[] = [rowXml(1, headerCells)];

  rowSpecs.forEach((spec, rowIdx) => {
    const rowNum = rowIdx + 2;
    const cells: string[] = [];
    Object.entries(spec).forEach(([colStr, item]) => {
      const col = Number(colStr);
      if (typeof item.val === 'number') {
        cells.push(numberCell(col, rowNum, item.val, item.formula));
      } else {
        cells.push(stringCell(col, rowNum, item.val));
      }
    });
    rowsXml.push(rowXml(rowNum, cells));
  });

  const files = {
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>
          <sheet name="Transactions" sheetId="1" r:id="rId1"/>
        </sheets>
      </workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <cellXfs count="1"><xf numFmtId="0"/></cellXfs>
      </styleSheet>`,
    'xl/worksheets/sheet1.xml': worksheet(rowsXml),
  };

  const archive = storedZip(files);
  const bytes = archive.slice();
  return {
    name: 'paperbook.xlsx',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  } as File;
}

describe('R0-002 Paper-Book XLSX Parser & Grouping', () => {
  it('groups multi-product transactions correctly from non-empty and blank Date rows', async () => {
    const file = createPaperBookFile([
      // Txn 1 (Row 2): 15/03/2025 Sell Chair (2 x 5000)
      { 0: { val: 'TX-001', formula: 'CONCAT("TX-", ROW())' }, 1: { val: '15/03/2025' }, 2: { val: 'Sell' }, 3: { val: 'Paid' }, 4: { val: 'ABC' }, 5: { val: 'Chair' }, 8: { val: 2 }, 9: { val: 5000 }, 10: { val: 10000, formula: 'I2*J2' } },
      // Txn 1 Line 2 (Row 3): Continuation blank Date -> Table (1 x 12000)
      { 5: { val: 'Table' }, 8: { val: 1 }, 9: { val: 12000 }, 10: { val: 12000, formula: 'I3*J3' } },
      // Txn 2 (Row 4): 16/03/2025 Buy Lamp (3 x 2500)
      { 0: { val: 'TX-002' }, 1: { val: '16/03/2025' }, 2: { val: 'Buy' }, 3: { val: 'Not Paid' }, 4: { val: 'XYZ' }, 5: { val: 'Lamp' }, 8: { val: 3 }, 9: { val: 2500 }, 10: { val: 7500, formula: 'I4*J4' } },
    ]);

    const parsed = await parsePaperBookWorkbook(file);

    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions.length).toBe(2);

    // Txn 1
    const t1 = parsed.transactions[0];
    expect(t1.transactionDate).toBe('2025-03-15');
    expect(t1.transactionType).toBe('SALE');
    expect(t1.paymentStatus).toBe('PAID');
    expect(t1.partyCompany).toBe('ABC');
    expect(t1.lines.length).toBe(2);
    expect(t1.lines[0].productName).toBe('Chair');
    expect(t1.lines[0].quantity).toBe(2);
    expect(t1.lines[0].unitPriceDzd).toBe(5000);
    expect(t1.lines[0].manualLineTotalDzd).toBeNull(); // formula cell -> calculated
    expect(t1.lines[1].productName).toBe('Table');
    expect(t1.lines[1].quantity).toBe(1);

    // Txn 2
    const t2 = parsed.transactions[1];
    expect(t2.transactionDate).toBe('2025-03-16');
    expect(t2.transactionType).toBe('PURCHASE');
    expect(t2.paymentStatus).toBe('UNPAID');
    expect(t2.partyCompany).toBe('XYZ');
    expect(t2.lines.length).toBe(1);

    expect(parsed.summary.transactionCount).toBe(2);
    expect(parsed.summary.lineCount).toBe(3);
    expect(parsed.summary.totalSalesDzd).toBe(22000);
    expect(parsed.summary.totalPurchasesDzd).toBe(7500);
  });

  it('detects orphan product line error when row 2 has blank Date', async () => {
    const file = createPaperBookFile([
      // Row 2: Blank Date orphan row
      { 5: { val: 'Orphan Chair' }, 8: { val: 2 }, 9: { val: 5000 } },
    ]);

    const parsed = await parsePaperBookWorkbook(file);
    expect(parsed.errors.length).toBe(1);
    expect(parsed.errors[0].message).toContain('ORPHAN_PRODUCT_LINE');
  });

  it('supports literal Line Total as manual override and generates warning', async () => {
    const file = createPaperBookFile([
      // Qty=10, Price=500 -> Calc=5000, Literal Total=4500 (NO formula tag)
      { 0: { val: 'TX-001' }, 1: { val: '15/03/2025' }, 2: { val: 'Sell' }, 3: { val: 'Paid' }, 5: { val: 'Desk' }, 8: { val: 10 }, 9: { val: 500 }, 10: { val: 4500 } },
    ]);

    const parsed = await parsePaperBookWorkbook(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions[0].lines[0].manualLineTotalDzd).toBe(4500);
    expect(parsed.warnings.some((w) => w.message.includes('MANUAL_LINE_TOTAL_OVERRIDE'))).toBe(true);
  });

  it('computes deterministic SHA-256 content hash for duplicate dataset protection', async () => {
    const file = createPaperBookFile([
      { 0: { val: 'TX-001' }, 1: { val: '15/03/2025' }, 2: { val: 'Sell' }, 3: { val: 'Paid' }, 5: { val: 'Desk' }, 8: { val: 1 }, 9: { val: 5000 } },
    ]);

    const parsed = await parsePaperBookWorkbook(file);
    expect(parsed.contentHash.length).toBe(64);

    const recomputed = await computeContentHash(parsed.transactions);
    expect(recomputed).toBe(parsed.contentHash);
  });

  it('groups multi-line transactions with repeated header fields and multi-lingual statuses', async () => {
    const file = createPaperBookFile([
      // Txn 1 Line 1: Vente, Payé, Client Alpha (2 x 10900 DA)
      {
        0: { val: 'INV-101' },
        1: { val: '06/07/2026' },
        2: { val: 'Vente' },
        3: { val: 'Payé' },
        4: { val: 'Client Alpha' },
        5: { val: 'Item A' },
        8: { val: 2 },
        9: { val: '10 900 DA' },
      },
      // Txn 1 Line 2: Repeated Date, Type, Paid, Party (5 x 5000)
      {
        0: { val: 'INV-101' },
        1: { val: '06/07/2026' },
        2: { val: 'Vente' },
        3: { val: 'Payé' },
        4: { val: 'Client Alpha' },
        5: { val: 'Item B' },
        8: { val: 5 },
        9: { val: 5000 },
      },
      // Txn 2 Line 1: Achat, Non Payé, Fournisseur Beta (10 x 3000)
      {
        0: { val: 'INV-102' },
        1: { val: '2026-07-07' },
        2: { val: 'Achat' },
        3: { val: 'Non Payé' },
        4: { val: 'Fournisseur Beta' },
        5: { val: 'Raw Material' },
        8: { val: 10 },
        9: { val: 3000 },
      },
    ]);

    const parsed = await parsePaperBookWorkbook(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions.length).toBe(2);

    // Txn 1 grouped with 2 lines
    const t1 = parsed.transactions[0];
    expect(t1.sourceExcelTxnRef).toBe('INV-101');
    expect(t1.transactionDate).toBe('2026-07-06');
    expect(t1.transactionType).toBe('SALE');
    expect(t1.paymentStatus).toBe('PAID');
    expect(t1.partyCompany).toBe('Client Alpha');
    expect(t1.lines.length).toBe(2);
    expect(t1.lines[0].productName).toBe('Item A');
    expect(t1.lines[0].unitPriceDzd).toBe(10900);
    expect(t1.lines[1].productName).toBe('Item B');
    expect(t1.lines[1].unitPriceDzd).toBe(5000);

    // Txn 2
    const t2 = parsed.transactions[1];
    expect(t2.sourceExcelTxnRef).toBe('INV-102');
    expect(t2.transactionDate).toBe('2026-07-07');
    expect(t2.transactionType).toBe('PURCHASE');
    expect(t2.paymentStatus).toBe('UNPAID');
    expect(t2.partyCompany).toBe('Fournisseur Beta');
    expect(t2.lines.length).toBe(1);

    expect(parsed.summary.transactionCount).toBe(2);
    expect(parsed.summary.lineCount).toBe(3);
    expect(parsed.summary.totalSalesDzd).toBe(2 * 10900 + 5 * 5000);
    expect(parsed.summary.totalPurchasesDzd).toBe(30000);
  });
});

