// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
// @ts-expect-error The browser application intentionally excludes Node types; this Node-only test reads a fixture font.
import { readFile } from 'node:fs/promises';
import {
  buildHistoricalAnalyticsPdf,
  buildHistoricalReportModel,
  buildHistoricalTableXlsx,
  HISTORICAL_EXPORT_HEADERS,
} from '../src/features/onboarding/historicalExports';
import type { HistoricalTableRow } from '../src/features/onboarding/historicalTableModel';
import type { HistoricalTradeAnalyticsResult } from '../src/shared/ipc/onboardingDto';

const rows: HistoricalTableRow[] = [
  { transactionSequence: 2, lineSequence: 1, row: 3, reference: 'TX-3', date: '2024-01-05', type: 'PURCHASE', payment: 'UNPAID', party: 'Supplier', product: 'Item 20', brand: null, details: null, quantity: 10, unitPrice: 20, lineTotal: 200, benefit: null },
  { transactionSequence: 1, lineSequence: 1, row: 2, reference: 'TX-20', date: '2025-12-20', type: 'SALE', payment: 'PAID', party: 'Customer', product: 'Item 100', brand: 'B', details: null, quantity: 2, unitPrice: 100, lineTotal: 200, benefit: 500 },
];

describe('historical exports', () => {
  it('creates a real XLSX with headers, numeric cells, date cells, frozen header, and current ordering', () => {
    const bytes = buildHistoricalTableXlsx(rows);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
    const files = unzipSync(bytes);
    const sheet = new TextDecoder().decode(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain(HISTORICAL_EXPORT_HEADERS[0]);
    expect(sheet.match(/<row r=/g)).toHaveLength(3);
    expect(sheet).toContain('<v>10</v>');
    expect(sheet.indexOf('TX-3')).toBeLessThan(sheet.indexOf('TX-20'));
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('s="2"');
    expect(sheet).not.toContain('10 DZD');
  });

  it('builds the PDF report payload from the active analytics period and authoritative KPIs', () => {
    const analytics = {
      overview: { dateFrom: '2024-01-01', dateTo: '2025-12-31', totalSalesDzd: 1000, totalPurchasesDzd: 400, totalExpensesDzd: 100, totalManualBenefitDzd: 300, tradeDifferenceDzd: 500 },
      timeline: [{ month: '2025-01', yearMonth: '2025-01', salesDzd: 1000, purchasesDzd: 400, expensesDzd: 100 }],
      products: [{ productName: 'Desk', matchedProductId: null, qtySold: 1, salesDzd: 1000, qtyPurchased: 0, purchasesDzd: 0 }],
    } as HistoricalTradeAnalyticsResult;
    const model = buildHistoricalReportModel(analytics, 'en', new Date('2026-08-10T12:00:00Z'));
    expect(model.period).toContain('2024-01-01 — 2025-12-31');
    expect(model.kpis.map((kpi) => kpi.value)).toEqual([1000, 400, 100, 300, 600, 500, -200]);
    expect(model.timeline).toHaveLength(1);
    expect(model.topProducts[0].productName).toBe('Desk');
  });

  it('renders a valid vector PDF with the bundled Arabic-capable font', async () => {
    const font = await readFile('src-tauri/src/infrastructure/pdf_proof/fonts/Amiri-Regular.ttf');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(font, { status: 200 });
    try {
      const analytics = {
        overview: { dateFrom: '2024-01-01', dateTo: '2025-12-31', totalSalesDzd: 1000, totalPurchasesDzd: 400, totalExpensesDzd: 100, totalManualBenefitDzd: 300 },
        timeline: [{ month: '2025-01', yearMonth: '2025-01', salesDzd: 1000, purchasesDzd: 400, expensesDzd: 100 }],
        products: [{ productName: 'مكتب', matchedProductId: null, qtySold: 1, salesDzd: 1000, qtyPurchased: 0, purchasesDzd: 0 }],
      } as HistoricalTradeAnalyticsResult;
      const blob = await buildHistoricalAnalyticsPdf(analytics, 'ar');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      expect(blob.type).toBe('application/pdf');
      expect(blob.size).toBeGreaterThan(10_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
