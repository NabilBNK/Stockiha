// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
// @ts-expect-error The browser application intentionally excludes Node types; this Node-only test reads the bundled report font.
import { readFile } from 'node:fs/promises';
import {
  buildHistoricalReportDocument,
  buildHistoricalReportPdf,
  buildHistoricalReportXlsx,
  CONTENT_WIDTH,
  historicalReportExportRefusal,
  historicalReportFilename,
  layoutTable,
  type ReportExportDocument,
} from '../src/features/onboarding/historicalReportExports';
import { FR } from '../src/features/onboarding/historicalReportCopy';
import type {
  HistoricalReportCode,
  HistoricalReportEnvelope,
} from '../src/shared/ipc/onboardingDto';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */
/* Internally consistent exact decimal strings, exactly as PostgreSQL `numeric`
 * would serialize them. The monthly sales column deliberately sums to the
 * profit-and-loss revenue, so a column total taken out of the workbook can be
 * checked against the headline figure the screen shows. */

const MONTHS = [
  { month: '2025-01', purchasesDzd: '120000.00', salesDzd: '200000.50', cogsDzd: '90000.25', grossProfitDzd: '110000.25', expensesDzd: '15000.00', netProfitDzd: '95000.25', recordedBenefitDzd: '105000.00', gapVsGrossDzd: '-5000.25', revenueWithCostDzd: '180000.50', revenueWithoutCostDzd: '20000.00', saleLinesWithoutCostAtDateCount: 2 },
  { month: '2025-02', purchasesDzd: '80000.00', salesDzd: '150000.25', cogsDzd: '70000.75', grossProfitDzd: '79999.50', expensesDzd: '12000.00', netProfitDzd: '67999.50', recordedBenefitDzd: '70000.00', gapVsGrossDzd: '-9999.50', revenueWithCostDzd: '130000.25', revenueWithoutCostDzd: '20000.00', saleLinesWithoutCostAtDateCount: 1 },
  { month: '2025-03', purchasesDzd: '50000.00', salesDzd: '99999.25', cogsDzd: '40000.00', grossProfitDzd: '59999.25', expensesDzd: '10000.00', netProfitDzd: '49999.25', recordedBenefitDzd: '62000.00', gapVsGrossDzd: '2000.75', revenueWithCostDzd: '89999.25', revenueWithoutCostDzd: '10000.00', saleLinesWithoutCostAtDateCount: 1 },
];

/** Total of the monthly sales column: 450 000,00 DA. */
const REVENUE = '450000.00';

const PROFIT_AND_LOSS = {
  revenueDzd: REVENUE,
  purchasesDzd: '250000.00',
  cogsDzd: '200001.00',
  grossProfitDzd: '249999.00',
  expensesDzd: '37000.00',
  netProfitDzd: '212999.00',
  recordedBenefitDzd: '237000.00',
  gapVsGrossDzd: '-12999.00',
  gapVsNetDzd: '24001.00',
  customerDebtDzd: '31500.75',
  supplierDebtDzd: '18000.00',
  unpaidExpensesDzd: '4200.00',
  saleLineCount: 42,
  monthCount: 3,
  salesWithRecordedBenefitCount: 38,
  salesWithoutRecordedBenefitCount: 4,
  revenueWithCostDzd: '400000.00',
  revenueWithoutCostDzd: '50000.00',
  grossProfitOnCostedSalesDzd: '199999.00',
  saleLinesWithCostCount: 38,
  saleLinesWithoutCostCount: 4,
  costFreeNoPurchaseCount: 3,
  costFreeNoPurchaseValueDzd: '45000.00',
  costFreeNoQuantityCount: 1,
  costFreeNoQuantityValueDzd: '5000.00',
  saleLinesWithoutCostAtDateCount: 3,
  saleLinesWithoutCostAtDateValueDzd: '45000.00',
  saleLinesWithoutQuantityCount: 1,
};

