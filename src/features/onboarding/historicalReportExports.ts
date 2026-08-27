import type {
  HistoricalCustomerDebtReport,
  HistoricalCustomerDebtRow,
  HistoricalMonthlyTrendRow,
  HistoricalProfitAndLossReport,
  HistoricalPurchasesReport,
  HistoricalReportBody,
  HistoricalReportCode,
  HistoricalReportEnvelope,
  HistoricalSalesReport,
  HistoricalSellerRow,
  HistoricalSellersReport,
  HistoricalStockValuationReport,
  HistoricalSupplierDebtAndExpensesReport,
} from '../../shared/ipc/onboardingDto';
import amiriFontUrl from '../../../src-tauri/src/infrastructure/pdf_proof/fonts/Amiri-Regular.ttf?url';
import {
  buildXlsxWorkbook,
  downloadExport,
  XLSX_MIME,
  XLSX_STYLE,
  type XlsxCellInput,
} from './historicalExports';
import { FR, money, qty, REPORT_EXPORT_COPY as EX } from './historicalReportCopy';

/**
 * WS-I-2 — the eight historical reports, as .xlsx and as a printable A4 PDF.
 *
 * This module FORMATS; it never computes. Every figure arrives as the exact
 * decimal string PostgreSQL produced, is carried through untouched, and is
 * turned into characters only at the last moment. No money or quantity value
 * ever passes through `Number()`, `parseFloat()` or arithmetic of any kind —
 * the exported file must agree with the screen to the centime, and a double
 * cannot promise that.
 *
 * Three rules it inherits from the screen and never bends:
 *
 *   - a report the readiness gate refused is refused here too. `report` arrives
 *     null and there is nothing to format, so the export cannot invent one;
 *   - wherever a profit appears, the paper's own figure, the computed figure
 *     and the gap between them appear together — an export that hides what the
 *     screen shows would be worse than no export at all;
 *   - a sale with no known purchase cost is never priced at zero. Its revenue
 *     gets its own section, and an unknown margin prints the words « marge
 *     inconnue », never 0 and never a blank.
 *
 * Both output formats are rendered from ONE intermediate document, built once
 * per report. That is what makes the second and third rules structural rather
 * than a pair of promises: the PDF and the workbook cannot drift apart, because
 * neither of them decides what the report contains.
 */

/* -------------------------------------------------------------------------- */
/* The intermediate document                                                  */
/* -------------------------------------------------------------------------- */

export type ReportCell =
  /** A row or column heading. */
  | { kind: 'label'; text: string }
  | { kind: 'text'; text: string }
  /** Prose that stands where a number would: « marge inconnue ». Never a 0. */
  | { kind: 'note'; text: string }
  /** `raw` is an exact decimal string, or null when the figure does not exist. */
  | { kind: 'money'; raw: string | null }
  | { kind: 'qty'; raw: string | null }
  | { kind: 'count'; value: number }
  | { kind: 'empty' };

export interface ReportRow {
  cells: ReportCell[];
  /** A total or a headline figure. */
  strong?: boolean;
}

export interface ReportTable {
  columns: string[];
  rows: ReportRow[];
}

export type ReportBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'table'; table: ReportTable };

export interface ReportExportDocument {
  code: HistoricalReportCode;
  title: string;
  period: string;
  generatedAt: string;
  blocks: ReportBlock[];
}

const L = (text: string): ReportCell => ({ kind: 'label', text });
const T = (text: string): ReportCell => ({ kind: 'text', text });
const NOTE = (text: string): ReportCell => ({ kind: 'note', text });
const M = (raw: string | null | undefined): ReportCell => ({ kind: 'money', raw: raw ?? null });
const Q = (raw: string | null | undefined): ReportCell => ({ kind: 'qty', raw: raw ?? null });
const C = (value: number): ReportCell => ({ kind: 'count', value });
const EMPTY: ReportCell = { kind: 'empty' };

const heading = (text: string): ReportBlock => ({ kind: 'heading', text });
const note = (text: string): ReportBlock => ({ kind: 'note', text });
const table = (columns: string[], rows: ReportRow[]): ReportBlock => ({
  kind: 'table',
  table: { columns, rows },
});

