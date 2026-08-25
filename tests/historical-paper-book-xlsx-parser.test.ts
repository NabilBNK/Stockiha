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

function formulaCellWithoutCachedValue(column: number, row: number, formula: string): string {
  return `<c r="${columnName(column)}${row}"><f>${escapeXml(formula)}</f></c>`;
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

function createPaperBookFile(rowSpecs: Array<Record<number, { val: string | number | null; formula?: string }>>): File {
  const headerCells = PAPER_BOOK_HEADERS.map((h, idx) => stringCell(idx, 1, h));
  const rowsXml: string[] = [rowXml(1, headerCells)];

  rowSpecs.forEach((spec, rowIdx) => {
    const rowNum = rowIdx + 2;
    const cells: string[] = [];
    Object.entries(spec).forEach(([colStr, item]) => {
      const col = Number(colStr);
      if (item.val === null) {
        cells.push(formulaCellWithoutCachedValue(col, rowNum, item.formula ?? ''));
      } else if (typeof item.val === 'number') {
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

function createPaperBookV2File(rowSpecs: Array<Record<number, { val: string | number | null; formula?: string }>>): File {
  const headerCells = [
    'Txn No. (Auto)',
    'Date',
    'Type',
    'Paid',
    'Party / Company (Optional)',
    'Product Name (Optional)',
    'Brand (Optional)',
    'Custom Details (Optional)',
    'Quantity',
    'Unit Price',
    'Line Total',
    'Benefit (Sell Only)',
    'Page No. (Optional)',
  ].map((h, idx) => stringCell(idx, 1, h));
  const rowsXml: string[] = [rowXml(1, headerCells)];

  rowSpecs.forEach((spec, rowIdx) => {
    const rowNum = rowIdx + 2;
    const cells: string[] = [];
    Object.entries(spec).forEach(([colStr, item]) => {
      const col = Number(colStr);
      if (item.val === null) {
        cells.push(formulaCellWithoutCachedValue(col, rowNum, item.formula ?? ''));
      } else if (typeof item.val === 'number') {
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
    name: 'paperbook_v2.xlsx',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  } as File;
}

describe('R0-002 & R0-003 Paper-Book XLSX Parser & Grouping', () => {
  it('groups multi-product transactions correctly from non-empty and blank Date rows', async () => {
    const file = createPaperBookFile([
      // Txn 1 (Row 2): 15/03/2025 Sell Chair (2 x 5000)
      { 0: { val: 'TX-001', formula: 'CONCAT("TX-", ROW())' }, 1: { val: '15/03/2025' }, 2: { val: 'Sell' }, 3: { val: 'Paid' }, 4: { val: 'ABC' }, 5: { val: 'Chair' }, 8: { val: 2 }, 9: { val: 5000 }, 10: { val: 10000, formula: 'I2*J2' } },
      // Txn 1 Line 2 (Row 3): Continuation blank Date -> Table (1 x 12000)
      { 5: { val: 'Table' }, 8: { val: 1 }, 9: { val: 12000 }, 10: { val: 12000, formula: 'I3*J3' } },
      // Txn 2 (Row 4): 16/03/2025 Buy Lamp (3 x 2500)
      { 0: { val: 'TX-002' }, 1: { val: '16/03/2025' }, 2: { val: 'Buy' }, 3: { val: 'Not Paid' }, 4: { val: 'XYZ' }, 5: { val: 'Lamp' }, 8: { val: 3 }, 9: { val: 2500 }, 10: { val: 7500, formula: 'I4*J4' } },
    ]);

    const parsed = await parsePaperBookWorkbook(file, '2026-08-25');

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
    expect(t1.lines[0].quantity).toBe('2');
    expect(t1.lines[0].unitPriceDzd).toBe('5000');
    // Rule 4: the CACHED value of the =I*J formula wins and is carried as an
    // exact decimal string. It is never recomputed in TypeScript.
    expect(t1.lines[0].manualLineTotalDzd).toBe('10000');
    expect(t1.lines[1].productName).toBe('Table');
    expect(t1.lines[1].quantity).toBe('1');

    // Txn 2
    const t2 = parsed.transactions[1];
    expect(t2.transactionDate).toBe('2025-03-16');
    expect(t2.transactionType).toBe('PURCHASE');
    expect(t2.paymentStatus).toBe('UNPAID');
    expect(t2.partyCompany).toBe('XYZ');
    expect(t2.lines.length).toBe(1);

    expect(parsed.summary.transactionCount).toBe(2);
    expect(parsed.summary.lineCount).toBe(3);
    expect(parsed.summary.dataRowCount).toBe(3);
    // The browser holds no monetary total at all.
    expect('totalSalesDzd' in parsed.summary).toBe(false);
  });

  it('reports a data row with no transaction above it as an ignored row, not a crash', async () => {
    const file = createPaperBookFile([
      // Row 2: Blank Type orphan row
      { 5: { val: 'Orphan Chair' }, 8: { val: 2 }, 9: { val: 5000 } },
    ]);

    const parsed = await parsePaperBookWorkbook(file, '2026-08-25');
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions).toEqual([]);
    const issue = parsed.rowIssues.find((i) => i.row === 2);
    expect(issue?.severity).toBe('WARNING');
    expect(issue?.probleme).toContain('aucune opération');
    expect(parsed.summary.ignoredRowCount).toBe(1);
  });

  it('lets a hand-typed Line Total win over quantity x unit price', async () => {
    const file = createPaperBookFile([
      // Qty=10, Price=500 -> would be 5000, but the paper says 4500.
      { 0: { val: 'TX-001' }, 1: { val: '15/03/2025' }, 2: { val: 'Sell' }, 3: { val: 'Paid' }, 5: { val: 'Desk' }, 8: { val: 10 }, 9: { val: 500 }, 10: { val: 4500 } },
    ]);

    const parsed = await parsePaperBookWorkbook(file, '2026-08-25');
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions[0].lines[0].manualLineTotalDzd).toBe('4500');
    expect(parsed.summary.manualOverrideCount).toBe(1);
  });

  it('warns and falls back to the database calculation when a formula has no cached value', async () => {
    const file = createPaperBookFile([
      { 0: { val: 'TX-001' }, 1: { val: '15/03/2025' }, 2: { val: 'Sell' }, 3: { val: 'Paid' }, 5: { val: 'Desk' }, 8: { val: 10 }, 9: { val: 500 }, 10: { val: null, formula: 'I2*J2' } },
    ]);

    const parsed = await parsePaperBookWorkbook(file, '2026-08-25');
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions[0].lines[0].manualLineTotalDzd).toBeNull();
    const issue = parsed.rowIssues.find((i) => i.row === 2 && i.column === 'Line Total');
    expect(issue?.severity).toBe('WARNING');
    expect(issue?.probleme).toContain('pas de résultat enregistré');
  });

  it('parses PAPER_BOOK_V2 contract with same date multi-txns, signed benefit, and expenses', async () => {
    const file = createPaperBookV2File([
      // Txn 1: 15/04/2026 Sell with positive benefit (14500)
      { 0: { val: 'TX-001', formula: 'IF(C2<>"","TX-001","")' }, 1: { val: '15/04/2026' }, 2: { val: 'Sell' }, 3: { val: 'Paid' }, 4: { val: 'Client A' }, 5: { val: 'Bed' }, 8: { val: 1 }, 9: { val: 40000 }, 10: { val: 40000, formula: 'I2*J2' }, 11: { val: 14500 }, 12: { val: 42 } },
      // Txn 2: 15/04/2026 Sell (SAME DATE) with negative benefit (-2500 loss)
      { 0: { val: 'TX-002' }, 1: { val: '15/04/2026' }, 2: { val: 'Sell' }, 3: { val: 'Paid' }, 4: { val: 'Client B' }, 5: { val: 'Mattress' }, 8: { val: 1 }, 9: { val: 15000 }, 10: { val: 15000 }, 11: { val: -2500 } },
      // Txn 3: 15/04/2026 Buy (SAME DATE)
      { 0: { val: 'TX-003' }, 1: { val: '15/04/2026' }, 2: { val: 'Buy' }, 3: { val: 'Paid' }, 4: { val: 'Supplier S' }, 5: { val: 'Raw Wood' }, 8: { val: 5 }, 9: { val: 3000 } },
      // Txn 4: 15/04/2026 Expense (SAME DATE) with no Qty/Price, literal Line Total=3500
      { 0: { val: 'TX-004' }, 1: { val: '15/04/2026' }, 2: { val: 'Expense' }, 3: { val: 'Paid' }, 7: { val: 'Transport' }, 10: { val: 3500 } },
      // Unused formula row: Column A & Column K formulas, but blank content
      { 0: { val: '', formula: 'IF(C6<>"","TX-005","")' }, 10: { val: null, formula: 'I6*J6' } },
    ]);

    const parsed = await parsePaperBookWorkbook(file, '2026-08-25');
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions.length).toBe(4);

    // Txn 1: Sell + Positive Benefit
    expect(parsed.transactions[0].transactionType).toBe('SALE');
    expect(parsed.transactions[0].manualBenefitDzd).toBe('14500');
    expect(parsed.transactions[0].pageNumber).toBe('42');

    // Txn 2: Sell + Negative Benefit
    expect(parsed.transactions[1].transactionType).toBe('SALE');
    expect(parsed.transactions[1].manualBenefitDzd).toBe('-2500');

    // Txn 3: Buy
    expect(parsed.transactions[2].transactionType).toBe('PURCHASE');
    expect(parsed.transactions[2].manualBenefitDzd).toBeNull();
    expect(parsed.transactions[2].lines[0].manualLineTotalDzd).toBeNull();

    // Txn 4: Expense — amount-only line, no invented Quantity=1 (rule 5)
    expect(parsed.transactions[3].transactionType).toBe('EXPENSE');
    expect(parsed.transactions[3].lines[0].quantity).toBeNull();
    expect(parsed.transactions[3].lines[0].unitPriceDzd).toBeNull();
    expect(parsed.transactions[3].lines[0].manualLineTotalDzd).toBe('3500');

    // The trailing formula-only row creates nothing at all.
    expect(parsed.summary.dataRowCount).toBe(4);
    expect(parsed.summary.salesCount).toBe(2);
    expect(parsed.summary.purchaseCount).toBe(1);
    expect(parsed.summary.expenseCount).toBe(1);
    expect(parsed.summary.benefitPositiveCount).toBe(1);
    expect(parsed.summary.benefitNegativeCount).toBe(1);
  });

  it('rejects Benefit on Buy or Expense transactions', async () => {
    const file = createPaperBookV2File([
      { 0: { val: 'TX-001' }, 1: { val: '15/04/2026' }, 2: { val: 'Buy' }, 3: { val: 'Paid' }, 5: { val: 'Wood' }, 8: { val: 1 }, 9: { val: 5000 }, 11: { val: 1000 } },
    ]);

    const parsed = await parsePaperBookWorkbook(file, '2026-08-25');
    expect(parsed.errors.length).toBe(1);
    const issue = parsed.rowIssues.find((i) => i.column === 'Benefit (Sell Only)');
    expect(issue?.severity).toBe('ERROR');
    expect(issue?.probleme).toContain('bénéfice');
  });

  it('computes deterministic SHA-256 content hash including manual benefit', async () => {
    const file = createPaperBookV2File([
      { 0: { val: 'TX-001' }, 1: { val: '15/04/2026' }, 2: { val: 'Sell' }, 3: { val: 'Paid' }, 5: { val: 'Desk' }, 8: { val: 1 }, 9: { val: 5000 }, 11: { val: 1500 } },
    ]);

    const parsed = await parsePaperBookWorkbook(file, '2026-08-25');
    expect(parsed.contentHash.length).toBe(64);

    const recomputed = await computeContentHash(parsed.transactions);
    expect(recomputed).toBe(parsed.contentHash);
  });

  it('keeps every amount as the exact characters the workbook stores', async () => {
    const file = createPaperBookV2File([
      { 0: { val: 'TX-000001' }, 1: { val: '22/10/2025' }, 2: { val: 'Buy' }, 3: { val: 'Paid' }, 4: { val: 'AK home' }, 5: { val: 'kowat' }, 6: { val: 'AK' }, 7: { val: '2 pers' }, 8: { val: 10 }, 9: { val: 2000 }, 12: { val: 2 } },
      { 4: { val: 'Rozana' }, 5: { val: 'kowat' }, 6: { val: 'rozana' }, 7: { val: '1 person' }, 8: { val: 5 }, 9: { val: 1500 } },
      { 0: { val: 'TX-000002' }, 1: { val: '23/11/2025' }, 2: { val: 'Sell' }, 3: { val: 'Paid' }, 4: { val: 'anis' }, 5: { val: 'kowat' }, 6: { val: 'rozana' }, 8: { val: 15 }, 9: { val: 2000 }, 11: { val: 7000 } },
      { 0: { val: 'TX-000003' }, 1: { val: '26/12/2025' }, 2: { val: 'Sell' }, 3: { val: 'Not Paid' }, 4: { val: 'zakou' }, 5: { val: 'ouess' }, 6: { val: 'Dolz' }, 8: { val: 2 }, 9: { val: 800 }, 11: { val: 500 } },
      // Rule 3: a continuation row must not carry its own Benefit.
      { 5: { val: 'kowat' }, 6: { val: 'rozana' }, 8: { val: 5 }, 9: { val: 2000 }, 11: { val: 2500 } },
      { 0: { val: 'TX-000004' }, 1: { val: '29/12/2025' }, 2: { val: 'Expense' }, 3: { val: 'Paid' }, 7: { val: 'food' }, 10: { val: 500 } },
    ]);

    const parsed = await parsePaperBookWorkbook(file, '2026-08-25');

    expect(parsed.errors).toEqual([]);
    expect(parsed.summary.isPartial).toBe(false);
    expect(parsed.summary.transactionCount).toBe(4);
    expect(parsed.summary.lineCount).toBe(6);
    expect(parsed.summary.purchaseCount).toBe(1);
    expect(parsed.summary.salesCount).toBe(2);
    expect(parsed.summary.expenseCount).toBe(1);
    expect(parsed.summary.minDate).toBe('2025-10-22');
    expect(parsed.summary.maxDate).toBe('2025-12-29');

    const t1 = parsed.transactions[0];
    expect(t1.lines.map((l) => l.quantity)).toEqual(['10', '5']);
    expect(t1.lines.map((l) => l.unitPriceDzd)).toEqual(['2000', '1500']);
    expect(t1.lines[0].partyCompany).toBe('AK home');
    expect(t1.lines[1].partyCompany).toBe('Rozana');

    // Rule 3/6: the transaction benefit is the one written on its first row.
    // The stray benefit on the continuation row is reported, not summed in.
    const t3 = parsed.transactions[2];
    expect(t3.manualBenefitDzd).toBe('500');
    const strayBenefit = parsed.rowIssues.find(
      (i) => i.row === 6 && i.column === 'Benefit (Sell Only)',
    );
    expect(strayBenefit?.severity).toBe('WARNING');
  });
});