const PARTY_ROWS = [
  { party: 'Établissement Benali & Fils', totalDzd: '180000.00', quantity: '240', lineCount: 18, transactionCount: 9, unpaidDzd: '12000.00' },
  { party: null, totalDzd: '70000.00', quantity: '95', lineCount: 7, transactionCount: 4, unpaidDzd: '6000.00' },
];

const PRODUCT_ROWS = [
  { canonicalKey: 'cable-3g-2.5', label: 'Câble électrique · Cabel · 3G 2.5', totalDzd: '160000.00', quantity: '200', lineCount: 14, transactionCount: 8 },
  { canonicalKey: 'disjoncteur-32a', label: 'Disjoncteur · Schneider · 32A', totalDzd: '90000.00', quantity: '135', lineCount: 11, transactionCount: 5 },
];

const SELLER = (label: string, quantitySold: string, revenueDzd: string, marginDzd: string | null) => ({
  canonicalKey: label.toLowerCase().replace(/\s+/g, '-'),
  label,
  quantitySold,
  revenueDzd,
  cogsDzd: marginDzd === null ? null : '1000.00',
  marginDzd,
  marginKnown: marginDzd !== null,
  saleLineCount: 4,
  linesWithoutCostCount: marginDzd === null ? 2 : 0,
});

const DEBT_ROWS = [
  { party: 'Boutique El Nour', balanceDzd: '21500.75', transactionCount: 5, oldestDate: '2025-01-12', newestDate: '2025-03-08' },
  { party: null, balanceDzd: '10000.00', transactionCount: 2, oldestDate: '2025-02-02', newestDate: '2025-02-19' },
];

const BODIES: Record<HistoricalReportCode, unknown> = {
  PROFIT_AND_LOSS,
  MONTHLY_TREND: MONTHS,
  PURCHASES: {
    bySupplier: PARTY_ROWS.map(({ unpaidDzd: _unpaid, ...rest }) => rest),
    byProduct: PRODUCT_ROWS,
    totalDzd: '250000.00',
    totalQuantity: '335',
    lineCount: 25,
    transactionCount: 13,
    supplierCount: 1,
    productCount: 2,
    unspecifiedSupplierTotalDzd: '70000.00',
  },
  SALES: {
    byCustomer: PARTY_ROWS,
    byProduct: PRODUCT_ROWS,
    totalDzd: REVENUE,
    totalQuantity: '520',
    lineCount: 42,
    transactionCount: 21,
    customerCount: 1,
    productCount: 2,
    unspecifiedCustomerTotalDzd: '70000.00',
  },
  SELLERS: {
    variantCount: 3,
    marginKnownCount: 2,
    marginUnknownCount: 1,
    rankingSize: 2,
    bestByQuantity: [SELLER('Câble électrique 3G 2.5', '200', '160000.00', '42000.00'), SELLER('Ampoule LED 9W', '150', '30000.00', null)],
    worstByQuantity: [SELLER('Ampoule LED 9W', '150', '30000.00', null)],
    bestByMargin: [SELLER('Câble électrique 3G 2.5', '200', '160000.00', '42000.00')],
    worstByMargin: [SELLER('Disjoncteur 32A', '135', '90000.00', '11000.50')],
    unknownMargin: [SELLER('Ampoule LED 9W', '150', '30000.00', null)],
  },
  CUSTOMER_DEBT: {
    rows: DEBT_ROWS,
    totalDzd: '31500.75',
    partyCount: 1,
    unspecifiedPartyBalanceDzd: '10000.00',
    transactionCount: 7,
    hasPartialPayments: false,
    hasAgeing: false,
  },
  SUPPLIER_DEBT_AND_EXPENSES: {
    supplier: {
      rows: DEBT_ROWS,
      totalDzd: '18000.00',
      partyCount: 1,
      unspecifiedPartyBalanceDzd: '4000.00',
      transactionCount: 4,
      hasPartialPayments: false,
      hasAgeing: false,
    },
    expenses: {
      rows: [
        { category: 'Loyer du local', totalDzd: '24000.00', unpaidDzd: '0.00', lineCount: 3, transactionCount: 3 },
        { category: null, totalDzd: '13000.00', unpaidDzd: '4200.00', lineCount: 5, transactionCount: 5 },
      ],
      totalDzd: '37000.00',
      unpaidTotalDzd: '4200.00',
      categoryCount: 1,
      lineCount: 8,
      uncategorizedTotalDzd: '13000.00',
      hasCategoryTaxonomy: false,
    },
  },
  STOCK_VALUATION: {
    asOfDate: '2025-03-31',
    dateRangeApplies: false,
    rows: [
      { canonicalKey: 'cable-3g-2.5', label: 'Câble électrique · Cabel · 3G 2.5', quantity: '40', valueDzd: '32000.00', unitCostDzd: '800.00' },
      { canonicalKey: 'disjoncteur-32a', label: 'Disjoncteur · Schneider · 32A', quantity: '25', valueDzd: '17999.00', unitCostDzd: '719.96' },
    ],
    variantCount: 2,
    totalQuantity: '65',
    totalValueDzd: '49999.00',
    totalPurchasedDzd: '250000.00',
    totalCogsDzd: '200001.00',
    balanceResidualDzd: '0.00',
    balances: true,
  },
};