/** A two-column figure/amount table, the shape most of these reports use. */
const figureRow = (label: string, raw: string | null, strong = false): ReportRow => ({
  cells: [L(label), M(raw)],
  strong,
});
const countRow = (label: string, value: number): ReportRow => ({ cells: [L(label), C(value)] });
const FIGURE_COLUMNS = [FR.figure, FR.amount];

/* -------------------------------------------------------------------------- */
/* Period and refusal                                                         */
/* -------------------------------------------------------------------------- */

export function describeExportPeriod(dateFrom: string | null, dateTo: string | null): string {
  if (dateFrom !== null && dateTo !== null) return EX.periodBetween(dateFrom, dateTo);
  if (dateFrom !== null) return EX.periodFrom(dateFrom);
  if (dateTo !== null) return EX.periodTo(dateTo);
  return EX.periodAll;
}

/**
 * The export gate. It is the SCREEN's gate, re-read rather than re-decided: the
 * database already refused to return a report, so there is no number here to
 * export even by mistake. Returns the plain-French reason, or null when the
 * report may be exported.
 */
export function historicalReportExportRefusal(
  envelope: HistoricalReportEnvelope | null,
): string | null {
  if (envelope === null) return FR.refusalMapping;
  if (envelope.refusalReason === 'NO_BATCH') return FR.refusalNoBatch;
  if (!envelope.canRender || envelope.report === null) return FR.refusalMapping;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Report 1 — profit and loss                                                 */
/* -------------------------------------------------------------------------- */

function profitAndLossBlocks(report: HistoricalProfitAndLossReport): ReportBlock[] {
  return [
    table(FIGURE_COLUMNS, [
      figureRow(FR.revenue, report.revenueDzd),
      figureRow(FR.cogs, report.cogsDzd),
      figureRow(FR.grossProfit, report.grossProfitDzd, true),
      figureRow(FR.expenses, report.expensesDzd),
      figureRow(FR.netProfit, report.netProfitDzd, true),
      figureRow(FR.purchases, report.purchasesDzd),
      figureRow(FR.customerDebt, report.customerDebtDzd),
      figureRow(FR.supplierDebt, report.supplierDebtDzd),
      figureRow(FR.unpaidExpenses, report.unpaidExpensesDzd),
    ]),
    note(FR.headlineNote),

    /* The cost-free split is a first-class section, never folded into the cost
     * of goods sold: these sales are a permanent feature of a shop that held
     * stock before its paper records began, and their revenue has no cost and
     * no margin at all. */
    heading(FR.splitTitle),
    heading(FR.withCostTitle),
    table(FIGURE_COLUMNS, [
      figureRow(FR.revenueWithCost, report.revenueWithCostDzd),
      figureRow(FR.cogs, report.cogsDzd),
      figureRow(FR.grossOnCosted, report.grossProfitOnCostedSalesDzd, true),
      countRow(FR.linesWithCost, report.saleLinesWithCostCount),
    ]),
    heading(FR.withoutCostTitle),
    note(FR.withoutCostExplain),
    table(FIGURE_COLUMNS, [
      figureRow(FR.revenueWithoutCost, report.revenueWithoutCostDzd, true),
      countRow(FR.linesWithoutCost, report.saleLinesWithoutCostCount),
      countRow(FR.reasonNoPurchase, report.costFreeNoPurchaseCount),
      countRow(FR.reasonNoQuantity, report.costFreeNoQuantityCount),
    ]),
    heading(FR.totalRevenueTitle),
    table(FIGURE_COLUMNS, [
      figureRow(FR.revenueWithCost, report.revenueWithCostDzd),
      figureRow(FR.revenueWithoutCost, report.revenueWithoutCostDzd),
      figureRow(FR.totalRevenueTitle, report.revenueDzd, true),
    ]),
    note(FR.totalRevenueExplain),

    /* Always all three figures together, never one alone. */
    heading(FR.twoTierTitle),
    table(FIGURE_COLUMNS, [
      figureRow(FR.recordedBenefit, report.recordedBenefitDzd),
      figureRow(FR.computedGross, report.grossProfitDzd),
      figureRow(FR.computedNet, report.netProfitDzd),
      figureRow(FR.gapVsGross, report.gapVsGrossDzd, true),
      figureRow(FR.gapVsNet, report.gapVsNetDzd, true),
    ]),
    note(FR.twoTierExplain),

    heading(FR.countsTitle),
    table(FIGURE_COLUMNS, [
      countRow(FR.saleLineCount, report.saleLineCount),
      countRow(FR.monthCount, report.monthCount),
      countRow(FR.withBenefit, report.salesWithRecordedBenefitCount),
      countRow(FR.withoutBenefit, report.salesWithoutRecordedBenefitCount),
    ]),
  ];
}

/* -------------------------------------------------------------------------- */
/* Report 2 — monthly trend                                                   */
/* -------------------------------------------------------------------------- */

function monthlyTrendBlocks(rows: HistoricalMonthlyTrendRow[]): ReportBlock[] {
  if (rows.length === 0) return [note(FR.trendEmpty)];
  return [
    table(
      [
        FR.month,
        FR.purchases,
        FR.revenue,
        FR.cogs,
        FR.grossProfit,
        FR.expenses,
        FR.netProfit,
        /* The two-tier pair, per month. */
        FR.recordedBenefit,
        FR.gapVsGross,
      ],
      rows.map((row) => ({
        cells: [
          L(row.month),
          M(row.purchasesDzd),
          M(row.salesDzd),
          M(row.cogsDzd),
          M(row.grossProfitDzd),
          M(row.expensesDzd),
          M(row.netProfitDzd),
          M(row.recordedBenefitDzd),
          M(row.gapVsGrossDzd),
        ],
      })),
    ),
    note(FR.twoTierExplain),
    note(FR.headlineNote),
  ];
}

/* -------------------------------------------------------------------------- */
/* Reports 3 and 4 — purchases and sales                                      */
/* -------------------------------------------------------------------------- */

interface PartyRow {
  party: string | null;
  totalDzd: string;
  quantity: string;
  lineCount: number;
  transactionCount: number;
  unpaidDzd?: string;
}

function partyTable(
  partyLabel: string,
  unspecifiedLabel: string,
  rows: PartyRow[],
  showUnpaid: boolean,
): ReportBlock {
  if (rows.length === 0) return note(FR.emptyRows);
  const columns = showUnpaid
    ? [partyLabel, FR.amount, FR.unpaidColumn, FR.quantity, FR.lines, FR.operations]
    : [partyLabel, FR.amount, FR.quantity, FR.lines, FR.operations];
  return table(
    columns,
    rows.map((row) => ({
      cells: [
        L(row.party ?? unspecifiedLabel),
        M(row.totalDzd),
        ...(showUnpaid ? [M(row.unpaidDzd ?? null)] : []),
        Q(row.quantity),
        C(row.lineCount),
        C(row.transactionCount),
      ],
    })),
  );
}

function productTable(
  rows: { canonicalKey: string; label: string; totalDzd: string; quantity: string; lineCount: number; transactionCount: number }[],
): ReportBlock {
  if (rows.length === 0) return note(FR.emptyRows);
  return table(
    [FR.product, FR.amount, FR.quantity, FR.lines, FR.operations],
    rows.map((row) => ({
      cells: [L(row.label), M(row.totalDzd), Q(row.quantity), C(row.lineCount), C(row.transactionCount)],
    })),
  );
}

function purchasesBlocks(report: HistoricalPurchasesReport): ReportBlock[] {
  return [
    table(FIGURE_COLUMNS, [
      { cells: [L(FR.total), M(report.totalDzd)], strong: true },
      { cells: [L(FR.quantity), Q(report.totalQuantity)] },
      countRow(FR.operations, report.transactionCount),
      countRow(FR.supplier, report.supplierCount),
      countRow(FR.product, report.productCount),
      figureRow(FR.unspecifiedSupplier, report.unspecifiedSupplierTotalDzd),
    ]),
    heading(FR.bySupplierTitle),
    partyTable(FR.supplier, FR.unspecifiedSupplier, report.bySupplier, false),
    heading(FR.byProductPurchaseTitle),
    note(FR.canonicalNote),
    productTable(report.byProduct),
  ];
}

function salesBlocks(report: HistoricalSalesReport): ReportBlock[] {
  return [
    table(FIGURE_COLUMNS, [
      { cells: [L(FR.total), M(report.totalDzd)], strong: true },
      { cells: [L(FR.quantity), Q(report.totalQuantity)] },
      countRow(FR.operations, report.transactionCount),
      countRow(FR.customer, report.customerCount),
      countRow(FR.product, report.productCount),
      figureRow(FR.unspecifiedCustomer, report.unspecifiedCustomerTotalDzd),
    ]),
    heading(FR.byCustomerTitle),
    partyTable(FR.customer, FR.unspecifiedCustomer, report.byCustomer, true),
    heading(FR.byProductSaleTitle),
    note(FR.canonicalNote),
    productTable(report.byProduct),
  ];
}

/* -------------------------------------------------------------------------- */
/* Report 5 — best and worst sellers                                          */
/* -------------------------------------------------------------------------- */

function sellerRanking(title: string, rows: HistoricalSellerRow[]): ReportBlock[] {
  if (rows.length === 0) return [heading(title), note(FR.sellersEmpty)];
  return [
    heading(title),
    table(
      [FR.product, FR.quantitySold, FR.revenue, FR.margin],
      rows.map((row) => ({
        cells: [
          L(row.label),
          Q(row.quantitySold),
          M(row.revenueDzd),
          /* Never a computed figure when the cost is unknown: a missing cost
           * read as zero would print a 100 % margin. The words go into the
           * cell instead — in the workbook too, where a 0 would be summed. */
          row.marginKnown ? M(row.marginDzd) : NOTE(FR.unknownMargin),
        ],
      })),
    ),
  ];
}

function sellersBlocks(report: HistoricalSellersReport): ReportBlock[] {
  return [
    note(FR.sellersIntro),
    ...sellerRanking(FR.bestByQuantity, report.bestByQuantity),
    ...sellerRanking(FR.worstByQuantity, report.worstByQuantity),
    ...sellerRanking(FR.bestByMargin, report.bestByMargin),
    ...sellerRanking(FR.worstByMargin, report.worstByMargin),
    ...(report.unknownMargin.length > 0
      ? [note(FR.unknownMarginExplain), ...sellerRanking(FR.unknownMarginTitle, report.unknownMargin)]
      : []),
  ];
}

/* -------------------------------------------------------------------------- */
/* Reports 6 and 7 — debt                                                     */
/* -------------------------------------------------------------------------- */

function debtBlocks(
  rows: HistoricalCustomerDebtRow[],
  partyLabel: string,
  emptyLabel: string,
  totalDzd: string,
  partyCount: number,
  transactionCount: number,
): ReportBlock[] {
  if (rows.length === 0) return [note(emptyLabel)];
  return [
    table(
      [partyLabel, FR.balance, FR.transactions, FR.oldest, FR.newest],
      [
        ...rows.map((row) => ({
          cells: [
            L(row.party ?? FR.unspecifiedParty),
            M(row.balanceDzd),
            C(row.transactionCount),
            T(row.oldestDate),
            T(row.newestDate),
          ],
        })),
        {
          cells: [
            L(FR.debtTotal),
            M(totalDzd),
            C(transactionCount),
            T(FR.debtPartyCount(partyCount)),
            EMPTY,
          ],
          strong: true,
        },
      ],
    ),
  ];
}

function customerDebtBlocks(report: HistoricalCustomerDebtReport): ReportBlock[] {
  return [
    note(FR.debtExplain),
    ...debtBlocks(
      report.rows,
      FR.customer,
      FR.debtEmpty,
      report.totalDzd,
      report.partyCount,
      report.transactionCount,
    ),
  ];
}

function supplierDebtAndExpensesBlocks(
  report: HistoricalSupplierDebtAndExpensesReport,
): ReportBlock[] {
  const expenses = report.expenses;
  return [
    heading(FR.supplierSectionTitle),
    note(FR.supplierDebtExplain),
    ...debtBlocks(
      report.supplier.rows,
      FR.supplier,
      FR.supplierDebtEmpty,
      report.supplier.totalDzd,
      report.supplier.partyCount,
      report.supplier.transactionCount,
    ),
    heading(FR.expensesTitle),
    note(FR.expensesExplain),
    ...(expenses.rows.length === 0
      ? [note(FR.expensesEmpty)]
      : [
          table(
            [FR.category, FR.amount, FR.unpaidColumn, FR.lines, FR.operations],
            [
              ...expenses.rows.map((row) => ({
                cells: [
                  L(row.category ?? FR.uncategorized),
                  M(row.totalDzd),
                  M(row.unpaidDzd),
                  C(row.lineCount),
                  C(row.transactionCount),
                ],
              })),
              {
                cells: [
                  L(FR.total),
                  M(expenses.totalDzd),
                  M(expenses.unpaidTotalDzd),
                  C(expenses.lineCount),
                  EMPTY,
                ],
                strong: true,
              },
            ],
          ),
        ]),
  ];
}

/* -------------------------------------------------------------------------- */
/* Report 8 — stock valuation                                                 */
/* -------------------------------------------------------------------------- */

function stockValuationBlocks(report: HistoricalStockValuationReport): ReportBlock[] {
  return [
    note(FR.stockIntro),
    ...(report.asOfDate !== null ? [note(FR.stockAsOf(report.asOfDate))] : []),
    ...(report.rows.length === 0
      ? [note(FR.stockEmpty)]
      : [
          table(
            [FR.product, FR.stockQuantity, FR.stockUnitCost, FR.stockValue],
            [
              ...report.rows.map((row) => ({
                cells: [L(row.label), Q(row.quantity), M(row.unitCostDzd), M(row.valueDzd)],
              })),
              {
                cells: [L(FR.stockTotal), Q(report.totalQuantity), EMPTY, M(report.totalValueDzd)],
                strong: true,
              },
            ],
          ),
        ]),
    heading(FR.stockProofTitle),
    table(FIGURE_COLUMNS, [
      figureRow(FR.stockProof, report.totalPurchasedDzd),
      figureRow(FR.stockProofCogs, report.totalCogsDzd),
      figureRow(FR.stockProofStock, report.totalValueDzd),
      figureRow(FR.stockProofResidual, report.balanceResidualDzd, true),
    ]),
    note(report.balances ? FR.stockProofOk : FR.stockProofFail),
  ];
}

/* -------------------------------------------------------------------------- */
/* The document                                                               */
/* -------------------------------------------------------------------------- */

function blocksFor(code: HistoricalReportCode, report: HistoricalReportBody): ReportBlock[] {
  switch (code) {
    case 'PROFIT_AND_LOSS':
      return profitAndLossBlocks(report as HistoricalProfitAndLossReport);
    case 'MONTHLY_TREND':
      return monthlyTrendBlocks(report as HistoricalMonthlyTrendRow[]);
    case 'PURCHASES':
      return purchasesBlocks(report as HistoricalPurchasesReport);
    case 'SALES':
      return salesBlocks(report as HistoricalSalesReport);
    case 'SELLERS':
      return sellersBlocks(report as HistoricalSellersReport);
    case 'CUSTOMER_DEBT':
      return customerDebtBlocks(report as HistoricalCustomerDebtReport);
    case 'SUPPLIER_DEBT_AND_EXPENSES':
      return supplierDebtAndExpensesBlocks(report as HistoricalSupplierDebtAndExpensesReport);
    case 'STOCK_VALUATION':
      return stockValuationBlocks(report as HistoricalStockValuationReport);
  }
}

/**
 * Builds the one document both exporters render. Throws when the readiness gate
 * refused the report, so no caller can format a number the screen would hide.
 */
export function buildHistoricalReportDocument(
  envelope: HistoricalReportEnvelope,
  generatedAt = new Date(),
): ReportExportDocument {
  const refusal = historicalReportExportRefusal(envelope);
  if (refusal !== null || envelope.report === null) {
    throw new Error(refusal ?? FR.refusalMapping);
  }
  return {
    code: envelope.reportCode,
    title: FR.tabs[envelope.reportCode],
    period: describeExportPeriod(envelope.dateFrom, envelope.dateTo),
    generatedAt: `${EX.generatedAt} ${new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(generatedAt)}`,
    blocks: blocksFor(envelope.reportCode, envelope.report),
  };
}

/* -------------------------------------------------------------------------- */
/* Excel                                                                      */
/* -------------------------------------------------------------------------- */

function isNumericCell(cell: ReportCell): boolean {
  return cell.kind === 'money' || cell.kind === 'qty' || cell.kind === 'count';
}

/**
 * One cell of the intermediate document, as a workbook cell.
 *
 * Money and quantities become REAL numeric cells holding the exact decimal
 * string PostgreSQL produced — the accountant can select the column and let
 * Excel SUM it. The display grouping is a number FORMAT on the cell, never
 * baked into the value, because a formatted string would be text and text does
 * not add up.
 */
function xlsxCell(cell: ReportCell, strong: boolean): XlsxCellInput {
  switch (cell.kind) {
    case 'empty':
      return { t: 'blank' };
    case 'money':
      return { t: 'number', v: cell.raw, s: strong ? XLSX_STYLE.boldMoney : XLSX_STYLE.money };
    case 'qty':
      /* The screen shows whole units; the workbook stores the exact figure and
       * displays it with no decimals, so the two agree without rounding. */
      return { t: 'number', v: cell.raw, s: XLSX_STYLE.integer };
    case 'count':
      return { t: 'number', v: String(cell.value), s: XLSX_STYLE.integer };
    case 'note':
      /* Stays text on purpose: « marge inconnue » must never become a 0 that
       * a column total would silently absorb. */
      return { t: 'text', v: cell.text, s: XLSX_STYLE.italic };
    default:
      return { t: 'text', v: cell.text, s: strong ? XLSX_STYLE.bold : XLSX_STYLE.general };
  }
}

export function buildHistoricalReportXlsx(model: ReportExportDocument): Uint8Array {
  const rows: XlsxCellInput[][] = [
    [{ t: 'text', v: model.title, s: XLSX_STYLE.title }],
    [{ t: 'text', v: model.period, s: XLSX_STYLE.general }],
    [{ t: 'text', v: model.generatedAt, s: XLSX_STYLE.general }],
    [{ t: 'text', v: EX.source, s: XLSX_STYLE.general }],
    [],
  ];

  let widest = 2;
  for (const block of model.blocks) {
    if (block.kind === 'heading') {
      rows.push([]);
      rows.push([{ t: 'text', v: block.text, s: XLSX_STYLE.bold }]);
      continue;
    }
    if (block.kind === 'note') {
      rows.push([{ t: 'text', v: block.text, s: XLSX_STYLE.wrapped }]);
      continue;
    }
    widest = Math.max(widest, block.table.columns.length);
    rows.push(block.table.columns.map((column) => ({ t: 'text', v: column, s: XLSX_STYLE.header })));
    for (const row of block.table.rows) {
      rows.push(row.cells.map((cell) => xlsxCell(cell, row.strong === true)));
    }
    rows.push([]);
  }

  const columnWidths = [46, ...Array.from({ length: Math.max(1, widest - 1) }, () => 20)];
  return buildXlsxWorkbook([{ name: model.title, columnWidths, rows }]);
}

/* -------------------------------------------------------------------------- */
/* PDF — A4, French, plain tables                                             */
/* -------------------------------------------------------------------------- */

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
/** ~15 mm. Inside every consumer printer's unprintable border. */
const MARGIN = 42;
const BOTTOM = 52;
export const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

/**
 * Amiri carries the Latin alphabet and French accents, but a few typographic
 * code points used on screen have no glyph in it. Substituting them here keeps
 * the printed figure readable instead of dropping a blank box into a number —
 * the VALUE never changes, only the character that separates or signs it.
 */
export function pdfSafe(value: string): string {
  return (
    value
      /* U+202F narrow no-break space (the French thousands separator) and
       * U+00A0 no-break space; Amiri carries neither. */
      .replace(/[  ]/g, ' ')
      /* U+2212 true minus sign. */
      .replace(/−/g, '-')
  );
}

/** The cell's printed text — the exact same string the screen shows. */
function cellText(cell: ReportCell): string {
  switch (cell.kind) {
    case 'empty':
      return '';
    case 'money':
      return money(cell.raw);
    case 'qty':
      return qty(cell.raw);
    case 'count':
      return String(cell.value);
    default:
      return cell.text;
  }
}

export interface PdfFont {
  widthOfTextAtSize(text: string, size: number): number;
}

function wrapText(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word !== '');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines.length === 0 ? [''] : lines;
}

