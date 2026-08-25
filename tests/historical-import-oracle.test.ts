import { describe, expect, it } from 'vitest';
// @ts-expect-error The browser application intentionally excludes Node types; this test reads a repository fixture.
import { readFile } from 'node:fs/promises';

import {
  canonicalDecimalText,
  parsePaperBookWorkbook,
  type HistoricalRowIssue,
  type PaperBookWorkbookData,
} from '../src/features/onboarding/xlsxParser';

/**
 * Parses the real frozen customer template and checks it against
 * `docs/test-data/Stockiha_TEST_DATASET_expected_results.md` (the oracle).
 *
 * Money is never summed here in application code. Where this test needs an
 * aggregate to compare with the oracle it does the addition itself, in exact
 * BigInt integer arithmetic, purely as a test assertion — the import path
 * carries the amounts to PostgreSQL as strings and never adds them up.
 */

const DATASET = 'docs/test-data/Stockiha_Historical_TEST_DATASET.xlsx';

// A fixed "today" so the future-date rule is deterministic. The dataset was
// generated for a 2026-08 review; row 83 carries 2026-09-08.
const TODAY = '2026-08-25';

async function loadDataset(): Promise<PaperBookWorkbookData> {
  const bytes: Uint8Array = await readFile(DATASET);
  const copy = bytes.slice();
  const file = {
    name: 'Stockiha_Historical_TEST_DATASET.xlsx',
    size: copy.byteLength,
    arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
  } as File;
  return parsePaperBookWorkbook(file, TODAY);
}

/** Exact integer sum, for test assertions only. */
function sumExact(values: Array<string | null>): string {
  let total = 0n;
  for (const value of values) {
    if (value === null) continue;
    total += BigInt(value);
  }
  return total.toString();
}

function issuesForRow(parsed: PaperBookWorkbookData, row: number): HistoricalRowIssue[] {
  return parsed.rowIssues.filter((issue) => issue.row === row);
}