const CODES = Object.keys(BODIES) as HistoricalReportCode[];

function envelopeFor(code: HistoricalReportCode): HistoricalReportEnvelope {
  return {
    batchId: 7,
    reportCode: code,
    dateFrom: '2025-01-01',
    dateTo: '2025-03-31',
    readiness: {
      batchId: 7,
      distinctDescriptionCount: 12,
      resolvedDescriptionCount: 12,
      unresolvedDescriptionCount: 0,
      sellDescriptionCount: 8,
      unresolvedSellDescriptionCount: 0,
      distinctCanonicalVariantsSold: 3,
      sellWithoutCostSourceCount: 0,
      sellWithoutCostSourceValueDzd: '0.00',
      isComplete: true,
    },
    canRender: true,
    refusalReason: null,
    report: BODIES[code] as HistoricalReportEnvelope['report'],
  };
}

const GENERATED = new Date('2026-08-26T09:30:00Z');
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

let fontBytes: Uint8Array;
let originalFetch: typeof globalThis.fetch;

beforeAll(async () => {
  fontBytes = await readFile('src-tauri/src/infrastructure/pdf_proof/fonts/Amiri-Regular.ttf');
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(fontBytes, { status: 200 })) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const documents = new Map<HistoricalReportCode, ReportExportDocument>();
const sheets = new Map<HistoricalReportCode, string>();

/* -------------------------------------------------------------------------- */

describe('WS-I-2 — historical report exports', () => {
  it('builds a document for all eight reports', () => {
    expect(CODES).toHaveLength(8);
    for (const code of CODES) {
      const model = buildHistoricalReportDocument(envelopeFor(code), GENERATED);
      documents.set(code, model);
      expect(model.title).toBe(FR.tabs[code]);
      expect(model.period).toBe('Du 2025-01-01 au 2025-03-31');
      expect(model.blocks.length).toBeGreaterThan(0);
    }
  });

  it('names each downloaded file after its report and the day it was produced', () => {
    expect(historicalReportFilename('PROFIT_AND_LOSS', 'xlsx', GENERATED)).toBe(
      'stockiha-rapport-profit-and-loss-2026-08-26.xlsx',
    );
    expect(historicalReportFilename('SUPPLIER_DEBT_AND_EXPENSES', 'pdf', GENERATED)).toBe(
      'stockiha-rapport-supplier-debt-and-expenses-2026-08-26.pdf',
    );
  });

  it('criterion 1 — every report yields a structurally valid workbook with real numeric money cells', async () => {
    for (const code of CODES) {
      const bytes = buildHistoricalReportXlsx(documents.get(code)!);
      expect(decode(bytes.slice(0, 2))).toBe('PK');
      const files = unzipSync(bytes);
      /* Every part the OPC package declares must actually be present. */
      for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
        expect(Object.keys(files)).toContain(part);
      }
      const sheet = decode(files['xl/worksheets/sheet1.xml']);
      sheets.set(code, sheet);
      /* A money cell carries style 3 or 7 and a bare <v>; it must never be
       * emitted as an inline string or a shared string, which would make it
       * text that Excel refuses to add up. */
      const moneyCells = [...sheet.matchAll(/<c r="[A-Z]+\d+" s="(?:3|7)"><v>(-?\d+(?:\.\d+)?)<\/v><\/c>/g)];
      expect(moneyCells.length).toBeGreaterThan(0);
      expect(sheet).not.toMatch(/<c r="[A-Z]+\d+" t="inlineStr" s="(?:3|7|4)"/);
      expect(sheet).not.toContain('t="s"');
      /* No <v> may hold anything but a plain decimal literal. */
      for (const value of [...sheet.matchAll(/<v>([^<]*)<\/v>/g)]) {
        expect(value[1]).toMatch(/^-?\d+(\.\d+)?$/);
      }
    }
  });

  it('criterion 6 — the monthly sales column sums, in exact centimes, to the on-screen revenue', () => {
    const sheet = sheets.get('MONTHLY_TREND')!;
    /* Column C of the trend table is Ventes. Pull the numeric cells back out
     * of the XML and total them the way a spreadsheet SUM() would — with exact
     * integer centimes, never a float. */
    const values = [...sheet.matchAll(/<c r="C(\d+)" s="3"><v>(-?\d+(?:\.\d+)?)<\/v><\/c>/g)].map(
      (match) => match[2],
    );
    expect(values).toEqual(MONTHS.map((month) => month.salesDzd));
    const centimes = values.reduce((sum, value) => {
      const [whole, fraction = ''] = value.split('.');
      return sum + BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
    }, 0n);
    const asDecimal = `${centimes / 100n}.${String(centimes % 100n).padStart(2, '0')}`;
    expect(asDecimal).toBe(REVENUE);
    /* The same figure the profit-and-loss headline shows. */
    expect(asDecimal).toBe(PROFIT_AND_LOSS.revenueDzd);
  });

  it('criterion 3 — the P&L export carries the cost-free split as its own section, not merged into COGS', () => {
    const model = documents.get('PROFIT_AND_LOSS')!;
    const headings = model.blocks.filter((block) => block.kind === 'heading').map((block) => (block as { text: string }).text);
    expect(headings).toContain(FR.splitTitle);
    expect(headings).toContain(FR.withCostTitle);
    expect(headings).toContain(FR.withoutCostTitle);
    /* The honesty sentence travels with it. */
    const notes = model.blocks.filter((block) => block.kind === 'note').map((block) => (block as { text: string }).text);
    expect(notes).toContain(FR.withoutCostExplain);
    expect(notes).toContain(FR.twoTierExplain);

    const sheet = sheets.get('PROFIT_AND_LOSS')!;
    expect(sheet).toContain(FR.withoutCostTitle);
    /* Cost-free revenue is reported on its own, and is NOT inside the cost of
     * goods sold figure: 400 000 + 50 000 = 450 000, while COGS is 200 001. */
    expect(sheet).toContain('<v>50000.00</v>');
    expect(sheet).toContain('<v>400000.00</v>');
    expect(sheet).toContain('<v>200001.00</v>');
  });

  it('criterion 4 — an unknown margin exports as words, never as 0 and never blank', () => {
    const sheet = sheets.get('SELLERS')!;
    /* The italic style slot (9), holding the literal phrase. */
    expect(sheet).toContain(`t="inlineStr" s="9"><is><t>${FR.unknownMargin}</t></is>`);
    const model = documents.get('SELLERS')!;
    const cells = model.blocks
      .filter((block) => block.kind === 'table')
      .flatMap((block) => (block as { table: { rows: { cells: { kind: string; raw?: string | null }[] }[] } }).table.rows)
      .flatMap((row) => row.cells);
    const noteCells = cells.filter((cell) => cell.kind === 'note');
    expect(noteCells.length).toBeGreaterThan(0);
    /* No money cell anywhere in the sellers report was given a fabricated 0
     * in place of an unknown margin. */
    const unknownRow = model.blocks
      .filter((block) => block.kind === 'table')
      .flatMap((block) => (block as { table: { rows: { cells: { kind: string; text?: string }[] }[] } }).table.rows)
      .find((row) => row.cells.some((cell) => cell.kind === 'note'));
    expect(unknownRow!.cells[unknownRow!.cells.length - 1]).toEqual({ kind: 'note', text: FR.unknownMargin });
  });

  it('criterion 5 — a gated report refuses to export, with the screen\'s own sentence', async () => {
    const gated: HistoricalReportEnvelope = {
      ...envelopeFor('PROFIT_AND_LOSS'),
      canRender: false,
      refusalReason: 'MAPPING_INCOMPLETE',
      report: null,
      readiness: {
        ...envelopeFor('PROFIT_AND_LOSS').readiness!,
        resolvedDescriptionCount: 11,
        unresolvedDescriptionCount: 1,
        unresolvedSellDescriptionCount: 1,
        isComplete: false,
      },
    };
    expect(historicalReportExportRefusal(gated)).toBe(FR.refusalMapping);
    expect(() => buildHistoricalReportDocument(gated, GENERATED)).toThrow(FR.refusalMapping);

    const noBatch: HistoricalReportEnvelope = { ...gated, refusalReason: 'NO_BATCH' };
    expect(historicalReportExportRefusal(noBatch)).toBe(FR.refusalNoBatch);
    /* A renderable report is not refused. */
    expect(historicalReportExportRefusal(envelopeFor('SALES'))).toBeNull();
  });

  it('criterion 2 — every report yields a loadable A4 PDF whose tables fit inside the margins', async () => {
    const { PDFDocument } = await import('pdf-lib');
    for (const code of CODES) {
      const blob = await buildHistoricalReportPdf(documents.get(code)!);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect(decode(bytes.slice(0, 5))).toBe('%PDF-');
      /* pdf-lib parsing its own output back is the strongest structural check
       * available without a viewer: a file Acrobat would offer to repair does
       * not survive a full parse. */
      const parsed = await PDFDocument.load(bytes);
      expect(parsed.getPageCount()).toBeGreaterThan(0);
      for (const page of parsed.getPages()) {
        const size = page.getSize();
        expect(size.width).toBeCloseTo(595.28, 2);
        expect(size.height).toBeCloseTo(841.89, 2);
      }
    }
    /* Eight PDFs, each embedding and subsetting the report font. */
  }, 120_000);

  it('criterion 2 — no table is laid out wider than the printable width', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(new Uint8Array(fontBytes), { subset: false });
    for (const code of CODES) {
      for (const block of documents.get(code)!.blocks) {
        if (block.kind !== 'table') continue;
        const { widths } = layoutTable(block.table, font);
        const total = widths.reduce((sum, width) => sum + width, 0);
        expect(total).toBeLessThanOrEqual(CONTENT_WIDTH + 0.5);
      }
    }
  });

  it('the bundled font covers every character the exports print', async () => {
    const fontkit = (await import('@pdf-lib/fontkit')).default as unknown as {
      create(buffer: Uint8Array): { hasGlyphForCodePoint(cp: number): boolean };
    };
    const font = fontkit.create(fontBytes);
    const { pdfSafe } = await import('../src/features/onboarding/historicalReportExports');
    const seen = new Set<string>();
    for (const model of documents.values()) {
      const strings = [model.title, model.period, model.generatedAt];
      for (const block of model.blocks) {
        if (block.kind === 'heading' || block.kind === 'note') strings.push(block.text);
        else {
          strings.push(...block.table.columns);
          for (const row of block.table.rows) {
            for (const cell of row.cells) {
              if ('text' in cell) strings.push(cell.text);
              if ('raw' in cell && cell.raw !== null) strings.push(cell.raw);
            }
          }
        }
      }
      for (const value of strings) for (const character of pdfSafe(value)) seen.add(character);
    }
    const missing = [...seen].filter((character) => !font.hasGlyphForCodePoint(character.codePointAt(0)!));
    expect(missing.map((c) => `${c} U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)).toEqual([]);
  });
});