/** Shortens a label until it fits. Only ever applied to text, never a figure. */
function fitText(text: string, font: PdfFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

/**
 * Column widths that fit the page. Numeric columns get whatever their widest
 * figure needs and are never squeezed — a truncated amount would be a wrong
 * amount. Text columns absorb the remainder, and the font steps down before
 * anything is shortened.
 */
export function layoutTable(
  reportTable: ReportTable,
  font: PdfFont,
): { size: number; widths: number[] } {
  const padding = 6;
  for (const size of [8, 7.5, 7, 6.5, 6]) {
    const numeric = reportTable.columns.map((_, index) =>
      reportTable.rows.every((row) => row.cells[index] === undefined || isNumericCell(row.cells[index]) || row.cells[index].kind === 'empty'),
    );
    const natural = reportTable.columns.map((column, index) => {
      let width = font.widthOfTextAtSize(pdfSafe(column), size);
      for (const row of reportTable.rows) {
        const cell = row.cells[index];
        if (cell === undefined) continue;
        width = Math.max(width, font.widthOfTextAtSize(pdfSafe(cellText(cell)), size));
      }
      return width + padding;
    });
    const total = natural.reduce((sum, width) => sum + width, 0);
    if (total <= CONTENT_WIDTH) {
      /* Spare room goes to the first text column, so labels breathe. */
      const spare = CONTENT_WIDTH - total;
      const flexible = natural.findIndex((_, index) => !numeric[index]);
      const widths = natural.slice();
      if (flexible >= 0) widths[flexible] += spare;
      return { size, widths };
    }
    if (size === 6) {
      const numericTotal = natural.reduce((sum, width, index) => sum + (numeric[index] ? width : 0), 0);
      const textIndexes = natural.map((_, index) => index).filter((index) => !numeric[index]);
      const available = Math.max(40 * textIndexes.length, CONTENT_WIDTH - numericTotal);
      const textTotal = textIndexes.reduce((sum, index) => sum + natural[index], 0) || 1;
      const widths = natural.map((width, index) =>
        numeric[index] ? width : (natural[index] / textTotal) * available,
      );
      return { size, widths };
    }
  }
  return { size: 6, widths: reportTable.columns.map(() => CONTENT_WIDTH / reportTable.columns.length) };
}

export async function buildHistoricalReportPdf(model: ReportExportDocument): Promise<Blob> {
  const [{ PDFDocument, rgb }, fontkitModule, fontResponse] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
    fetch(amiriFontUrl),
  ]);
  if (!fontResponse.ok) throw new Error('Report font could not be loaded.');
  const fontBytes = new Uint8Array(await fontResponse.arrayBuffer());
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkitModule.default);
  const font = await doc.embedFont(fontBytes, { subset: true });

  const ink = rgb(23 / 255, 32 / 255, 51 / 255);
  const muted = rgb(88 / 255, 100 / 255, 120 / 255);
  const band = rgb(233 / 255, 238 / 255, 246 / 255);
  const rule = rgb(200 / 255, 208 / 255, 220 / 255);

  const pages = [doc.addPage([A4_WIDTH, A4_HEIGHT])];
  let page = pages[0];
  let cursorY = A4_HEIGHT - MARGIN;

  const write = (text: string, x: number, y: number, size: number, color = ink) => {
    page.drawText(pdfSafe(text), { x, y, size, font, color });
  };
  const writeRight = (text: string, right: number, y: number, size: number, color = ink) => {
    const safe = pdfSafe(text);
    page.drawText(safe, { x: right - font.widthOfTextAtSize(safe, size), y, size, font, color });
  };
  const newPage = () => {
    page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    pages.push(page);
    cursorY = A4_HEIGHT - MARGIN;
  };
  const ensure = (needed: number) => {
    if (cursorY - needed < BOTTOM) newPage();
  };

  /* ---- cover block, page 1 only ---------------------------------------- */
  write(model.title, MARGIN, cursorY - 16, 16);
  cursorY -= 32;
  write(model.period, MARGIN, cursorY, 9, muted);
  cursorY -= 13;
  write(model.generatedAt, MARGIN, cursorY, 9, muted);
  cursorY -= 13;
  for (const line of wrapText(pdfSafe(EX.source), font, 8, CONTENT_WIDTH)) {
    write(line, MARGIN, cursorY, 8, muted);
    cursorY -= 11;
  }
  cursorY -= 10;

  /* ---- blocks ----------------------------------------------------------- */
  for (const block of model.blocks) {
    if (block.kind === 'heading') {
      ensure(30);
      cursorY -= 8;
      write(block.text, MARGIN, cursorY, 11);
      cursorY -= 14;
      continue;
    }

    if (block.kind === 'note') {
      const lines = wrapText(pdfSafe(block.text), font, 8, CONTENT_WIDTH);
      for (const line of lines) {
        ensure(12);
        write(line, MARGIN, cursorY, 8, muted);
        cursorY -= 10.5;
      }
      cursorY -= 6;
      continue;
    }

    const { size, widths } = layoutTable(block.table, font);
    const rowHeight = size + 7;
    const numeric = block.table.columns.map((_, index) =>
      block.table.rows.every(
        (row) =>
          row.cells[index] === undefined ||
          isNumericCell(row.cells[index]) ||
          row.cells[index].kind === 'empty',
      ),
    );
    const drawHeader = () => {
      ensure(rowHeight * 2);
      page.drawRectangle({
        x: MARGIN,
        y: cursorY - rowHeight + 3,
        width: widths.reduce((sum, width) => sum + width, 0),
        height: rowHeight,
        color: band,
      });
      let x = MARGIN;
      block.table.columns.forEach((column, index) => {
        const text = fitText(pdfSafe(column), font, size, widths[index] - 6);
        if (numeric[index]) writeRight(text, x + widths[index] - 3, cursorY - size + 1, size);
        else write(text, x + 3, cursorY - size + 1, size);
        x += widths[index];
      });
      cursorY -= rowHeight;
      page.drawRectangle({
        x: MARGIN,
        y: cursorY + 2,
        width: widths.reduce((sum, width) => sum + width, 0),
        height: 0.6,
        color: rule,
      });
    };

    drawHeader();
    for (const row of block.table.rows) {
      if (cursorY - rowHeight < BOTTOM) {
        newPage();
        drawHeader();
      }
      let x = MARGIN;
      row.cells.forEach((cell, index) => {
        const width = widths[index] ?? 0;
        if (cell.kind !== 'empty') {
          const raw = pdfSafe(cellText(cell));
          /* A figure is never shortened; only a label is. */
          const text = isNumericCell(cell) ? raw : fitText(raw, font, size, width - 6);
          if (isNumericCell(cell)) writeRight(text, x + width - 3, cursorY - size + 1, size);
          else write(text, x + 3, cursorY - size + 1, size, cell.kind === 'note' ? muted : ink);
        }
        x += width;
      });
      if (row.strong === true) {
        page.drawRectangle({
          x: MARGIN,
          y: cursorY - rowHeight + 4,
          width: widths.reduce((sum, width) => sum + width, 0),
          height: 0.6,
          color: rule,
        });
      }
      cursorY -= rowHeight;
    }
    cursorY -= 10;
  }

  /* ---- footer ----------------------------------------------------------- */
  pages.forEach((reportPage, index) => {
    const label = pdfSafe(EX.page(index + 1, pages.length));
    reportPage.drawText(label, {
      x: (A4_WIDTH - font.widthOfTextAtSize(label, 8)) / 2,
      y: 26,
      size: 8,
      font,
      color: muted,
    });
  });

  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}

/* -------------------------------------------------------------------------- */
/* Download wiring                                                            */
/* -------------------------------------------------------------------------- */

export function historicalReportFilename(
  code: HistoricalReportCode,
  extension: 'xlsx' | 'pdf',
  date = new Date(),
): string {
  const slug = code.toLowerCase().replace(/_/g, '-');
  return `stockiha-rapport-${slug}-${date.toISOString().slice(0, 10)}.${extension}`;
}

export function exportHistoricalReportXlsx(
  envelope: HistoricalReportEnvelope,
  date = new Date(),
): void {
  const model = buildHistoricalReportDocument(envelope, date);
  const bytes = buildHistoricalReportXlsx(model);
  downloadExport(
    new Blob([bytes], { type: XLSX_MIME }),
    historicalReportFilename(envelope.reportCode, 'xlsx', date),
  );
}

export async function exportHistoricalReportPdf(
  envelope: HistoricalReportEnvelope,
  date = new Date(),
): Promise<void> {
  const model = buildHistoricalReportDocument(envelope, date);
  const blob = await buildHistoricalReportPdf(model);
  downloadExport(blob, historicalReportFilename(envelope.reportCode, 'pdf', date));
}