describe('WS-G historical import vs the oracle dataset', () => {
  it('canonicalises stored cell text without arithmetic', () => {
    expect(canonicalDecimalText('160.0')).toBe('160');
    expect(canonicalDecimalText('1.60')).toBe('1.6');
    expect(canonicalDecimalText('0.9')).toBe('0.9');
    expect(canonicalDecimalText('-0.0')).toBe('0');
    expect(canonicalDecimalText('00042')).toBe('42');
    expect(canonicalDecimalText('19880510')).toBe('19880510');
    expect(canonicalDecimalText('15/052025')).toBeNull();
  });

  it('reads 235 transaction headers — 83 Buy, 118 Sell, 34 Expense — one of them blocked', async () => {
    const parsed = await loadDataset();

    // 234 of the 235 headers import as they stand. The 235th is the Buy on
    // row 6, held back by its unreadable date until the owner corrects it.
    expect(parsed.summary.purchaseCount).toBe(82);
    expect(parsed.summary.salesCount).toBe(118);
    expect(parsed.summary.expenseCount).toBe(34);
    expect(parsed.summary.transactionCount).toBe(234);

    const blockedHeaders = parsed.rowIssues.filter((i) => i.blocksRow);
    expect(blockedHeaders.map((i) => i.row)).toEqual([6]);
    expect(parsed.summary.purchaseCount + blockedHeaders.length).toBe(83);
    expect(parsed.summary.transactionCount + blockedHeaders.length).toBe(235);

    // Rows 3..472 carry data; row 2 of the table range is blank, and the
    // =I*J formula filled down over rows 473..501 is template spill-over.
    expect(parsed.summary.dataRowCount).toBe(470);
    expect(parsed.summary.ignoredRowCount).toBe(1);
    // 470 read − 1 page-only row 228 − 1 blocked row 6 = 468 product lines.
    expect(parsed.summary.lineCount).toBe(468);
  });

  it('rejects the malformed date on row 6 and only asks for confirmation on the future date', async () => {
    const parsed = await loadDataset();

    const row6 = issuesForRow(parsed, 6);
    expect(row6.some((i) => i.severity === 'ERROR' && i.column === 'Date')).toBe(true);
    expect(row6[0].probleme).toContain('15/052025');
    expect(row6[0].blocksRow).toBe(true);
    // No error code, no stack trace — plain French with a concrete action.
    expect(row6[0].action).toContain('JJ/MM/AAAA');

    // The oracle names this defect "row 85"; in the regenerated workbook the
    // future-dated header is row 83 (2026-09-08). Row 85 is a continuation
    // line of the same transaction and carries no date at all.
    const row83 = issuesForRow(parsed, 83);
    const future = row83.find((i) => i.column === 'Date');
    expect(future?.severity).toBe('WARNING');
    expect(future?.blocksRow).toBe(false);
    expect(future?.requiresConfirmation).toBe(true);
    expect(future?.probleme).toContain('2026-09-08');
    expect(issuesForRow(parsed, 85)).toEqual([]);
  });

  it('surfaces the numeric Custom Details rows and keeps the displayed value', async () => {
    const parsed = await loadDataset();
    const numericDetailRows = parsed.rowIssues
      .filter((i) => i.column === 'Custom Details (Optional)')
      .map((i) => i.row);
    expect(numericDetailRows).toEqual([16, 38, 41, 42, 43, 46, 63, 94, 95, 107, 136, 190]);

    const byRow = new Map<number, string | null>();
    for (const txn of parsed.transactions) {
      for (const line of txn.lines) byRow.set(line.sourceRowNumber, line.customDetails);
    }
    expect(byRow.get(16)).toBe('1.6');
    expect(byRow.get(38)).toBe('1.8');
    expect(byRow.get(43)).toBe('0.9');
    expect(byRow.get(107)).toBe('160');
    expect(byRow.get(190)).toBe('180');
  });

  it('creates no transaction and no line for the page-only row 228', async () => {
    const parsed = await loadDataset();
    const issue = issuesForRow(parsed, 228)[0];
    expect(issue.severity).toBe('WARNING');
    expect(issue.blocksRow).toBe(false);
    expect(issue.probleme).toContain('16');

    const hasLine = parsed.transactions.some((t) =>
      t.lines.some((l) => l.sourceRowNumber === 228),
    );
    expect(hasLine).toBe(false);
    expect(parsed.transactions.some((t) => t.sourceFirstExcelRow === 228)).toBe(false);
  });

  it('carries the hand-typed Line Total of rows 255, 326 and 420, not quantity x unit price', async () => {
    const parsed = await loadDataset();
    const byRow = new Map<number, { qty: string | null; price: string | null; total: string | null }>();
    for (const txn of parsed.transactions) {
      for (const line of txn.lines) {
        byRow.set(line.sourceRowNumber, {
          qty: line.quantity,
          price: line.unitPriceDzd,
          total: line.manualLineTotalDzd,
        });
      }
    }
    expect(byRow.get(255)).toEqual({ qty: '4', price: '13250', total: '52500' });
    expect(byRow.get(326)).toEqual({ qty: '5', price: '16700', total: '84000' });
    expect(byRow.get(420)).toEqual({ qty: '2', price: '5050', total: '10000' });
  });

  it('imports the 12-line purchase as ONE transaction with 12 lines', async () => {
    const parsed = await loadDataset();
    const twelve = parsed.transactions.filter((t) => t.lines.length === 12);
    expect(twelve.length).toBeGreaterThanOrEqual(1);
    expect(twelve[0].transactionType).toBe('PURCHASE');
    expect(twelve[0].sourceFirstExcelRow).toBe(19);
    expect(new Set(twelve[0].lines.map((l) => l.sourceRowNumber)).size).toBe(12);
  });

  it('keeps blank, zero and negative Benefit distinguishable', async () => {
    const parsed = await loadDataset();
    const byFirstRow = new Map(parsed.transactions.map((t) => [t.sourceFirstExcelRow, t]));

    expect(byFirstRow.get(233)?.manualBenefitDzd).toBeNull(); // blank = unknown
    expect(byFirstRow.get(243)?.manualBenefitDzd).toBe('0'); // a recorded zero
    expect(byFirstRow.get(297)?.manualBenefitDzd).toBe('-4000'); // a recorded loss

    expect(parsed.summary.salesWithManualBenefitCount).toBe(88);
    expect(parsed.summary.salesWithoutManualBenefitCount).toBe(30);
    expect(parsed.summary.benefitZeroCount).toBe(4);
    expect(parsed.summary.benefitNegativeCount).toBe(7);
    expect(parsed.summary.benefitPositiveCount).toBe(77);
  });

  it('accepts blank supplier on purchases and amount-only expense lines', async () => {
    const parsed = await loadDataset();
    const purchases = parsed.transactions.filter((t) => t.transactionType === 'PURCHASE');
    // The oracle counts 36 of 83 purchases with a supplier. One of them is the
    // rejected row 6, whose transaction is absent until the date is corrected.
    expect(purchases.length).toBe(82);
    expect(purchases.filter((t) => t.partyCompany !== null).length).toBe(35);

    const expenses = parsed.transactions.filter((t) => t.transactionType === 'EXPENSE');
    expect(expenses.length).toBe(34);
    for (const expense of expenses) {
      for (const line of expense.lines) {
        // Rule 5: no invented Quantity = 1.
        expect(line.quantity).toBeNull();
        expect(line.unitPriceDzd).toBeNull();
        expect(line.manualLineTotalDzd).not.toBeNull();
      }
    }
  });

  it('reproduces the oracle totals once row 6 is corrected (exact integer arithmetic)', async () => {
    const parsed = await loadDataset();

    // Row 6 is rejected, so its transaction is absent until the owner fixes it.
    expect(parsed.transactions.some((t) => t.sourceFirstExcelRow === 6)).toBe(false);

    const totalsFor = (type: string) =>
      sumExact(
        parsed.transactions
          .filter((t) => t.transactionType === type)
          .flatMap((t) => t.lines.map((l) => l.manualLineTotalDzd)),
      );

    // Row 6 holds a single purchase line of 115 000 DZD (10 x 11 500).
    const purchasesWithoutRow6 = totalsFor('PURCHASE');
    expect(purchasesWithoutRow6).toBe('19765510');
    expect((BigInt(purchasesWithoutRow6) + 115000n).toString()).toBe('19880510');

    expect(totalsFor('SALE')).toBe('4258950');
    expect(totalsFor('EXPENSE')).toBe('565100');

    // Every line total came from column K, so nothing had to be recomputed.
    const missingTotals = parsed.transactions.flatMap((t) =>
      t.lines.filter((l) => l.manualLineTotalDzd === null),
    );
    expect(missingTotals).toEqual([]);
  });

  it('produces a validation report that is French, actionable and never silent', async () => {
    const parsed = await loadDataset();
    expect(parsed.rowIssues.length).toBeGreaterThan(0);
    for (const issue of parsed.rowIssues) {
      expect(issue.probleme.length).toBeGreaterThan(0);
      expect(issue.action.length).toBeGreaterThan(0);
      expect(issue.row).toBeGreaterThan(1);
      // No error codes and no stack traces leak into the owner-facing text.
      expect(issue.probleme).not.toMatch(/[A-Z_]{6,}/);
      expect(issue.action).not.toMatch(/[.]ts:[0-9]|Error:|[ ]at [A-Za-z]+[(]/);
    }
    // Exactly one blocking row: the malformed date on row 6.
    const blocking = parsed.rowIssues.filter((i) => i.blocksRow);
    expect(blocking.map((i) => i.row)).toEqual([6]);
  });
});
